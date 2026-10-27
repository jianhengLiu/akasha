// Reads a photo (with a vision model) or a typed note and returns the fields
// Akasha cares about (title, whose it is, category, expiry date, key details
// and the full text).
// Phone photos of Chinese paperwork are hard for classic OCR; a vision model
// guided by a prompt does much better. The image is sent to the configured
// provider and nothing is stored here.

import { config } from "./config.ts";
import { storedAi } from "./accounts.ts";
import type { Meta } from "./family.ts";

export interface Extracted {
  title: string;
  people: number[];
  category: number | null;
  expiry: string | null;
  details: { label: string; value: string }[];
  text: string;
  // details + text, ready to store as the document's searchable content.
  content: string;
}

// What an admin saved in Settings wins; the environment is the default.
export function aiConfig() {
  const s = storedAi();
  return {
    baseUrl: (s.baseUrl || config.aiBaseUrl).replace(/\/+$/, ""),
    model: s.model || config.aiModel,
    wireApi: (s.wireApi || config.aiWireApi) as "chat" | "responses",
    key: s.key || config.aiApiKey,
  };
}
export const aiEnabled = () => {
  const c = aiConfig();
  return !!(c.baseUrl && c.key && c.model);
};

export function validBaseUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

// Model ids the provider offers (OpenAI-compatible GET /models). Lets an admin
// pick one and doubles as a connection test. Unsaved values can be tried.
export async function listModels(over: { baseUrl?: string; key?: string } = {}): Promise<string[]> {
  const c = aiConfig();
  const base = (over.baseUrl || c.baseUrl).replace(/\/+$/, "");
  // The saved key only ever goes to the saved address.
  const key = over.key || (base === c.baseUrl ? c.key : "");
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new AiError(`ai provider returned ${res.status} for /models`);
  const body = await res.json() as { data?: { id?: unknown }[] };
  return [...new Set((body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string"))].sort();
}

export class AiError extends Error {}

function prompt(meta: Meta, note?: string): string {
  return [
    note === undefined
      ? "你在帮一个家庭整理资料。看这张照片（可能是保单、证件、病历、发票、合同等），只输出一个 JSON 对象，不要其他文字："
      : "你在帮一个家庭整理资料。下面是家人随手记下的一段文字（可能是卡号、电话、地址、密码提示、备忘等），只输出一个 JSON 对象，不要其他文字：",
    "{",
    '  "title": "简短中文标题，带上是谁的，比如“妈妈 重疾险保单”",',
    `  "people": 这份资料属于哪些家人，只能从 ${JSON.stringify(meta.people.map((p) => p.name))} 里选，看不出来就给 [],`,
    `  "category": 只能从 ${JSON.stringify(meta.categories.map((c) => c.name))} 里选一个，不确定就给 null,`,
    '  "expiry": "到期、续保或有效期截止日期，格式 YYYY-MM-DD，没有就给 null",',
    '  "details": [{"label": "字段名", "value": "值"}]，列出最有用的信息，比如保险公司、险种、被保险人、保单号、保额、保费、证件号码、有效期、医院、诊断、金额，最多 12 条,',
    note === undefined ? '  "text": "照片上的全部文字，按原样逐行抄下来"' : '  "text": ""',
    "}",
    ...(note === undefined ? [] : ["", "文字内容：", note]),
  ].join("\n");
}

// Models sometimes wrap JSON in ```json fences or add a sentence around it.
export function parseJson(s: string): Record<string, unknown> {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("no json in reply");
  return JSON.parse(s.slice(start, end + 1));
}

export function toExtracted(raw: Record<string, unknown>, meta: Meta): Extracted {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const names = Array.isArray(raw.people) ? raw.people.map((x) => str(x, 40)) : [];
  const people = meta.people.filter((p) => names.includes(p.name)).map((p) => p.id);
  const category = meta.categories.find((c) => c.name === str(raw.category, 40))?.id ?? null;
  const date = str(raw.expiry, 10);
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : null;
  const details = (Array.isArray(raw.details) ? raw.details : [])
    .map((d) => ({ label: str(d?.label, 40), value: str(d?.value, 200) }))
    .filter((d) => d.label && d.value)
    .slice(0, 12);
  const text = str(raw.text, 20_000);
  const content = [...details.map((d) => `${d.label}：${d.value}`), ...(details.length && text ? [""] : []), text].join("\n").trim();
  return { title: str(raw.title, 120), people, category, expiry, details, text, content };
}

// Two wire formats are common: Chat Completions (most providers) and the
// newer Responses API (OpenAI, and Codex-style relays that only offer it).
async function callChat(prompt: string, dataUrl?: string): Promise<string | undefined> {
  const body = await post("/chat/completions", {
    model: aiConfig().model,
    temperature: 0,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...(dataUrl ? [{ type: "image_url", image_url: { url: dataUrl } }] : []),
      ],
    }],
  }) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content;
}

async function callResponses(prompt: string, dataUrl?: string): Promise<string | undefined> {
  const body = await post("/responses", {
    model: aiConfig().model,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...(dataUrl ? [{ type: "input_image", image_url: dataUrl }] : []),
      ],
    }],
  }) as { output_text?: string; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  if (typeof body.output_text === "string") return body.output_text;
  return body.output
    ?.flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}

async function post(path: string, payload: unknown): Promise<unknown> {
  const c = aiConfig();
  const res = await fetch(`${c.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new AiError(`ai provider returned ${res.status} for ${path}`);
  return res.json();
}

export async function extract(input: { image: Blob } | { note: string }, meta: Meta): Promise<Extracted> {
  const call = aiConfig().wireApi === "responses" ? callResponses : callChat;
  let reply: string | undefined;
  if ("image" in input) {
    const bytes = Buffer.from(await input.image.arrayBuffer());
    reply = await call(prompt(meta), `data:${input.image.type || "image/jpeg"};base64,${bytes.toString("base64")}`);
  } else {
    reply = await call(prompt(meta, input.note));
  }
  if (typeof reply !== "string" || !reply) throw new AiError("empty ai reply");
  return toExtracted(parseJson(reply), meta);
}
