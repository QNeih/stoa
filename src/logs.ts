import type { LogEntry, StoredEntry } from "./types";
import { addDays, daysBetween, localDate } from "./time";

/** The day an entry is filed under: the local date it started. */
export function dayOf(e: LogEntry): string {
  return localDate(new Date(e.start));
}

/** The Log loads a week at a time: its first page is today and the six days before. */
export const LOG_PAGE_DAYS = 7;

export function firstPageStart(today: string): string {
  return addDays(today, 1 - LOG_PAGE_DAYS);
}

/**
 * First day of the next older page, given the first day loaded so far (`from`) and the latest earlier day
 * with an entry (`olderDay`): whole weeks back from `from`, skipping weeks without entries.
 */
export function olderPageStart(from: string, olderDay: string): string {
  const weeks = Math.ceil(daysBetween(olderDay, from) / LOG_PAGE_DAYS);
  return addDays(from, -weeks * LOG_PAGE_DAYS);
}

/** Strips phone-only fields (storage key, row id, day), as in the JSON export. */
export function toContract(e: StoredEntry | LogEntry): LogEntry {
  const { type, subGoal, task, start, end, note } = e;
  return { type, subGoal, task, start, end, note };
}

/** Lowercase slug for ids, unique against `taken` (adds -2, -3, ...). */
export function slugify(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
