// Account requests and family-wide sharing.
//
// Parents ask for an account on the login screen; an admin approves it in
// Settings, which creates the Paperless user in the family group. Until then
// the request (with its password encrypted under AKASHA_SECRET) waits in
// <dataDir>/signups.json.
//
// Paperless documents are private to their owner by default, so Akasha shares
// every document and every category/person/field with the family group.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";
import { loadMeta } from "./family.ts";
import { Paperless, PaperlessError } from "./paperless.ts";

// What family members may do. Codenames of Django model permissions.
const FAMILY_PERMISSIONS = [
  "view_document", "add_document", "change_document", "delete_document",
  "view_tag", "view_documenttype", "add_documenttype", "view_customfield", "view_correspondent", "view_storagepath",
  "view_paperlesstask", "view_uisettings", "change_uisettings", "view_note", "add_note",
];
const MAX_PENDING = 20;

export interface Signup { id: string; name: string; username: string; created: string }
interface StoredSignup extends Signup { password: string }
// Who may see a document: the whole family group, or only these accounts
// (besides its owner and admins, who always can). [] means "only me".
export type Share = "family" | number[];
export interface Member { id: number; name: string; isAdmin: boolean }

interface Store {
  familyGroupId?: number;
  signups: StoredSignup[];
  aiKey?: string;
  // Active accounts, refreshed by admins, so members can pick who sees what
  // without needing permission to list Paperless users themselves.
  roster?: Member[];
  // Each account's last choice, keyed by user id, offered again next upload.
  habits?: Record<string, Share>;
  // Documents deliberately not shared with the whole family.
  restricted?: number[];
}

const storePath = () => join(config.dataDir, "akasha.json");

async function load(): Promise<Store> {
  try {
    const s = JSON.parse(await readFile(storePath(), "utf8")) as Store;
    return { ...s, signups: s.signups ?? [] };
  } catch {
    return { signups: [] };
  }
}

async function save(s: Store) {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${storePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  await rename(tmp, storePath());
}

const key = () => createHash("sha256").update(`akasha-signup:${config.secret}`).digest();

function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export type SignupError = "invalid_name" | "invalid_username" | "weak_password" | "taken" | "too_many";

// Mirrors the parts of Django's password rules that elderly users hit most,
// so a request doesn't fail only later at approval time.
export function checkSignup(name: string, username: string, password: string): SignupError | null {
  if (!name || name.length > 20) return "invalid_name";
  if (!/^[\p{L}\p{N}_.@+-]{2,30}$/u.test(username)) return "invalid_username";
  if (password.length < 8 || password.length > 128 || /^\d+$/.test(password) || password === username) return "weak_password";
  return null;
}

export async function requestSignup(input: { name?: unknown; username?: unknown; password?: unknown }): Promise<SignupError | null> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const bad = checkSignup(name, username, password);
  if (bad) return bad;
  const s = await load();
  if (s.signups.some((x) => x.username.toLowerCase() === username.toLowerCase())) return "taken";
  if (s.signups.length >= MAX_PENDING) return "too_many";
  s.signups.push({ id: randomUUID(), name, username, password: encrypt(password), created: new Date().toISOString() });
  await save(s);
  return null;
}

export async function listSignups(): Promise<Signup[]> {
  return (await load()).signups.map(({ password: _, ...rest }) => rest);
}

export async function rejectSignup(id: string): Promise<boolean> {
  const s = await load();
  const before = s.signups.length;
  s.signups = s.signups.filter((x) => x.id !== id);
  if (s.signups.length === before) return false;
  await save(s);
  return true;
}

// Finds or creates the family group. Needs an admin token.
export async function ensureFamilyGroup(admin: Paperless): Promise<number> {
  const s = await load();
  if (s.familyGroupId) {
    try {
      await admin.json(`/api/groups/${s.familyGroupId}/`);
      return s.familyGroupId;
    } catch (e) {
      if (!(e instanceof PaperlessError && e.status === 404)) throw e;
    }
  }
  const groups = await admin.all<{ id: number; name: string; permissions: string[] }>("/api/groups/");
  const existing = groups.find((g) => g.name === config.familyGroup);
  if (existing && FAMILY_PERMISSIONS.some((x) => !existing.permissions.includes(x))) {
    await admin.send("PATCH", `/api/groups/${existing.id}/`, { permissions: [...new Set([...existing.permissions, ...FAMILY_PERMISSIONS])] });
  }
  const group = existing
    ?? await admin.send<{ id: number }>("POST", "/api/groups/", { name: config.familyGroup, permissions: FAMILY_PERMISSIONS });
  s.familyGroupId = group.id;
  await save(s);
  return group.id;
}

const familyPerms = (gid: number) => ({ view: { users: [], groups: [gid] }, change: { users: [], groups: [gid] } });

export function parseShare(v: unknown, roster: Member[]): Share | null {
  if (v === "family") return "family";
  if (!Array.isArray(v) || v.length > 50) return null;
  const ids = [...new Set(v.map(Number))];
  return ids.every((id) => roster.some((m) => m.id === id)) ? ids : null;
}

export async function getRoster(): Promise<Member[]> {
  return (await load()).roster ?? [];
}

export async function refreshRoster(admin: Paperless): Promise<Member[]> {
  const users = await admin.all<{ id: number; username: string; first_name?: string; is_active: boolean; is_superuser: boolean }>("/api/users/");
  const roster = users
    .filter((u) => u.is_active && u.username !== "consumer" && u.username !== "AnonymousUser")
    .map((u) => ({ id: u.id, name: u.first_name?.trim() || u.username, isAdmin: u.is_superuser }));
  const s = await load();
  s.roster = roster;
  await save(s);
  return roster;
}

