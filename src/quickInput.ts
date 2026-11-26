// The Log's quick input: one line of free text, e.g. "45m gym yesterday", "1h30 job search 14:00" or
// "gym 45 min on 2026-11-20", read into a session on a sub-goal. Pure, so the Log can preview it live.
import { isoLocal, localDate, parseLocalDate } from "./time";
import type { SubGoal, SessionEntry } from "./types";

export interface QuickResult {
  /** The matched sub-goal, or null when the text names none or several. */
  subGoal: SubGoal | null;
  /** Local date the session starts on. */
  day: string;
  start: Date | null;
  end: Date | null;
  minutes: number | null;
  /**
   * True when the text gave only a duration, so the times were placed by rule: ending now for today,
   * ending at 12:00 for other days.
   */
  placed: boolean;
  /** Why the text cannot be saved yet; empty when it can. */
  problems: string[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Words that only join the parts, as in "on monday", "at 14:00", "for 45m". */
const FILLERS = new Set(["on", "at", "from", "for", "to", "last", "-", "–", "—"]);
const MAX_MINUTES = 24 * 60;

/** Local midnight of `day` plus `h` hours and `m` minutes. */
function atTime(day: string, h: number, m: number): Date {
  const d = parseLocalDate(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** 24-hour clock from "2" "30" "pm"; null when out of range. */
function clock(hText: string, mText: string | undefined, ampm: string | undefined): { h: number; m: number } | null {
  let h = Number(hText);
  const m = mText ? Number(mText) : 0;
  if (m > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  } else if (h > 23) return null;
  return { h, m };
}

/** Case-insensitive match of `query` against sub-goal names: exact, then prefix, then contains, then named inside the query. */
export function matchSubGoal(query: string, subGoals: SubGoal[]): { subGoal: SubGoal | null; candidates: SubGoal[] } {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return { subGoal: null, candidates: [] };
  const name = (h: SubGoal) => h.name.trim().toLowerCase().replace(/\s+/g, " ");
  const levels: ((n: string) => boolean)[] = [
    (n) => n === q,
    (n) => n.startsWith(q),
    (n) => n.includes(q),
    (n) => ` ${q} `.includes(` ${n} `),
  ];
  for (const level of levels) {
    const found = subGoals.filter((h) => level(name(h)));
    if (found.length) return { subGoal: found.length === 1 ? found[0] : null, candidates: found };
  }
  return { subGoal: null, candidates: [] };
}

/**
 * Reads one line into a session. `subGoals` should be the sub-goals that can take new sessions (not archived).
 * Duration: "45m", "45 min", "1h", "1h30", "1.5h", "2 hours". Times: "14:00" (start), "14:00-15:30", "9am".
 * Date: today unless "yesterday", a weekday name (its latest day up to today; "last" goes a week further when
 * that is today) or an ISO date. The rest of the words name the sub-goal.
 */
export function parseQuickInput(text: string, subGoals: SubGoal[], now: Date): QuickResult {
  const problems: string[] = [];
  const today = localDate(now);
  let rest = ` ${text.toLowerCase()} `;
  /** Takes the first match of `re` out of the text. */
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = rest.match(re);
    if (m) rest = rest.slice(0, m.index) + " " + rest.slice(m.index! + m[0].length);
    return m;
  };

  // Date.
  let day = today;
  let dateSeen = false;
  const iso = take(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    dateSeen = true;
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (localDate(d) !== iso[0]) problems.push(`${iso[0]} is not a date.`);
    else day = iso[0];
  }
  const word = take(/\b(?:(last)\s+)?(today|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (word) {
    if (dateSeen) problems.push("The text names two dates.");
    dateSeen = true;
    const d = parseLocalDate(today);
    if (word[2] === "yesterday") d.setDate(d.getDate() - 1);
    else if (word[2] !== "today") {
      let back = (d.getDay() - WEEKDAYS.indexOf(word[2]) + 7) % 7;
      if (back === 0 && word[1]) back = 7;
      d.setDate(d.getDate() - back);
    }
    if (!iso) day = localDate(d);
  }
  if (take(/\b(\d{4})-(\d{2})-(\d{2})\b|\b(?:today|yesterday)\b/)) problems.push("The text names two dates.");

  // Times: a range, or one start time.
  const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
  let start: Date | null = null;
  let end: Date | null = null;
  let startOnly: Date | null = null;
  const range = take(new RegExp(String.raw`\b${T}\s*(?:-|–|—|\bto\b)\s*${T}(?![\d:])`));
  // A range needs a colon or am/pm on one side, so "1-2" stays text.
  if (range && (range[2] || range[3] || range[5] || range[6])) {
    const a = clock(range[1], range[2], range[3] ?? range[6]);
    const b = clock(range[4], range[5], range[6]);
    if (!a || !b) problems.push(`${range[0].trim()} is not a time.`);
    else {
      start = atTime(day, a.h, a.m);
      end = atTime(day, b.h, b.m);
      if (end <= start) end.setDate(end.getDate() + 1);
    }
  } else if (range) {
    rest = ` ${range[0]} ${rest}`;
  }
  if (!start) {
    const one = take(/\b(\d{1,2}):(\d{2})\s*(am|pm)?(?![\d:])/) ?? take(/\b(\d{1,2})\s*(am|pm)\b/);
    if (one) {
      const c = one[0].includes(":") ? clock(one[1], one[2], one[3]) : clock(one[1], undefined, one[2]);
      if (!c) problems.push(`${one[0].trim()} is not a time.`);
      else startOnly = atTime(day, c.h, c.m);
    }
  }

  // Duration.
  let minutes: number | null = null;
  const durations: number[] = [];
  for (;;) {
    // "1h30": the minutes may follow the h straight away, so the unit ends at a non-letter, not a word boundary.
    const h = take(/\b(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)(?![a-z])\s*(?:(\d{1,2})\s*(?:m|min|mins|minute|minutes)?(?![a-z\d:]))?/);
    if (h) {
      durations.push(Math.round(Number(h[1].replace(",", ".")) * 60) + (h[2] ? Number(h[2]) : 0));
      continue;
    }
    const m = take(/\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
    if (m) {
      durations.push(Number(m[1]));
      continue;
    }
    break;
  }
  if (durations.length > 1) problems.push("The text names two durations.");
  if (durations.length) minutes = durations[0];

  // Sub-goal: what is left.
  const query = rest
    .split(/\s+/)
    .filter((w) => w && !FILLERS.has(w))
    .join(" ")
    .replace(/[,;.]+/g, " ")
    .trim();
  const { subGoal, candidates } = matchSubGoal(query, subGoals);
  if (!query) problems.push("Name a sub-goal.");
  else if (candidates.length > 1) problems.push(`"${query}" fits ${candidates.map((h) => h.name).join(", ")}; type more of the name.`);
  else if (!subGoal) problems.push(`No sub-goal matches "${query}".`);

  // Place the session.
  let placed = false;
  if (start && end) {
    const span = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (minutes !== null && minutes !== span) problems.push("The duration does not match the start and end.");
    minutes = span;
  } else if (startOnly && minutes !== null) {
    start = startOnly;
    end = new Date(start.getTime() + minutes * 60_000);
  } else if (minutes !== null) {
    placed = true;
    if (day === today) {
      end = new Date(now);
      end.setSeconds(0, 0);
    } else end = atTime(day, 12, 0);
    start = new Date(end.getTime() - minutes * 60_000);
  }

  if (minutes === null) problems.push(startOnly ? "Add a duration or an end time." : "Add a duration, e.g. 45m or 1h30.");
  else if (minutes <= 0) problems.push("The duration must be more than 0 minutes.");
  else if (minutes > MAX_MINUTES) problems.push("A session cannot be longer than 24 hours.");
  if (day > today) problems.push("The date is in the future.");
  else if (end && end.getTime() > now.getTime()) problems.push("That ends in the future.");

  return { subGoal, day: start ? localDate(start) : day, start, end, minutes, placed, problems };
}

/** The session to save, or null while the text has problems. */
export function quickSession(r: QuickResult): SessionEntry | null {
  if (r.problems.length || !r.subGoal || !r.start || !r.end) return null;
  return { type: "session", subGoal: r.subGoal.id, task: "", start: isoLocal(r.start), end: isoLocal(r.end), note: "" };
}
