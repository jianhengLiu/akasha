// End-to-end API tests: Akasha's server against the in-memory Paperless mock.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createMock } from "../mock/paperless-mock.ts";

let mockServer: ReturnType<typeof serve>;
let app: { fetch: (r: Request) => Response | Promise<Response> };

before(async () => {
  mockServer = serve({ fetch: createMock().fetch, port: 0 });
  await new Promise((r) => mockServer.once("listening", r));
  process.env.PAPERLESS_URL = `http://localhost:${(mockServer.address() as AddressInfo).port}`;
  process.env.AKASHA_AI_BASE_URL = `${process.env.PAPERLESS_URL}/v1`;
  process.env.AKASHA_AI_API_KEY = "test-key";
  process.env.AKASHA_AI_MODEL = "mock-vision";
  process.env.AKASHA_DATA_DIR = await mkdtemp(`${tmpdir()}/akasha-`);
  const { createApp } = await import("../server/app.ts");
  app = createApp();
});

after(() => mockServer.close());

async function login(username: string, password = username) {
  const res = await app.fetch(new Request("http://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  }));
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { res, cookie };
}

const get = (path: string, cookie: string) => app.fetch(new Request(`http://x${path}`, { headers: { cookie } }));

test("rejects wrong password and unauthenticated calls", async () => {
  const { res } = await login("mama", "nope");
  assert.equal(res.status, 401);
  assert.equal((await get("/api/meta", "")).status, 401);
});

test("meta maps people tags, categories and expiry field", async () => {
  const { cookie } = await login("mama");
  const meta = await (await get("/api/meta", cookie)).json();
  assert.deepEqual(meta.people.map((p: { name: string }) => p.name), ["爸爸", "妈妈", "小明"]);
  assert.ok(meta.categories.some((c: { name: string }) => c.name === "保险"));
  assert.equal(meta.expiryFieldId, 1);
});

test("me returns display name", async () => {
  const { cookie } = await login("mama");
  const me = await (await get("/api/me", cookie)).json();
  assert.equal(me.displayName, "妈妈");
  assert.equal(me.isAdmin, false);
});

test("filters by person, category, search and expiry window", async () => {
  const { cookie } = await login("mama");
  const byPerson = await (await get("/api/docs?person=2", cookie)).json();
  assert.ok(byPerson.docs.length > 0);
  assert.ok(byPerson.docs.every((d: { people: { name: string }[] }) => d.people.some((p) => p.name === "妈妈")));

  const insurance = await (await get("/api/docs?category=1", cookie)).json();
  assert.ok(insurance.docs.every((d: { category: { name: string } }) => d.category.name === "保险"));

  const search = await (await get(`/api/docs?q=${encodeURIComponent("医保")}`, cookie)).json();
  assert.equal(search.docs[0].title, "爸爸 医保卡");

  const expiring = await (await get("/api/docs?expiring=60", cookie)).json();
  const dates = expiring.docs.map((d: { expiry: string }) => d.expiry);
  assert.equal(dates.length, 2);
  assert.deepEqual(dates, [...dates].sort());
});

test("updates expiry and people without touching other tags", async () => {
  const { cookie } = await login("admin");
  const patch = (body: unknown) => app.fetch(new Request("http://x/api/docs/8", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  const a = await (await patch({ expiry: "2030-01-01", people: [2] })).json();
  assert.equal(a.expiry, "2030-01-01");
  assert.deepEqual(a.people.map((p: { name: string }) => p.name), ["妈妈"]);
  const b = await (await patch({ expiry: null })).json();
  assert.equal(b.expiry, null);
});

test("upload returns a task that resolves to a document", async () => {
  const { cookie } = await login("mama");
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "policy.jpg", { type: "image/jpeg" }));
  form.append("person", "2");
  form.append("category", "1");
  const up = await app.fetch(new Request("http://x/api/docs", { method: "POST", headers: { cookie }, body: form }));
  const { taskId } = await up.json();
  const task = await (await get(`/api/tasks/${taskId}`, cookie)).json();
  assert.equal(task.status, "SUCCESS");
  const doc = await (await get(`/api/docs/${task.docId}`, cookie)).json();
  assert.equal(doc.category.name, "保险");
  assert.deepEqual(doc.people.map((p: { name: string }) => p.name), ["妈妈"]);
});

test("setup is admin-only and idempotent", async () => {
  const mama = await login("mama");
  const denied = await app.fetch(new Request("http://x/api/setup", {
    method: "POST", headers: { cookie: mama.cookie, "content-type": "application/json" }, body: JSON.stringify({ people: ["外婆"] }),
  }));
  assert.equal(denied.status, 403);
  const admin = await login("admin");
  const run = () => app.fetch(new Request("http://x/api/setup", {
    method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: JSON.stringify({ people: ["外婆"] }),
  }));
  assert.deepEqual((await (await run()).json()).created, ["person:外婆"]);
  assert.deepEqual((await (await run()).json()).created, []);
});

test("feedback is validated, labelled with its page and saved", async () => {
  const { readFile } = await import("node:fs/promises");
  const { config } = await import("../server/config.ts");
  config.dataDir = await mkdtemp(`${tmpdir()}/akasha-`);
  config.githubToken = "";
  const { cookie } = await login("mama");
  const post = (body: unknown) => app.fetch(new Request("http://x/api/feedback", {
    method: "POST", headers: { cookie, "content-type": "application/json", "user-agent": "test-agent" }, body: JSON.stringify(body),
  }));
  assert.equal((await post({ message: "", page: "home" })).status, 400);
  const ok = await post({ message: "按钮太小了\n第二行", page: "doc", route: "/doc/3", font: "xl" });
  assert.deepEqual(await ok.json(), { ok: true, via: "file" });
  const saved = JSON.parse((await readFile(`${config.dataDir}/feedback.jsonl`, "utf8")).trim());
  assert.equal(saved.title, "[doc] 按钮太小了");
  assert.deepEqual(saved.labels, ["feedback", "page:doc"]);
  assert.match(saved.body, /\| 路径 \| `\/doc\/3` \|/);
  assert.doesNotMatch(saved.body, /mama/);
});

test("AI reads a photo into suggested fields, and content can be saved", async () => {
  const { cookie } = await login("mama");
  const me = await (await get("/api/me", cookie)).json();
  assert.equal(me.ai, true);
  const meta = await (await get("/api/meta", cookie)).json();

  const form = new FormData();
  form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "p.jpg", { type: "image/jpeg" }));
  const res = await app.fetch(new Request("http://x/api/ai/extract", { method: "POST", headers: { cookie }, body: form }));
  assert.equal(res.status, 200);
  const ex = await res.json();
  assert.equal(ex.title, "妈妈 医疗险保单");
  // Unknown names are dropped; only real family members are kept.
  assert.deepEqual(ex.people, [meta.people.find((p: { name: string }) => p.name === "妈妈").id]);
  assert.equal(ex.category, meta.categories.find((c: { name: string }) => c.name === "保险").id);
  assert.match(ex.expiry, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(ex.content, /^保险公司：中国太平洋保险\n/);

  const pdf = new FormData();
  pdf.append("file", new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
  const bad = await app.fetch(new Request("http://x/api/ai/extract", { method: "POST", headers: { cookie }, body: pdf }));
  assert.equal(bad.status, 400);

  const patched = await app.fetch(new Request("http://x/api/docs/1", {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ content: ex.content, expiry: ex.expiry }),
  }));
  const doc = await patched.json();
  assert.equal(doc.content, ex.content);
  assert.equal(doc.expiry, ex.expiry);
});

