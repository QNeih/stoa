/** The bottom tabs. Settings is not a tab; the gear in the Header opens it. */
const TABS = [
  ["today", "Today"],
  ["time", "Time"],
  ["goals", "Goals"],
  ["results", "Results"],
  ["log", "Log"],
] as const;

export function Nav({ active }: { active: string }) {
  return (
    <nav className="tabs">
      {TABS.map(([id, label]) => (
        <a key={id} href={`#/${id}`} className={id === active ? "active" : ""} aria-current={id === active ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
