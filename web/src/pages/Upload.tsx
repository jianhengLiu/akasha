import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { categoryIcon } from "../lib/categories.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import { go } from "../lib/router.ts";
import { BigButton, Chip, ErrorNote, Page, TopBar } from "../components/ui.tsx";

type Phase = { name: "pick" } | { name: "saving" } | { name: "processing"; taskId: string } | { name: "done"; docId: number | null } | { name: "error" };

const POLL_MS = 2000;
const POLL_LIMIT = 60;

export function Upload({ params }: { params: URLSearchParams }) {
  const t = useT();
  const { meta } = useApp();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [people, setPeople] = useState<number[]>(() => {
    const p = Number(params.get("person"));
    return p ? [p] : [];
  });
  const [category, setCategory] = useState<number | null>(() => Number(params.get("category")) || null);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "pick" });

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (phase.name !== "processing") return;
    let tries = 0;
    let alive = true;
    const tick = async () => {
      tries++;
      try {
        const s = await api.task(phase.taskId);
        if (!alive) return;
        if (s.status === "SUCCESS") return setPhase({ name: "done", docId: s.docId });
        if (s.status === "FAILURE") return setPhase({ name: "error" });
      } catch {
        // keep polling; transient errors are common on mobile networks
      }
      if (tries >= POLL_LIMIT) return setPhase({ name: "done", docId: null });
      timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase]);

  async function submit() {
    if (!file) return;
    setPhase({ name: "saving" });
    const form = new FormData();
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());
    if (category) form.append("category", String(category));
    for (const p of people) form.append("person", String(p));
    try {
      const { taskId } = await api.upload(form);
      setPhase({ name: "processing", taskId });
    } catch {
      setPhase({ name: "error" });
    }
  }

  function reset() {
    setFile(null);
    setTitle("");
    setPhase({ name: "pick" });
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
    e.target.value = "";
  };

  if (phase.name === "processing" || phase.name === "done") {
    return (
      <Page>
        <TopBar title={t.addPhoto} />
        <div className="flex flex-col items-center py-10 text-center">
          <div className="text-7xl" aria-hidden>{phase.name === "done" ? "✅" : "⏳"}</div>
          <p className="mt-6 text-2xl font-bold">{phase.name === "done" ? t.savedDone : t.savedProcessing}</p>
        </div>
        <div className="space-y-3">
          {phase.name === "done" && phase.docId && <BigButton onClick={() => go(`/doc/${phase.docId}`)}>{t.openIt}</BigButton>}
          <BigButton tone="plain" onClick={reset}>📷 {t.addAnother}</BigButton>
          <BigButton tone="plain" onClick={() => go("/")}>{t.home}</BigButton>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <TopBar title={t.addPhoto} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
      <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={onPick} />

      {!file ? (
        <div className="space-y-4 pt-4">
          <button
            onClick={() => cameraInput.current?.click()}
            className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-3xl bg-brand text-white shadow-md active:bg-brand-dark"
          >
            <span className="text-7xl" aria-hidden>📷</span>
            <span className="text-2xl font-bold">{t.takePhoto}</span>
          </button>
          <BigButton tone="plain" onClick={() => fileInput.current?.click()}>🖼️ {t.pickFile}</BigButton>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            {preview ? (
              <img src={preview} alt="" className="mx-auto max-h-80 w-full object-contain" />
            ) : (
              <div className="p-8 text-center text-xl">📄 {file.name}</div>
            )}
            <button onClick={() => setFile(null)} className="min-h-12 w-full border-t border-line text-lg text-brand">
              {t.retake}
            </button>
          </div>

          {meta.people.length > 0 && (
            <div>
              <div className="mb-3 text-xl font-bold">{t.whose}</div>
              <div className="flex flex-wrap gap-2">
                {meta.people.map((p) => (
                  <Chip key={p.id} selected={people.includes(p.id)} onClick={() => setPeople((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}>
                    {p.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="mb-3 text-xl font-bold">{t.whatKind}</div>
            <div className="flex flex-wrap gap-2">
              {meta.categories.map((c) => (
                <Chip key={c.id} selected={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>
                  {categoryIcon(c.name)} {c.name}
                </Chip>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-3 block text-xl font-bold">{t.titleOptional}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-14 w-full rounded-2xl border-2 border-line bg-card px-4 text-xl" />
          </label>

          {phase.name === "error" && <ErrorNote />}
          <BigButton disabled={phase.name === "saving"} onClick={submit}>
            {phase.name === "saving" ? t.saving : `✅ ${t.save}`}
          </BigButton>
        </div>
      )}
    </Page>
  );
}
