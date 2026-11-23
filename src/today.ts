// Logic behind the Today tab: today's plan cards, their order, the sub-goals that can be added,
// switching the one running timer, and today's time including the running timer.
import { activeGoals } from "./format";
import { isoLocal, localDate, splitByDay } from "./time";
import type { Config, Habit, LogEntry, Plan, PlanItem, RunningTimer, SessionEntry } from "./types";

/** Today's plan items in row order; none when the stored plan is for another day. */
export const todayItems = (plan: Plan | null, today: string): PlanItem[] => (plan?.date === today ? plan.items : []);

/** Whether the running timer belongs to this plan item (same sub-goal and task). */
export const isRunning = (timer: RunningTimer | null, item: PlanItem): boolean =>
  !!timer && timer.habit === item.habit && timer.task === item.task.trim();

/** `items` with the one at `from` moved to `to`; the others keep their order. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const out = [...items];
  const [moved] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, moved);
  return out;
}

/**
 * Where a dragged card lands: `centers` are the vertical centres of all cards before the drag,
 * `from` the dragged card and `dy` how far it moved. It lands after every other card whose centre
 * its own centre has passed.
 */
export function dropIndex(centers: number[], from: number, dy: number): number {
  const at = centers[from] + dy;
  return centers.filter((c, i) => i !== from && c < at).length;
}

/** Today's plan with its items replaced; a plan for another day (or none) becomes a new plan for today. */
export function withItems(plan: Plan | null, today: string, items: PlanItem[]): Plan {
  if (plan?.date === today) return { ...plan, items };
  // Without a plan_days row the budget is the planned total, which is 0 for added items.
  return { date: today, time_budget_min: items.reduce((sum, i) => sum + i.minutes, 0), items, note: "" };
}

/** A sub-goal added on the phone: a plan row at 0 minutes, without a task. */
export const addedItem = (habit: string): PlanItem => ({ habit, task: "", minutes: 0 });

/**
 * The sub-goals "+ Add" offers: not archived, of an active goal, and not yet on today's list.
 * In goal rank order, then in the order of the config.
 */
export function addableHabits(config: Config, items: PlanItem[]): Habit[] {
  const onList = new Set(items.map((i) => i.habit));
  return activeGoals(config).flatMap((g) => config.habits.filter((h) => h.goal === g.id && !h.archived && !onList.has(h.id)));
}

/**
 * The one-timer rule: starting a timer ends the running one at the new start. Returns the session
 * to save for the running timer, if any, and the new timer.
 */
export function switchTimer(
  running: RunningTimer | null,
  next: { habit: string; task: string },
  start: Date,
): { session: SessionEntry | null; timer: RunningTimer } {
  return {
    session: running ? timerSession(running, start) : null,
    timer: { habit: next.habit, task: next.task.trim(), start: isoLocal(start) },
  };
}

/** A timer ended at `end` as a session; an end at or before the start gives it one minute. */
export function timerSession(t: RunningTimer, end: Date, note = ""): SessionEntry {
  const start = new Date(t.start);
  if (end <= start) end = new Date(start.getTime() + 60_000);
  return { type: "session", habit: t.habit, task: t.task, start: t.start, end: isoLocal(end), note: note.trim() };
}

/** Time of a span [start, end) that falls on `day`. */
function msOnDay(start: Date, end: Date, day: string): number {
  return splitByDay(start, end).find((p) => p.day === day)?.ms ?? 0;
}

/**
 * Time on `now`'s day: saved sessions plus the running timer up to `now`, split at local midnight.
 * With `habit`, only that sub-goal's time.
 */
export function msToday(entries: LogEntry[], timer: RunningTimer | null, now: Date, habit?: string): number {
  const day = localDate(now);
  let ms = 0;
  for (const s of entries) if (!habit || s.habit === habit) ms += msOnDay(new Date(s.start), new Date(s.end), day);
  if (timer && (!habit || timer.habit === habit)) ms += msOnDay(new Date(timer.start), now, day);
  return ms;
}
