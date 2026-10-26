import { useEffect, useState } from "react";

// Hash-based routing keeps deployment simple (any static host, any sub-path)
// and makes the browser back button behave as parents expect.

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function href(path: string, params?: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `#${path}${s ? `?${s}` : ""}`;
}

export function go(path: string, params?: Record<string, string | number | undefined>) {
  window.location.hash = href(path, params);
}

export function back() {
  if (window.history.length > 1) window.history.back();
  else go("/");
}