test("account requests wait for an admin, then join the family group", async () => {
  const signup = (body: unknown) => app.fetch(new Request("http://x/api/signup", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.0.0.9" }, body: JSON.stringify(body),
  }));
  assert.deepEqual(await (await signup({ name: "爸爸", username: "baba", password: "12345678" })).json(), { error: "weak_password" });
  assert.equal((await signup({ name: "爸爸", username: "baba", password: "baba-2026!" })).status, 200);
  assert.deepEqual(await (await signup({ name: "爸爸", username: "BABA", password: "another-pass" })).json(), { error: "taken" });

  const mama = await login("mama");
  assert.equal((await get("/api/signups", mama.cookie)).status, 403);
  const admin = await login("admin");
  const list = await (await get("/api/signups", admin.cookie)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].username, "baba");
  assert.equal(list[0].password, undefined);
  assert.equal((await login("baba", "baba-2026!")).res.status, 401);

  const approved = await app.fetch(new Request(`http://x/api/signups/${list[0].id}/approve`, { method: "POST", headers: { cookie: admin.cookie } }));
  assert.equal(approved.status, 200);
  const baba = await login("baba", "baba-2026!");
  assert.equal(baba.res.status, 200);
  assert.deepEqual(await (await get("/api/signups", admin.cookie)).json(), []);

  // Setup shares existing documents and metadata with the family group;
  // new uploads are shared once Paperless has processed them.
  await app.fetch(new Request("http://x/api/setup", { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: "{}" }));
  const form = new FormData();
  form.append("file", new File(["x"], "new.jpg", { type: "image/jpeg" }));
  const { taskId } = await (await app.fetch(new Request("http://x/api/docs", { method: "POST", headers: { cookie: baba.cookie }, body: form }))).json();
  const task = await (await get(`/api/tasks/${taskId}`, baba.cookie)).json();
  const perms = await (await fetch(`${process.env.PAPERLESS_URL}/api/_perms/`, { headers: { authorization: "Token tok-admin" } })).json();
  const family = { view: { users: [], groups: [1] }, change: { users: [], groups: [1] } };
  assert.deepEqual(perms["documents:1"], family);
  assert.deepEqual(perms[`documents:${task.docId}`], family);
  assert.deepEqual(perms["document_types:1"], family);
  assert.ok(Object.keys(perms).some((k) => k.startsWith("tags:")));
});

