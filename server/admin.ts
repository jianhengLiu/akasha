// Admin-only management of family members (person tags), categories
// (document types) and accounts. Removing a person or category never deletes
// documents: they move to another one, or just lose that label. Accounts are disabled, not deleted, so they
// can be turned back on.

import { config } from "./config.ts";
import { loadMeta } from "./family.ts";
import type { Paperless } from "./paperless.ts";

export interface Account { id: number; username: string; name: string; active: boolean; isAdmin: boolean }

export async function renamePerson(admin: Paperless, id: number, name: string): Promise<"ok" | "not_found" | "taken"> {
  const meta = await loadMeta(admin);
  if (!meta.people.some((x) => x.id === id)) return "not_found";
  if (meta.people.some((x) => x.id !== id && x.name === name)) return "taken";
  await admin.send("PATCH", `/api/tags/${id}/`, { name: `${config.peoplePrefix}${name}` });
  return "ok";
}

// Moves the person's documents to `into` (when given), then deletes the tag.
export async function removePerson(admin: Paperless, id: number, into?: number): Promise<"ok" | "not_found"> {
  const meta = await loadMeta(admin);
  if (!meta.people.some((x) => x.id === id)) return "not_found";
  if (into !== undefined && (into === id || !meta.people.some((x) => x.id === into))) return "not_found";
  if (into !== undefined) {
    const docs = await admin.all<{ id: number }>(`/api/documents/?tags__id__all=${id}&fields=id`);
    if (docs.length) {
      await admin.send("POST", "/api/documents/bulk_edit/", {
        documents: docs.map((d) => d.id),
        method: "modify_tags",
        parameters: { add_tags: [into], remove_tags: [id] },
      });
    }
  }
  await admin.raw(`/api/tags/${id}/`, { method: "DELETE" });
  return "ok";
}

export async function renameCategory(admin: Paperless, id: number, name: string): Promise<"ok" | "not_found" | "taken"> {
  const meta = await loadMeta(admin);
  if (!meta.categories.some((x) => x.id === id)) return "not_found";
  if (meta.categories.some((x) => x.id !== id && x.name === name)) return "taken";
  await admin.send("PATCH", `/api/document_types/${id}/`, { name });
  return "ok";
}

// Moves the category's documents to `into` (when given), then deletes it;
// otherwise Paperless leaves those documents without a category.
export async function removeCategory(admin: Paperless, id: number, into?: number): Promise<"ok" | "not_found"> {
  const meta = await loadMeta(admin);
  if (!meta.categories.some((x) => x.id === id)) return "not_found";
  if (into !== undefined && (into === id || !meta.categories.some((x) => x.id === into))) return "not_found";
  if (into !== undefined) {
    const docs = await admin.all<{ id: number }>(`/api/documents/?document_type__id=${id}&fields=id`);
    if (docs.length) {
      await admin.send("POST", "/api/documents/bulk_edit/", {
        documents: docs.map((d) => d.id),
        method: "set_document_type",
        parameters: { document_type: into },
      });
    }
  }
  await admin.raw(`/api/document_types/${id}/`, { method: "DELETE" });
  return "ok";
}

export async function listAccounts(admin: Paperless): Promise<Account[]> {
  const users = await admin.all<{ id: number; username: string; first_name?: string; is_active: boolean; is_superuser: boolean }>("/api/users/");
  return users
    .filter((u) => u.username !== "consumer" && u.username !== "AnonymousUser")
    .map((u) => ({ id: u.id, username: u.username, name: u.first_name?.trim() || u.username, active: u.is_active, isAdmin: u.is_superuser }));
}

export async function setAccountActive(admin: Paperless, id: number, active: boolean, selfId: number): Promise<"ok" | "not_found" | "forbidden"> {
  const target = (await listAccounts(admin)).find((u) => u.id === id);
  if (!target) return "not_found";
  // Never lock out an admin (including yourself) from here.
  if (target.isAdmin || id === selfId) return "forbidden";
  await admin.send("PATCH", `/api/users/${id}/`, { is_active: active });
  return "ok";
}
