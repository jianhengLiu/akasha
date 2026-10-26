// Maps Paperless concepts onto the simple family model the UI shows:
//   category  = Paperless document type (保险, 证件, ...)
//   person    = Paperless tag named "<prefix><name>" (家人/妈妈)
//   expiry    = Paperless date custom field (到期日)

import { config } from "./config.ts";
import type { PCustomField, PDocType, PDocument, Paged, Paperless, PTag } from "./paperless.ts";

export interface Meta {
  people: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  expiryFieldId: number | null;
}

export interface FamilyDoc {
  id: number;
  title: string;
  category: { id: number; name: string } | null;
  people: { id: number; name: string }[];
  created: string;
  added: string;
  expiry: string | null;
  excerpt: string;
}

export interface FamilyDocDetail extends FamilyDoc {
  content: string;
  fileName: string | null;
}

export async function loadMeta(p: Paperless): Promise<Meta> {
  const [tags, types, fields] = await Promise.all([
    p.all<PTag>("/api/tags/"),
    p.all<PDocType>("/api/document_types/"),
    p.all<PCustomField>("/api/custom_fields/"),
  ]);
  const prefix = config.peoplePrefix;
  return {
    people: tags
      .filter((t) => t.name.startsWith(prefix))
      .map((t) => ({ id: t.id, name: t.name.slice(prefix.length) })),
    categories: types.map((t) => ({ id: t.id, name: t.name })),
    expiryFieldId: fields.find((f) => f.name === config.expiryField && f.data_type === "date")?.id ?? null,
  };
}

export function toFamilyDoc(d: PDocument, meta: Meta): FamilyDoc {
  const expiry = meta.expiryFieldId == null
    ? null
    : (d.custom_fields.find((c) => c.field === meta.expiryFieldId)?.value as string | null | undefined) ?? null;
  const cat = meta.categories.find((c) => c.id === d.document_type) ?? null;
  return {
    id: d.id,
    title: d.title,
    category: cat,
    people: meta.people.filter((p) => d.tags.includes(p.id)),
    created: d.created,
    added: d.added,
    expiry,
    excerpt: (d.content ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
}

export function toDetail(d: PDocument, meta: Meta): FamilyDocDetail {
  return { ...toFamilyDoc(d, meta), content: d.content ?? "", fileName: d.original_file_name ?? null };
}

export interface DocQuery {
  q?: string;
  person?: number;
  category?: number;
  page?: number;
  pageSize?: number;
  expiringWithinDays?: number;
}

export function buildDocumentsPath(q: DocQuery, meta: Meta, today = new Date()): string {
  const params = new URLSearchParams();
  params.set("page_size", String(q.pageSize ?? 30));
  params.set("page", String(q.page ?? 1));
  if (q.q) params.set("query", q.q);
  else params.set("ordering", "-added");
  if (q.person) params.set("tags__id__all", String(q.person));
  if (q.category) params.set("document_type__id", String(q.category));
  if (q.expiringWithinDays != null && meta.expiryFieldId != null) {
    const from = isoDate(addDays(today, -1));
    const to = isoDate(addDays(today, q.expiringWithinDays));
    params.set("custom_field_query", JSON.stringify([meta.expiryFieldId, "range", [from, to]]));
  }
  return `/api/documents/?${params.toString()}`;
}

export async function listDocs(p: Paperless, q: DocQuery) {
  const meta = await loadMeta(p);
  if (q.expiringWithinDays != null && meta.expiryFieldId == null) {
    return { count: 0, docs: [] as FamilyDoc[] };
  }
  const page = await p.json<Paged<PDocument>>(buildDocumentsPath(q, meta));
  let docs = page.results.map((d) => toFamilyDoc(d, meta));
  if (q.expiringWithinDays != null) {
    docs = docs.sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
  }
  return { count: page.count, docs };
}

export interface DocPatch {
  title?: string;
  category?: number | null;
  people?: number[];
  expiry?: string | null;
  content?: string;
}

export async function patchDoc(p: Paperless, id: number, patch: DocPatch) {
  const meta = await loadMeta(p);
  const current = await p.json<PDocument>(`/api/documents/${id}/`);
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.category !== undefined) body.document_type = patch.category;
  if (typeof patch.content === "string") body.content = patch.content.slice(0, 100_000);
  if (patch.people !== undefined) {
    const personIds = new Set(meta.people.map((x) => x.id));
    body.tags = [...current.tags.filter((t) => !personIds.has(t)), ...patch.people];
  }
  if (patch.expiry !== undefined) {
    if (meta.expiryFieldId == null) throw new Error("expiry field not set up");
    const others = current.custom_fields.filter((c) => c.field !== meta.expiryFieldId);
    body.custom_fields = patch.expiry ? [...others, { field: meta.expiryFieldId, value: patch.expiry }] : others;
  }
  const updated = await p.send<PDocument>("PATCH", `/api/documents/${id}/`, body);
  return toDetail(updated, meta);
}

// Creates the default categories, family-member tags and the expiry field
// when they do not exist yet. Safe to run more than once.
export async function ensureDefaults(p: Paperless, people = config.defaultPeople) {
  const meta = await loadMeta(p);
  const created: string[] = [];
  for (const name of config.defaultCategories) {
    if (!meta.categories.some((c) => c.name === name)) {
      await p.send("POST", "/api/document_types/", { name, matching_algorithm: 0 });
      created.push(`category:${name}`);
    }
  }
  for (const name of people) {
    if (!meta.people.some((x) => x.name === name)) {
      await p.send("POST", "/api/tags/", { name: `${config.peoplePrefix}${name}`, matching_algorithm: 0 });
      created.push(`person:${name}`);
    }
  }
  if (meta.expiryFieldId == null) {
    await p.send("POST", "/api/custom_fields/", { name: config.expiryField, data_type: "date" });
    created.push(`field:${config.expiryField}`);
  }
  return created;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