export async function getHabit(userId: number): Promise<Share> {
  return (await load()).habits?.[userId] ?? "family";
}

export async function setHabit(userId: number, share: Share) {
  const s = await load();
  s.habits = { ...s.habits, [userId]: share };
  await save(s);
}

// Sets who may see (and edit) one document. Only its owner or an admin may
// change permissions; Paperless refuses anyone else.
export async function applyShare(p: Paperless, docId: number, share: Share) {
  const s = await load();
  const gid = s.familyGroupId;
  if (share === "family" && !gid) return;
  const perms = share === "family"
    ? familyPerms(gid!)
    : { view: { users: share, groups: [] }, change: { users: share, groups: [] } };
  await p.send("PATCH", `/api/documents/${docId}/`, { set_permissions: perms });
  const restricted = new Set(s.restricted ?? []);
  if (share === "family") restricted.delete(docId);
  else restricted.add(docId);
  const fresh = await load();
  fresh.restricted = [...restricted];
  await save(fresh);
}

export function shareOf(perms: { view?: { users?: number[]; groups?: number[] } } | undefined, gid: number | undefined): Share | null {
  if (!perms?.view) return null;
  if (gid && perms.view.groups?.includes(gid)) return "family";
  return perms.view.users ?? [];
}

export async function familyGroupId(): Promise<number | undefined> {
  return (await load()).familyGroupId;
}

// Shares everything that exists so far: all documents, categories, people
// tags and the expiry field. Run by first-time setup; safe to repeat.
export async function shareEverything(admin: Paperless, gid: number) {
  const meta = await loadMeta(admin);
  const perms = familyPerms(gid);
  const objects: [string, number[]][] = [
    ["tags", meta.people.map((x) => x.id)],
    ["document_types", meta.categories.map((x) => x.id)],
    ["custom_fields", meta.expiryFieldId ? [meta.expiryFieldId] : []],
  ];
  for (const [kind, ids] of objects) {
    for (const id of ids) await admin.send("PATCH", `/api/${kind}/${id}/`, { set_permissions: perms });
  }
  // Documents someone chose to keep to fewer people stay that way.
  const restricted = new Set((await load()).restricted ?? []);
  const docs = (await admin.all<{ id: number }>("/api/documents/?fields=id")).filter((d) => !restricted.has(d.id));
  if (docs.length) {
    await admin.send("POST", "/api/documents/bulk_edit/", {
      documents: docs.map((d) => d.id),
      method: "set_permissions",
      parameters: { set_permissions: perms, merge: true },
    });
  }
}

export type ApproveResult = { ok: true; username: string } | { ok: false; error: "not_found" | "rejected"; detail?: string };

// Creates the Paperless user in the family group and removes the request.
export async function approveSignup(admin: Paperless, id: string, person?: number): Promise<ApproveResult> {
  const s = await load();
  const req = s.signups.find((x) => x.id === id);
  if (!req) return { ok: false, error: "not_found" };
  const gid = await ensureFamilyGroup(admin);
  try {
    await admin.send("POST", "/api/users/", {
      username: req.username,
      password: decrypt(req.password),
      first_name: req.name,
      is_active: true,
      groups: [gid],
    });
  } catch (e) {
    if (e instanceof PaperlessError && e.status === 400) return { ok: false, error: "rejected", detail: e.message };
    throw e;
  }
  // The admin can say which existing family member this is; otherwise a
  // person with the requested name is created (unless one exists).
  const meta = await loadMeta(admin);
  const known = person !== undefined && meta.people.some((x) => x.id === person);
  if (!known && !meta.people.some((x) => x.name === req.name)) {
    await admin.send("POST", "/api/tags/", {
      name: `${config.peoplePrefix}${req.name}`, matching_algorithm: 0, set_permissions: familyPerms(gid),
    });
  }
  await shareEverything(admin, gid);
  await refreshRoster(admin);
  const fresh = await load();
  fresh.signups = fresh.signups.filter((x) => x.id !== id);
  await save(fresh);
  return { ok: true, username: req.username };
}

// Any family member may add a category. It is shared with the family right
// away; an existing category with the same name is returned instead.
export async function addCategory(p: Paperless, name: string): Promise<{ id: number; name: string }> {
  const existing = (await loadMeta(p)).categories.find((c) => c.name === name);
  if (existing) return existing;
  const gid = (await load()).familyGroupId;
  const created = await p.send<{ id: number; name: string }>("POST", "/api/document_types/", {
    name, matching_algorithm: 0, ...(gid ? { set_permissions: familyPerms(gid) } : {}),
  });
  return { id: created.id, name: created.name };
}

// Runs once per server start when an admin opens the app, so sharing and
// group permissions stay right without anyone pressing "first-time setup".
let synced = false;
export function syncFamilyOnce(admin: Paperless) {
  if (synced) return;
  synced = true;
  ensureFamilyGroup(admin)
    .then((gid) => shareEverything(admin, gid))
    .then(() => refreshRoster(admin))
    .catch((e) => {
      synced = false;
      console.warn("family sync failed:", e instanceof Error ? e.message : e);
    });
}

// The AI key can be entered by an admin in Settings instead of the
// environment, so it survives redeploys. Stored encrypted, kept in memory.
let aiKeyCache = "";
export const storedAiKey = () => aiKeyCache;

export async function loadAiKey() {
  const s = await load();
  try {
    aiKeyCache = s.aiKey ? decrypt(s.aiKey) : "";
  } catch {
    aiKeyCache = "";
  }
}

export async function saveAiKey(key: string) {
  const s = await load();
  if (key) s.aiKey = encrypt(key);
  else delete s.aiKey;
  await save(s);
  aiKeyCache = key;
}
