import { useState } from "react";
import { ApiError } from "../lib/api.ts";
import type { Account, AiSettings as AiSettingsData, Named, Signup, WireApi } from "../lib/api.ts";
import { useAsync } from "../lib/useAsync.ts";
import { api } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import type { FontSize } from "../lib/prefs.ts";
import { go } from "../lib/router.ts";
import { BigButton, Chip, ErrorNote, Page, TopBar } from "../components/ui.tsx";
import { InstallToHome } from "../components/InstallToHome.tsx";

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

      <section className="mt-8">
        <InstallToHome variant="button" />
      </section>

      {me.isAdmin && <PendingSignups />}
      {me.isAdmin && <ManageNames kind="people" />}
      {me.isAdmin && <ManageNames kind="categories" />}
      {me.isAdmin && <Accounts />}
      {me.isAdmin && <AiSettings />}

      {me.isAdmin && meta.categories.length === 0 && (
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
  const { meta, refreshMeta } = useApp();
  const list = useAsync(() => api.signups(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Which existing person each request is; 0 = create a new one.
  const [person, setPerson] = useState<Record<string, number>>({});

  const chosen = (s: Signup) => person[s.id] ?? meta.people.find((p) => p.name === s.name)?.id ?? 0;

  async function act(s: Signup, approve: boolean) {
    setBusy(s.id);
    setFailed(null);
    try {
      if (approve) {
        await api.approveSignup(s.id, chosen(s) || undefined);
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
          <div>
            <div className="mb-2 text-lg">{t.whoIsThis}</div>
            <div className="flex flex-wrap gap-2">
              {meta.people.map((p) => (
                <Chip key={p.id} selected={chosen(s) === p.id} onClick={() => setPerson((m) => ({ ...m, [s.id]: p.id }))}>{p.name}</Chip>
              ))}
              {!meta.people.some((p) => p.name === s.name) && (
                <Chip selected={chosen(s) === 0} onClick={() => setPerson((m) => ({ ...m, [s.id]: 0 }))}>{t.newPerson(s.name)}</Chip>
              )}
            </div>
          </div>
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

// Rename or remove family members or categories. Removing can move the
// documents to another one; documents themselves are never deleted.
function ManageNames({ kind }: { kind: "people" | "categories" }) {
  const t = useT();
  const { meta, refreshMeta } = useApp();
  const items = kind === "people" ? meta.people : meta.categories;
  const rename = kind === "people" ? api.renamePerson : api.renameCategory;
  const remove = kind === "people" ? api.removePerson : api.removeCategory;
  const [mode, setMode] = useState<null | { kind: "rename" | "remove"; person: Named }>(null);
  const [name, setName] = useState("");
  const [into, setInto] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function open(kind: "rename" | "remove", person: Named) {
    setMode({ kind, person });
    setName(person.name);
    setInto(null);
    setError("");
  }

  async function run() {
    if (!mode) return;
    setBusy(true);
    setError("");
    try {
      if (mode.kind === "rename") await rename(mode.person.id, name.trim());
      else await remove(mode.person.id, into ?? undefined);
      await refreshMeta();
      setMode(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t.nameTaken : t.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 space-y-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="text-xl font-bold">{kind === "people" ? t.manageFamily : t.manageCategories}</h2>
      {items.map((p) =>
        mode?.person.id === p.id ? (
          <div key={p.id} className="space-y-3 rounded-xl border-2 border-line bg-paper p-3">
            {mode.kind === "rename" ? (
              <input value={name} onChange={(e) => setName(e.target.value)} className="min-h-14 w-full rounded-xl border-2 border-line bg-card px-3 text-xl" />
            ) : (
              <>
                <p className="text-xl font-bold">{t.removeTitle(p.name)}</p>
                <div className="text-lg">{t.moveDocsTo}</div>
                <div className="flex flex-wrap gap-2">
                  {items.filter((x) => x.id !== p.id).map((x) => (
                    <Chip key={x.id} selected={into === x.id} onClick={() => setInto(x.id)}>{x.name}</Chip>
                  ))}
                  <Chip selected={into === null} onClick={() => setInto(null)}>{kind === "people" ? t.keepDocsOnly : t.noCategory}</Chip>
                </div>
                <p className="text-base text-muted">{t.removePersonHint}</p>
              </>
            )}
            {error && <p className="text-lg text-danger">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <BigButton tone="plain" onClick={() => setMode(null)}>{t.cancel}</BigButton>
              <BigButton tone={mode.kind === "remove" ? "danger" : "brand"} disabled={busy || !name.trim()} onClick={run}>
                {mode.kind === "remove" ? t.removePerson : t.save}
              </BigButton>
            </div>
          </div>
        ) : (
          <div key={p.id} className="flex items-center gap-2 rounded-xl border border-line bg-paper p-3">
            <span className="flex-1 text-xl font-bold">{p.name}</span>
            <button onClick={() => open("rename", p)} className="min-h-12 rounded-xl border-2 border-line px-3 text-lg">{t.rename}</button>
            <button onClick={() => open("remove", p)} className="min-h-12 rounded-xl border-2 border-line px-3 text-lg text-danger">{t.removePerson}</button>
          </div>
        ),
      )}
    </section>
  );
}

function Accounts() {
  const t = useT();
  const { me } = useApp();
  const list = useAsync(() => api.accounts(), []);
  const [busy, setBusy] = useState<number | null>(null);

  async function toggle(a: Account) {
    setBusy(a.id);
    try {
      await api.setAccountActive(a.id, !a.active);
      list.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8 space-y-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="text-xl font-bold">{t.accounts}</h2>
      {!!list.error && <ErrorNote />}
      {list.data?.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-paper p-3">
          <div className="flex-1">
            <div className={`text-xl font-bold ${a.active ? "" : "text-muted line-through"}`}>{a.name}</div>
            <div className="text-base text-muted">
              {a.username}
              {a.isAdmin && ` · ${t.adminBadge}`}
              {!a.active && ` · ${t.disabled}`}
            </div>
          </div>
          {!a.isAdmin && a.id !== me.id && (
            <button disabled={busy === a.id} onClick={() => toggle(a)} className={`min-h-12 rounded-xl border-2 border-line px-3 text-lg ${a.active ? "text-danger" : "text-brand"}`}>
              {a.active ? t.disable : t.enable}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function AiSettings() {
  const t = useT();
  const s = useAsync(() => api.aiSettings(), []);
  return (
    <section className="mt-8 space-y-4 rounded-2xl border border-line bg-card p-4">
      <h2 className="text-xl font-bold">
        {t.aiSettings}
        {s.data && <span className={`ml-2 text-lg ${s.data.enabled ? "text-brand" : "text-muted"}`}>{s.data.enabled ? `✅ ${t.aiOn}` : t.aiOff}</span>}
      </h2>
      {!!s.error && <ErrorNote />}
      {s.data && <AiForm initial={s.data} onSaved={s.reload} />}
    </section>
  );
}

function AiForm({ initial, onSaved }: { initial: AiSettingsData; onSaved: () => void }) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [wireApi, setWireApi] = useState<WireApi>(initial.wireApi);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(initial.model);
  const [models, setModels] = useState<string[] | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error" | "models_failed">("idle");
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setState("idle"); };
  const input = "mt-2 min-h-14 w-full rounded-xl border-2 border-line bg-paper px-3 text-xl";

  async function loadModels() {
    setState("busy");
    try {
      const r = await api.aiModels({ baseUrl: baseUrl.trim(), key: key.trim() });
      setModels(r.models);
      setState("idle");
    } catch {
      setModels(null);
      setState("models_failed");
    }
  }

  async function save() {
    setState("busy");
    try {
      await api.saveAiSettings({ baseUrl: baseUrl.trim(), wireApi, model: model.trim(), ...(key.trim() ? { key: key.trim() } : {}) });
      setKey("");
      setState("saved");
      onSaved();
    } catch {
      setState("error");
    }
  }

  return (
    <>
      {!initial.enabled && <p className="text-base text-muted">{t.aiNoServer}</p>}
      <label className="block text-lg">
        {t.aiBaseUrl}
        <input type="url" inputMode="url" autoComplete="off" value={baseUrl} onChange={(e) => edit(setBaseUrl)(e.target.value)}
          placeholder="https://api.openai.com/v1" className={input} />
      </label>
      <div>
        <div className="text-lg">{t.aiWireApi}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip selected={wireApi === "chat"} onClick={() => edit(setWireApi)("chat")}>{t.aiWireChat}</Chip>
          <Chip selected={wireApi === "responses"} onClick={() => edit(setWireApi)("responses")}>{t.aiWireResponses}</Chip>
        </div>
        <p className="mt-2 text-base text-muted">{t.aiWireHint}</p>
      </div>
      <label className="block text-lg">
        {t.aiKey}
        <input type="password" autoComplete="off" value={key} onChange={(e) => edit(setKey)(e.target.value)}
          placeholder={initial.keySet ? "••••••••" : ""} className={input} />
        {initial.keyFromEnv && <span className="mt-1 block text-base text-muted">{t.aiKeyFromEnv}</span>}
      </label>
      <div>
        <label className="block text-lg">
          {t.aiModel}
          {models?.length ? (
            <select value={model} onChange={(e) => edit(setModel)(e.target.value)} className={input}>
              {!models.includes(model) && <option value={model}>{model || "—"}</option>}
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input autoComplete="off" value={model} onChange={(e) => edit(setModel)(e.target.value)} placeholder="gpt-4o" className={input} />
          )}
        </label>
        <button onClick={loadModels} disabled={state === "busy" || !baseUrl.trim()} className="mt-2 min-h-12 text-lg text-brand disabled:opacity-50">
          🔄 {t.aiLoadModels}
        </button>
        {state === "models_failed" && <p className="text-lg text-danger">{t.aiModelsFailed}</p>}
      </div>
      {state === "error" && <ErrorNote />}
      <BigButton tone="plain" disabled={state === "busy" || !baseUrl.trim() || !model.trim()} onClick={save}>
        {state === "saved" ? `✅ ${t.aiKeySaved}` : t.save}
      </BigButton>
    </>
  );
}
