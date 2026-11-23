import { useEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Header } from "../components/Header";
import { activeGoals, goalName, habitName, toLocalInput } from "../format";
import { PALETTE, goalColor } from "../palette";
import { useStoa } from "../state";
import { dropIndex, addableHabits, isRunning, msToday, todayItems } from "../today";
import { formatClock, formatDuration, formatTime, localDate } from "../time";
import type { Config, PlanItem } from "../types";

/** Re-renders every second while `active`, so running time counts up; returns the current time. */
function useNow(active: boolean): Date {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);
  return new Date();
}

/** The goal colour of a sub-goal, as a CSS custom property for the card accent. */
function accent(config: Config, habit: string): CSSProperties {
  const goal = config.goals.find((g) => g.id === config.habits.find((h) => h.id === habit)?.goal);
  return { "--goal": goal ? PALETTE[goalColor(goal)] : "var(--line)" } as CSSProperties;
}

interface Drag {
  from: number;
  to: number;
  /** How far the pointer moved since it went down. */
  dy: number;
  /** How far a passed card moves aside: the dragged card's height plus the gap. */
  shift: number;
}

/**
 * Drag to reorder with a handle, by pointer events (touch, pen and mouse alike). The cards stay in
 * place in the DOM while dragging and only move by transform; the drop calls `onDrop(from, to)`.
 * Only the first `count` cards of the list take part.
 */
function useCardDrag(count: number, onDrop: (from: number, to: number) => void) {
  const list = useRef<HTMLOListElement>(null);
  const centers = useRef<number[]>([]);
  const y0 = useRef(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const finish = (drop: boolean) => {
    const d = dragRef.current;
    update(null);
    if (drop && d && d.from !== d.to) onDrop(d.from, d.to);
  };

  const handle = (index: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const cards = ([...list.current!.children] as HTMLElement[]).slice(0, count);
      const rects = cards.map((c) => c.getBoundingClientRect());
      centers.current = rects.map((r) => r.top + r.height / 2);
      const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
      y0.current = e.clientY;
      update({ from: index, to: index, dy: 0, shift: rects[index].height + gap });
      // Keeps the moves coming to the handle when the finger leaves it.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - y0.current;
      update({ ...d, dy, to: dropIndex(centers.current, d.from, dy) });
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    // Keyboard users move a card with the arrow keys.
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : null;
      if (to === null || to < 0 || to >= count) return;
      e.preventDefault();
      onDrop(index, to);
    },
  });

  /** The vertical offset of card `i` while dragging. */
  const offset = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.shift;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.shift;
    return 0;
  };

  return { list, drag, handle, offset };
}

const GripIcon = () => (
  <svg width="16" height="24" viewBox="0 0 16 24" aria-hidden="true">
    {[5, 11].flatMap((x) => [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="currentColor" />))}
  </svg>
);

const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M6 3.5v13l11-6.5z" fill="currentColor" />
  </svg>
);

const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <rect x="4.5" y="3.5" width="4" height="13" rx="1" fill="currentColor" />
    <rect x="11.5" y="3.5" width="4" height="13" rx="1" fill="currentColor" />
  </svg>
);

/** Keys that stay with an item when the list is reordered; a repeated item gets a count. */
function itemKeys(items: PlanItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((i) => {
    const k = `${i.habit}\u0000${i.task}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}\u0000${n}`;
  });
}

/**
 * Today's plan as cards in row order: drag the handle to reorder, play to start a timer. The running
 * card stands out by colour and shadow and shows today's time on its sub-goal; "+ Add" puts another
 * sub-goal on the list and starts it.
 */
