import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api.ts";
import type { Me, Meta } from "./lib/api.ts";
import { dictionaries, I18nContext } from "./lib/i18n.ts";
import { AppContext, loadPrefs, savePrefs } from "./lib/prefs.ts";
import type { Prefs } from "./lib/prefs.ts";
import { useRoute } from "./lib/router.ts";
import { Loading } from "./components/ui.tsx";
import { Feedback } from "./components/Feedback.tsx";
import { Login } from "./pages/Login.tsx";
import { Home } from "./pages/Home.tsx";
import { DocList } from "./pages/DocList.tsx";
import { DocDetailPage } from "./pages/DocDetail.tsx";
import { Upload } from "./pages/Upload.tsx";
import { Settings } from "./pages/Settings.tsx";

type Session = { status: "loading" } | { status: "anon" } | { status: "ok"; me: Me; meta: Meta };

export function App() {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [session, setSession] = useState<Session>({ status: "loading" });
  const route = useRoute();
  const t = dictionaries[prefs.lang];

  useEffect(() => {
    document.documentElement.dataset.font = prefs.font;
    document.documentElement.lang = prefs.lang === "zh" ? "zh-CN" : "en";
    document.title = `Akasha · ${t.appName}`;
  }, [prefs, t]);

  const load = useCallback(async () => {
    try {
      const [me, meta] = await Promise.all([api.me(), api.meta()]);
      setSession({ status: "ok", me, meta });
    } catch {
      setSession({ status: "anon" });
    }
  }, []);

  useEffect(() => {
    load();
    const onAnon = () => setSession({ status: "anon" });
    window.addEventListener("akasha:unauthenticated", onAnon);
    return () => window.removeEventListener("akasha:unauthenticated", onAnon);
  }, [load]);

  const setPrefs = useCallback((p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  }, []);

  const state = useMemo(() => {
    if (session.status !== "ok") return null;
    return {
      me: session.me,
      meta: session.meta,
      prefs,
      setPrefs,
      refreshMeta: async () => {
        const meta = await api.meta();
        setSession((s) => (s.status === "ok" ? { ...s, meta } : s));
      },
    };
  }, [session, prefs, setPrefs]);

  let page;
  let pageName = "home";
  if (session.status === "loading") page = <Loading />;
  else if (!state) page = <Login onDone={load} />;
  else {
    const docMatch = route.path.match(/^\/doc\/(\d+)$/);
    if (docMatch) [pageName, page] = ["doc", <DocDetailPage id={Number(docMatch[1])} />];
    else if (route.path === "/list") [pageName, page] = ["list", <DocList params={route.params} />];
    else if (route.path === "/upload") [pageName, page] = ["upload", <Upload params={route.params} />];
    else if (route.path === "/settings") [pageName, page] = ["settings", <Settings onLogout={() => setSession({ status: "anon" })} />];
    else page = <Home />;
  }

  return (
    <I18nContext.Provider value={t}>
      {state ? (
        <AppContext.Provider value={state}>
          {page}
          <Feedback page={pageName} route={`${route.path}${route.params.size ? `?${route.params}` : ""}`} />
        </AppContext.Provider>
      ) : (
        page
      )}
    </I18nContext.Provider>
  );
}
