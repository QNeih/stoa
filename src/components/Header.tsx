import type { ReactNode } from "react";
import { useStoa } from "../state";

/**
 * Screen title with the sync state and the Settings gear on the right; the sync state turns into a
 * sign-in button when one is needed.
 */
export function Header({ title, children }: { title: string; children?: ReactNode }) {
  const { syncing, account, signInNeeded, signIn, syncStatus, pending } = useStoa();
  const issue = !!account && !!syncStatus && !syncStatus.ok;
  const badge = syncing ? "Syncing…"
    : issue ? "Sync issue"
    : pending ? `${pending} to sync`
    : "Synced";
  return (
    <header className="top">
      <h1>{title}</h1>
      {children}
      {!account ? (
        <button className="sync-badge link" onClick={() => (location.hash = "#/settings")}>
          Sign in
        </button>
      ) : signInNeeded && !syncing ? (
        <button className="sync-badge link warn" onClick={() => void signIn()}>
          Sign in again
        </button>
      ) : (
        <span className={issue ? "sync-badge warn" : "sync-badge"}>{badge}</span>
      )}
      <a className="gear" href="#/settings" aria-label="Settings">
        ⚙
      </a>
    </header>
  );
}
