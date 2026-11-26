// Logic behind the Today tab: today's plan cards (yesterday's carried over without a new list), their order, the sub-goals that can be added,
// switching the one running timer, and today's time including the running timer.
import { activeGoals } from "./format";
import { standingChecks } from "./results";
import { isoLocal, localDate, splitByDay } from "./time";
import type { Config, LogEntry, Plan, PlanItem, ResultCheck, RunningTimer, SessionEntry, SubGoal } from "./types";

/**
 * Whether a sub-goal's results are all met for good: it has results, and every one that is not
 * archived is a manual result with a standing check. An automatic result counts again each day, so a
 * sub-goal with one is never met this way.
 */
export function subGoalMet(config: Config, checks: ResultCheck[], subGoal: string): boolean {
  const results = config.results.filter((r) => r.subGoal === subGoal && !r.archived);
  return results.length > 0 && results.every((r) => r.type === "manual" && standingChecks(checks, r.id).length > 0);
}

/**
 * Today's plan items in row order. Without a plan for today, the latest earlier list carries over,
 * minus archived sub-goals and sub-goals whose results are all met (`subGoalMet`).
 */
export function todayItems(plan: Plan | null, today: string, config: Config, checks: ResultCheck[]): PlanItem[] {
  if (!plan || plan.date > today) return [];
  if (plan.date === today) return plan.items;
  const archived = new Set(config.subGoals.filter((h) => h.archived).map((h) => h.id));
  return plan.items.filter((i) => !archived.has(i.subGoal) && !subGoalMet(config, checks, i.subGoal));
}

/** Whether the running timer belongs to this plan item (same sub-goal and task). */
export const isRunning = (timer: RunningTimer | null, item: PlanItem): boolean =>
  !!timer && timer.subGoal === item.subGoal && timer.task === item.task.trim();

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
  return { date: today, items };
}

/** A sub-goal added on the phone: a plan row without a task. */
export const addedItem = (subGoal: string): PlanItem => ({ subGoal, task: "" });

/**
 * The sub-goals "+ Add" offers: not archived, of an active goal, and not yet on today's list.
 * In goal rank order, then in the order of the config.
 */
export function addableSubGoals(config: Config, items: PlanItem[]): SubGoal[] {
  const onList = new Set(items.map((i) => i.subGoal));
  return activeGoals(config).flatMap((g) => config.subGoals.filter((h) => h.goal === g.id && !h.archived && !onList.has(h.id)));
}

/**
 * The one-timer rule: starting a timer ends the running one at the new start. Returns the session
 * to save for the running timer, if any, and the new timer.
 */
export function switchTimer(
  running: RunningTimer | null,
  next: { subGoal: string; task: string },
  start: Date,
): { session: SessionEntry | null; timer: RunningTimer } {
  return {
    session: running ? timerSession(running, start) : null,
    timer: { subGoal: next.subGoal, task: next.task.trim(), start: isoLocal(start) },
  };
}

/** A timer ended at `end` as a session; an end at or before the start gives it one minute. */
export function timerSession(t: RunningTimer, end: Date, note = ""): SessionEntry {
  const start = new Date(t.start);
  if (end <= start) end = new Date(start.getTime() + 60_000);
  return { type: "session", subGoal: t.subGoal, task: t.task, start: t.start, end: isoLocal(end), note: note.trim() };
}

/** Time of a span [start, end) that falls on `day`. */
function msOnDay(start: Date, end: Date, day: string): number {
  return splitByDay(start, end).find((p) => p.day === day)?.ms ?? 0;
}

/**
 * Time on `now`'s day: saved sessions plus the running timer up to `now`, split at local midnight.
 * With `subGoal`, only that sub-goal's time.
 */
export function msToday(entries: LogEntry[], timer: RunningTimer | null, now: Date, subGoal?: string): number {
  const day = localDate(now);
  let ms = 0;
  for (const s of entries) if (!subGoal || s.subGoal === subGoal) ms += msOnDay(new Date(s.start), new Date(s.end), day);
  if (timer && (!subGoal || timer.subGoal === subGoal)) ms += msOnDay(new Date(timer.start), now, day);
  return ms;
}
