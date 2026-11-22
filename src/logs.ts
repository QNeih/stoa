import type { LogEntry, StoredEntry } from "./types";
import { localDate } from "./time";

/** The log file an entry belongs to: the local date it started. */
export function dayOf(e: LogEntry): string {
  return localDate(new Date(e.type === "session" ? e.start : e.at));
}

/** Strip phone-only fields so the file holds exactly the data contract. */
export function toContract(e: StoredEntry | LogEntry): LogEntry {
  if (e.type === "session") {
    const { type, habit, task, start, end, note } = e;
    return { type, habit, task, start, end, note };
  }
  const { type, counter, at, delta } = e;
  return { type, counter, at, delta };
}

const timeOf = (e: LogEntry) => (e.type === "session" ? e.start : e.at);

/** One JSON object per line, in time order, ending with a newline (empty day: empty file). */
export function toJsonl(entries: (StoredEntry | LogEntry)[]): string {
  const sorted = entries.map(toContract).sort((a, b) => Date.parse(timeOf(a)) - Date.parse(timeOf(b)));
  return sorted.map((e) => JSON.stringify(e)).join("\n") + (sorted.length ? "\n" : "");
}

export function parseJsonl(text: string): LogEntry[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry)
    .filter((e) => e.type === "session" || e.type === "counter");
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
