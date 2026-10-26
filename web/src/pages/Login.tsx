import { useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { BigButton, Page } from "../components/ui.tsx";
import { Signup } from "./Signup.tsx";

export function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(username.trim(), password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t.badCredentials : t.error);
    } finally {
      setBusy(false);
    }
  }

  if (signingUp) return <Signup onBack={() => setSigningUp(false)} />;

  const input = "mt-2 block min-h-14 w-full rounded-2xl border-2 border-line bg-card px-4 text-xl";
  return (
    <Page>
      <div className="flex flex-col items-center pt-12">
        <img src="/icon.svg" alt="" className="h-24 w-24" />
        <h1 className="mt-4 text-3xl font-bold">{t.appName}</h1>
      </div>
      <form onSubmit={submit} className="mt-10 space-y-5">
        <label className="block text-lg font-medium">
          {t.username}
          <input className={input} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-lg font-medium">
          {t.password}
          <input className={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-xl bg-danger/10 p-3 text-lg text-danger">{error}</p>}
        <BigButton type="submit" disabled={busy || !username || !password}>
          {t.login}
        </BigButton>
      </form>
      <button onClick={() => setSigningUp(true)} className="mt-6 min-h-14 w-full text-xl text-brand underline">
        {t.signupLink}
      </button>
    </Page>
  );
}
