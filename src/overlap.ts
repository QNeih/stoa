// Sessions that overlap in time, and the three ways to resolve a new or edited session that overlaps
// saved ones: keep both, trim, or replace. Pure, so quick input and the edit form share it.
import { toContract } from "./logs";
import type { SessionEntry, StoredEntry } from "./types";

const ms = (iso: string) => new Date(iso).getTime();

/** True when [a.start, a.end) and [b.start, b.end) share time; touching ends do not count. */
export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

/** Saved entries that overlap `session`, earliest first; `ignoreId` is the entry being edited. */
export function overlapping<E extends StoredEntry>(entries: E[], session: SessionEntry, ignoreId?: number): E[] {
  return entries
    .filter((e) => e.id !== ignoreId && overlaps(e, session))
    .sort((a, b) => ms(a.start) - ms(b.start));
}

/** Ids of the entries that overlap at least one other entry in `entries`. */
export function overlappingIds(entries: StoredEntry[]): Set<number> {
  const sorted = entries.filter((e) => e.id !== undefined).sort((a, b) => ms(a.start) - ms(b.start));
  const out = new Set<number>();
  // Sweep by start: an entry overlaps an earlier one when it starts before the latest end seen so far.
  let latest: StoredEntry | null = null;
  for (const e of sorted) {
    if (latest && ms(e.start) < ms(latest.end)) {
      out.add(latest.id!);
      out.add(e.id!);
    }
    if (!latest || ms(e.end) > ms(latest.end)) latest = e;
  }
  return out;
}

/** What to write: the session itself, saved entries rewritten with a new end, and entries to delete. */
export interface OverlapFix {
  session: SessionEntry;
  update: { id: number; entry: SessionEntry }[];
  remove: number[];
}

/** Saves the session as it is; the overlap stays. */
export function keepBoth(session: SessionEntry): OverlapFix {
  return { session, update: [], remove: [] };
}

/** Saves the session and deletes the entries it overlaps. */
export function replaceOverlapped(session: SessionEntry, overlapped: StoredEntry[]): OverlapFix {
  return { session, update: [], remove: overlapped.map((e) => e.id!) };
}

/**
 * Trims so nothing overlaps: of two overlapping sessions, the one that starts earlier ends where the other
 * starts. When both start together, the new session starts where the saved one ends. Returns null when that
 * would leave the new session with no time (a saved entry covers it from its start).
 * A saved entry that starts earlier and runs past the new session loses its time after the new start.
 */
export function trimOverlapped(session: SessionEntry, overlapped: StoredEntry[]): OverlapFix | null {
  let { start, end } = session;
  const update: OverlapFix["update"] = [];
  for (const o of [...overlapped].sort((a, b) => ms(a.start) - ms(b.start))) {
    if (!overlaps(o, { start, end })) continue;
    if (ms(o.start) < ms(start)) update.push({ id: o.id!, entry: { ...toContract(o), end: start } });
    else if (ms(o.start) > ms(start)) end = o.start;
    else start = o.end;
    if (ms(start) >= ms(end)) return null;
  }
  return { session: { ...session, start, end }, update, remove: [] };
}
