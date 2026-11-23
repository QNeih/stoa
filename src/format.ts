// Display helpers shared by the screens.
import type { CSSProperties } from "react";
import { PALETTE, goalColor } from "./palette";
import { formatDuration, isoLocal } from "./time";
import type { Config, Goal } from "./types";

/** Value for a datetime-local input: local time to the minute. */
export const toLocalInput = (d: Date) => isoLocal(d).slice(0, 16);

export const daysAgoText = (n: number | null) =>
  n === null ? "no time yet"
  : n === 0 ? "last time spent: today"
  : n === 1 ? "last time spent: yesterday"
  : `last time spent: ${n} days ago`;

export const habitName = (c: Config, id: string) => c.habits.find((x) => x.id === id)?.name ?? id;
export const goalName = (c: Config, id: string) => c.goals.find((g) => g.id === id)?.name ?? id;

/** Goals that are not archived, in rank order. */
export const activeGoals = (c: Config): Goal[] => c.goals.filter((g) => !g.archived).sort((a, b) => a.rank - b.rank);

/** "+1h 05m vs last week", "-25m vs last week" or "same as last week" (compared to the minute). */
export function deltaText(nowMs: number, beforeMs: number): string {
  const diff = Math.floor(nowMs / 60_000) - Math.floor(beforeMs / 60_000);
  if (diff === 0) return "same as last week";
  return `${diff > 0 ? "+" : "-"}${formatDuration(Math.abs(diff) * 60_000)} vs last week`;
}

/** Inline style that sets the goal's colour as `--goal` for the CSS of a card or dot. */
export const goalStyle = (goal: Goal) => ({ "--goal": PALETTE[goalColor(goal)] }) as CSSProperties;
