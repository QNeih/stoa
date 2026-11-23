// Display helpers shared by the screens.
import type { CSSProperties } from "react";
import { PALETTE, goalColor } from "./palette";
import { isoLocal } from "./time";
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

/** Inline style that sets the goal's colour as `--goal` for the CSS of a card or dot. */
export const goalStyle = (goal: Goal) => ({ "--goal": PALETTE[goalColor(goal)] }) as CSSProperties;
