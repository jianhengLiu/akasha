import type { ReactNode } from "react";
import { daysUntil, thumbUrl } from "../lib/api.ts";
import type { Doc } from "../lib/api.ts";
import { categoryIcon } from "../lib/categories.ts";
import { useT } from "../lib/i18n.ts";
import { back, href } from "../lib/router.ts";

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-xl px-4 pb-28 pt-4">{children}</main>;
}

export function TopBar({ title, right }: { title?: string; right?: ReactNode }) {
  const t = useT();
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 bg-paper/95 px-2 py-2 backdrop-blur">
      <button
        onClick={back}
        className="flex min-h-12 items-center gap-1 rounded-xl px-3 text-lg font-medium text-brand active:bg-line"
      >
        <span aria-hidden className="text-2xl leading-none">‹</span> {t.back}
      </button>
      <h1 className="flex-1 truncate text-center text-xl font-bold">{title}</h1>
      <div className="min-w-20 text-right">{right}</div>
    </div>
  );
}

export function SectionTitle({ children, link }: { children: ReactNode; link?: { to: string; label: string } }) {
  return (
    <div className="mb-3 mt-8 flex items-baseline justify-between">
      <h2 className="text-xl font-bold">{children}</h2>
      {link && (
        <a href={link.to} className="px-2 py-1 text-base font-medium text-brand">
          {link.label} ›
        </a>
      )}
    </div>
  );
}

export function ExpiryBadge({ date }: { date: string }) {
  const t = useT();
  const n = daysUntil(date);
  const tone = n < 0 ? "bg-danger text-white" : n <= 30 ? "bg-warn text-white" : "bg-line text-ink";
  return <span className={`inline-block rounded-full px-3 py-0.5 text-sm font-bold ${tone}`}>{t.daysLeft(n)}</span>;
}

export function DocRow({ doc }: { doc: Doc }) {
  return (
    <a
      href={href(`/doc/${doc.id}`)}
      className="flex items-center gap-4 rounded-2xl border border-line bg-card p-3 shadow-sm active:scale-[0.99]"
    >
      <img
        src={thumbUrl(doc.id)}
        alt=""
        loading="lazy"
        className="h-24 w-18 shrink-0 rounded-lg border border-line bg-paper object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-lg font-bold leading-snug">{doc.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-muted">
          {doc.category && (
            <span>
              {categoryIcon(doc.category.name)} {doc.category.name}
            </span>
          )}
          {doc.people.map((p) => (
            <span key={p.id}>· {p.name}</span>
          ))}
        </div>
        {doc.expiry && (
          <div className="mt-2">
            <ExpiryBadge date={doc.expiry} />
          </div>
        )}
      </div>
      <span aria-hidden className="text-3xl text-muted">›</span>
    </a>
  );
}

export function Loading() {
  const t = useT();
  return <p className="py-10 text-center text-lg text-muted">{t.loading}</p>;
}

export function ErrorNote() {
  const t = useT();
  return <p className="rounded-xl bg-danger/10 p-4 text-lg text-danger">{t.error}</p>;
}

export function Empty() {
  const t = useT();
  return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-lg text-muted">{t.nothingHere}</p>;
}

export function BigButton({
  children,
  onClick,
  tone = "brand",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "brand" | "plain";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls =
    tone === "brand"
      ? "bg-brand text-white active:bg-brand-dark"
      : "border-2 border-line bg-card text-ink active:bg-line";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl px-5 text-xl font-bold shadow-sm disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-12 rounded-full border-2 px-5 text-lg font-medium ${
        selected ? "border-brand bg-brand text-white" : "border-line bg-card text-ink"
      }`}
    >
      {children}
    </button>
  );
}
