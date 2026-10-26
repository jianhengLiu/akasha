import { useState } from "react";
import { api, downloadUrl, previewUrl, thumbUrl } from "../lib/api.ts";
import { categoryIcon } from "../lib/categories.ts";
import { useT } from "../lib/i18n.ts";
import { CategoryPicker } from "../components/CategoryPicker.tsx";
import { SharePicker } from "../components/SharePicker.tsx";
import type { Share } from "../lib/api.ts";
import { useApp } from "../lib/prefs.ts";
import { go } from "../lib/router.ts";
import { useAsync } from "../lib/useAsync.ts";
import { BigButton, Chip, ErrorNote, ExpiryBadge, Loading, Page, TopBar } from "../components/ui.tsx";

export function DocDetailPage({ id }: { id: number }) {
  const t = useT();
  const { meta } = useApp();
  const res = useAsync(() => api.doc(id), [id]);
  const [editing, setEditing] = useState<null | "expiry" | "info" | "share">(null);
  const [share, setShare] = useState<Share>("family");
  const [expiry, setExpiry] = useState("");
  const [people, setPeople] = useState<number[]>([]);
  const [category, setCategory] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);
  const [deleting, setDeleting] = useState<"no" | "confirm" | "busy" | "error">("no");

  if (res.loading && !res.data) return <Page><TopBar /><Loading /></Page>;
  if (!res.data) return <Page><TopBar /><ErrorNote /></Page>;
  const doc = res.data;

  async function save(patch: Parameters<typeof api.patchDoc>[1]) {
    setBusy(true);
    try {
      res.setData(await api.patchDoc(id, patch));
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveShare() {
    setBusy(true);
    try {
      const r = await api.setShare(id, share);
      res.setData({ ...doc, share: r.share });
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setDeleting("busy");
    try {
      await api.deleteDoc(id);
      go("/");
    } catch {
      setDeleting("error");
    }
  }

  return (
    <Page>
      <TopBar title={doc.title} />

      <a href={previewUrl(id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        <img src={thumbUrl(id)} alt={doc.title} className="mx-auto max-h-[60vh] w-full object-contain" />
      </a>

      <h2 className="mt-5 text-2xl font-bold leading-snug">{doc.title}</h2>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-lg text-muted">
        {doc.category && <span>{categoryIcon(doc.category.name)} {doc.category.name}</span>}
        {doc.people.map((p) => <span key={p.id}>· {p.name}</span>)}
      </div>

      <section className="mt-5 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base text-muted">{t.expiry}</div>
            <div className="text-xl font-bold">{doc.expiry ?? t.noExpiry}</div>
            {doc.expiry && <div className="mt-1"><ExpiryBadge date={doc.expiry} /></div>}
          </div>
          {meta.expiryFieldId != null && editing !== "expiry" && (
            <button
              onClick={() => { setExpiry(doc.expiry ?? ""); setEditing("expiry"); }}
              className="min-h-12 rounded-xl border-2 border-line px-4 text-lg font-medium"
            >
              {doc.expiry ? t.change : t.setExpiry}
            </button>
          )}
        </div>
        {editing === "expiry" && (
          <div className="mt-4 space-y-3">
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="min-h-14 w-full rounded-xl border-2 border-line bg-paper px-3 text-xl" />
            <div className="grid grid-cols-2 gap-3">
              <BigButton tone="plain" onClick={() => setEditing(null)}>{t.cancel}</BigButton>
              <BigButton disabled={busy} onClick={() => save({ expiry: expiry || null })}>{t.save}</BigButton>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-card p-4">
        {editing !== "info" ? (
          <button
            onClick={() => {
              setPeople(doc.people.map((p) => p.id));
              setCategory(doc.category?.id ?? null);
              setEditing("info");
            }}
            className="flex min-h-12 w-full items-center justify-between text-lg font-medium"
          >
            <span>{t.personAndCategory}</span>
            <span className="text-brand">{t.change} ›</span>
          </button>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-lg font-bold">{t.whose}</div>
              <div className="flex flex-wrap gap-2">
                {meta.people.map((p) => (
                  <Chip key={p.id} selected={people.includes(p.id)} onClick={() => setPeople((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])}>
                    {p.name}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-lg font-bold">{t.whatKind}</div>
              <CategoryPicker value={category} onChange={setCategory} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <BigButton tone="plain" onClick={() => setEditing(null)}>{t.cancel}</BigButton>
              <BigButton disabled={busy} onClick={() => save({ people, category })}>{t.save}</BigButton>
            </div>
          </div>
        )}
      </section>

      {doc.share !== null && (
        <section className="mt-4 rounded-2xl border border-line bg-card p-4">
          {editing !== "share" ? (
            <button
              onClick={() => { setShare(doc.share ?? "family"); setEditing("share"); }}
              className="flex min-h-12 w-full items-center justify-between gap-3 text-lg font-medium"
            >
              <span>{t.whoCanSee} <span className="text-muted">{doc.share === "family" ? t.shareFamily : doc.share.length === 0 ? t.shareOnlyMe : "👥"}</span></span>
              <span className="shrink-0 text-brand">{t.change} ›</span>
            </button>
          ) : (
            <div className="space-y-4">
              <div className="text-lg font-bold">{t.whoCanSee}</div>
              <SharePicker value={share} onChange={setShare} />
              <div className="grid grid-cols-2 gap-3">
                <BigButton tone="plain" onClick={() => setEditing(null)}>{t.cancel}</BigButton>
                <BigButton disabled={busy} onClick={saveShare}>{t.save}</BigButton>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <a href={previewUrl(id)} target="_blank" rel="noreferrer" className="flex min-h-16 items-center justify-center rounded-2xl bg-brand text-xl font-bold text-white">
          🔍 {t.viewOriginal}
        </a>
        <a href={downloadUrl(id)} className="flex min-h-16 items-center justify-center rounded-2xl border-2 border-line bg-card text-xl font-bold">
          ⬇️ {t.download}
        </a>
      </div>

      {doc.content && (
        <section className="mt-6">
          <button onClick={() => setShowText((s) => !s)} className="flex min-h-12 w-full items-center justify-between text-lg font-bold">
            <span>{t.recognizedText}</span>
            <span aria-hidden>{showText ? "▲" : "▼"}</span>
          </button>
          {showText && <p className="whitespace-pre-wrap rounded-2xl bg-card p-4 text-lg leading-relaxed">{doc.content}</p>}
        </section>
      )}

      <section className="mt-10">
        {deleting === "no" ? (
          <button onClick={() => setDeleting("confirm")} className="min-h-14 w-full text-lg font-medium text-danger">
            🗑️ {t.deleteDoc}
          </button>
        ) : (
          <div className="space-y-3 rounded-2xl border-2 border-danger/40 bg-card p-4">
            <p className="text-xl font-bold">{t.deleteConfirm}</p>
            <p className="text-lg text-muted">{t.deleteHint}</p>
            {deleting === "error" && <ErrorNote />}
            <div className="grid grid-cols-2 gap-3">
              <BigButton tone="plain" onClick={() => setDeleting("no")}>{t.cancel}</BigButton>
              <BigButton tone="danger" disabled={deleting === "busy"} onClick={remove}>{t.delete}</BigButton>
            </div>
          </div>
        )}
      </section>
    </Page>
  );
}