test("documents can be deleted", async () => {
  const { cookie } = await login("mama");
  const del = (id: number) => app.fetch(new Request(`http://x/api/docs/${id}`, { method: "DELETE", headers: { cookie } }));
  assert.equal((await del(8)).status, 200);
  assert.equal((await get("/api/docs/8", cookie)).status, 404);
  assert.equal((await del(8)).status, 404);
});

test("AI also works over the Responses API", async () => {
  const { config } = await import("../server/config.ts");
  config.aiWireApi = "responses";
  try {
    const { cookie } = await login("mama");
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff])], "p.jpg", { type: "image/jpeg" }));
    const res = await app.fetch(new Request("http://x/api/ai/extract", { method: "POST", headers: { cookie }, body: form }));
    assert.equal(res.status, 200);
    const ex = await res.json();
    assert.equal(ex.title, "爸爸 车险保单");
    assert.equal(ex.expiry, null);
  } finally {
    config.aiWireApi = "chat";
  }
});

test("admin can rename, merge and remove people, and disable accounts", async () => {
  const admin = await login("admin");
  const mama = await login("mama");
  const send = (method: string, path: string, cookie: string, body?: unknown) => app.fetch(new Request(`http://x${path}`, {
    method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const people = async () => (await (await get("/api/meta", admin.cookie)).json()).people as { id: number; name: string }[];
  const id = async (name: string) => (await people()).find((p) => p.name === name)!.id;

  assert.equal((await send("PATCH", `/api/people/${await id("小明")}`, mama.cookie, { name: "x" })).status, 403);
  assert.equal((await send("PATCH", `/api/people/${await id("小明")}`, admin.cookie, { name: "妈妈" })).status, 409);
  assert.equal((await send("PATCH", `/api/people/${await id("小明")}`, admin.cookie, { name: "儿子" })).status, 200);

  // Merge 爸爸 into 儿子: 爸爸's documents move over, nothing is deleted.
  const babaId = await id("爸爸");
  const sonId = await id("儿子");
  const before = (await (await get(`/api/docs?person=${babaId}`, admin.cookie)).json()).count;
  assert.ok(before > 0);
  assert.equal((await send("DELETE", `/api/people/${babaId}?into=${sonId}`, admin.cookie)).status, 200);
  assert.ok(!(await people()).some((p) => p.name === "爸爸"));
  assert.ok((await (await get(`/api/docs?person=${sonId}`, admin.cookie)).json()).count >= before);

  const accounts = await (await get("/api/accounts", admin.cookie)).json();
  const mamaAcc = accounts.find((a: { username: string }) => a.username === "mama");
  const adminAcc = accounts.find((a: { username: string }) => a.username === "admin");
  assert.equal(mamaAcc.active, true);
  assert.equal((await send("PATCH", `/api/accounts/${adminAcc.id}`, admin.cookie, { active: false })).status, 403);
  assert.equal((await send("PATCH", `/api/accounts/${mamaAcc.id}`, admin.cookie, { active: false })).status, 200);
  assert.equal((await login("mama")).res.status, 401);
  assert.equal((await send("PATCH", `/api/accounts/${mamaAcc.id}`, admin.cookie, { active: true })).status, 200);
  assert.equal((await login("mama")).res.status, 200);
});

test("AI can also tidy up a typed note", async () => {
  const { cookie } = await login("mama");
  const form = new FormData();
  form.append("note", "家里WiFi名称 Home-5G 密码在冰箱上");
  const res = await app.fetch(new Request("http://x/api/ai/extract", { method: "POST", headers: { cookie }, body: form }));
  assert.equal(res.status, 200);
  const ex = await res.json();
  assert.equal(ex.title, "家里 WiFi");
  assert.deepEqual(ex.details, [{ label: "WiFi 名称", value: "Home-5G" }]);

  // A typed note is stored in Paperless as a plain-text document.
  const up = new FormData();
  up.append("file", new File(["家里WiFi名称 Home-5G"], "note.txt", { type: "text/plain" }));
  up.append("title", ex.title);
  const r = await app.fetch(new Request("http://x/api/docs", { method: "POST", headers: { cookie }, body: up }));
  assert.equal(r.status, 200);
});

test("family members can add a category, once", async () => {
  const { cookie } = await login("mama");
  const add = (name: string) => app.fetch(new Request("http://x/api/categories", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name }),
  }));
  assert.equal((await add("  ")).status, 400);
  const a = await (await add("宠物")).json();
  const b = await (await add("宠物")).json();
  assert.equal(a.id, b.id);
  const meta = await (await get("/api/meta", cookie)).json();
  assert.equal(meta.categories.filter((c: { name: string }) => c.name === "宠物").length, 1);
});

