export interface Named { id: number; name: string }

export interface Meta {
  people: Named[];
  categories: Named[];
  expiryFieldId: number | null;
}

export interface Doc {
  id: number;
  title: string;
  category: Named | null;
  people: Named[];
  created: string;
  added: string;
  expiry: string | null;
  excerpt: string;
}

// "family", or the accounts besides yourself ([] = only me).
export type Share = "family" | number[];

export interface Member { id: number; name: string; isAdmin: boolean }

export interface DocDetail extends Doc {
  content: string;
  fileName: string | null;
  // null when you may not change who sees it.
  share: Share | null;
}

export interface Me { id: number; username: string; displayName: string; isAdmin: boolean; ai: boolean; share: Share }

export interface Account { id: number; username: string; name: string; active: boolean; isAdmin: boolean }

export interface Signup { id: string; name: string; username: string; created: string }

export interface Extracted {
  title: string;
  people: number[];
  category: number | null;
  expiry: string | null;
  details: { label: string; value: string }[];
  content: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event("akasha:unauthenticated"));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  login: (username: string, password: string) => call<{ ok: true }>("/api/auth/login", jsonInit("POST", { username, password })),
  signup: (body: { name: string; username: string; password: string }) => call<{ ok: true }>("/api/signup", jsonInit("POST", body)),
  signups: () => call<Signup[]>("/api/signups"),
  approveSignup: (id: string, person?: number) =>
    call<{ ok: true }>(`/api/signups/${encodeURIComponent(id)}/approve`, jsonInit("POST", person ? { person } : {})),
  renamePerson: (id: number, name: string) => call<{ ok: true }>(`/api/people/${id}`, jsonInit("PATCH", { name })),
  removePerson: (id: number, into?: number) => call<{ ok: true }>(`/api/people/${id}${into ? `?into=${into}` : ""}`, { method: "DELETE" }),
  aiSettings: () => call<{ enabled: boolean; baseUrl: string; model: string; keyFromEnv: boolean; keySet: boolean }>("/api/ai/settings"),
  saveAiKey: (key: string) => call<{ ok: true; enabled: boolean }>("/api/ai/settings", jsonInit("PUT", { key })),
  renameCategory: (id: number, name: string) => call<{ ok: true }>(`/api/categories/${id}`, jsonInit("PATCH", { name })),
  removeCategory: (id: number, into?: number) => call<{ ok: true }>(`/api/categories/${id}${into ? `?into=${into}` : ""}`, { method: "DELETE" }),
  accounts: () => call<Account[]>("/api/accounts"),
  setAccountActive: (id: number, active: boolean) => call<{ ok: true }>(`/api/accounts/${id}`, jsonInit("PATCH", { active })),
  rejectSignup: (id: string) => call<{ ok: true }>(`/api/signups/${encodeURIComponent(id)}`, { method: "DELETE" }),
  logout: () => call<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => call<Me>("/api/me"),
  meta: () => call<Meta>("/api/meta"),
  setup: (people: string[]) => call<{ created: string[]; meta: Meta }>("/api/setup", jsonInit("POST", { people })),
  docs: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return call<{ count: number; docs: Doc[] }>(`/api/docs?${qs}`);
  },
  doc: (id: number) => call<DocDetail>(`/api/docs/${id}`),
  patchDoc: (id: number, patch: Partial<{ title: string; category: number | null; people: number[]; expiry: string | null; content: string }>) =>
    call<DocDetail>(`/api/docs/${id}`, jsonInit("PATCH", patch)),
  family: () => call<Member[]>("/api/family"),
  setShare: (id: number, share: Share) => call<{ ok: true; share: Share }>(`/api/docs/${id}/share`, jsonInit("PUT", { share })),
  deleteDoc: (id: number) => call<{ ok: true }>(`/api/docs/${id}`, { method: "DELETE" }),
  upload: (form: FormData) => call<{ taskId: string }>("/api/docs", { method: "POST", body: form }),
  extract: (image: Blob) => {
    const form = new FormData();
    form.append("file", image, "photo.jpg");
    return call<Extracted>("/api/ai/extract", { method: "POST", body: form });
  },
  addCategory: (name: string) => call<Named>("/api/categories", jsonInit("POST", { name })),
  extractNote: (note: string) => {
    const form = new FormData();
    form.append("note", note);
    return call<Extracted>("/api/ai/extract", { method: "POST", body: form });
  },
  feedback: (body: Record<string, string>) => call<{ ok: true; via: string }>("/api/feedback", jsonInit("POST", body)),
  task: (id: string) => call<{ status: string; docId: number | null }>(`/api/tasks/${encodeURIComponent(id)}`),
};

export const thumbUrl = (id: number) => `/api/docs/${id}/thumb`;
export const previewUrl = (id: number) => `/api/docs/${id}/preview`;
export const downloadUrl = (id: number) => `/api/docs/${id}/download`;

export function daysUntil(iso: string, today = new Date()): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - now) / 86400000);
}
