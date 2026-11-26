import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Header } from "../components/Header";
import { PenIcon, TrashIcon } from "../components/Icons";
import { OverlapWarning, savedOverlaps } from "../components/OverlapWarning";
import { subGoalName } from "../format";
import { firstPageStart, olderPageStart } from "../logs";
import { overlappingIds, type OverlapFix } from "../overlap";
import { parseQuickInput, quickSession } from "../quickInput";
import { useStoa } from "../state";
import { formatDuration, formatTime, isoLocal, localDate } from "../time";
import type { SessionEntry, StoredEntry } from "../types";
import { SessionForm } from "./SessionForm";

/** Upper bound for "every day from here on" in a day range. */
const LAST_DAY = "9999-12-31";
const LONG_PRESS_MS = 500;

const dayTitle = (day: string) =>
  new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const length = (e: { start: string; end: string }) => new Date(e.end).getTime() - new Date(e.start).getTime();

/**
 * Sessions by day, newest first, for fixing them: the past week at first, then a week more each time the
 * end of the list scrolls into view. Quick input at the top adds a session from one line of text.
 */
export function LogScreen() {
  const { config, entries, loadEntries, latestDayBefore } = useStoa();
  const [from, setFrom] = useState(() => firstPageStart(localDate(new Date())));
  /** Sessions from `from` on; null until the page is read. */
  const [loaded, setLoaded] = useState<{ from: string; entries: StoredEntry[]; olderDay: string | null } | null>(null);
  const [menu, setMenu] = useState<StoredEntry | null>(null);
  const [draft, setDraft] = useState<SessionEntry | null>(null);
  const [quickText, setQuickText] = useState("");

  // Reread the loaded weeks after every change in the store (`entries` is replaced on each change).
  useEffect(() => {
    let live = true;
    void Promise.all([loadEntries(from, LAST_DAY), latestDayBefore(from)]).then(([page, olderDay]) => {
      if (live) setLoaded({ from, entries: page, olderDay });
    });
    return () => {
      live = false;
    };
  }, [from, entries]);

  const loading = !loaded || loaded.from !== from;
  const olderDay = loaded?.olderDay ?? null;
  const loadOlder = () => {
    if (!loading && olderDay) setFrom(olderPageStart(from, olderDay));
  };

  if (draft) {
    return (
      <SessionForm
        draft={draft}
        onDone={(saved) => {
          setDraft(null);
          if (saved) setQuickText("");
        }}
      />
    );
  }

  const shown = loaded?.entries ?? [];
  const clashes = overlappingIds(shown);
  const byDay = new Map<string, StoredEntry[]>();
  for (const e of [...shown].sort((a, b) => b.start.localeCompare(a.start))) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }
  const days = [...byDay.keys()].sort().reverse();

  return (
    <div>
      <Header title="Log" />
      <QuickAdd text={quickText} setText={setQuickText} onChange={setDraft} />
      <a className="link small" href="#/log/new">
        Add with the full form
      </a>
      {!loading && !days.length && !olderDay && <p className="muted">No sessions yet.</p>}
      {!loading && !days.length && olderDay && <p className="muted">No sessions in the past week.</p>}
      {days.map((day) => (
        <section key={day}>
          <h2 className="row">
            <span>{dayTitle(day)}</span>
            <span className="small">{formatDuration(byDay.get(day)!.reduce((sum, e) => sum + length(e), 0))}</span>
          </h2>
          <ul className="list">
            {byDay.get(day)!.map((e) => (
              <EntryRow key={e.id} entry={e} clash={clashes.has(e.id!)} onMenu={() => setMenu(e)} />
            ))}
          </ul>
        </section>
      ))}
      {olderDay && <OlderSentinel busy={loading} onVisible={loadOlder} />}
      {menu && (
        <EntryMenu
          entry={menu}
          onClose={() => setMenu(null)}
          name={subGoalName(config, menu.subGoal)}
        />
      )}
    </div>
  );
}