test("admin can set the AI key in Settings; it is never sent back", async () => {
  const { config } = await import("../server/config.ts");
  const envKey = config.aiApiKey;
  config.aiApiKey = "";
  try {
    const admin = await login("admin");
    const mama = await login("mama");
    const put = (cookie: string, key: string) => app.fetch(new Request("http://x/api/ai/settings", {
      method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ key }),
    }));
    assert.equal((await put(mama.cookie, "x")).status, 403);
    assert.equal((await (await get("/api/me", admin.cookie)).json()).ai, false);
    assert.equal((await put(admin.cookie, " test-key ")).status, 200);
    const s = await (await get("/api/ai/settings", admin.cookie)).json();
    assert.deepEqual({ enabled: s.enabled, keySet: s.keySet, keyFromEnv: s.keyFromEnv }, { enabled: true, keySet: true, keyFromEnv: false });
    assert.ok(!JSON.stringify(s).includes("test-key"));
    // The stored key works against the provider.
    const form = new FormData();
    form.append("note", "家里WiFi名称 Home-5G");
    assert.equal((await app.fetch(new Request("http://x/api/ai/extract", { method: "POST", headers: { cookie: mama.cookie }, body: form }))).status, 200);
    assert.equal((await put(admin.cookie, "")).status, 200);
    assert.equal((await (await get("/api/me", admin.cookie)).json()).ai, false);
  } finally {
    config.aiApiKey = envKey;
  }
});

