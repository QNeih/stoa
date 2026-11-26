import { describe, expect, it } from "vitest";
import { matchSubGoal, parseQuickInput, quickSession } from "../src/quickInput";
import type { SubGoal } from "../src/types";

const subGoal = (id: string, name: string): SubGoal => ({ id, goal: "g", name, archived: false, created: "" });
const subGoals = [subGoal("gym", "Gym"), subGoal("job", "Job search"), subGoal("cv", "CV"), subGoal("read", "Reading"), subGoal("write", "Writing")];

// Monday 23 November 2026, 18:20:30 in Berlin (the tests run in Europe/Berlin).
const now = new Date("2026-11-23T18:20:30+01:00");
const parse = (text: string) => parseQuickInput(text, subGoals, now);
/** Start and end as local "YYYY-MM-DD HH:MM". */
const span = (text: string) => {
  const r = parse(text);
  const f = (d: Date | null) => d && `${d.toLocaleDateString("sv")} ${d.toTimeString().slice(0, 5)}`;
  return [f(r.start), f(r.end)];
};

describe("matchSubGoal", () => {
  it("matches case-insensitively by exact name, then prefix, then contains", () => {
    expect(matchSubGoal("GYM", subGoals).subGoal?.id).toBe("gym");
    expect(matchSubGoal("job", subGoals).subGoal?.id).toBe("job");
    expect(matchSubGoal("search", subGoals).subGoal?.id).toBe("job");
  });

  it("finds a sub-goal named inside longer text", () => {
    expect(matchSubGoal("gym workout", subGoals).subGoal?.id).toBe("gym");
  });

  it("reports every candidate when the text fits several", () => {
    const r = matchSubGoal("ing", subGoals);
    expect(r.subGoal).toBeNull();
    expect(r.candidates.map((h) => h.id)).toEqual(["read", "write"]);
  });

  it("prefers an exact name over a longer one it starts", () => {
    const r = matchSubGoal("cv", [subGoal("cv", "CV"), subGoal("cvx", "CV review")]);
    expect(r.subGoal?.id).toBe("cv");
  });
});

describe("parseQuickInput", () => {
  it("places a duration for today so it ends now, to the minute", () => {
    const r = parse("45m gym");
    expect(r.subGoal?.id).toBe("gym");
    expect(r.minutes).toBe(45);
    expect(r.placed).toBe(true);
    expect(span("45m gym")).toEqual(["2026-11-23 17:35", "2026-11-23 18:20"]);
    expect(r.problems).toEqual([]);
  });

  it("places a duration on another day so it ends at 12:00", () => {
    const r = parse("45m gym yesterday");
    expect(r.day).toBe("2026-11-22");
    expect(span("45m gym yesterday")).toEqual(["2026-11-22 11:15", "2026-11-22 12:00"]);
  });

  it("reads hours with minutes and a start time", () => {
    const r = parse("1h30 job search 14:00");
    expect(r.subGoal?.id).toBe("job");
    expect(r.minutes).toBe(90);
    expect(r.placed).toBe(false);
    expect(span("1h30 job search 14:00")).toEqual(["2026-11-23 14:00", "2026-11-23 15:30"]);
  });

  it("reads a spelled-out duration and an ISO date after 'on'", () => {
    const r = parse("gym 45 min on 2026-11-20");
    expect(r.subGoal?.id).toBe("gym");
    expect(r.day).toBe("2026-11-20");
    expect(span("gym 45 min on 2026-11-20")).toEqual(["2026-11-20 11:15", "2026-11-20 12:00"]);
  });

  it.each([
    ["2h cv", 120],
    ["1.5h cv", 90],
    ["1h 15m cv", 75],
    ["cv 2 hours", 120],
    ["cv 20 minutes", 20],
  ])("reads the duration in %s", (text, minutes) => {
    expect(parse(text).minutes).toBe(minutes);
    expect(parse(text).subGoal?.id).toBe("cv");
  });

  it("reads a start-end range, and a range past midnight ends the next day", () => {
    expect(span("gym 9:15-10:00 yesterday")).toEqual(["2026-11-22 09:15", "2026-11-22 10:00"]);
    expect(parse("gym 9:15-10:00 yesterday").minutes).toBe(45);
    expect(span("reading 23:30 to 0:15 saturday")).toEqual(["2026-11-21 23:30", "2026-11-22 00:15"]);
    expect(span("gym 9am-10:30am")).toEqual(["2026-11-23 09:00", "2026-11-23 10:30"]);
  });

  it("takes a weekday as its latest day up to today, and 'last' goes a week back when that is today", () => {
    expect(parse("30m gym friday").day).toBe("2026-11-20");
    expect(parse("30m gym monday").day).toBe("2026-11-23");
    expect(parse("30m gym last monday").day).toBe("2026-11-16");
    expect(parse("30m gym last friday").day).toBe("2026-11-20");
  });

  it("flags an unknown sub-goal", () => {
    expect(parse("45m swimming").problems).toEqual(['No sub-goal matches "swimming".']);
  });

  it("flags a sub-goal name that fits several", () => {
    expect(parse("45m ing").problems[0]).toMatch(/fits Reading, Writing/);
  });

  it("flags missing parts", () => {
    expect(parse("gym").problems).toEqual(["Add a duration, e.g. 45m or 1h30."]);
    expect(parse("gym 14:00").problems).toEqual(["Add a duration or an end time."]);
    expect(parse("45m").problems).toEqual(["Name a sub-goal."]);
  });

  it("flags a time or date in the future", () => {
    expect(parse("1h gym 18:00").problems).toEqual(["That ends in the future."]);
    expect(parse("1h gym on 2026-11-24").problems).toEqual(["The date is in the future."]);
  });

  it("flags times and dates that do not exist and durations out of range", () => {
    expect(parse("gym 25:00-26:00").problems).toContain("25:00-26:00 is not a time.");
    expect(parse("45m gym 2026-02-30").problems).toContain("2026-02-30 is not a date.");
    expect(parse("0m gym").problems).toContain("The duration must be more than 0 minutes.");
    expect(parse("25h gym yesterday").problems).toContain("A session cannot be longer than 24 hours.");
  });

  it("flags a duration that disagrees with the range, and two durations", () => {
    expect(parse("30m gym 9:00-10:00").problems).toEqual(["The duration does not match the start and end."]);
    expect(parse("30m 1h gym").problems).toContain("The text names two durations.");
  });
});

describe("quickSession", () => {
  it("builds the session to save once the text has no problems", () => {
    expect(quickSession(parse("1h30 job search 14:00"))).toEqual({
      type: "session",
      subGoal: "job",
      task: "",
      start: "2026-11-23T14:00:00+01:00",
      end: "2026-11-23T15:30:00+01:00",
      note: "",
    });
    expect(quickSession(parse("gym"))).toBeNull();
  });
});
