import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { config } from "./config.ts";
import { ensureDefaults, listDocs, loadMeta, patchDoc, toDetail } from "./family.ts";
import { Paperless, PaperlessError } from "./paperless.ts";
import type { PDocument } from "./paperless.ts";

const COOKIE = "akasha_session";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

type Env = { Variables: { paperless: Paperless } };

function isHttps(c: Context): boolean {
  return c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
}

function intParam(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createApp() {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof PaperlessError) {
      const status = err.status === 401 || err.status === 403 || err.status === 404 ? err.status : 502;
      return c.json({ error: "paperless", status: err.status }, status);
    }
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.post("/api/auth/login", async (c) => {
    const { username, password } = await c.req.json<{ username?: string; password?: string }>();
    if (!username || !password) return c.json({ error: "missing" }, 400);
    try {
      const token = await new Paperless(config.paperlessUrl).login(username, password);
      await setSignedCookie(c, COOKIE, token, config.secret, {
        httpOnly: true,
        sameSite: "Lax",
        secure: isHttps(c),
        path: "/",
        maxAge: 60 * 60 * 24 * 180,
      });
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof PaperlessError && e.status === 400) return c.json({ error: "bad_credentials" }, 401);
      throw e;
    }
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    const token = await getSignedCookie(c, config.secret, COOKIE);
    if (!token) return c.json({ error: "unauthenticated" }, 401);
    c.set("paperless", new Paperless(config.paperlessUrl, token));
    await next();
  });

  app.get("/api/me", async (c) => {
    const p = c.var.paperless;
    const [s, profile] = await Promise.all([
      p.json<{ user: { id: number; username: string; is_superuser?: boolean } }>("/api/ui_settings/"),
      p.json<{ first_name?: string }>("/api/profile/").catch(() => ({}) as { first_name?: string }),
    ]);
    return c.json({
      id: s.user.id,
      username: s.user.username,
      displayName: profile.first_name?.trim() || s.user.username,
      isAdmin: !!s.user.is_superuser,
    });
  });

  app.get("/api/meta", async (c) => c.json(await loadMeta(c.var.paperless)));

  app.post("/api/setup", async (c) => {
    const body = await c.req.json<{ people?: string[] }>().catch(() => ({}) as { people?: string[] });
    const people = body.people?.map((s) => s.trim()).filter(Boolean);
    const created = await ensureDefaults(c.var.paperless, people?.length ? people : undefined);
    return c.json({ created, meta: await loadMeta(c.var.paperless) });
  });

  app.get("/api/docs", async (c) => {
    const result = await listDocs(c.var.paperless, {
      q: c.req.query("q")?.trim() || undefined,
      person: intParam(c.req.query("person")),
      category: intParam(c.req.query("category")),
      page: intParam(c.req.query("page")),
      expiringWithinDays: intParam(c.req.query("expiring")),
    });
    return c.json(result);
  });

  app.get("/api/docs/:id{[0-9]+}", async (c) => {
    const p = c.var.paperless;
    const [doc, meta] = await Promise.all([
      p.json<PDocument>(`/api/documents/${c.req.param("id")}/`),
      loadMeta(p),
    ]);
    return c.json(toDetail(doc, meta));
  });

  app.patch("/api/docs/:id{[0-9]+}", async (c) => {
    const body = await c.req.json();
    return c.json(await patchDoc(c.var.paperless, Number(c.req.param("id")), body));
  });

  for (const kind of ["thumb", "preview", "download"] as const) {
    app.get(`/api/docs/:id{[0-9]+}/${kind}`, async (c) => {
      const res = await c.var.paperless.raw(`/api/documents/${c.req.param("id")}/${kind}/`);
      const headers = new Headers();
      for (const h of ["content-type", "content-length", "content-disposition"]) {
        const v = res.headers.get(h);
        if (v) headers.set(h, v);
      }
      headers.set("cache-control", "private, max-age=3600");
      return new Response(res.body, { status: 200, headers });
    });
  }

  app.post("/api/docs", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "missing_file" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "too_large" }, 413);
    const out = new FormData();
    out.append("document", file, file.name || "photo.jpg");
    const title = String(form.get("title") ?? "").trim();
    if (title) out.append("title", title);
    const category = intParam(String(form.get("category") ?? ""));
    if (category) out.append("document_type", String(category));
    for (const person of form.getAll("person")) {
      const id = intParam(String(person));
      if (id) out.append("tags", String(id));
    }
    const task = await c.var.paperless.json<string>("/api/documents/post_document/", { method: "POST", body: out });
    return c.json({ taskId: task });
  });

  app.get("/api/tasks/:id", async (c) => {
    const tasks = await c.var.paperless.json<{ status: string; related_document: string | null; result?: string }[]>(
      `/api/tasks/?task_id=${encodeURIComponent(c.req.param("id"))}`,
    );
    const t = tasks[0];
    if (!t) return c.json({ status: "PENDING", docId: null });
    return c.json({ status: t.status, docId: t.related_document ? Number(t.related_document) : null });
  });

  return app;
}
