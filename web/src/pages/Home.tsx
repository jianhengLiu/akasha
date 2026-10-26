import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api.ts";
import { categoryIcon, personColor } from "../lib/categories.ts";
import { greeting, useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import { go, href } from "../lib/router.ts";
import { useAsync } from "../lib/useAsync.ts";
import { DocRow, Empty, Page, SectionTitle } from "../components/ui.tsx";

const EXPIRY_WINDOW_DAYS = 60;

export function Home() {
  const t = useT();
  const { me, meta } = useApp();
  const [q, setQ] = useState("");
  const expiring = useAsync(() => api.docs({ expiring: EXPIRY_WINDOW_DAYS }), []);
  const recent = useAsync(() => api.docs({ page: 1 }), []);

  function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) go("/list", { q: q.trim() });
  }

  return (
    <Page>
      <header className="flex items-center justify-between pt-2">
        <div>
          <p className="text-lg text-muted">{greeting(t)}</p>
          <h1 className="text-3xl font-bold">{me.displayName}</h1>
        </div>
        <a
          href={href("/settings")}
          aria-label={t.settings}
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-line bg-card text-2xl"
        >
          ⚙️
        </a>
      </header>

      <form onSubmit={search} className="mt-6 flex gap-2" role="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.searchPlaceholder}
          enterKeyHint="search"
          className="min-h-16 min-w-0 flex-1 rounded-2xl border-2 border-line bg-card px-4 text-xl"
        />
        <button type="submit" className="min-h-16 rounded-2xl bg-ink px-5 text-xl font-bold text-paper">
          {t.search}
        </button>
      </form>

      <a
        href={href("/upload")}
        className="mt-4 flex items-center gap-4 rounded-3xl bg-brand p-5 text-white shadow-md active:bg-brand-dark"
      >
        <span className="text-5xl" aria-hidden>📷</span>
        <span>
          <span className="block text-2xl font-bold">{t.addPhoto}</span>
          <span className="block text-base opacity-90">{t.addPhotoHint}</span>
        </span>
      </a>

      {expiring.data && expiring.data.docs.length > 0 && (
        <>
          <SectionTitle link={{ to: href("/list", { expiring: EXPIRY_WINDOW_DAYS }), label: t.seeAll }}>
            ⏰ {t.expiringSoon}
          </SectionTitle>
          <div className="space-y-3">
            {expiring.data.docs.slice(0, 3).map((d) => (
              <DocRow key={d.id} doc={d} />
            ))}
          </div>
        </>
      )}

      {meta.people.length > 0 && (
        <>
          <SectionTitle>{t.byPerson}</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            {meta.people.map((p) => (
              <a
                key={p.id}
                href={href("/list", { person: p.id })}
                className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card p-3 shadow-sm active:scale-95"
              >
                <span
                  className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold text-white"
                  style={{ background: personColor(p.id) }}
                >
                  {p.name.slice(0, 1)}
                </span>
                <span className="text-lg font-bold">{p.name}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <SectionTitle>{t.byCategory}</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {meta.categories.map((c) => (
          <a
            key={c.id}
            href={href("/list", { category: c.id })}
            className="flex min-h-20 items-center gap-3 rounded-2xl border border-line bg-card px-4 shadow-sm active:scale-95"
          >
            <span className="text-3xl" aria-hidden>{categoryIcon(c.name)}</span>
            <span className="text-xl font-bold">{c.name}</span>
          </a>
        ))}
      </div>

      <SectionTitle link={{ to: href("/list"), label: t.seeAll }}>{t.recent}</SectionTitle>
      <div className="space-y-3">
        {recent.data?.docs.slice(0, 5).map((d) => <DocRow key={d.id} doc={d} />)}
        {recent.data && recent.data.docs.length === 0 && <Empty />}
      </div>
    </Page>
  );
}
