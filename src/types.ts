// Data contract shared with the stoa-data repo and the check-in routine.

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

export interface Counter {
  id: string;
  goal: string;
  name: string;
}

export interface Config {
  goals: Goal[];
  habits: Habit[];
  counters: Counter[];
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

export interface CounterEntry {
  type: "counter";
  counter: string;
  at: string;
  delta: number;
}

export type LogEntry = SessionEntry | CounterEntry;

/** A log entry as kept on the phone: `day` is the local start date, the file it belongs to. */
export type StoredEntry = LogEntry & { id?: number; day: string };

export interface RunningTimer {
  habit: string;
  task: string;
  start: string;
  /** When the user last answered "still going?"; phone-only. */
  checked?: string;
}