/** Loads the next older week when it scrolls into view; the button does the same by tap. */
function OlderSentinel({ busy, onVisible }: { busy: boolean; onVisible: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef(onVisible);
  latest.current = onVisible;
  useEffect(() => {
    if (busy || !ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) latest.current();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [busy]);
  return (
    <button ref={ref} className="link older" disabled={busy} onClick={onVisible}>
      {busy ? "Loading…" : "Load older sessions"}
    </button>
  );
}

/** One session; a tap edits it, a long press or the "…" button opens its menu. */
function EntryRow({ entry: e, clash, onMenu }: { entry: StoredEntry; clash: boolean; onMenu: () => void }) {
  const { config } = useStoa();
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  /** Set when a long press opened the menu, so the click that ends the press does not also edit. */
  const pressed = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const open = () => {
    cancel();
    pressed.current = true;
    onMenu();
  };
  const edit = () => (location.hash = `#/log/edit/${e.id}`);

  return (
    <li
      className="tap entry"
      tabIndex={0}
      onPointerDown={(p: PointerEvent) => {
        pressed.current = false;
        origin.current = { x: p.clientX, y: p.clientY };
        cancel();
        timer.current = window.setTimeout(open, LONG_PRESS_MS);
      }}
      onPointerMove={(p: PointerEvent) => {
        if (Math.hypot(p.clientX - origin.current.x, p.clientY - origin.current.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(c) => {
        c.preventDefault();
        open();
      }}
      onClick={() => {
        if (pressed.current) pressed.current = false;
        else edit();
      }}
      onKeyDown={(k: KeyboardEvent) => {
        if (k.target === k.currentTarget && k.key === "Enter") edit();
      }}
    >
      <div className="row">
        <strong>{subGoalName(config, e.subGoal)}</strong>
        <span className="actions">
          <span>{formatDuration(length(e))}</span>
          <button
            className="icon more"
            aria-label={`Actions for ${subGoalName(config, e.subGoal)} ${formatTime(new Date(e.start))}`}
            onPointerDown={(p) => p.stopPropagation()}
            onClick={(c) => {
              c.stopPropagation();
              onMenu();
            }}
          >
            …
          </button>
        </span>
      </div>
      {e.task && <div>{e.task}</div>}
      {e.note && <div className="note">{e.note}</div>}
      <div className="muted small">
        {formatTime(new Date(e.start))}–{formatTime(new Date(e.end))}
        {localDate(new Date(e.end)) !== e.day ? " (next day)" : ""}
      </div>
      {clash && <div className="warn small">Overlaps another session</div>}
    </li>
  );
}

/** Edit or delete one session. Delete acts at once; the toast offers Undo. */
function EntryMenu({ entry, name, onClose }: { entry: StoredEntry; name: string; onClose: () => void }) {
  const { deleteEntry } = useStoa();
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Session actions" onClick={(c) => c.stopPropagation()}>
        <h2>
          {name} {formatTime(new Date(entry.start))}–{formatTime(new Date(entry.end))}
        </h2>
        <button className="pick" onClick={() => (location.hash = `#/log/edit/${entry.id}`)}>
          <PenIcon />
          Edit
        </button>
        <button
          className="pick danger"
          onClick={() => {
            onClose();
            void deleteEntry(entry.id!);
          }}
        >
          <TrashIcon />
          Delete
        </button>
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * One line of text read as a session ("45m gym yesterday"), previewed as it is typed. Save adds it; Change
 * opens the full form with it filled in. A session that overlaps saved ones asks how to resolve it first.
 */
function QuickAdd({ text, setText, onChange }: { text: string; setText: (t: string) => void; onChange: (draft: SessionEntry) => void }) {
  const { config, saveSession, loadEntries } = useStoa();
  const [conflict, setConflict] = useState<{ session: SessionEntry; overlapped: StoredEntry[] } | null>(null);
  const parsed = text.trim() ? parseQuickInput(text, config.subGoals.filter((h) => !h.archived), new Date()) : null;
  const session = parsed && quickSession(parsed);

  const save = async () => {
    if (!session) return;
    const overlapped = await savedOverlaps(loadEntries, session);
    if (overlapped.length) return setConflict({ session, overlapped });
    await saveSession(session);
    setText("");
  };
  const resolve = async (fix: OverlapFix) => {
    await saveSession(fix.session, undefined, fix);
    setConflict(null);
    setText("");
  };

  return (
    <form
      className="quick"
      onSubmit={(f) => {
        f.preventDefault();
        void save();
      }}
    >
      <input
        type="text"
        aria-label="Quick add"
        placeholder="45m gym yesterday"
        enterKeyHint="done"
        autoComplete="off"
        value={text}
        onChange={(c) => {
          setText(c.target.value);
          setConflict(null);
        }}
      />
      {parsed && (
        <div className="card quick-preview" aria-live="polite">
          <dl>
            <dt>Sub-goal</dt>
            <dd>{parsed.subGoal?.name ?? "–"}</dd>
            <dt>Date</dt>
            <dd>{dayTitle(parsed.day)}</dd>
            <dt>Time</dt>
            <dd>{parsed.start && parsed.end ? `${formatTime(parsed.start)}–${formatTime(parsed.end)}` : "–"}</dd>
            <dt>Duration</dt>
            <dd>{parsed.minutes !== null && parsed.minutes > 0 ? formatDuration(parsed.minutes * 60_000) : "–"}</dd>
          </dl>
          {parsed.placed && !parsed.problems.length && (
            <p className="muted small">{parsed.day === localDate(new Date()) ? "Ends now." : "Placed to end at 12:00."} Change it if needed.</p>
          )}
          {!!parsed.problems.length && (
            <ul className="problems small">
              {parsed.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {conflict ? (
            <OverlapWarning
              session={conflict.session}
              overlapped={conflict.overlapped}
              onResolve={(fix) => void resolve(fix)}
              onBack={() => setConflict(null)}
            />
          ) : (
            <div className="actions">
              <button className="primary" type="submit" disabled={!session}>
                Save
              </button>
              <button
                type="button"
                disabled={!parsed.start || !parsed.end}
                onClick={() =>
                  parsed.start &&
                  parsed.end &&
                  onChange({
                    type: "session",
                    subGoal: parsed.subGoal?.id ?? "",
                    task: "",
                    start: isoLocal(parsed.start),
                    end: isoLocal(parsed.end),
                    note: "",
                  })
                }
              >
                Change
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
