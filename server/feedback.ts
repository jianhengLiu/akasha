// Turns in-app feedback into GitHub issues, labelled with the page it came
// from, so problems can be traced back to a screen. Without a GitHub token
// configured, feedback is appended to a local JSON-lines file instead.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.ts";

export interface Feedback {
  message: string;
  page: string;
  route: string;
  lang?: string;
  font?: string;
  viewport?: string;
  appVersion?: string;
}

export interface FeedbackContext {
  username: string;
  userAgent: string;
}

export function validate(input: unknown): Feedback | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const message = str(o.message, 4000);
  const page = str(o.page, 40).replace(/[^a-z0-9-]/gi, "");
  if (!message || !page) return null;
  return {
    message,
    page,
    route: str(o.route, 200),
    lang: str(o.lang, 10),
    font: str(o.font, 10),
    viewport: str(o.viewport, 20),
    appVersion: str(o.appVersion, 20),
  };
}

export function issueFor(f: Feedback, ctx: FeedbackContext) {
  const firstLine = f.message.split("\n")[0].slice(0, 60);
  return {
    title: `[${f.page}] ${firstLine}`,
    labels: ["feedback", `page:${f.page}`],
    body: [
      f.message,
      "",
      "---",
      "| | |",
      "| --- | --- |",
      `| 页面 | \`${f.page}\` |`,
      `| 路径 | \`${f.route || "/"}\` |`,
      `| 用户 | ${ctx.username} |`,
      `| 语言 / 字号 | ${f.lang || "?"} / ${f.font || "?"} |`,
      `| 屏幕 | ${f.viewport || "?"} |`,
      `| 版本 | ${f.appVersion || "?"} |`,
      `| 浏览器 | ${ctx.userAgent.slice(0, 200).replace(/\|/g, "/")} |`,
      "",
      "_Submitted from Akasha's in-app feedback button._",
    ].join("\n"),
  };
}

export async function submitFeedback(f: Feedback, ctx: FeedbackContext): Promise<{ via: "github" | "file"; url?: string }> {
  const issue = issueFor(f, ctx);
  if (config.githubToken && config.feedbackRepo) {
    const res = await fetch(`https://api.github.com/repos/${config.feedbackRepo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "akasha-feedback",
      },
      body: JSON.stringify(issue),
    });
    if (res.ok) {
      const { html_url } = (await res.json()) as { html_url: string };
      return { via: "github", url: html_url };
    }
    console.error(`feedback: GitHub returned ${res.status}, saving to file instead`);
  }
  await mkdir(config.dataDir, { recursive: true });
  await appendFile(
    join(config.dataDir, "feedback.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), ...issue })}\n`,
  );
  return { via: "file" };
}

// Simple per-user limit so a stuck button cannot flood the issue tracker.
const recent = new Map<string, number[]>();
export function allow(username: string, now = Date.now(), limit = 10, windowMs = 60 * 60 * 1000): boolean {
  const times = (recent.get(username) ?? []).filter((t) => now - t < windowMs);
  if (times.length >= limit) return false;
  times.push(now);
  recent.set(username, times);
  return true;
}
