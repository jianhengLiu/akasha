import { useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { BigButton, Page } from "../components/ui.tsx";

// Anyone can ask for an account; it works once an admin approves it.
export function Signup({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    try {
      await api.signup({ name: name.trim(), username: username.trim(), password });
      setState("sent");
    } catch (err) {
      setError((err instanceof ApiError && t.signupErrors[err.message]) || t.error);
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <Page>
        <div className="flex flex-col items-center pt-16 text-center">
          <div className="text-7xl" aria-hidden>📨</div>
          <p className="mt-6 text-2xl font-bold">{t.signupSent}</p>
        </div>
        <div className="mt-10"><BigButton onClick={onBack}>{t.backToLogin}</BigButton></div>
      </Page>
    );
  }

  const input = "mt-2 block min-h-14 w-full rounded-2xl border-2 border-line bg-card px-4 text-xl";
  return (
    <Page>
      <h1 className="pt-10 text-3xl font-bold">{t.signupTitle}</h1>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <label className="block text-lg font-medium">
          {t.yourName}
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-lg font-medium">
          {t.chooseUsername}
          <input className={input} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-lg font-medium">
          {t.choosePassword}
          <input className={input} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-xl bg-danger/10 p-3 text-lg text-danger">{error}</p>}
        <BigButton type="submit" disabled={state === "busy" || !name.trim() || !username.trim() || !password}>
          {t.submitSignup}
        </BigButton>
        <BigButton tone="plain" onClick={onBack}>{t.backToLogin}</BigButton>
      </form>
    </Page>
  );
}