test("admin can rename and remove categories without losing documents", async () => {
  const admin = await login("admin");
  const send = (method: string, path: string, body?: unknown) => app.fetch(new Request(`http://x${path}`, {
    method, headers: { cookie: admin.cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const cats = async () => (await (await get("/api/meta", admin.cookie)).json()).categories as { id: number; name: string }[];
  const id = async (name: string) => (await cats()).find((c) => c.name === name)!.id;
  assert.equal((await send("PATCH", `/api/categories/${await id("房产")}`, { name: "保险" })).status, 409);
  assert.equal((await send("PATCH", `/api/categories/${await id("房产")}`, { name: "房子" })).status, 200);
  const house = await id("房子");
  const other = await id("其他");
  const before = (await (await get(`/api/docs?category=${house}`, admin.cookie)).json()).count;
  assert.ok(before > 0);
  assert.equal((await send("DELETE", `/api/categories/${house}?into=${other}`)).status, 200);
  assert.ok(!(await cats()).some((c) => c.name === "房子"));
  assert.ok((await (await get(`/api/docs?category=${other}`, admin.cookie)).json()).count >= before);
});

test("login attempts are rate limited per address", async () => {
  const attempt = () => app.fetch(new Request("http://x/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ username: "mama", password: "wrong" }),
  }));
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429);
});

test("feedback is anonymous and masks personal details", async () => {
  const { redact } = await import("../server/feedback.ts");
  const masked = redact("妈妈的身份证 11010119600101123X，手机 13812345678，保单号 P2025ABC8812，邮箱 a.b@example.com，卡号 6222020200112233", ["妈妈", "mama"]);
  for (const leak of ["11010119600101123X", "13812345678", "P2025ABC8812", "a.b@example.com", "6222020200112233", "妈妈"]) {
    assert.ok(!masked.includes(leak), `${leak} leaked: ${masked}`);
  }
  assert.ok(masked.includes("某家人的身份证"));
  // Ordinary words and small numbers stay readable.
  assert.equal(redact("第2页的按钮太小了，字号调到大还是看不清"), "第2页的按钮太小了，字号调到大还是看不清");

  const { readFile } = await import("node:fs/promises");
  const { config } = await import("../server/config.ts");
  const { cookie } = await login("mama");
  await app.fetch(new Request("http://x/api/feedback", {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "user-agent": "Mozilla/5.0 (Linux; Android 14; V2309A) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36" },
    body: JSON.stringify({ message: "妈妈 想问 13812345678 怎么改", page: "home", route: "/" }),
  }));
  const lines = (await readFile(`${config.dataDir}/feedback.jsonl`, "utf8")).trim().split("\n");
  const saved = JSON.parse(lines[lines.length - 1]);
  assert.ok(!saved.body.includes("mama") && !saved.body.includes("13812345678") && !saved.title.includes("妈妈"));
  assert.ok(saved.body.includes("Android 14 · Chrome"));
});

test("uploads can be shared with chosen accounts, and the choice is remembered", async () => {
  const admin = await login("admin");
  const roster = await (await get("/api/family", admin.cookie)).json();
  assert.ok(roster.some((m: { name: string }) => m.name === "妈妈"));
  const baba = await login("baba", "baba-2026!");
  const family = await (await get("/api/family", baba.cookie)).json();
  assert.ok(!family.some((m: { name: string }) => m.name === "爸爸"), "yourself is not listed");
  const perms = async () => (await fetch(`${process.env.PAPERLESS_URL}/api/_perms/`, { headers: { authorization: "Token tok-admin" } })).json();

  const form = new FormData();
  form.append("file", new File(["x"], "private.jpg", { type: "image/jpeg" }));
  form.append("share", "2");
  const { taskId } = await (await app.fetch(new Request("http://x/api/docs", { method: "POST", headers: { cookie: baba.cookie }, body: form }))).json();
  const { docId } = await (await get(`/api/tasks/${taskId}`, baba.cookie)).json();
  assert.deepEqual((await perms())[`documents:${docId}`], { view: { users: [2], groups: [] }, change: { users: [2], groups: [] } });
  assert.deepEqual((await (await get("/api/me", baba.cookie)).json()).share, [2]);
  assert.deepEqual((await (await get(`/api/docs/${docId}`, baba.cookie)).json()).share, [2]);

  const put = (cookie: string, share: unknown) => app.fetch(new Request(`http://x/api/docs/${docId}/share`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ share }),
  }));
  const mama = await login("mama");
  assert.equal((await (await get(`/api/docs/${docId}`, mama.cookie)).json()).share, null, "only the owner may change it");
  assert.notEqual((await put(mama.cookie, "family")).status, 200);
  assert.equal((await put(baba.cookie, [999])).status, 400);

  // "Only me" survives the family-wide sync that runs for admins.
  assert.equal((await put(baba.cookie, [])).status, 200);
  await app.fetch(new Request("http://x/api/setup", { method: "POST", headers: { cookie: admin.cookie, "content-type": "application/json" }, body: "{}" }));
  assert.deepEqual((await perms())[`documents:${docId}`].view, { users: [], groups: [] });

  assert.equal((await put(baba.cookie, "family")).status, 200);
  assert.equal((await (await get(`/api/docs/${docId}`, baba.cookie)).json()).share, "family");
});