export function TodayScreen() {
  const { config, entries, plan, timer, account, startTimer, pauseTimer, moveTodayItem } = useStoa();
  const now = useNow(!!timer);
  const today = localDate(now);
  const items = todayItems(plan, today);
  const keys = itemKeys(items);
  const { list, drag, handle, offset } = useCardDrag(items.length, (from, to) => void moveTodayItem(from, to));
  const [picking, setPicking] = useState(false);
  const goalOf = (id: string) => goalName(config, config.habits.find((h) => h.id === id)?.goal ?? "");
  // A timer whose item is not on today's list (started before midnight, or the plan changed) still shows.
  const orphan = timer && !items.some((i) => isRunning(timer, i)) ? timer : null;

  const card = (item: PlanItem, index: number | null, key: string) => {
    const running = isRunning(timer, item);
    const name = habitName(config, item.habit);
    const ms = msToday(entries, timer, now, item.habit);
    const dy = index === null ? 0 : offset(index);
    const lifted = index !== null && drag?.from === index;
    return (
      <li
        key={key}
        className={["plan-card", running && "running", lifted && "lifted"].filter(Boolean).join(" ")}
        style={{ ...accent(config, item.habit), transform: dy ? `translateY(${dy}px)` : undefined }}
      >
        {index !== null ? (
          <button className="grip" aria-label={`Move ${name}`} {...handle(index)}>
            <GripIcon />
          </button>
        ) : (
          <span className="grip" />
        )}
        <div className="what">
          <div className="goal-name">{goalOf(item.habit)}</div>
          <div className="sub-goal">
            {name}
            {item.task && <span className="task"> · {item.task}</span>}
          </div>
        </div>
        {running ? (
          <div className="clock" aria-label="Time today">
            {formatClock(ms)}
          </div>
        ) : (
          ms > 0 && <div className="today-time">{formatDuration(ms)}</div>
        )}
        {running ? (
          <button className="play pause" aria-label={`Pause ${name}`} onClick={() => void pauseTimer()}>
            <PauseIcon />
          </button>
        ) : (
          <button className="play" aria-label={`Start ${name}`} onClick={() => void startTimer(item.habit, item.task)}>
            <PlayIcon />
          </button>
        )}
      </li>
    );
  };

  return (
    <div>
      <Header title="Today">
        <span className="muted small">{formatDuration(msToday(entries, timer, now))} today</span>
      </Header>
      {items.length > 0 || orphan ? (
        <ol ref={list} className={drag ? "plan-list dragging" : "plan-list"}>
          {items.map((item, i) => card(item, i, keys[i]))}
          {orphan && card({ habit: orphan.habit, task: orphan.task }, null, "running")}
        </ol>
      ) : (
        <section className="card">
          <p>Nothing on today's list yet.</p>
          <p className="muted small">
            {account
              ? "The daily check-in writes today's list to your Stoa sheet; it loads on the next sync. Or add a sub-goal below."
              : "Sign in with Google in Settings to load the list from the check-in, or add a sub-goal below."}
          </p>
        </section>
      )}
      {timer && <TimerStart />}
      <button className="add" onClick={() => setPicking(true)}>
        + Add
      </button>
      {picking && <AddPicker items={items} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** When the running timer started, with a way to move its start (forgot to tap play) or discard it. */
function TimerStart() {
  const { timer, setTimerStart, discardTimer } = useStoa();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!timer) return null;
  const start = new Date(timer.start);

  const save = async () => {
    const problem = await setTimerStart(new Date(value));
    setError(problem);
    if (!problem) setEditing(false);
  };

  if (!editing) {
    return (
      <p className="timer-start muted small">
        Started {formatTime(start)}
        <button
          className="link"
          onClick={() => {
            setValue(toLocalInput(start));
            setError(null);
            setEditing(true);
          }}
        >
          Change start
        </button>
      </p>
    );
  }
  return (
    <section className="card stack">
      <label className="stack">
        Started at
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && (
        <p className="danger small" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button className="primary" onClick={() => void save()}>
          Save
        </button>
        <button onClick={() => setEditing(false)}>Cancel</button>
        <button
          className="link danger"
          onClick={() => {
            if (confirm("Discard this timer without saving?")) void discardTimer();
          }}
        >
          Discard timer
        </button>
      </div>
    </section>
  );
}

/** A sheet listing the sub-goals that are not on today's list; one tap adds one and starts it. */
function AddPicker({ items, onClose }: { items: PlanItem[]; onClose: () => void }) {
  const { config, addAndStart } = useStoa();
  const addable = addableHabits(config, items);
  const hasSubGoals = config.habits.some((h) => !h.archived);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Add to today" onClick={(e) => e.stopPropagation()}>
        <h2>Add to today</h2>
        {!addable.length && (
          <p className="muted">{hasSubGoals ? "Every sub-goal is on today's list." : "Add a sub-goal under Goals first."}</p>
        )}
        {activeGoals(config).map((g) => {
          const habits = addable.filter((h) => h.goal === g.id);
          if (!habits.length) return null;
          return (
            <section key={g.id}>
              <h3 className="muted small">{g.name}</h3>
              {habits.map((h) => (
                <button
                  key={h.id}
                  className="pick"
                  style={accent(config, h.id)}
                  onClick={() => {
                    onClose();
                    void addAndStart(h.id);
                  }}
                >
                  <span className="dot" />
                  {h.name}
                </button>
              ))}
            </section>
          );
        })}
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
