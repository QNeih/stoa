import { describe, expect, it } from "vitest";
import { dashboard } from "../src/stats";
import type { Config, LogEntry } from "../src/types";

const config: Config = {
  goals: [
    { id: "career", name: "Career", rank: 1, archived: false },
    { id: "family", name: "Family", rank: 2, archived: false },
    { id: "old", name: "Old", rank: 3, archived: true },
  ],
  habits: [
    { id: "job-search", goal: "career", name: "Job search", archived: false },
    { id: "partner", goal: "family", name: "Time together", archived: false },
  ],
  counters: [{ id: "apps", goal: "career", name: "Applications" }],
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
    { type: "counter", counter: "apps", at: "2026-11-20T10:00:00+01:00", delta: 1 },
    { type: "counter", counter: "apps", at: "2026-11-10T10:00:00+01:00", delta: 1 },
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

  it("counts counters for the week and in total", () => {
    expect(d.counters).toEqual([{ counter: "apps", week: 1, total: 2 }]);
  });

  it("reports days since time was last spent, null when never", () => {
    const later = dashboard(config, entries, new Date("2026-11-25T12:00:00+01:00"));
    expect(later.weekByGoal.map((g) => g.lastSpentDaysAgo)).toEqual([3, 3]);
    expect(dashboard(config, [], now).weekByGoal[0].lastSpentDaysAgo).toBeNull();
  });
});
