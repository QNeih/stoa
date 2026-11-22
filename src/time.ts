const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO 8601 with the local offset and no milliseconds, e.g. 2026-11-22T21:05:00+01:00. */
export function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Local midnight that starts the day of `d`. */
export function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Local midnight that ends the day of `d` (DST-safe). */
export function nextMidnight(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() + 1);
  return s;
}

/** Monday 00:00 local of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const back = (s.getDay() + 6) % 7;
  s.setDate(s.getDate() - back);
  return s;
}

/** Parse YYYY-MM-DD as a local date at 00:00. */
export function parseLocalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole calendar days from day `a` to day `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Split [start, end) at local midnights into per-day durations in ms. */
export function splitByDay(start: Date, end: Date): { day: string; ms: number }[] {
  const parts: { day: string; ms: number }[] = [];
  let cur = start;
  while (cur < end) {
    const cut = nextMidnight(cur);
    const stop = cut < end ? cut : end;
    parts.push({ day: localDate(cur), ms: stop.getTime() - cur.getTime() });
    cur = stop;
  }
  return parts;
}

/** "1h 05m", "25m", "0m". */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}

/** "1:05:09" for the running timer. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** "21:05" local. */
export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** How far back a timer may be started or moved. */
export const MAX_BACKDATE_MS = 24 * 3600_000;

/**
 * Checks a timer start: valid, not after `now`, at most 24 hours back, and not before `notBefore`
 * (the end of the latest saved session). Returns a short message, or null when the start is fine.
 */
export function validateStart(start: Date, now: Date, notBefore: Date | null): string | null {
  if (Number.isNaN(start.getTime())) return "Enter a valid start time.";
  if (start.getTime() > now.getTime()) return "The start cannot be in the future.";
  if (now.getTime() - start.getTime() > MAX_BACKDATE_MS) return "The start cannot be more than 24 hours ago.";
  if (notBefore && start.getTime() < notBefore.getTime()) {
    const day = localDate(notBefore) === localDate(now) ? "" : `${localDate(notBefore)} `;
    return `The start cannot be before ${day}${formatTime(notBefore)}, when your last session ended.`;
  }
  return null;
}
