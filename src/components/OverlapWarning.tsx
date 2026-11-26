import { subGoalName } from "../format";
import { dayOf } from "../logs";
import { keepBoth, overlapping, replaceOverlapped, trimOverlapped, type OverlapFix } from "../overlap";
import { useStoa, type Stoa } from "../state";
import { addDays, formatTime, localDate } from "../time";
import type { SessionEntry, StoredEntry } from "../types";

/**
 * Saved sessions that overlap `session`, read from the days it can touch: the day before its start (a session
 * running past midnight) up to the day it ends. `ignoreId` is the session being edited.
 */
export async function savedOverlaps(loadEntries: Stoa["loadEntries"], session: SessionEntry, ignoreId?: number): Promise<StoredEntry[]> {
  const near = await loadEntries(addDays(dayOf(session), -1), localDate(new Date(session.end)));
  return overlapping(near, session, ignoreId);
}

const span = (e: { start: string; end: string }) => `${formatTime(new Date(e.start))}–${formatTime(new Date(e.end))}`;

/** Shown before saving a session that overlaps saved ones: keep both, trim, replace, or go back. */
export function OverlapWarning({
  session,
  overlapped,
  onResolve,
  onBack,
}: {
  session: SessionEntry;
  overlapped: StoredEntry[];
  onResolve: (fix: OverlapFix) => void;
  onBack: () => void;
}) {
  const { config } = useStoa();
  const trim = trimOverlapped(session, overlapped);
  return (
    <div className="card overlap" role="alert">
      <h2>Overlaps {overlapped.length === 1 ? "a saved session" : `${overlapped.length} saved sessions`}</h2>
      <ul className="small">
        {overlapped.map((e) => (
          <li key={e.id}>
            {subGoalName(config, e.subGoal)} {localDate(new Date(e.start)) === dayOf(session) ? "" : `${e.day} `}
            {span(e)}
          </li>
        ))}
      </ul>
      <div className="stack">
        <button type="button" onClick={() => onResolve(keepBoth(session))}>Keep both</button>
        <button type="button" disabled={!trim} onClick={() => trim && onResolve(trim)}>
          {trim
            ? `Trim: ${[
                `this one ${span(trim.session)}`,
                ...trim.update.map((u) => `${subGoalName(config, u.entry.subGoal)} ends ${formatTime(new Date(u.entry.end))}`),
              ].join(", ")}`
            : "Trim"}
        </button>
        {!trim && <p className="muted small">Trimming would leave this session no time.</p>}
        <button type="button" className="danger" onClick={() => onResolve(replaceOverlapped(session, overlapped))}>
          Replace: delete {overlapped.length === 1 ? "it" : "them"}
        </button>
        <button type="button" className="link" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
