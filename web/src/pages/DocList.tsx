import { api } from "../lib/api.ts";
import { categoryIcon } from "../lib/categories.ts";
import { useT } from "../lib/i18n.ts";
import { useApp } from "../lib/prefs.ts";
import { useAsync } from "../lib/useAsync.ts";
import { DocRow, Empty, ErrorNote, Loading, Page, TopBar } from "../components/ui.tsx";

export function DocList({ params }: { params: URLSearchParams }) {
  const t = useT();
  const { meta } = useApp();
  const q = params.get("q") ?? undefined;
  const person = params.get("person") ?? undefined;
  const category = params.get("category") ?? undefined;
  const expiring = params.get("expiring") ?? undefined;
  const key = params.toString();
  const res = useAsync(() => api.docs({ q, person, category, expiring }), [key]);

  let title = t.recent;
  if (q) title = t.resultsFor(q);
  else if (expiring) title = `⏰ ${t.expiringSoon}`;
  else if (person) title = meta.people.find((p) => String(p.id) === person)?.name ?? "";
  else if (category) {
    const c = meta.categories.find((x) => String(x.id) === category);
    title = c ? `${categoryIcon(c.name)} ${c.name}` : "";
  }

  return (
    <Page>
      <TopBar title={title} />
      {res.loading && <Loading />}
      {res.error != null && <ErrorNote />}
      {res.data && (
        <>
          <p className="mb-3 text-base text-muted">{t.count(res.data.count)}</p>
          <div className="space-y-3">
            {res.data.docs.map((d) => (
              <DocRow key={d.id} doc={d} />
            ))}
          </div>
          {res.data.docs.length === 0 && <Empty />}
        </>
      )}
    </Page>
  );
}
