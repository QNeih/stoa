// Data contract shared with the Stoa sheet (see TABS in sheets.ts) and the check-in routine.
// A goal has sub-goals (`Habit`, the `habits` tab); a session is a timed block on a sub-goal;
// a result is something a sub-goal should bring, checked by hand or derived from time.
import type { PaletteKey } from "./palette";

export interface Goal {
  id: string;
  name: string;
  rank: number;
  archived: boolean;
  /** Key into the palette; "" until one is picked (goalColor then picks one from the id). */
  color: PaletteKey | "";
}

/** A sub-goal of a goal. Sessions and results belong to sub-goals. */
export interface Habit {
  id: string;
  goal: string;
  name: string;
  archived: boolean;
  /** Local date (YYYY-MM-DD) the sub-goal was created; "" means older than any session. */
  created: string;
}

/**
 * A result of a sub-goal. The daily check-in creates results; the app only renames and archives them.
 * A manual result is checked by hand (`result_checks`); an automatic one is done on every day with
 * at least `min_minutes` of sessions on its sub-goal, derived on read and never stored.
 */
export interface Result {
  id: string;
  habit: string;
  name: string;
  type: "manual" | "auto";
  /** Minutes a day needs for an automatic result; 30 when the sheet leaves it empty. */
  min_minutes: number;
  archived: boolean;
}

export interface Config {
  goals: Goal[];
  /** Sub-goals. */
  habits: Habit[];
  results: Result[];
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

/**
 * A manual result checked as done on `day`. Unchecking sets `removed_at` and keeps the check.
 * `uid` is the row id in the `result_checks` tab.
 */
export interface ResultCheck {
  uid: string;
  result: string;
  day: string;
  checked_at: string;
  note: string;
  /** Minutes tracked on the result's sub-goal since its previous check (or since the sub-goal began). */
  minutes_since_last: number;
  /** When the check was undone; "" while it stands. */
  removed_at: string;
}

/** A result check as kept on the phone; `id` is the phone's storage key. */
export type StoredCheck = ResultCheck & { id?: number };

export interface RunningTimer {
  habit: string;
  task: string;
  start: string;
  /** When the user last answered "still going?"; phone-only. */
  checked?: string;
}
