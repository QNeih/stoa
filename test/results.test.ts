import { describe, expect, it } from "vitest";
import { autoDoneDays, doneResults, lastCheck, lastHabitCheck, minutesSince, minutesSinceLastCheck, inDoneWindow, openResults, standingCheckByUid, standingChecks } from "../src/results";
import type { Habit, LogEntry, Result, ResultCheck } from "../src/types";

const s = (habit: string, start: string, end: string): LogEntry => ({
  type: "session",
  habit,
  task: "",
  start: `${start}+01:00`,
  end: `${end}+01:00`,
  note: "",
});

const run: Habit = { id: "run", goal: "health", name: "Run", archived: false, created: "" };
const entries: LogEntry[] = [
  s("run", "2026-11-20T08:00:00", "2026-11-20T08:20:00"), // 20 min
  s("run", "2026-11-20T18:00:00", "2026-11-20T18:15:00"), // 35 min that day
  s("run", "2026-11-21T23:40:00", "2026-11-22T00:20:00"), // 20 min each side of midnight
  s("run", "2026-11-22T07:00:00", "2026-11-22T07:10:00"), // 30 min on the 22nd
  s("read", "2026-11-22T09:00:00", "2026-11-22T11:00:00"),
];

const auto: Result = { id: "trained", habit: "run", name: "Trained", type: "auto", min_minutes: 30, archived: false };
const manual: Result = { id: "5k", habit: "run", name: "Ran 5k", type: "manual", min_minutes: 30, archived: false };

const check = (uid: string, day: string, at: string, removed_at = ""): ResultCheck => ({
  uid,
  result: "5k",
  day,
  checked_at: `${at}+01:00`,
  note: "",
  minutes_since_last: 0,
  removed_at,
});

describe("automatic results", () => {
  it("are done on days with at least the minimum minutes on the sub-goal, split at midnight", () => {
    expect(autoDoneDays(auto, entries)).toEqual(["2026-11-20", "2026-11-22"]);
    expect(autoDoneDays({ ...auto, min_minutes: 20 }, entries)).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
  });

  it("change as soon as a session changes, since they are derived", () => {
    expect(autoDoneDays(auto, entries.slice(1))).toEqual(["2026-11-22"]);
  });

  it("never come from a manual result", () => {
    expect(autoDoneDays(manual, entries)).toEqual([]);
  });
});

describe("minutes since the last check", () => {
  const now = new Date("2026-11-22T12:00:00+01:00");

  it("count sub-goal time from a timestamp, cutting a session that straddles it", () => {
    expect(minutesSince(entries, run, "2026-11-20T18:05:00+01:00", now)).toBe(10 + 40 + 10);
  });

  it("count from the sub-goal's created day, or all its sessions without one", () => {
    expect(minutesSince(entries, run, null, now)).toBe(20 + 15 + 40 + 10);
    expect(minutesSince(entries, { ...run, created: "2026-11-21" }, null, now)).toBe(40 + 10);
  });

  it("stop at the given time", () => {
    expect(minutesSince(entries, run, null, new Date("2026-11-22T00:00:00+01:00"))).toBe(20 + 15 + 20);
  });

  it("use the latest standing check of the result before the new one", () => {
    const checks = [
      check("a", "2026-11-20", "2026-11-20T09:00:00"),
      check("b", "2026-11-21", "2026-11-21T12:00:00", "2026-11-21T12:01:00+01:00"),
      check("c", "2026-11-22", "2026-11-22T13:00:00"),
    ];
    expect(lastCheck(checks, "5k", now)?.uid).toBe("a");
    expect(minutesSinceLastCheck([manual, auto], run, checks, entries, now)).toBe(15 + 40 + 10);
    expect(minutesSinceLastCheck([manual, auto], run, [], entries, now)).toBe(20 + 15 + 40 + 10);
  });

  it("count from the last check of any result on the sub-goal, and only that sub-goal", () => {
    const pb: Result = { ...manual, id: "pb", name: "Personal best" };
    const book: Result = { ...manual, id: "book", habit: "read", name: "Finished a book" };
    const checks = [
      check("a", "2026-11-20", "2026-11-20T09:00:00"),
      { ...check("p", "2026-11-21", "2026-11-21T08:00:00"), result: "pb" },
      { ...check("b", "2026-11-22", "2026-11-22T06:00:00"), result: "book" },
    ];
    const results = [manual, pb, book];
    expect(lastHabitCheck(checks, results, "run", now)?.uid).toBe("p");
    expect(minutesSinceLastCheck(results, run, checks, entries, now)).toBe(40 + 10);
  });
});

describe("done results", () => {
  const checks = [
    check("x", "2026-11-22", "2026-11-22T20:00:00"),
    check("y", "2026-11-21", "2026-11-21T20:00:00", "2026-11-21T20:05:00+01:00"),
    { ...check("z", "2026-11-21", "2026-11-21T20:00:00"), result: "trained" },
    { ...check("w", "2026-11-21", "2026-11-21T20:00:00"), result: "unknown" },
  ];

  it("list standing manual checks and derived automatic days, by day and result order", () => {
    const done = doneResults([manual, auto], checks, entries);
    expect(done.map((d) => [d.day, d.result, d.type])).toEqual([
      ["2026-11-20", "trained", "auto"],
      ["2026-11-22", "5k", "manual"],
      ["2026-11-22", "trained", "auto"],
    ]);
    expect(done[0]).toMatchObject({ ms: 35 * 60_000 });
  });

  it("list several checks of one result on a day in the order they were made", () => {
    const more = [check("m2", "2026-11-22", "2026-11-22T21:00:00"), check("m1", "2026-11-22", "2026-11-22T19:00:00")];
    const done = doneResults([manual], more, []);
    expect(done.map((d) => d.type === "manual" && d.check.uid)).toEqual(["m1", "m2"]);
  });

  it("find the standing check to undo by its uid", () => {
    expect(standingCheckByUid(checks, "x")?.uid).toBe("x");
    expect(standingCheckByUid(checks, "y")).toBeNull();
    expect(standingChecks(checks, "5k").map((c) => c.uid)).toEqual(["x"]);
  });
});

describe("open results", () => {
  const today = "2026-11-23";

  it("keep a manual result open until it has a standing check, whatever the day", () => {
    expect(openResults([manual], [], entries, today)).toEqual([manual]);
    expect(openResults([manual], [check("x", "2026-10-01", "2026-10-01T20:00:00")], entries, today)).toEqual([]);
    expect(openResults([manual], [check("x", "2026-11-22", "2026-11-22T20:00:00", "2026-11-23T08:00:00+01:00")], entries, today)).toEqual([manual]);
  });

  it("keep an automatic result open until it reached its minimum today", () => {
    expect(openResults([auto], [], entries, "2026-11-22")).toEqual([]);
    expect(openResults([auto], [], entries, today)).toEqual([auto]);
  });
});

describe("done window", () => {
  it("lists entries up to 7 days after their day", () => {
    expect(inDoneWindow("2026-11-16", "2026-11-23")).toBe(true);
    expect(inDoneWindow("2026-11-15", "2026-11-23")).toBe(false);
  });
});
