import type { Config, LogEntry, Plan, PlanItem, SessionEntry } from "./types";
import { daysBetween, localDate, splitByDay, startOfWeek } from "./time";

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
