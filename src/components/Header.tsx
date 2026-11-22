import type { ReactNode } from "react";
import { useStoa } from "../state";

/** Screen title with the sync state on the right. */
export function Header({ title, children }: { title: string; children?: ReactNode }) {
  const { syncing, settings, syncStatus, pending } = useStoa();
  const issue = !!settings.token && !!syncStatus && !syncStatus.ok;
  const badge = syncing ? "Syncing…"
    : !settings.token ? "Not connected"
    : issue ? "Sync issue"
    : pending ? `${pending} to sync`
    : "Synced";
  return (
    <header className="top">
      <h1>{title}</h1>
      {children}
      <span className={issue ? "sync-badge warn" : "sync-badge"}>{badge}</span>
    </header>
  );
}
