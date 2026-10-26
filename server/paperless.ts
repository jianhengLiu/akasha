// Thin client for the subset of the Paperless-ngx REST API that Akasha uses.
// Every call runs with the logged-in user's own API token, so Paperless
// permissions decide what each family member can see.

export class PaperlessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Paged<T> {
  count: number;
  next: string | null;
  results: T[];
}

export interface PTag { id: number; name: string; color?: string }
export interface PDocType { id: number; name: string }
export interface PCustomField { id: number; name: string; data_type: string }
export interface PDocument {
  id: number;
  title: string;
  content: string;
  tags: number[];
  document_type: number | null;
  correspondent: number | null;
  created: string;
  added: string;
  original_file_name?: string;
  custom_fields: { field: number; value: unknown }[];
}

export class Paperless {
  base: string;
  token?: string;

  constructor(base: string, token?: string) {
    this.base = base.replace(/\/+$/, "");
    this.token = token;
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json; version=9");
    if (this.token) headers.set("Authorization", `Token ${this.token}`);
    const res = await fetch(`${this.base}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PaperlessError(res.status, text.slice(0, 500) || res.statusText);
    }
    return res;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.raw(path, init);
    return (await res.json()) as T;
  }

  send<T>(method: string, path: string, body: unknown): Promise<T> {
    return this.json<T>(path, {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  async login(username: string, password: string): Promise<string> {
    const { token } = await this.send<{ token: string }>("POST", "/api/token/", { username, password });
    return token;
  }

  async all<T>(path: string): Promise<T[]> {
    const sep = path.includes("?") ? "&" : "?";
    const page = await this.json<Paged<T>>(`${path}${sep}page_size=1000`);
    return page.results;
  }
}
