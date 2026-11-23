import type { Config, LogEntry, Plan, PlanItem, SessionEntry } from "./types";
import { daysBetween, localDate, parseLocalDate, splitByDay, startOfWeek } from "./time";

export interface DoneItem {
  session: SessionEntry;
  /** Time of this session that falls on the day asked for. */
  ms: number;
}

export interface GoalWeek {
  goal: string;
  ms: number;
  /** Days since time was last spent on the goal; 0 = today, null = never. */
  lastSpentDaysAgo: number | null;
}

export interface Dashboard {
  todayMs: number;
  done: DoneItem[];
  weekByGoal: GoalWeek[];
}

/** Sessions that have time on `day`, split at local midnight, oldest first. */
export function doneOn(entries: LogEntry[], day: string): DoneItem[] {
  const out: DoneItem[] = [];
  for (const s of entries) {
    const part = splitByDay(new Date(s.start), new Date(s.end)).find((p) => p.day === day);
    if (part && part.ms > 0) out.push({ session: s, ms: part.ms });
  }
  return out.sort((a, b) => a.session.start.localeCompare(b.session.start));
}

export interface PlanProgress {
  items: { item: PlanItem; spentMs: number }[];
  plannedMs: number;
  /** Time on `day` spent on plan items (same habit and task). */
  onPlanMs: number;
  /** Time on `day` spent on anything else. */
  offPlanMs: number;
}

/** Planned against spent time per plan item, for the plan's own day. */
export function planProgress(plan: Plan, entries: LogEntry[], day: string): PlanProgress {
  const done = doneOn(entries, day);
  const key = (habit: string, task: string) => `${habit}\u0000${task.trim()}`;
  const spent = new Map<string, number>();
  for (const d of done) {
    const k = key(d.session.habit, d.session.task);
    spent.set(k, (spent.get(k) ?? 0) + d.ms);
  }
  const keys = new Set(plan.items.map((i) => key(i.habit, i.task)));
  const items = plan.items.map((item) => ({ item, spentMs: spent.get(key(item.habit, item.task)) ?? 0 }));
  const onPlanMs = [...keys].reduce((sum, k) => sum + (spent.get(k) ?? 0), 0);
  const totalMs = done.reduce((sum, d) => sum + d.ms, 0);
  return {
    items,
    plannedMs: plan.items.reduce((sum, i) => sum + i.minutes * 60_000, 0),
    onPlanMs,
    offPlanMs: totalMs - onPlanMs,
  };
}

export function dashboard(config: Config, entries: LogEntry[], now: Date): Dashboard {
  const today = localDate(now);
  const weekStart = localDate(startOfWeek(now));
  const goalOfHabit = new Map(config.habits.map((h) => [h.id, h.goal]));

  const done = doneOn(entries, today);
  const todayMs = done.reduce((sum, d) => sum + d.ms, 0);

  const weekMs = new Map<string, number>();
  const lastDay = new Map<string, string>();
  for (const s of entries) {
    const goal = goalOfHabit.get(s.habit);
    if (!goal) continue;
    for (const p of splitByDay(new Date(s.start), new Date(s.end))) {
      if (p.day > today) continue;
      if (p.day >= weekStart) weekMs.set(goal, (weekMs.get(goal) ?? 0) + p.ms);
      if (p.ms > 0 && (lastDay.get(goal) ?? "") < p.day) lastDay.set(goal, p.day);
    }
  }

  const weekByGoal = config.goals
    .filter((g) => !g.archived)
    .sort((a, b) => a.rank - b.rank)
    .map((g) => {
      const last = lastDay.get(g.id);
      return {
        goal: g.id,
        ms: weekMs.get(g.id) ?? 0,
        lastSpentDaysAgo: last ? daysBetween(last, today) : null,
      };
    });

  return { todayMs, done, weekByGoal };
}

// --- goal stats ---

export interface SubGoalStats {
  habit: string;
  weekMs: number;
  lastWeekMs: number;
  allTimeMs: number;
}

export interface GoalStats {
  goal: string;
  /** Monday 00:00 until now. */
  weekMs: number;
  /** The same span a week earlier: last Monday 00:00 until this time 7 days ago. */
  lastWeekMs: number;
  allTimeMs: number;
  /** No time on the goal today or in the 6 days before. */
  neglected: boolean;
  /** Days since time was last spent on the goal; 0 = today, null = never. */
  lastSpentDaysAgo: number | null;
  /** The goal's sub-goals that are active or have time, most time this week first. */
  subGoals: SubGoalStats[];
}

/** Time of a session inside [from, to). */
const overlapMs = (s: SessionEntry, from: number, to: number) =>
  Math.max(0, Math.min(new Date(s.end).getTime(), to) - Math.max(new Date(s.start).getTime(), from));

/** `d` moved by whole calendar days, keeping its local time (DST-safe). */
function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Time per active goal and its sub-goals: this week, the same span last week, and all time, plus
 * whether the goal went without time for the last 7 days. Most time this week first, then by rank.
 * A session counts for the goal its sub-goal belongs to now.
 */