test("admin can choose the AI provider, model and wire format in Settings", async () => {
  const { config } = await import("../server/config.ts");
  const env = { ...config };
  Object.assign(config, { aiBaseUrl: "", aiModel: "", aiApiKey: "" });
  const admin = await login("admin");
  const mama = await login("mama");
  const send = (cookie: string, method: string, path: string, body: unknown) => app.fetch(new Request(`http://x${path}`, {
    method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  try {
    assert.equal((await (await get("/api/me", admin.cookie)).json()).ai, false);
    assert.equal((await send(mama.cookie, "PUT", "/api/ai/settings", { model: "x" })).status, 403);
    assert.equal((await send(admin.cookie, "PUT", "/api/ai/settings", { baseUrl: "ftp://x" })).status, 400);
    assert.equal((await send(admin.cookie, "PUT", "/api/ai/settings", { wireApi: "grpc" })).status, 400);

    const baseUrl = `${process.env.PAPERLESS_URL}/v1/`;
    const models = await (await send(admin.cookie, "POST", "/api/ai/models", { baseUrl, key: "test-key" })).json();
    assert.deepEqual(models.models, ["mock-mini", "mock-vision"]);
    assert.equal((await send(admin.cookie, "PUT", "/api/ai/settings", { baseUrl, model: "mock-vision", wireApi: "chat", key: "test-key" })).status, 200);
    const s = await (await get("/api/ai/settings", admin.cookie)).json();
    assert.deepEqual(s, { enabled: true, baseUrl: baseUrl.replace(/\/$/, ""), model: "mock-vision", wireApi: "chat", keySet: true, keyFromEnv: false });
    assert.equal((await send(admin.cookie, "POST", "/api/ai/models", {})).status, 200, "saved address and key work");

    const form = new FormData();
    form.append("note", "家里WiFi名称 Home-5G");
    assert.equal((await app.fetch(new Request("http://x/api/ai/extract", { method: "POST", headers: { cookie: mama.cookie }, body: form }))).status, 200);
    // The saved key is not sent to an address that was only typed in.
    assert.equal((await send(admin.cookie, "POST", "/api/ai/models", { baseUrl: `${process.env.PAPERLESS_URL}/v1/../v1` })).status, 502);
  } finally {
    await send(admin.cookie, "PUT", "/api/ai/settings", { baseUrl: "", model: "", wireApi: "", key: "" });
    Object.assign(config, env);
  }
});
