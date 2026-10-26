// "Add to home screen" support. Android Chrome-like browsers fire
// beforeinstallprompt, which we keep so a button can open the real install
// dialog. iOS and in-app browsers (WeChat) need step-by-step instructions.

import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export function initInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export type Platform = "wechat" | "ios" | "other";

export function platform(): Platform {
  const ua = navigator.userAgent;
  if (/MicroMessenger/i.test(ua)) return "wechat";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "other";
}

// Opens the browser's own install dialog when it offers one.
// Returns false when the user has to follow manual steps instead.
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  await e.prompt();
  await e.userChoice.catch(() => undefined);
  return true;
}

export function useCanPrompt(): boolean {
  const [can, setCan] = useState(!!deferred);
  useEffect(() => {
    const f = () => setCan(!!deferred);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return can;
}
