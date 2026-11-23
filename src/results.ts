// Results of sub-goals: automatic results derived from session time, the time behind a manual
// check, and the done list. Everything here is derived on read, so edits to sessions show at once.
import { daysBetween, parseLocalDate, splitByDay } from "./time";
import type { Habit, LogEntry, Result, ResultCheck } from "./types";

/** Session time per local day on one sub-goal, split at local midnight. */
export function msByDay(entries: LogEntry[], habit: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of entries) {
    if (s.habit !== habit) continue;
    for (const p of splitByDay(new Date(s.start), new Date(s.end))) out.set(p.day, (out.get(p.day) ?? 0) + p.ms);
  }
  return out;
}

/** Days, oldest first, on which an automatic result is done: at least `min_minutes` of sessions on its sub-goal. */
export function autoDoneDays(result: Result, entries: LogEntry[]): string[] {
  if (result.type !== "auto") return [];
  return [...msByDay(entries, result.habit)]
    .filter(([, ms]) => ms > 0 && ms >= result.min_minutes * 60_000)
    .map(([day]) => day)
    .sort();
}

/**
 * Whole minutes of sessions on a sub-goal from `since` until `until`. Without `since` it counts from
 * the start of the sub-goal's `created` day, or all its sessions when it has no date.
 */
export function minutesSince(entries: LogEntry[], habit: Habit, since: string | null, until: Date): number {
  const from = since ? new Date(since).getTime() : habit.created ? parseLocalDate(habit.created).getTime() : -Infinity;
  const to = until.getTime();
  let ms = 0;
  for (const s of entries) {
    if (s.habit !== habit.id) continue;
    const start = Math.max(new Date(s.start).getTime(), from);
    const end = Math.min(new Date(s.end).getTime(), to);
    if (end > start) ms += end - start;
  }
  return Math.floor(ms / 60_000);
}

/** The latest standing check of a result made before `before`, or null when there is none. */
export function lastCheck(checks: ResultCheck[], result: string, before: Date): ResultCheck | null {
  let last: ResultCheck | null = null;
  for (const c of checks) {
    if (c.result !== result || c.removed_at) continue;
    const at = new Date(c.checked_at).getTime();
    if (!(at < before.getTime())) continue;
    if (!last || at > new Date(last.checked_at).getTime()) last = c;
  }
  return last;
}

/** The latest standing check made before `before` of any result on sub-goal `habit`, or null when there is none. */
export function lastHabitCheck(checks: ResultCheck[], results: Result[], habit: string, before: Date): ResultCheck | null {
  let last: ResultCheck | null = null;
  for (const r of results) {
    if (r.habit !== habit) continue;
    const c = lastCheck(checks, r.id, before);
    if (c && (!last || new Date(c.checked_at) > new Date(last.checked_at))) last = c;
  }
  return last;
}

/**
 * `minutes_since_last` for a check made at `at` of a result on `habit`: sub-goal time since the last
 * standing check of any of its results, or since the sub-goal began for the first.
 */
export function minutesSinceLastCheck(results: Result[], habit: Habit, checks: ResultCheck[], entries: LogEntry[], at: Date): number {
  return minutesSince(entries, habit, lastHabitCheck(checks, results, habit.id, at)?.checked_at ?? null, at);
}

/** The standing checks of a manual result (not undone), in the order given. */
export function standingChecks<C extends ResultCheck>(checks: C[], result: string): C[] {
  return checks.filter((c) => c.result === result && !c.removed_at);
}

/** The standing check with row id `uid`, if any (the one an uncheck removes). */
export function standingCheckByUid<C extends ResultCheck>(checks: C[], uid: string): C | null {
  return checks.find((c) => c.uid === uid && !c.removed_at) ?? null;
}

/** How many days after its day a done entry stays in the done list. */
export const DONE_DAYS = 7;

/** Whether a done entry on `day` is still listed on `today`. */
export function inDoneWindow(day: string, today: string): boolean {
  return daysBetween(day, today) <= DONE_DAYS;
}

/**
 * Results still open on `today`: a manual result until it has a standing check (of any day), an
 * automatic result until it reached its minimum today.
 */
export function openResults(results: Result[], checks: ResultCheck[], entries: LogEntry[], today: string): Result[] {
  return results.filter((r) =>
    r.type === "manual" ? !standingChecks(checks, r.id).length : !autoDoneDays(r, entries).includes(today),
  );
}

/** One done result on one day. */
export type DoneResult =
  | { type: "manual"; result: string; day: string; check: ResultCheck }
  | { type: "auto"; result: string; day: string; /** Session time on the sub-goal that day. */ ms: number };

/**
 * Every done result: standing checks of manual results plus the derived days of automatic results.
 * Sorted by day, then in the order of `results`, then by check time. Checks of unknown or automatic results are left out.
 */
export function doneResults(results: Result[], checks: ResultCheck[], entries: LogEntry[]): DoneResult[] {
  const order = new Map(results.map((r, i) => [r.id, i]));
  const out: DoneResult[] = [];
  for (const c of checks) {
    const r = results.find((x) => x.id === c.result);
    if (r?.type === "manual" && !c.removed_at) out.push({ type: "manual", result: r.id, day: c.day, check: c });
  }
  for (const r of results) {
    if (r.type !== "auto") continue;
    const byDay = msByDay(entries, r.habit);
    for (const day of autoDoneDays(r, entries)) out.push({ type: "auto", result: r.id, day, ms: byDay.get(day)! });
  }
  const checkedAt = (d: DoneResult) => (d.type === "manual" ? d.check.checked_at : "");
  return out.sort(
    (a, b) => a.day.localeCompare(b.day) || order.get(a.result)! - order.get(b.result)! || checkedAt(a).localeCompare(checkedAt(b)),
  );
}

/** Session time on the days an automatic result was done, and how many days that was. */
export function autoResultTotals(result: Result, entries: LogEntry[]): { ms: number; days: number } {
  const byDay = msByDay(entries, result.habit);
  const days = autoDoneDays(result, entries);
  return { ms: days.reduce((n, d) => n + byDay.get(d)!, 0), days: days.length };
}