export function goalStats(config: Config, entries: LogEntry[], now: Date): GoalStats[] {
  const today = localDate(now);
  const weekStart = startOfWeek(now).getTime();
  const lastWeekStart = addDays(startOfWeek(now), -7).getTime();
  const lastWeekEnd = addDays(now, -7).getTime();
  const sevenDaysStart = localDate(addDays(now, -6));
  const habitStats = new Map(config.habits.map((h) => [h.id, { habit: h.id, weekMs: 0, lastWeekMs: 0, allTimeMs: 0 }]));
  const lastDay = new Map<string, string>();

  for (const s of entries) {
    const st = habitStats.get(s.habit);
    if (!st) continue;
    st.weekMs += overlapMs(s, weekStart, now.getTime());
    st.lastWeekMs += overlapMs(s, lastWeekStart, lastWeekEnd);
    st.allTimeMs += overlapMs(s, -Infinity, now.getTime());
    for (const p of splitByDay(new Date(s.start), new Date(s.end))) {
      if (p.ms > 0 && p.day <= today && (lastDay.get(s.habit) ?? "") < p.day) lastDay.set(s.habit, p.day);
    }
  }

  return config.goals
    .filter((g) => !g.archived)
    .map((g) => {
      const habits = config.habits.filter((h) => h.goal === g.id);
      const subGoals = habits
        .filter((h) => !h.archived || habitStats.get(h.id)!.allTimeMs > 0)
        .map((h) => habitStats.get(h.id)!)
        .sort((a, b) => b.weekMs - a.weekMs || b.allTimeMs - a.allTimeMs);
      const sum = (k: "weekMs" | "lastWeekMs" | "allTimeMs") => habits.reduce((n, h) => n + habitStats.get(h.id)![k], 0);
      const last = habits.map((h) => lastDay.get(h.id) ?? "").reduce((a, b) => (a > b ? a : b), "");
      return {
        goal: g.id,
        rank: g.rank,
        weekMs: sum("weekMs"),
        lastWeekMs: sum("lastWeekMs"),
        allTimeMs: sum("allTimeMs"),
        neglected: last < sevenDaysStart,
        lastSpentDaysAgo: last ? daysBetween(last, today) : null,
        subGoals,
      };
    })
    .sort((a, b) => b.weekMs - a.weekMs || a.rank - b.rank)
    .map(({ rank: _, ...stats }) => stats);
}

// --- time per bucket ---

/** Bucket size of the time chart: one bar per week, month or year. */
export type Range = "week" | "month" | "year";
export const RANGES: Range[] = ["week", "month", "year"];

export interface Bucket {
  /** First day of the bucket: a Monday, the 1st of a month, or January 1st. */
  start: string;
  /** Time per goal id (archived goals included); goals without time are left out. */
  byGoal: Record<string, number>;
  totalMs: number;
}

/** The first day of the bucket that holds `day`. */
function bucketStart(day: string, range: Range): string {
  if (range === "week") return localDate(startOfWeek(parseLocalDate(day)));
  return range === "month" ? `${day.slice(0, 7)}-01` : `${day.slice(0, 4)}-01-01`;
}

/** The first day of the bucket after the one starting on `start`. */
function nextBucket(start: string, range: Range): string {
  const d = parseLocalDate(start);
  if (range === "week") d.setDate(d.getDate() + 7);
  else if (range === "month") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return localDate(d);
}

/** The local day of the earliest session, or null without sessions. */
function firstDay(entries: LogEntry[]): string | null {
  let first: string | null = null;
  for (const s of entries) {
    const day = localDate(new Date(s.start));
    if (!first || day < first) first = day;
  }
  return first;
}

/**
 * Time per week, month or year, stacked by goal, from the bucket of the first session up to the
 * current one (empty buckets included), at most the last `max`. Sessions are split at local midnight;
 * a session counts for the goal its sub-goal belongs to now. Empty without sessions.
 */
export function timeBuckets(config: Config, entries: LogEntry[], range: Range, now: Date, max = 12): Bucket[] {
  const first = firstDay(entries);
  if (!first) return [];
  const today = localDate(now);
  const goalOf = new Map(config.habits.map((h) => [h.id, h.goal]));
  const buckets = new Map<string, Bucket>();
  for (let b = bucketStart(first, range); b <= today; b = nextBucket(b, range)) buckets.set(b, { start: b, byGoal: {}, totalMs: 0 });
  for (const s of entries) {
    const goal = goalOf.get(s.habit);
    if (!goal) continue;
    for (const p of splitByDay(new Date(s.start), new Date(s.end))) {
      const b = buckets.get(bucketStart(p.day, range));
      if (!b || p.day > today || p.ms <= 0) continue;
      b.byGoal[goal] = (b.byGoal[goal] ?? 0) + p.ms;
      b.totalMs += p.ms;
    }
  }
  return [...buckets.values()].slice(-max);
}

/**
 * The ranges with enough data to compare: the first session lies before the current week, month or
 * year, so the chart has at least two buckets.
 */
export function rangesWithData(entries: LogEntry[], now: Date): Range[] {
  const first = firstDay(entries);
  if (!first) return [];
  const today = localDate(now);
  return RANGES.filter((r) => first < bucketStart(today, r));
}
