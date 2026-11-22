import { useEffect } from "react";
import { Header } from "../components/Header";
import { loadGis } from "../googleAuth";
import { useStoa } from "../state";

/** Google sign-in, sync state and the JSON backup. */
export function SettingsScreen() {
  const { account, signInNeeded, syncStatus: s, pending, signIn, signOut, sync, exportAll } = useStoa();

  // Load Google's script ahead, so a tap on Sign in opens the popup right away.
  useEffect(() => {
    if (!account || signInNeeded) loadGis().catch(() => undefined);
  }, [account, signInNeeded]);

  return (
    <div>
      <Header title="Settings" />
      <section className="card stack">
        <h2>Google account</h2>
        {account ? (
          <>
            <p>
              Signed in as <strong>{account.email}</strong>
            </p>
            {signInNeeded && (
              <button className="primary" onClick={() => void signIn()}>
                Sign in again
              </button>
            )}
            <button onClick={() => void signOut()}>Sign out</button>
          </>
        ) : (
          <>
            <p className="muted small">
              Stoa keeps your log in a sheet named "Stoa" in your own Google Drive. It can see only the files it created.
            </p>
            <button className="primary" onClick={() => void signIn()}>
              Sign in with Google
            </button>
          </>
        )}
      </section>
      <section className="card stack">
        <h2>Sync</h2>
        <p>{s ? `${s.ok ? "Last sync" : "Last try"} ${new Date(s.at).toLocaleString()}: ${s.message}` : "Not synced yet."}</p>
        <p className="muted small">{pending ? `${pending} change(s) waiting to be written.` : "Nothing waiting."}</p>
        <button disabled={!account} onClick={() => void sync()}>
          Sync now
        </button>
      </section>
      <section className="card stack">
        <h2>Backup</h2>
        <p className="muted small">Downloads everything on this phone as one JSON file.</p>
        <button onClick={exportAll}>Export</button>
      </section>
    </div>
  );
}
