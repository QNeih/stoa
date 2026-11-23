// Data contract shared with the Stoa sheet (see TABS in sheets.ts) and the check-in routine.

export interface Goal {
  id: string;
  name: string;
  rank: number;
  archived: boolean;
}

export interface Habit {
  id: string;
  goal: string;
  name: string;
  archived: boolean;
}

export interface Config {
  goals: Goal[];
  habits: Habit[];
}

export interface PlanItem {
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
