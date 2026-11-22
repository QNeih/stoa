import type { FormEvent } from "react";
import { Header } from "../components/Header";
import { HabitSelect } from "../components/HabitSelect";
import { toLocalInput } from "../format";
import { useStoa } from "../state";
import { isoLocal } from "../time";
import type { SessionEntry, StoredEntry } from "../types";

/** Adds a past session, or edits or deletes the one with `id`. */
export function SessionForm({ id }: { id?: number }) {
  const { entries, saveSession, deleteEntry } = useStoa();
  const existing = entries.find((e): e is StoredEntry & SessionEntry => e.id === id && e.type === "session");
  const now = new Date();

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    const start = new Date(field("start"));
    const end = new Date(field("end"));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return alert("The end must be after the start.");
    await saveSession(
      { type: "session", habit: field("habit"), task: field("task").trim(), start: isoLocal(start), end: isoLocal(end), note: field("note").trim() },
      existing?.id,
    );
    location.hash = "#/log";
  };

  const remove = async () => {
    if (!existing || !confirm("Delete this session?")) return;
    await deleteEntry(existing.id!);
    location.hash = "#/log";
  };

  return (
    <div>
      <Header title={existing ? "Edit session" : "Add past session"} />
      {id !== undefined && !existing && <p className="muted">This session no longer exists.</p>}
      <form className="stack" onSubmit={save}>
        <label className="stack">
          Habit
          <HabitSelect name="habit" defaultValue={existing?.habit} />
        </label>
        <label className="stack">
          Task
          <input name="task" type="text" placeholder="Task (optional)" defaultValue={existing?.task ?? ""} />
        </label>
        <label className="stack">
          Start
          <input
            name="start"
            type="datetime-local"
            required
            defaultValue={toLocalInput(existing ? new Date(existing.start) : new Date(now.getTime() - 3600_000))}
          />
        </label>
        <label className="stack">
          End
          <input name="end" type="datetime-local" required defaultValue={toLocalInput(existing ? new Date(existing.end) : now)} />
        </label>
        <label className="stack">
          Note
          <input name="note" type="text" placeholder="What came out of it? (optional)" defaultValue={existing?.note ?? ""} />
        </label>
        <button className="primary" type="submit">
          Save
        </button>
        {existing && (
          <button type="button" className="danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
        <a className="button" href="#/log">
          Cancel
        </a>
      </form>
    </div>
  );
}
