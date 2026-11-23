import { describe, expect, it } from "vitest";
import { dashboard, goalStats, planProgress, rangesWithData, timeBuckets } from "../src/stats";
import type { Config, LogEntry, Plan } from "../src/types";

const config: Config = {
  goals: [
    { id: "career", name: "Career", rank: 1, archived: false, color: "sky" },
    { id: "family", name: "Family", rank: 2, archived: false, color: "rose" },
    { id: "old", name: "Old", rank: 3, archived: true, color: "" },
  ],
  habits: [
    { id: "job-search", goal: "career", name: "Job search", archived: false, created: "" },
    { id: "partner", goal: "family", name: "Time together", archived: false, created: "" },
  ],
  results: [],
};

const s = (habit: string, start: string, end: string): LogEntry => ({
  type: "session",
  habit,
  task: "",
  start,
  end,
  note: "",
});

describe("dashboard", () => {
  const now = new Date("2026-11-22T12:00:00+01:00"); // a Sunday
  const entries: LogEntry[] = [
    s("job-search", "2026-11-22T09:00:00+01:00", "2026-11-22T10:30:00+01:00"),
    s("partner", "2026-11-21T20:00:00+01:00", "2026-11-22T09:00:00+01:00"), // sleepover
    s("job-search", "2026-11-14T09:00:00+01:00", "2026-11-14T10:00:00+01:00"), // last week
  ];
  const d = dashboard(config, entries, now);

  it("counts today's part of a sleepover in time today and the done list", () => {
    expect(d.todayMs).toBe((1.5 + 9) * 3600_000);
    expect(d.done.map((x) => x.session.habit)).toEqual(["partner", "job-search"]);
  });

  it("sums the week per active goal in rank order, both days of the sleepover", () => {
    expect(d.weekByGoal).toEqual([
      { goal: "career", ms: 1.5 * 3600_000, lastSpentDaysAgo: 0 },
      { goal: "family", ms: 13 * 3600_000, lastSpentDaysAgo: 0 },
    ]);
  });

  it("reports days since time was last spent, null when never", () => {
    const later = dashboard(config, entries, new Date("2026-11-25T12:00:00+01:00"));
    expect(later.weekByGoal.map((g) => g.lastSpentDaysAgo)).toEqual([3, 3]);
    expect(dashboard(config, [], now).weekByGoal[0].lastSpentDaysAgo).toBeNull();
  });
});

describe("plan progress", () => {
  const plan: Plan = {
    date: "2026-11-22",
    time_budget_min: 120,
    items: [
      { habit: "job-search", task: "Cover letter", minutes: 90 },
      { habit: "partner", task: "", minutes: 30 },
    ],
    note: "",
  };
  const entries: LogEntry[] = [
    { ...s("job-search", "2026-11-22T09:00:00+01:00", "2026-11-22T09:40:00+01:00"), task: "Cover letter" },
    { ...s("job-search", "2026-11-22T10:00:00+01:00", "2026-11-22T10:20:00+01:00"), task: "Cover letter " },
    { ...s("job-search", "2026-11-22T11:00:00+01:00", "2026-11-22T11:30:00+01:00"), task: "Something else" },
    { ...s("job-search", "2026-11-21T09:00:00+01:00", "2026-11-21T10:00:00+01:00"), task: "Cover letter" },
  ];

  it("sums today's time per plan item by habit and task, and the time off the plan", () => {
    const p = planProgress(plan, entries, "2026-11-22");
    expect(p.items.map((i) => i.spentMs / 60_000)).toEqual([60, 0]);
    expect(p.plannedMs / 60_000).toBe(120);
    expect(p.onPlanMs / 60_000).toBe(60);
    expect(p.offPlanMs / 60_000).toBe(30);
  });
});

