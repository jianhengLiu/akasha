// End-to-end API tests: Akasha's server against the in-memory Paperless mock.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createMock } from "../mock/paperless-mock.ts";

let mockServer: ReturnType<typeof serve>;
let app: { fetch: (r: Request) => Response | Promise<Response> };

before(async () => {
  mockServer = serve({ fetch: createMock().fetch, port: 0 });
  await new Promise((r) => mockServer.once("listening", r));
  process.env.PAPERLESS_URL = `http://localhost:${(mockServer.address() as AddressInfo).port}`;
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
  assert.deepEqual(meta.people.map((p: { name: string }) => p.name), ["爸爸", "妈妈", "建恒"]);
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
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { config } = await import("../server/config.ts");
  config.dataDir = await mkdtemp(`${tmpdir()}/akasha-`);
  config.githubToken = "";
  const { cookie } = await login("mama");
  const post = (body: unknown) => app.fetch(new Request("http://x/api/feedback", {
    method: "POST", headers: { cookie, "content-type": "application/json", "user-agent": "test-agent" }, body: JSON.stringify(body),
  }));
  assert.equal((await post({ message: "", page: "home" })).status, 400);
  const ok = await post({ message: "按钮太小了\n第二行", kind: "too_small", page: "doc", route: "/doc/3", font: "xl" });
  assert.deepEqual(await ok.json(), { ok: true, via: "file" });
  const saved = JSON.parse((await readFile(`${config.dataDir}/feedback.jsonl`, "utf8")).trim());
  assert.equal(saved.title, "[doc] 字或按钮太小：按钮太小了");
  assert.deepEqual(saved.labels, ["feedback", "page:doc", "kind:too_small"]);
  assert.match(saved.body, /\| 路径 \| `\/doc\/3` \|/);
  assert.match(saved.body, /\| 用户 \| mama \|/);
});
