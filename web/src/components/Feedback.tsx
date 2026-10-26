import { useState } from "react";
import { api } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import { BigButton } from "./ui.tsx";

// A floating "suggest" button on every signed-in page. Feedback is sent with
// the page name and route so it can be traced back to the screen.
export function Feedback({ page, route }: { page: string; route: string }) {
  const t = useT();
  const { prefs } = useApp();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  function close() {
    setOpen(false);
    if (state === "sent") {
      setMessage("");
      setState("idle");
    }
  }

  async function send() {
    setState("busy");
    try {
      await api.feedback({
        message: message.trim(),
        page,
        route,
        lang: prefs.lang,
        font: prefs.font,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        appVersion: __APP_VERSION__,
      });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-20 flex min-h-12 items-center gap-1 rounded-full border-2 border-line bg-card px-4 text-base font-bold text-ink shadow-lg"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        💬 {t.feedback}
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.feedback}
            className="w-full max-w-xl rounded-t-3xl bg-paper p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {state === "sent" ? (
              <div className="py-6 text-center">
                <div className="text-6xl" aria-hidden>🙏</div>
                <p className="mt-4 text-2xl font-bold">{t.feedbackThanks}</p>
                <div className="mt-6"><BigButton onClick={close}>{t.close}</BigButton></div>
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">{t.feedbackTitle}</h2>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.feedbackPlaceholder}
                  rows={4}
                  className="w-full rounded-2xl border-2 border-line bg-card p-4 text-xl"
                />
                {state === "error" && <p className="text-lg text-danger">{t.error}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <BigButton tone="plain" onClick={close}>{t.cancel}</BigButton>
                  <BigButton disabled={!message.trim() || state === "busy"} onClick={send}>{t.send}</BigButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
