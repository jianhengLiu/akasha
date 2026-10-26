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

export interface DocDetail extends Doc {
  content: string;
  fileName: string | null;
}

export interface Me { id: number; username: string; displayName: string; isAdmin: boolean }

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
  patchDoc: (id: number, patch: Partial<{ title: string; category: number | null; people: number[]; expiry: string | null }>) =>
    call<DocDetail>(`/api/docs/${id}`, jsonInit("PATCH", patch)),
  upload: (form: FormData) => call<{ taskId: string }>("/api/docs", { method: "POST", body: form }),
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
