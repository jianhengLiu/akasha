// A tiny in-memory stand-in for Paperless-ngx, for local development,
// screenshots and tests. It implements only the endpoints Akasha calls.
// Users: admin/admin (superuser), mama/mama.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";

interface Doc {
  id: number;
  title: string;
  content: string;
  tags: number[];
  document_type: number | null;
  correspondent: null;
  created: string;
  added: string;
  original_file_name: string;
  custom_fields: { field: number; value: unknown }[];
  owner: number;
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function createMock() {
  const users: { id: number; username: string; first_name: string; password: string; is_superuser: boolean; token: string; groups?: number[]; is_active?: boolean }[] = [
    { id: 1, username: "admin", first_name: "小明", password: "admin", is_superuser: true, token: "tok-admin" },
    { id: 2, username: "mama", first_name: "妈妈", password: "mama", is_superuser: false, token: "tok-mama" },
  ];
  const groups: { id: number; name: string; permissions: string[] }[] = [];
  // Object permissions as last set by set_permissions, keyed "kind:id".
  const perms = new Map<string, unknown>();
  const tags = [
    { id: 1, name: "家人/爸爸" },
    { id: 2, name: "家人/妈妈" },
    { id: 3, name: "家人/小明" },
  ];
  const types = ["保险", "证件", "医疗", "房产", "车辆", "票据", "其他"].map((name, i) => ({ id: i + 1, name }));
  const fields = [{ id: 1, name: "到期日", data_type: "date" }];
  let nextId = 1;
  const docs: Doc[] = [];
  const add = (title: string, type: number, people: number[], content: string, expiry?: string, ageDays = 0, owner = 1) => {
    docs.push({
      id: nextId++,
      title,
      content,
      tags: people,
      document_type: type,
      correspondent: null,
      created: daysFromNow(-ageDays - 30),
      added: new Date(Date.now() - ageDays * 86400000).toISOString(),
      original_file_name: `${title}.jpg`,
      custom_fields: expiry ? [{ field: 1, value: expiry }] : [],
      owner,
    });
  };
  add("爸爸 医疗险保单", 1, [1], "中国平安 平安e生保 被保险人 张** 保单号 P2025****8812 保险期间一年 年保费 1,280 元", daysFromNow(23), 40);
  add("妈妈 重疾险保单", 1, [2], "中国人寿 国寿福 被保险人 王** 保单号 2019****3301 交费期 20 年 年交保费 6,200 元", daysFromNow(150), 200);
  add("车险 交强险+商业险", 5, [1], "中国人保 交强险 商业三者险 200 万 保费合计 4,350 元", daysFromNow(9), 300);
  add("妈妈 身份证", 2, [2], "居民身份证 姓名 王** 有效期限 2016.05.12-2036.05.12", "2036-05-12", 500);
  add("爸爸 医保卡", 2, [1], "社会保障卡 姓名 张** 社会保障号码 **************1234", undefined, 600);
  add("妈妈 体检报告 2026", 3, [2], "瑞慈体检 总检结论 血压偏高 建议定期复查 甲状腺结节 建议半年复查 B 超", undefined, 12);
  add("房产证", 4, [1, 2], "不动产权证书 坐落 **市**区**路**号 共有情况 共同共有", undefined, 900);
  add("冰箱发票", 6, [], "海尔 BCD-500W 冰箱 发票金额 4,999 元 保修三年", daysFromNow(400), 60);

  const tasks = new Map<string, { status: string; related_document: string | null }>();
  const app = new Hono<{ Variables: { user: (typeof users)[number] } }>();

  // Stand-in for an OpenAI-compatible vision model (AKASHA_AI_BASE_URL=<mock>/v1).
  app.post("/v1/chat/completions", async (c) => {
    if (c.req.header("authorization") !== "Bearer test-key") return c.json({ error: { message: "bad key" } }, 401);
    const b = await c.req.json();
    const parts = b.messages?.[0]?.content ?? [];
    const hasImage = parts.some((p: { type: string; image_url?: { url?: string } }) => p.type === "image_url" && p.image_url?.url?.startsWith("data:image/"));
    const prompt = parts.find((p: { type: string }) => p.type === "text")?.text ?? "";
    if (!hasImage) {
      if (!prompt.includes("文字内容：")) return c.json({ error: { message: "no input" } }, 400);
      const note = { title: "家里 WiFi", people: [], category: "其他", expiry: null, details: [{ label: "WiFi 名称", value: "Home-5G" }], text: "" };
      return c.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(note) } }] });
    }
    const reply = {
      title: "妈妈 医疗险保单",
      people: ["妈妈", "隔壁老王"],
      category: "保险",
      expiry: daysFromNow(200),
      details: [
        { label: "保险公司", value: "中国太平洋保险" },
        { label: "被保险人", value: "王**" },
        { label: "保单号", value: "CPIC2026****0417" },
        { label: "年保费", value: "1,560 元" },
      ],
      text: "中国太平洋保险\n个人医疗保险单\n被保险人 王**\n保单号 CPIC2026****0417",
    };
    return c.json({ choices: [{ message: { role: "assistant", content: "```json\n" + JSON.stringify(reply) + "\n```" } }] });
  });

  app.get("/v1/models", (c) => {
    if (c.req.header("authorization") !== "Bearer test-key") return c.json({ error: { message: "bad key" } }, 401);
    return c.json({ object: "list", data: [{ id: "mock-vision" }, { id: "mock-mini" }] });
  });

  app.post("/v1/responses", async (c) => {
    if (c.req.header("authorization") !== "Bearer test-key") return c.json({ error: { message: "bad key" } }, 401);
    const b = await c.req.json();
    const hasImage = (b.input?.[0]?.content ?? []).some((p: { type: string; image_url?: string }) => p.type === "input_image" && p.image_url?.startsWith("data:image/"));
    if (!hasImage) return c.json({ error: { message: "no image" } }, 400);
    const reply = { title: "爸爸 车险保单", people: ["爸爸"], category: "车辆", expiry: null, details: [], text: "中国人保 机动车保险单" };
    return c.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(reply) }] }] });
  });

  app.post("/api/token/", async (c) => {
    const { username, password } = await c.req.json();
    const u = users.find((x) => x.username === username && x.password === password && x.is_active !== false);
    if (!u) return c.json({ non_field_errors: ["Unable to log in with provided credentials."] }, 400);
    return c.json({ token: u.token });
  });

  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const u = users.find((x) => auth === `Token ${x.token}` && x.is_active !== false);
    if (!u) return c.json({ detail: "Invalid token." }, 401);
    c.set("user", u);
    await next();
  });

  const paged = <T>(items: T[], page = 1, size = 1000) => ({
    count: items.length,
    next: page * size < items.length ? `?page=${page + 1}` : null,
    previous: null,
    results: items.slice((page - 1) * size, page * size),
  });
  const adminOnly = (c: { var: { user: { is_superuser: boolean } } }) => !c.var.user.is_superuser;

  app.get("/api/ui_settings/", (c) =>
    c.json({ user: { id: c.var.user.id, username: c.var.user.username, is_superuser: c.var.user.is_superuser } }));
  app.get("/api/profile/", (c) => c.json({ first_name: c.var.user.first_name, last_name: "" }));
  app.get("/api/tags/", (c) => c.json(paged(tags)));
  app.get("/api/document_types/", (c) => c.json(paged(types)));
  app.get("/api/custom_fields/", (c) => c.json(paged(fields)));
  app.post("/api/tags/", async (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const b = await c.req.json();
    const t = { id: tags.length + 1, name: b.name };
    tags.push(t);
    if (b.set_permissions) perms.set(`tags:${t.id}`, b.set_permissions);
    return c.json(t, 201);
  });
  app.post("/api/document_types/", async (c) => {
    const b = await c.req.json();
    const t = { id: types.length + 1, name: b.name };
    types.push(t);
    if (b.set_permissions) perms.set(`document_types:${t.id}`, b.set_permissions);
    return c.json(t, 201);
  });
  app.post("/api/custom_fields/", async (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const b = await c.req.json();
    const f = { id: fields.length + 1, name: b.name, data_type: b.data_type };
    fields.push(f);
    return c.json(f, 201);
  });

  app.get("/api/groups/", (c) => (adminOnly(c) ? c.json({ detail: "forbidden" }, 403) : c.json(paged(groups))));
  app.get("/api/groups/:id/", (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const g = groups.find((x) => x.id === Number(c.req.param("id")));
    return g ? c.json(g) : c.json({ detail: "Not found." }, 404);
  });
  app.post("/api/groups/", async (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const b = await c.req.json();
    const g = { id: groups.length + 1, name: b.name, permissions: b.permissions ?? [] };
    groups.push(g);
    return c.json(g, 201);
  });
  app.patch("/api/groups/:id/", async (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const g = groups.find((x) => x.id === Number(c.req.param("id")));
    if (!g) return c.json({ detail: "Not found." }, 404);
    Object.assign(g, await c.req.json());
    return c.json(g);
  });
  app.post("/api/users/", async (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const b = await c.req.json();
    if (users.some((u) => u.username === b.username)) return c.json({ username: ["A user with that username already exists."] }, 400);
    if (String(b.password ?? "").length < 8) return c.json({ password: ["This password is too short."] }, 400);
    const u = { id: users.length + 1, username: b.username, first_name: b.first_name ?? "", password: b.password, is_superuser: false, token: `tok-${b.username}`, groups: b.groups };
    users.push(u);
    return c.json({ id: u.id, username: u.username, groups: u.groups }, 201);
  });
  for (const kind of ["tags", "document_types", "custom_fields"]) {
    app.patch(`/api/${kind}/:id/`, async (c) => {
      if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
      const b = await c.req.json();
      if (b.set_permissions) perms.set(`${kind}:${c.req.param("id")}`, b.set_permissions);
      if ((kind === "tags" || kind === "document_types") && b.name) {
        const t = (kind === "tags" ? tags : types).find((x) => x.id === Number(c.req.param("id")));
        if (!t) return c.json({ detail: "Not found." }, 404);
        t.name = b.name;
      }
      return c.json({ id: Number(c.req.param("id")) });
    });
  }
  app.delete("/api/tags/:id/", (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const i = tags.findIndex((t) => t.id === Number(c.req.param("id")));
    if (i < 0) return c.json({ detail: "Not found." }, 404);
    const [t] = tags.splice(i, 1);
    for (const d of docs) d.tags = d.tags.filter((x) => x !== t.id);
    return c.body(null, 204);
  });
  app.delete("/api/document_types/:id/", (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const i = types.findIndex((t) => t.id === Number(c.req.param("id")));
    if (i < 0) return c.json({ detail: "Not found." }, 404);
    const [t] = types.splice(i, 1);
    for (const d of docs) if (d.document_type === t.id) d.document_type = null as unknown as number;
    return c.body(null, 204);
  });
  app.get("/api/users/", (c) => (adminOnly(c) ? c.json({ detail: "forbidden" }, 403) : c.json(paged(users.map((u) => ({
    id: u.id, username: u.username, first_name: u.first_name, is_active: u.is_active !== false, is_superuser: u.is_superuser,
  }))))));
  app.patch("/api/users/:id/", async (c) => {
    if (adminOnly(c)) return c.json({ detail: "forbidden" }, 403);
    const u = users.find((x) => x.id === Number(c.req.param("id")));
    if (!u) return c.json({ detail: "Not found." }, 404);
    const b = await c.req.json();
    if (typeof b.is_active === "boolean") u.is_active = b.is_active;
    return c.json({ id: u.id, is_active: u.is_active });
  });
  app.post("/api/documents/bulk_edit/", async (c) => {
    const b = await c.req.json();
    if (b.method === "set_permissions") {
      for (const id of b.documents) perms.set(`documents:${id}`, b.parameters.set_permissions);
    } else if (b.method === "set_document_type") {
      for (const d of docs.filter((x) => b.documents.includes(x.id))) d.document_type = b.parameters.document_type;
    } else if (b.method === "modify_tags") {
      for (const d of docs.filter((x) => b.documents.includes(x.id))) {
        d.tags = [...new Set([...d.tags.filter((t) => !b.parameters.remove_tags.includes(t)), ...b.parameters.add_tags])];
      }
    } else {
      return c.json({ detail: "unsupported" }, 400);
    }
    return c.json({ result: "OK" });
  });
  // Test helper, not part of Paperless.
  app.get("/api/_perms/", (c) => c.json(Object.fromEntries(perms)));

  app.get("/api/documents/", (c) => {
    const q = c.req.query();
    let list = [...docs];
    if (q.query) {
      const words = q.query.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((d) => words.every((w) => `${d.title} ${d.content}`.toLowerCase().includes(w)));
    }
    if (q.tags__id__all) {
      const ids = q.tags__id__all.split(",").map(Number);
      list = list.filter((d) => ids.every((id) => d.tags.includes(id)));
    }
    if (q.document_type__id) list = list.filter((d) => d.document_type === Number(q.document_type__id));
    if (q.custom_field_query) {
      const [field, op, arg] = JSON.parse(q.custom_field_query);
      if (op === "range") {
        list = list.filter((d) => {
          const v = d.custom_fields.find((f) => f.field === field)?.value as string | undefined;
          return !!v && v >= arg[0] && v <= arg[1];
        });
      }
    }
    if (!q.query) list.sort((a, b) => b.added.localeCompare(a.added));
    return c.json(paged(list, Number(q.page ?? 1), Number(q.page_size ?? 25)));
  });

  const find = (id: string) => docs.find((d) => d.id === Number(id));
  app.delete("/api/documents/:id/", (c) => {
    const i = docs.findIndex((d) => d.id === Number(c.req.param("id")));
    if (i < 0) return c.json({ detail: "Not found." }, 404);
    docs.splice(i, 1);
    return c.body(null, 204);
  });
  app.get("/api/documents/:id/", (c) => {
    const d = find(c.req.param("id"));
    if (!d) return c.json({ detail: "Not found." }, 404);
    const none = { view: { users: [], groups: [] }, change: { users: [], groups: [] } };
    return c.json(c.req.query("full_perms") === "true" ? { ...d, permissions: perms.get(`documents:${d.id}`) ?? none } : d);
  });
  app.patch("/api/documents/:id/", async (c) => {
    const d = find(c.req.param("id"));
    if (!d) return c.json({ detail: "Not found." }, 404);
    const { set_permissions, ...rest } = await c.req.json();
    // Like Paperless, only the owner or a superuser may change permissions.
    if (set_permissions && d.owner !== c.var.user.id && !c.var.user.is_superuser) return c.json({ detail: "forbidden" }, 403);
    if (set_permissions) perms.set(`documents:${d.id}`, set_permissions);
    Object.assign(d, rest);
    return c.json(d);
  });

  const card = (d: Doc, w: number, h: number) => {
    const type = types.find((t) => t.id === d.document_type)?.name ?? "";
    const lines = d.content.match(/.{1,16}/g) ?? [];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 300 400">
<rect width="300" height="400" fill="#fbfaf7"/><rect x="0" y="0" width="300" height="56" fill="#e8e2d6"/>
<text x="20" y="36" font-size="22" font-family="sans-serif" fill="#5b4a2e">${type}</text>
<text x="20" y="96" font-size="20" font-family="sans-serif" fill="#222">${d.title}</text>
${lines.slice(0, 8).map((l, i) => `<text x="20" y="${140 + i * 30}" font-size="16" font-family="sans-serif" fill="#666">${l}</text>`).join("")}
</svg>`;
  };
  for (const kind of ["thumb", "preview", "download"]) {
    app.get(`/api/documents/:id/${kind}/`, (c) => {
      const d = find(c.req.param("id"));
      if (!d) return c.json({ detail: "Not found." }, 404);
      return c.body(card(d, kind === "thumb" ? 300 : 900, kind === "thumb" ? 400 : 1200), 200, {
        "content-type": "image/svg+xml",
      });
    });
  }

  app.post("/api/documents/post_document/", async (c) => {
    const form = await c.req.formData();
    const file = form.get("document") as File | null;
    if (!file) return c.json({ document: ["No file"] }, 400);
    const id = nextId;
    add(
      String(form.get("title") || file.name.replace(/\.[^.]+$/, "")),
      Number(form.get("document_type")) || 7,
      form.getAll("tags").map(Number),
      "（模拟识别文字）新上传的文件内容",
      undefined,
      0,
      c.var.user.id,
    );
    const uuid = randomUUID();
    tasks.set(uuid, { status: "SUCCESS", related_document: String(id) });
    return c.json(uuid);
  });
  app.get("/api/tasks/", (c) => {
    const t = tasks.get(c.req.query("task_id") ?? "");
    return c.json(t ? [{ task_id: c.req.query("task_id"), ...t }] : []);
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_PORT ?? 8001);
  serve({ fetch: createMock().fetch, port }, () => console.log(`paperless mock on :${port} (admin/admin, mama/mama)`));
}
