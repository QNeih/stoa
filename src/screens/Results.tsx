import { useState, type CSSProperties, type ReactNode } from "react";
import { Header } from "../components/Header";
import { ChevronIcon, PenIcon } from "../components/Icons";
import { activeGoals } from "../format";
import { PALETTE, goalColor } from "../palette";
import { doneResults, inDoneWindow, openResults, type DoneResult } from "../results";
import { useStoa } from "../state";
import { daysBetween, formatDuration, localDate, parseLocalDate } from "../time";
import { msToday } from "../today";
import type { Config, Goal, Result } from "../types";

/** Results that show: not archived, on a sub-goal that is not archived, of a goal that is not archived. */
function visibleResults(config: Config): Result[] {
  const goals = new Set(activeGoals(config).map((g) => g.id));
  const subGoals = new Set(config.subGoals.filter((h) => !h.archived && goals.has(h.goal)).map((h) => h.id));
  return config.results.filter((r) => !r.archived && subGoals.has(r.subGoal));
}

const goalStyle = (goal: Goal) => ({ "--goal": PALETTE[goalColor(goal)] }) as CSSProperties;

/** "Today", "Yesterday", or a short date such as "Sat 21 Nov". */
function dayText(day: string, today: string): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  return parseLocalDate(day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Rows grouped by goal (a headline, in rank order) and sub-goal (a divider with its name, in config
 * order). Goals and sub-goals without rows are left out.
 */
function Grouped<T>({ config, items, subGoalOf, row }: { config: Config; items: T[]; subGoalOf: (t: T) => string; row: (t: T) => ReactNode }) {
  return activeGoals(config).map((goal) => {
    const subGoals = config.subGoals
      .filter((h) => h.goal === goal.id)
      .map((h) => ({ subGoal: h, rows: items.filter((t) => subGoalOf(t) === h.id) }))
      .filter((x) => x.rows.length);
    if (!subGoals.length) return null;
    return (
      <section key={goal.id} className="result-goal" style={goalStyle(goal)}>
        <h3 className="goal-headline">
          <span className="dot" />
          {goal.name}
        </h3>
        {subGoals.map(({ subGoal, rows }) => (
          <div key={subGoal.id}>
            <div className="divider">
              <span>{subGoal.name}</span>
            </div>
            <ul className="result-list">{rows.map(row)}</ul>
          </div>
        ))}
      </section>
    );
  });
}

/**
 * The one place where results are checked and unchecked. Open results come first: manual ones with a
 * checkbox (checking offers an optional note), automatic ones with today's progress toward their
 * minimum. The done list below holds the last 7 days of standing checks (each with "Add another") and of days automatic results were reached.
 */
export function ResultsScreen() {
  const { config, checks, entries, timer, checkResult, uncheckResult } = useStoa();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const now = new Date();
  const today = localDate(now);

  const results = visibleResults(config);
  const byId = new Map(results.map((r) => [r.id, r]));
  const open = openResults(results, checks, entries, today);
  const shownDone = doneResults(results, checks, entries)
    .filter((d) => inDoneWindow(d.day, today))
    .reverse();

  const startCheck = (id: string) => {
    setNote("");
    setNoteFor(noteFor === id ? null : id);
  };
  const save = (id: string, text: string) => {
    setNoteFor(null);
    void checkResult(id, text);
  };

  /** The inline sheet that saves a check of result `id` with an optional note. */
  const noteForm = (id: string) => (
    <form
      className="note-sheet"
      onSubmit={(e) => {
        e.preventDefault();
        save(id, note);
      }}
    >
      <input aria-label="Note" placeholder="Note (optional)" value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
      <div className="actions">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={() => save(id, "")}>
          Skip note
        </button>
      </div>
    </form>
  );

  const openRow = (r: Result) => {
    if (r.type === "auto") {
      const minutes = Math.floor(msToday(entries, timer, now, r.subGoal) / 60_000);
      return (
        <li key={r.id} className="result auto">
          <span className="result-name">{r.name}</span>
          <span className="muted small">
            {minutes} / {r.min_minutes} min today
          </span>
        </li>
      );
    }
    const noting = noteFor === r.id;
    return (
      <li key={r.id} className="result">
        <label className="check">
          <input type="checkbox" checked={noting} onChange={() => startCheck(r.id)} />
          <span className="result-name">{r.name}</span>
        </label>
        {noting && noteForm(r.id)}
      </li>
    );
  };

  /** One done entry: the first of its card in full, the others (`compact`) as a day line. */
  const doneEntry = (d: DoneResult, compact: boolean) => {
    const r = byId.get(d.result)!;
    const when = dayText(d.day, today);
    if (d.type === "auto") {
      return (
        <div key={`auto-${d.day}`} className="done-entry auto">
          {!compact && (
            <span className="tick" aria-hidden="true">
              ✓
            </span>
          )}
          <div className="result-body">
            {!compact && <span className="result-name">{r.name}</span>}
            <div className="muted small">
              {when} · {formatDuration(d.ms)} ·{" "}
              <a className="edit-log" href="#/log" aria-label={`Edit ${when.toLowerCase()} in Log`}>
                <PenIcon />Log
              </a>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div key={d.check.uid} className="done-entry">
        <label className="check">
          <input type="checkbox" checked aria-label={`Uncheck ${r.name}`} onChange={() => void uncheckResult(d.check.uid)} />
          <div className="result-body">
            {!compact && <span className="result-name">{r.name}</span>}
            <div className={compact ? "small" : "muted small"}>{when}</div>
            {!compact && d.check.note && <div className="note small">{d.check.note}</div>}
          </div>
        </label>
        {!compact && (
          <>
            <button type="button" className="link small" onClick={() => startCheck(`copy:${d.check.uid}`)}>
              Add another
            </button>
            {noteFor === `copy:${d.check.uid}` && noteForm(d.result)}
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      <Header title="Results" />
      {!results.length ? (
        <p className="muted">No results yet. The daily check-in adds them to your Stoa sheet; they load on the next sync.</p>
      ) : (
        <>
          <h2>Open</h2>
          {open.length ? (
            <Grouped config={config} items={open} subGoalOf={(r) => r.subGoal} row={openRow} />
          ) : (
            <p className="muted small">Everything is done for today.</p>
          )}
          <h2>Done</h2>
          {shownDone.length ? (
            <Grouped
              config={config}
              items={doneGroups(shownDone)}
              subGoalOf={(g) => byId.get(g[0].result)!.subGoal}
              row={(g) => <DoneCard key={groupKey(g[0])} entries={g} render={doneEntry} />}
            />
          ) : (
            <p className="muted small">Nothing done yet.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Done entries of the same result and note share a card. */
const groupKey = (d: DoneResult) => `${d.result}\u0000${d.type === "manual" ? d.check.note : ""}`;

/** `done` (newest first) grouped by result and note, each group newest first, in the order of its newest entry. */
function doneGroups(done: DoneResult[]): DoneResult[][] {
  const groups = new Map<string, DoneResult[]>();
  for (const d of done) {
    const k = groupKey(d);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups.values()];
}

/** A card of done entries: the newest in full, the others behind the chevron at the top right. */
function DoneCard({ entries, render }: { entries: DoneResult[]; render: (d: DoneResult, compact: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = entries;
  return (
    <li className={["result done", first.type === "auto" && "auto", rest.length > 0 && "has-more"].filter(Boolean).join(" ")}>
      {render(first, false)}
      {rest.length > 0 && (
        <>
          <button
            type="button"
            className="more-toggle"
            aria-expanded={open}
            aria-label={open ? "Show less" : `Show ${rest.length} more`}
            onClick={() => setOpen(!open)}
          >
            <span className="small">+{rest.length}</span>
            <span className={open ? "chevron open" : "chevron"}>
              <ChevronIcon />
            </span>
          </button>
          {open && <div className="more-entries">{rest.map((d) => render(d, true))}</div>}
        </>
      )}
    </li>
  );
}