describe("goal stats", () => {
  const cfg: Config = {
    ...config,
    habits: [
      ...config.habits,
      { id: "cv", goal: "career", name: "CV", archived: true, created: "" },
      { id: "unused", goal: "career", name: "Unused", archived: true, created: "" },
      { id: "old-h", goal: "old", name: "Old habit", archived: false, created: "" },
    ],
  };
  const now = new Date("2026-11-25T12:00:00+01:00"); // a Wednesday
  const h = 3600_000;
  const entries: LogEntry[] = [
    s("job-search", "2026-11-24T09:00:00+01:00", "2026-11-24T10:00:00+01:00"),
    s("partner", "2026-11-23T20:00:00+01:00", "2026-11-23T23:00:00+01:00"),
    s("job-search", "2026-11-18T09:00:00+01:00", "2026-11-18T10:00:00+01:00"), // inside last week's span
    s("job-search", "2026-11-18T13:00:00+01:00", "2026-11-18T14:00:00+01:00"), // after it
    s("cv", "2026-11-02T10:00:00+01:00", "2026-11-02T10:30:00+01:00"),
    s("old-h", "2026-11-24T10:00:00+01:00", "2026-11-24T11:00:00+01:00"),
  ];

  it("gives this week, the same span last week and all time per active goal, most time this week first", () => {
    const stats = goalStats(cfg, entries, now);
    expect(stats.map((g) => [g.goal, g.weekMs / h, g.lastWeekMs / h, g.allTimeMs / h])).toEqual([
      ["family", 3, 0, 3],
      ["career", 1, 1, 3.5],
    ]);
  });

  it("lists sub-goals with their totals, leaving out archived ones without time", () => {
    const career = goalStats(cfg, entries, now).find((g) => g.goal === "career")!;
    expect(career.subGoals).toEqual([
      { habit: "job-search", weekMs: 1 * h, lastWeekMs: 1 * h, allTimeMs: 3 * h },
      { habit: "cv", weekMs: 0, lastWeekMs: 0, allTimeMs: 0.5 * h },
    ]);
  });

  it("flags goals without time today or in the 6 days before", () => {
    const flags = (at: string) => Object.fromEntries(goalStats(cfg, entries, new Date(at)).map((g) => [g.goal, g.neglected]));
    expect(flags("2026-11-30T12:00:00+01:00")).toEqual({ career: false, family: true });
    expect(flags("2026-12-01T12:00:00+01:00")).toEqual({ career: true, family: true });
    expect(goalStats(cfg, [], now).map((g) => [g.neglected, g.lastSpentDaysAgo])).toEqual([
      [true, null],
      [true, null],
    ]);
  });
});

describe("time per bucket", () => {
  const now = new Date("2026-11-25T12:00:00+01:00");
  const h = 3600_000;
  const entries: LogEntry[] = [
    s("job-search", "2026-11-02T10:00:00+01:00", "2026-11-02T11:00:00+01:00"),
    s("partner", "2026-11-22T23:00:00+01:00", "2026-11-23T01:00:00+01:00"), // Sunday into Monday
    s("job-search", "2026-11-24T09:00:00+01:00", "2026-11-24T11:00:00+01:00"),
  ];

  it("stacks time by goal per week from the first session's week, with empty weeks, split at midnight", () => {
    expect(timeBuckets(config, entries, "week", now)).toEqual([
      { start: "2026-11-02", byGoal: { career: 1 * h }, totalMs: 1 * h },
      { start: "2026-11-09", byGoal: {}, totalMs: 0 },
      { start: "2026-11-16", byGoal: { family: 1 * h }, totalMs: 1 * h },
      { start: "2026-11-23", byGoal: { family: 1 * h, career: 2 * h }, totalMs: 3 * h },
    ]);
    expect(timeBuckets(config, entries, "week", now, 2).map((b) => b.start)).toEqual(["2026-11-16", "2026-11-23"]);
  });

  it("buckets by month and year too", () => {
    expect(timeBuckets(config, entries, "month", now)).toEqual([{ start: "2026-11-01", byGoal: { career: 3 * h, family: 2 * h }, totalMs: 5 * h }]);
    const older = [s("partner", "2025-12-31T10:00:00+01:00", "2025-12-31T11:00:00+01:00"), ...entries];
    expect(timeBuckets(config, older, "year", now).map((b) => [b.start, b.totalMs / h])).toEqual([
      ["2025-01-01", 1],
      ["2026-01-01", 5],
    ]);
    expect(timeBuckets(config, older, "month", now)).toHaveLength(12);
    expect(timeBuckets(config, [], "week", now)).toEqual([]);
  });

  it("offers a range once the data reaches back before its current bucket", () => {
    expect(rangesWithData([], now)).toEqual([]);
    expect(rangesWithData(entries.slice(2), now)).toEqual([]);
    expect(rangesWithData(entries, now)).toEqual(["week"]);
    expect(rangesWithData([s("partner", "2025-12-31T10:00:00+01:00", "2025-12-31T11:00:00+01:00")], now)).toEqual(["week", "month", "year"]);
  });
});
