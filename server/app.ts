import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { addCategory, approveSignup, loadAiSettings, saveAiSettings, storedAi, syncFamilyOnce, ensureFamilyGroup, listSignups, rejectSignup, requestSignup, shareEverything, applyShare, familyGroupId, getHabit, getRoster, parseShare, refreshRoster, setHabit, shareOf } from "./accounts.ts";
import type { Share } from "./accounts.ts";
import { listAccounts, removeCategory, removePerson, renameCategory, renamePerson, setAccountActive } from "./admin.ts";
import { AiError, aiConfig, aiEnabled, extract, listModels, validBaseUrl } from "./ai.ts";
import { config } from "./config.ts";
import { ensureDefaults, listDocs, loadMeta, patchDoc, toDetail } from "./family.ts";
import { allow, submitFeedback, validate } from "./feedback.ts";
import { Paperless, PaperlessError } from "./paperless.ts";
import type { PDocument } from "./paperless.ts";

const COOKIE = "akasha_session";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_AI_IMAGE_BYTES = 8 * 1024 * 1024;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map<string, number[]>();

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
  const ready = loadAiSettings().catch((e) => console.warn("could not load AI settings:", e.message));

  app.onError((err, c) => {
    if (err instanceof PaperlessError) {
      const status = err.status === 401 || err.status === 403 || err.status === 404 ? err.status : 502;
      return c.json({ error: "paperless", status: err.status }, status);
    }
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.use("/api/*", async (_c, next) => {
    await ready;
    await next();
  });

  const clientIp = (c: Context) =>
    c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

  app.post("/api/auth/login", async (c) => {
    const { username, password } = await c.req.json<{ username?: string; password?: string }>();
    if (!username || !password) return c.json({ error: "missing" }, 400);
    // Slow down password guessing: 10 wrong passwords per 15 minutes per address.
    const ip = clientIp(c);
    const now = Date.now();
    const recent = (loginFailures.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_MAX_FAILURES) return c.json({ error: "rate_limited" }, 429);
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
      if (e instanceof PaperlessError && e.status === 400) {
        loginFailures.set(ip, [...recent, now]);
        return c.json({ error: "bad_credentials" }, 401);
      }
      throw e;
    }
  });

  // Public: anyone can ask for an account; an admin approves it in Settings.
  app.post("/api/signup", async (c) => {
    if (!allow(`signup:${clientIp(c)}`, Date.now(), 5)) return c.json({ error: "rate_limited" }, 429);
    const error = await requestSignup(await c.req.json().catch(() => ({})));
    return error ? c.json({ error }, 400) : c.json({ ok: true });
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
    if (s.user.is_superuser) syncFamilyOnce(p);
    return c.json({
      id: s.user.id,
      username: s.user.username,
      displayName: profile.first_name?.trim() || s.user.username,
      isAdmin: !!s.user.is_superuser,
      ai: aiEnabled(),
      share: await getHabit(s.user.id),
    });
  });

  // Accounts a document can be shared with (everyone but yourself).
  app.get("/api/family", async (c) => {
    const me = await whoami(c.var.paperless);
    const roster = me.isAdmin ? await refreshRoster(c.var.paperless) : await getRoster();
    return c.json(roster.filter((m) => m.id !== me.id));
  });

  // Upload task id -> who should see the new document, until it is shared.
  const pendingShares = new Map<string, Share>();

  async function whoami(p: Paperless) {
    const s = await p.json<{ user: { id: number; is_superuser?: boolean } }>("/api/ui_settings/");
    return { id: s.user.id, isAdmin: !!s.user.is_superuser };
  }
  const isAdmin = async (p: Paperless) => (await whoami(p)).isAdmin;
  const status = { ok: 200, not_found: 404, taken: 409, forbidden: 403 } as const;

  app.patch("/api/people/:id{[0-9]+}", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const clean = name?.trim();
    if (!clean || clean.length > 20) return c.json({ error: "invalid_name" }, 400);
    const r = await renamePerson(c.var.paperless, Number(c.req.param("id")), clean);
    return c.json(r === "ok" ? { ok: true } : { error: r }, status[r]);
  });

  app.patch("/api/categories/:id{[0-9]+}", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const clean = name?.trim();
    if (!clean || clean.length > 20) return c.json({ error: "invalid_name" }, 400);
    const r = await renameCategory(c.var.paperless, Number(c.req.param("id")), clean);
    return c.json(r === "ok" ? { ok: true } : { error: r }, status[r]);
  });

  app.delete("/api/categories/:id{[0-9]+}", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const r = await removeCategory(c.var.paperless, Number(c.req.param("id")), intParam(c.req.query("into")));
    return c.json(r === "ok" ? { ok: true } : { error: r }, status[r]);
  });

  app.delete("/api/people/:id{[0-9]+}", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const r = await removePerson(c.var.paperless, Number(c.req.param("id")), intParam(c.req.query("into")));
    return c.json(r === "ok" ? { ok: true } : { error: r }, status[r]);
  });

  // AI settings: base URL and model come from the environment; the key may be
  // set here. The key itself is never sent back to the browser.
  // The key itself is never sent back, only whether one is set.
  app.get("/api/ai/settings", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const a = aiConfig();
    return c.json({
      enabled: aiEnabled(),
      baseUrl: a.baseUrl,
      model: a.model,
      wireApi: a.wireApi,
      keySet: !!a.key,
      keyFromEnv: !storedAi().key && !!config.aiApiKey,
    });
  });

  app.put("/api/ai/settings", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const patch: Parameters<typeof saveAiSettings>[0] = {};
    for (const k of ["baseUrl", "model", "key"] as const) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== "string" || b[k].length > 500) return c.json({ error: "invalid" }, 400);
      patch[k] = b[k].trim();
    }
    if (patch.baseUrl) {
      patch.baseUrl = patch.baseUrl.replace(/\/+$/, "");
      if (!validBaseUrl(patch.baseUrl)) return c.json({ error: "invalid_url" }, 400);
    }
    if (b.wireApi !== undefined) {
      if (b.wireApi !== "" && b.wireApi !== "chat" && b.wireApi !== "responses") return c.json({ error: "invalid" }, 400);
      patch.wireApi = b.wireApi;
    }
    await saveAiSettings(patch);
    return c.json({ ok: true, enabled: aiEnabled() });
  });

  // Lists the provider's models, optionally with an address/key not saved yet.
  app.post("/api/ai/models", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const b = await c.req.json<{ baseUrl?: unknown; key?: unknown }>().catch(() => ({}) as { baseUrl?: unknown; key?: unknown });
    const baseUrl = typeof b.baseUrl === "string" ? b.baseUrl.trim() : "";
    const key = typeof b.key === "string" ? b.key.trim() : "";
    if (baseUrl && !validBaseUrl(baseUrl)) return c.json({ error: "invalid_url" }, 400);
    try {
      return c.json({ models: await listModels({ baseUrl, key }) });
    } catch (e) {
      console.warn("ai models failed:", e instanceof Error ? e.message : e);
      return c.json({ error: "ai_failed" }, 502);
    }
  });

  app.get("/api/accounts", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    refreshRoster(c.var.paperless).catch(() => {});
    return c.json(await listAccounts(c.var.paperless));
  });

  app.patch("/api/accounts/:id{[0-9]+}", async (c) => {
    const me = await whoami(c.var.paperless);
    if (!me.isAdmin) return c.json({ error: "forbidden" }, 403);
    const { active } = await c.req.json<{ active?: boolean }>().catch(() => ({}) as { active?: boolean });
    if (typeof active !== "boolean") return c.json({ error: "invalid" }, 400);
    const r = await setAccountActive(c.var.paperless, Number(c.req.param("id")), active, me.id);
    if (r === "ok") await refreshRoster(c.var.paperless);
    return c.json(r === "ok" ? { ok: true } : { error: r }, status[r]);
  });

  app.get("/api/signups", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    return c.json(await listSignups());
  });

  app.post("/api/signups/:id/approve", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json<{ person?: number }>().catch(() => ({}) as { person?: number });
    const r = await approveSignup(c.var.paperless, c.req.param("id"), typeof body.person === "number" ? body.person : undefined);
    if (r.ok) return c.json(r);
    return c.json(r, r.error === "not_found" ? 404 : 400);
  });

  app.delete("/api/signups/:id", async (c) => {
    if (!(await isAdmin(c.var.paperless))) return c.json({ error: "forbidden" }, 403);
    return (await rejectSignup(c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  app.post("/api/categories", async (c) => {
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const clean = name?.trim();
    if (!clean || clean.length > 20) return c.json({ error: "invalid_name" }, 400);
    return c.json(await addCategory(c.var.paperless, clean));
  });

  app.get("/api/meta", async (c) => c.json(await loadMeta(c.var.paperless)));

  app.post("/api/setup", async (c) => {
    const body = await c.req.json<{ people?: string[] }>().catch(() => ({}) as { people?: string[] });
    const people = body.people?.map((s) => s.trim()).filter(Boolean);
    const created = await ensureDefaults(c.var.paperless, people?.length ? people : undefined);
    await shareEverything(c.var.paperless, await ensureFamilyGroup(c.var.paperless));
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
    const [doc, meta, me, gid] = await Promise.all([
      p.json<PDocument & { owner?: number | null; permissions?: { view?: { users?: number[]; groups?: number[] } } }>(
        `/api/documents/${c.req.param("id")}/?full_perms=true`,
      ),
      loadMeta(p),
      whoami(p),
      familyGroupId(),
    ]);
    const canShare = me.isAdmin || doc.owner == null || doc.owner === me.id;
    return c.json({ ...toDetail(doc, meta), share: canShare ? shareOf(doc.permissions, gid) : null });
  });

  app.put("/api/docs/:id{[0-9]+}/share", async (c) => {
    const body = await c.req.json<{ share?: unknown }>().catch(() => ({}) as { share?: unknown });
    const share = parseShare(body.share, await getRoster());
    if (!share) return c.json({ error: "invalid" }, 400);
    await applyShare(c.var.paperless, Number(c.req.param("id")), share);
    return c.json({ ok: true, share });
  });

  app.patch("/api/docs/:id{[0-9]+}", async (c) => {
    const body = await c.req.json();
    return c.json(await patchDoc(c.var.paperless, Number(c.req.param("id")), body));
  });

  // Paperless moves deleted documents to its trash (kept 30 days by default),
  // where an admin can restore them.
  app.delete("/api/docs/:id{[0-9]+}", async (c) => {
    await c.var.paperless.raw(`/api/documents/${c.req.param("id")}/`, { method: "DELETE" });
    return c.json({ ok: true });
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
    const raw = String(form.get("share") ?? "family");
    const share = parseShare(raw === "family" ? raw : raw.split(",").filter(Boolean), await getRoster());
    if (!share) return c.json({ error: "invalid_share" }, 400);
    const task = await c.var.paperless.json<string>("/api/documents/post_document/", { method: "POST", body: out });
    pendingShares.set(task, share);
    const me = await whoami(c.var.paperless);
    await setHabit(me.id, share);
    return c.json({ taskId: task });
  });

  // Reads a (client-downscaled) photo or a typed note with the configured model and
  // returns suggested fields. Nothing is saved; the user confirms first.
  app.post("/api/ai/extract", async (c) => {
    if (!aiEnabled()) return c.json({ error: "ai_disabled" }, 404);
    const form = await c.req.formData();
    const file = form.get("file");
    const note = form.get("note");
    let input: { image: Blob } | { note: string };
    if (typeof note === "string" && note.trim()) {
      input = { note: note.trim().slice(0, 20_000) };
    } else {
      if (!(file instanceof File) || !file.type.startsWith("image/")) return c.json({ error: "missing_image" }, 400);
      if (file.size > MAX_AI_IMAGE_BYTES) return c.json({ error: "too_large" }, 413);
      input = { image: file };
    }
    try {
      return c.json(await extract(input, await loadMeta(c.var.paperless)));
    } catch (e) {
      if (e instanceof AiError || (e instanceof Error && (e.name === "TimeoutError" || e instanceof SyntaxError))) {
        console.warn("ai extract failed:", e.message);
        return c.json({ error: "ai_failed" }, 502);
      }
      throw e;
    }
  });

  app.post("/api/feedback", async (c) => {
    const f = validate(await c.req.json().catch(() => null));
    if (!f) return c.json({ error: "invalid" }, 400);
    const p = c.var.paperless;
    const [s, profile, meta] = await Promise.all([
      p.json<{ user: { username: string } }>("/api/ui_settings/"),
      p.json<{ first_name?: string; last_name?: string }>("/api/profile/").catch(() => ({}) as { first_name?: string; last_name?: string }),
      loadMeta(p),
    ]);
    if (!allow(s.user.username)) return c.json({ error: "rate_limited" }, 429);
    const names = [s.user.username, profile.first_name ?? "", profile.last_name ?? "", ...meta.people.map((x) => x.name)];
    const result = await submitFeedback(f, { userAgent: c.req.header("user-agent") ?? "", names });
    return c.json({ ok: true, via: result.via });
  });

  app.get("/api/tasks/:id", async (c) => {
    const tasks = await c.var.paperless.json<{ status: string; related_document: string | null; result?: string }[]>(
      `/api/tasks/?task_id=${encodeURIComponent(c.req.param("id"))}`,
    );
    const t = tasks[0];
    if (!t) return c.json({ status: "PENDING", docId: null });
    const docId = t.related_document ? Number(t.related_document) : null;
    // New documents belong to the uploader only; share them as they chose.
    const taskId = c.req.param("id");
    if (t.status === "SUCCESS" && docId) {
      const share = pendingShares.get(taskId) ?? await getHabit((await whoami(c.var.paperless)).id);
      await applyShare(c.var.paperless, docId, share)
        .then(() => pendingShares.delete(taskId))
        .catch((e) => console.warn("share failed:", e.message));
    }
    return c.json({ status: t.status, docId });
  });

  return app;
}
