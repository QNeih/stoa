import type { LogEntry, StoredEntry } from "./types";
import { localDate } from "./time";

/** The day an entry is filed under: the local date it started. */
export function dayOf(e: LogEntry): string {
  return localDate(new Date(e.type === "session" ? e.start : e.at));
}

/** Strips phone-only fields (storage key, row id, day), as in the JSON export. */
export function toContract(e: StoredEntry | LogEntry): LogEntry {
  if (e.type === "session") {
    const { type, habit, task, start, end, note } = e;
    return { type, habit, task, start, end, note };
  }
  const { type, counter, at, delta } = e;
  return { type, counter, at, delta };
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
