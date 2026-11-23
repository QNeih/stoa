// Data contract shared with the Stoa sheet (see TABS in sheets.ts) and the check-in routine.
// A goal has sub-goals (`Habit`, the `habits` tab); a session is a timed block on a sub-goal.
import type { PaletteKey } from "./palette";

export interface Goal {
  id: string;
  name: string;
  rank: number;
  archived: boolean;
  /** Key into the palette; "" until one is picked (goalColor then picks one from the id). */
  color: PaletteKey | "";
}

/** A sub-goal of a goal. Sessions belong to sub-goals. */
export interface Habit {
  id: string;
  goal: string;
  name: string;
  archived: boolean;
  /** Local date (YYYY-MM-DD) the sub-goal was created; "" means older than any session. */
  created: string;
}

export interface Config {
  goals: Goal[];
  /** Sub-goals. */
  habits: Habit[];
}

export interface PlanItem {
  /** The sub-goal. */
  habit: string;
  task: string;
  minutes: number;
}

export interface Plan {
  date: string;
  time_budget_min: number;
  items: PlanItem[];
  note: string;
}

/** Times are ISO 8601 strings with the local offset, e.g. 2026-11-22T21:00:00+01:00. */
export interface SessionEntry {
  type: "session";
  /** The sub-goal. */
  habit: string;
  task: string;
  start: string;
  end: string;
  note: string;
}

/** The only kind of log entry; old counter rows in the sheet are left alone and not read. */
export type LogEntry = SessionEntry;

/**
 * A log entry as kept on the phone: `id` is the phone's storage key, `uid` the entry's row id
 * in the sheet's `logs` tab, `day` the local start date it is filed under.
 */
export type StoredEntry = LogEntry & { id?: number; uid: string; day: string };

export interface RunningTimer {
  habit: string;
  task: string;
  start: string;
  /** When the user last answered "still going?"; phone-only. */
  checked?: string;
}
