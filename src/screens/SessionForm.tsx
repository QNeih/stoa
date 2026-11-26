import { useState, type FormEvent } from "react";
import { Header } from "../components/Header";
import { SubGoalSelect } from "../components/SubGoalSelect";
import { TrashIcon } from "../components/Icons";
import { OverlapWarning, savedOverlaps } from "../components/OverlapWarning";
import { toLocalInput } from "../format";
import type { OverlapFix } from "../overlap";
import { useStoa } from "../state";
import { isoLocal } from "../time";
import type { SessionEntry, StoredEntry } from "../types";

/**
 * Adds a past session, or edits or deletes the one with `id`. `draft` fills a new session (the quick input's
 * "Change"); `onDone` replaces going back to the Log. A session that overlaps saved ones asks how to resolve it.
 */
export function SessionForm({ id, draft, onDone }: { id?: number; draft?: SessionEntry; onDone?: (saved: boolean) => void }) {
  const { entries, saveSession, deleteEntry, loadEntries } = useStoa();
  const existing = entries.find((e): e is StoredEntry & SessionEntry => e.id === id && e.type === "session");
  const fill = existing ?? draft;
  const [now] = useState(() => new Date());
  const [conflict, setConflict] = useState<{ session: SessionEntry; overlapped: StoredEntry[] } | null>(null);
  const done = (saved: boolean) => (onDone ? onDone(saved) : (location.hash = "#/log"));

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    const start = new Date(field("start"));
    const end = new Date(field("end"));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return alert("The end must be after the start.");
    const session: SessionEntry = {
      type: "session",
      subGoal: field("subGoal"),
      task: field("task").trim(),
      start: isoLocal(start),
      end: isoLocal(end),
      note: field("note").trim(),
    };
    const overlapped = await savedOverlaps(loadEntries, session, existing?.id);
    if (overlapped.length) return setConflict({ session, overlapped });
    await saveSession(session, existing?.id);
    done(true);
  };

  const resolve = async (fix: OverlapFix) => {
    await saveSession(fix.session, existing?.id, fix);
    done(true);
  };

  const remove = async () => {
    if (!existing) return;
    await deleteEntry(existing.id!);
    done(false);
  };

  return (
    <div>
      <Header title={existing ? "Edit session" : "Add past session"} />
      {id !== undefined && !existing && <p className="muted">This session no longer exists.</p>}
      <form className="stack" onSubmit={save} onChange={() => setConflict(null)}>
        <label className="stack">
          Sub-goal
          <SubGoalSelect name="subGoal" defaultValue={fill?.subGoal || undefined} />
        </label>
        <label className="stack">
          Task
          <input name="task" type="text" placeholder="Task (optional)" defaultValue={fill?.task ?? ""} />
        </label>
        <label className="stack">
          Start
          <input
            name="start"
            type="datetime-local"
            required
            defaultValue={toLocalInput(fill ? new Date(fill.start) : new Date(now.getTime() - 3600_000))}
          />
        </label>
        <label className="stack">
          End
          <input name="end" type="datetime-local" required defaultValue={toLocalInput(fill ? new Date(fill.end) : now)} />
        </label>
        <label className="stack">
          Note
          <input name="note" type="text" placeholder="What came out of it? (optional)" defaultValue={fill?.note ?? ""} />
        </label>
        {conflict ? (
          <OverlapWarning
            session={conflict.session}
            overlapped={conflict.overlapped}
            onResolve={(fix) => void resolve(fix)}
            onBack={() => setConflict(null)}
          />
        ) : (
          <button className="primary" type="submit">
            Save
          </button>
        )}
        {existing && (
          <button type="button" className="danger" onClick={() => void remove()}>
            <TrashIcon />
            Delete
          </button>
        )}
        <button type="button" onClick={() => done(false)}>
          Cancel
        </button>
      </form>
    </div>
  );
}
