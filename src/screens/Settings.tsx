import type { FormEvent } from "react";
import { Header } from "../components/Header";
import { useStoa } from "../state";

/** The data repo and its token, sync state and the JSON backup. */
export function SettingsScreen() {
  const { settings, syncStatus: s, pending, connect, sync, exportAll } = useStoa();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void connect(String(form.get("repo")).trim(), String(form.get("token")).trim());
  };

  return (
    <div>
      <Header title="Settings" />
      <form className="card stack" onSubmit={save}>
        <h2>Data repo</h2>
        <label className="stack">
          Repository
          <input name="repo" type="text" placeholder="owner/stoa-data" defaultValue={settings.repo} autoCapitalize="off" spellCheck={false} required />
        </label>
        <label className="stack">
          Access token
          <input name="token" type="password" placeholder="github_pat_…" defaultValue={settings.token} autoComplete="off" required />
        </label>
        <p className="muted small">
          A fine-grained GitHub token for this one repository, with Contents read and write. It is stored on this phone only.
        </p>
        <button className="primary" type="submit">
          Save and sync
        </button>
      </form>
      <section className="card stack">
        <h2>Sync</h2>
        <p>{s ? `${s.ok ? "Last sync" : "Last try"} ${new Date(s.at).toLocaleString()}: ${s.message}` : "Not synced yet."}</p>
        <p className="muted small">{pending ? `${pending} change(s) waiting to be written.` : "Nothing waiting."}</p>
        <button disabled={!settings.token} onClick={() => void sync()}>
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
