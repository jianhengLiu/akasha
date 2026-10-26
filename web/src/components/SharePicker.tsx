import { api } from "../lib/api.ts";
import type { Share } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useAsync } from "../lib/useAsync.ts";
import { Chip } from "./ui.tsx";

// "Family", "Only me", or specific accounts. Tapping a name narrows a
// family-wide choice down to that person.
export function SharePicker({ value, onChange }: { value: Share; onChange: (s: Share) => void }) {
  const t = useT();
  const family = useAsync(() => api.family(), []);
  const members = (family.data ?? []).filter((m) => !m.isAdmin);
  const hasAdmins = (family.data ?? []).some((m) => m.isAdmin);
  const toggle = (id: number) => {
    if (value === "family") return onChange([id]);
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Chip selected={value === "family"} onClick={() => onChange("family")}>👨‍👩‍👧 {t.shareFamily}</Chip>
        {members.map((m) => (
          <Chip key={m.id} selected={value !== "family" && value.includes(m.id)} onClick={() => toggle(m.id)}>{m.name}</Chip>
        ))}
        <Chip selected={value !== "family" && value.length === 0} onClick={() => onChange([])}>🔒 {t.shareOnlyMe}</Chip>
      </div>
      {value !== "family" && hasAdmins && <p className="text-base text-muted">{t.shareAdminsToo}</p>}
    </div>
  );
}
