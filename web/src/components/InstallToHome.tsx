import { useState } from "react";
import { useT } from "../lib/i18n.ts";
import { isStandalone, platform, promptInstall } from "../lib/install.ts";
import { BigButton } from "./ui.tsx";

const DISMISS_KEY = "akasha.installDismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

// "Put it on the phone's home screen": one tap where the browser supports it,
// otherwise short steps for iPhone, WeChat or other browsers.
export function InstallToHome({ variant }: { variant: "card" | "button" }) {
  const t = useT();
  const [hidden, setHidden] = useState(() => isStandalone() || (variant === "card" && dismissed()));
  const [steps, setSteps] = useState(false);

  if (hidden) return null;

  async function start() {
    if (await promptInstall()) {
      if (isStandalone()) setHidden(true);
      return;
    }
    setSteps(true);
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setHidden(true);
  }

  const p = platform();
  const list = p === "wechat" ? t.installStepsWechat : p === "ios" ? t.installStepsIos : t.installStepsOther;

  return (
    <>
      {variant === "card" ? (
        <div className="mt-4 rounded-3xl border-2 border-line bg-card p-4">
          <button onClick={start} className="flex w-full items-center gap-4 text-left">
            <span className="text-5xl" aria-hidden>📲</span>
            <span>
              <span className="block text-2xl font-bold">{t.installTitle}</span>
              <span className="block text-base text-muted">{t.installHint}</span>
            </span>
          </button>
          <button onClick={dismiss} className="mt-2 min-h-12 w-full text-right text-base text-muted">{t.installLater}</button>
        </div>
      ) : (
        <BigButton tone="plain" onClick={start}>📲 {t.installTitle}</BigButton>
      )}

      {steps && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setSteps(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.installTitle}
            className="w-full max-w-xl rounded-t-3xl bg-paper p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold">📲 {t.installTitle}</h2>
            <ol className="mt-4 space-y-3">
              {list.map((s, i) => (
                <li key={i} className="flex gap-3 text-xl leading-relaxed">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold text-white">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6"><BigButton onClick={() => setSteps(false)}>{t.gotIt}</BigButton></div>
          </div>
        </div>
      )}
    </>
  );
}
