const TABS = [
  ["today", "Today"],
  ["plan", "Plan"],
  ["log", "Log"],
  ["habits", "Habits"],
  ["settings", "Settings"],
] as const;

export function Nav({ active }: { active: string }) {
  return (
    <nav className="tabs">
      {TABS.map(([id, label]) => (
        <a key={id} href={`#/${id}`} className={id === active ? "active" : ""}>
          {label}
        </a>
      ))}
    </nav>
  );
}
