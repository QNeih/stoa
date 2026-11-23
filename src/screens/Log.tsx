import { useState } from "react";
import { Header } from "../components/Header";
import { habitName } from "../format";
import { useStoa } from "../state";
import { formatDuration, formatTime, localDate } from "../time";
import type { StoredEntry } from "../types";

const DAYS_SHOWN = 14;

/** All sessions by day, newest first; a tap opens the edit form. */
export function LogScreen() {
  const { config, entries } = useStoa();
  const [showAll, setShowAll] = useState(false);

  const byDay = new Map<string, StoredEntry[]>();
  for (const e of [...entries].sort((a, b) => b.start.localeCompare(a.start))) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }
  const days = [...byDay.keys()].sort().reverse();
  const shown = showAll ? days : days.slice(0, DAYS_SHOWN);

  return (
    <div>
      <Header title="Log" />
      <a className="button primary" href="#/log/new">
        Add past session
      </a>
      {!days.length && <p className="muted">No sessions yet.</p>}
      {shown.map((day) => (
        <section key={day}>
          <h2>
            {new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
          </h2>
          <ul className="list">
            {byDay.get(day)!.map((e) => (
              <li key={e.id} className="tap" onClick={() => (location.hash = `#/log/edit/${e.id}`)}>
                <div className="row">
                  <strong>{habitName(config, e.habit)}</strong>
                  <span>{formatDuration(new Date(e.end).getTime() - new Date(e.start).getTime())}</span>
                </div>
                {e.task && <div>{e.task}</div>}
                {e.note && <div className="note">{e.note}</div>}
                <div className="muted small">
                  {formatTime(new Date(e.start))}–{formatTime(new Date(e.end))}
                  {localDate(new Date(e.end)) !== e.day ? " (next day)" : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {days.length > shown.length && (
        <button className="link" onClick={() => setShowAll(true)}>
          Show older days
        </button>
      )}
    </div>
  );
}
