import { useState } from "react";
import { api } from "../lib/api.ts";
import { categoryIcon } from "../lib/categories.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import { Chip } from "./ui.tsx";

// Category chips plus "+ new category", which any family member can use.
export function CategoryPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const t = useT();
  const { meta, refreshMeta } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    setBusy(true);
    setFailed(false);
    try {
      const c = await api.addCategory(name.trim());
      await refreshMeta();
      onChange(c.id);
      setAdding(false);
      setName("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {meta.categories.map((c) => (
          <Chip key={c.id} selected={value === c.id} onClick={() => onChange(value === c.id ? null : c.id)}>
            {categoryIcon(c.name)} {c.name}
          </Chip>
        ))}
        {!adding && <Chip selected={false} onClick={() => setAdding(true)}>＋ {t.newCategory}</Chip>}
      </div>
      {adding && (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={20}
            aria-label={t.newCategory}
            className="min-h-14 min-w-0 flex-1 rounded-xl border-2 border-line bg-card px-3 text-xl"
          />
          <button disabled={busy || !name.trim()} onClick={add} className="min-h-14 rounded-xl bg-brand px-4 text-xl font-bold text-white disabled:opacity-50">
            {t.add}
          </button>
          <button onClick={() => { setAdding(false); setName(""); }} className="min-h-14 rounded-xl border-2 border-line px-3 text-xl">
            {t.cancel}
          </button>
        </div>
      )}
      {failed && <p className="text-lg text-danger">{t.error}</p>}
    </div>
  );
}
