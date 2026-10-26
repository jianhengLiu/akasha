import { useState } from "react";
import type { Signup } from "../lib/api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { api } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import type { FontSize } from "../lib/prefs.ts";
import { go } from "../lib/router.ts";
import { BigButton, Chip, ErrorNote, Page, TopBar } from "../components/ui.tsx";

export function Settings({ onLogout }: { onLogout: () => void }) {
  const t = useT();
  const { me, meta, prefs, setPrefs, refreshMeta } = useApp();
  const [names, setNames] = useState(() => (meta.people.length ? meta.people.map((p) => p.name).join("，") : "爸爸，妈妈"));
  const [setupState, setSetupState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const fonts: [FontSize, string][] = [["normal", t.fontNormal], ["large", t.fontLarge], ["xl", t.fontXL]];

  async function runSetup() {
    setSetupState("busy");
    try {
      await api.setup(names.split(/[,，、\s]+/).filter(Boolean));
      await refreshMeta();
      setSetupState("done");
    } catch {
      setSetupState("error");
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
    go("/");
  }

  return (
    <Page>
      <TopBar title={t.settings} />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{t.fontSize}</h2>
        <div className="flex flex-wrap gap-2">
          {fonts.map(([v, label]) => (
            <Chip key={v} selected={prefs.font === v} onClick={() => setPrefs({ ...prefs, font: v })}>{label}</Chip>
          ))}
        </div>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-bold">{t.language}</h2>
        <div className="flex flex-wrap gap-2">
          <Chip selected={prefs.lang === "zh"} onClick={() => setPrefs({ ...prefs, lang: "zh" })}>中文</Chip>
          <Chip selected={prefs.lang === "en"} onClick={() => setPrefs({ ...prefs, lang: "en" })}>English</Chip>
        </div>
      </section>

      {me.isAdmin && <PendingSignups />}

      {me.isAdmin && (
        <section className="mt-8 space-y-3 rounded-2xl border border-line bg-card p-4">
          <h2 className="text-xl font-bold">{t.firstSetup}</h2>
          <p className="text-base text-muted">{t.firstSetupHint}</p>
          <label className="block text-lg">
            {t.familyMembers}
            <input value={names} onChange={(e) => setNames(e.target.value)} className="mt-2 min-h-14 w-full rounded-xl border-2 border-line bg-paper px-3 text-xl" />
          </label>
          {setupState === "error" && <ErrorNote />}
          <BigButton tone="plain" disabled={setupState === "busy"} onClick={runSetup}>
            {setupState === "done" ? `✅ ${t.setupDone}` : t.firstSetup}
          </BigButton>
        </section>
      )}

      <div className="mt-10">
        <p className="mb-3 text-center text-base text-muted">{me.username}</p>
        <BigButton tone="plain" onClick={logout}>{t.logout}</BigButton>
      </div>
    </Page>
  );
}

function PendingSignups() {
  const t = useT();
  const { refreshMeta } = useApp();
  const list = useAsync(() => api.signups(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function act(s: Signup, approve: boolean) {
    setBusy(s.id);
    setFailed(null);
    try {
      if (approve) {
        await api.approveSignup(s.id);
        await refreshMeta();
      } else {
        await api.rejectSignup(s.id);
      }
      list.reload();
    } catch {
      setFailed(s.id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8 space-y-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="text-xl font-bold">{t.pendingSignups}</h2>
      {!!list.error && <ErrorNote />}
      {list.data?.length === 0 && <p className="text-lg text-muted">{t.noPending}</p>}
      {list.data?.map((s) => (
        <div key={s.id} className="space-y-3 rounded-xl border border-line bg-paper p-3">
          <div className="text-xl font-bold">{s.name} <span className="text-base font-normal text-muted">（{s.username}）</span></div>
          {failed === s.id && <p className="text-lg text-danger">{t.approveFailed}</p>}
          <div className="grid grid-cols-2 gap-3">
            <BigButton tone="plain" disabled={busy === s.id} onClick={() => act(s, false)}>{t.reject}</BigButton>
            <BigButton disabled={busy === s.id} onClick={() => act(s, true)}>{t.approve}</BigButton>
          </div>
        </div>
      ))}
    </section>
  );
}
