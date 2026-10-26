import { createContext, useContext } from "react";
import type { Lang } from "./i18n.ts";
import type { Me, Meta } from "./api.ts";

export type FontSize = "normal" | "large" | "xl";

export interface Prefs {
  font: FontSize;
  lang: Lang;
}

const KEY = "akasha.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { font: "large", lang: "zh", ...JSON.parse(raw) };
  } catch {
    // storage unavailable: fall through to defaults
  }
  // Default to large text: most users are parents.
  // Chinese by default for everyone; English is a choice in Settings.
  return { font: "large", lang: "zh" };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export interface AppState {
  me: Me;
  meta: Meta;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  refreshMeta: () => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside AppContext");
  return v;
}
