import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import type { Extracted } from "../lib/api.ts";
import { categoryIcon } from "../lib/categories.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import { go } from "../lib/router.ts";
import { BigButton, Chip, ErrorNote, Page, TopBar } from "../components/ui.tsx";

type Phase = { name: "pick" } | { name: "saving" } | { name: "processing"; taskId: string } | { name: "done"; docId: number | null } | { name: "error" };

type AiState = { name: "off" } | { name: "reading" } | { name: "done"; result: Extracted } | { name: "failed" };

const POLL_MS = 2000;
const AI_MAX_SIDE = 1600;

// Phone photos are often 5-10 MB; the model only needs a readable JPEG.
async function downscale(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, AI_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85));
}
const POLL_LIMIT = 60;

export function Upload({ params }: { params: URLSearchParams }) {
  const t = useT();
  const { meta, me } = useApp();
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
  const [ai, setAi] = useState<AiState>({ name: "off" });
  const [expiry, setExpiry] = useState("");

  // Let the AI read a new photo and pre-fill whatever the user hasn't chosen yet.
  useEffect(() => {
    setAi({ name: "off" });
    if (!file || !me.ai || !file.type.startsWith("image/")) return;
    let alive = true;
    setAi({ name: "reading" });
    downscale(file)
      .then((img) => api.extract(img))
      .then((r) => {
        if (!alive) return;
        setAi({ name: "done", result: r });
        setTitle((v) => v || r.title);
        setPeople((v) => (v.length ? v : r.people));
        setCategory((v) => v ?? r.category);
        setExpiry((v) => v || r.expiry || "");
      })
      .catch(() => alive && setAi({ name: "failed" }));
    return () => {
      alive = false;
    };
  }, [file, me.ai]);

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
        if (s.status === "SUCCESS") {
          if (s.docId) await saveExtras(s.docId);
          return setPhase({ name: "done", docId: s.docId });
        }
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

  // The AI's text and the expiry date can only be stored once Paperless has
  // created the document. A failure here still leaves the document saved.
  async function saveExtras(docId: number) {
    const patch: { content?: string; expiry?: string } = {};
    if (ai.name === "done" && ai.result.content) patch.content = ai.result.content;
    if (expiry && meta.expiryFieldId != null) patch.expiry = expiry;
    if (Object.keys(patch).length) await api.patchDoc(docId, patch).catch(() => {});
  }

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
    setExpiry("");
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

          {ai.name !== "off" && (
            <div className="rounded-2xl border-2 border-line bg-card p-4" aria-live="polite">
              <div className="text-xl font-bold">
                {ai.name === "reading" ? `🤖 ${t.aiReading}` : ai.name === "done" ? `🤖 ${t.aiFilled}` : t.aiFailed}
              </div>
              {ai.name === "done" && ai.result.details.length > 0 && (
                <dl className="mt-3 space-y-1 text-lg">
                  {ai.result.details.map((d, i) => (
                    <div key={i} className="flex gap-2">
                      <dt className="shrink-0 text-muted">{d.label}</dt>
                      <dd className="break-all">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

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

          {meta.expiryFieldId != null && (expiry || ai.name === "done") && (
            <label className="block">
              <span className="mb-3 block text-xl font-bold">{t.expiry}</span>
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="min-h-14 w-full rounded-2xl border-2 border-line bg-card px-4 text-xl" />
            </label>
          )}

          {phase.name === "error" && <ErrorNote />}
          <BigButton disabled={phase.name === "saving" || ai.name === "reading"} onClick={submit}>
            {phase.name === "saving" ? t.saving : `✅ ${t.save}`}
          </BigButton>
        </div>
      )}
    </Page>
  );
}
