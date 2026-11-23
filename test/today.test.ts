import { describe, expect, it } from "vitest";
import {
  addableHabits,
  addedItem,
  dropIndex,
  isRunning,
  moveItem,
  msToday,
  switchTimer,
  timerSession,
  todayItems,
  withItems,
} from "../src/today";
import type { Config, LogEntry, Plan, RunningTimer } from "../src/types";

const config: Config = {
  goals: [
    { id: "family", name: "Family", rank: 2, archived: false, color: "rose" },
    { id: "career", name: "Career", rank: 1, archived: false, color: "sky" },
    { id: "old", name: "Old", rank: 3, archived: true, color: "" },
  ],
  habits: [
    { id: "partner", goal: "family", name: "Time together", archived: false, created: "" },
    { id: "cv", goal: "career", name: "CV", archived: false, created: "" },
    { id: "apply", goal: "career", name: "Apply", archived: false, created: "" },
    { id: "network", goal: "career", name: "Network", archived: true, created: "" },
    { id: "hobby", goal: "old", name: "Hobby", archived: false, created: "" },
  ],
  results: [],
};

const plan: Plan = {
  date: "2026-11-23",
  items: [
    { habit: "cv", task: "" },
    { habit: "partner", task: "Walk" },
  ],
};

const s = (habit: string, start: string, end: string): LogEntry => ({
  type: "session",
  habit,
  task: "",
  start: `${start}+01:00`,
  end: `${end}+01:00`,
  note: "",
});

describe("today's cards", () => {
  it("shows the stored plan only on its own day", () => {
    expect(todayItems(plan, "2026-11-23")).toBe(plan.items);
    expect(todayItems(plan, "2026-11-24")).toEqual([]);
    expect(todayItems(null, "2026-11-23")).toEqual([]);
  });

  it("matches the running timer by sub-goal and task", () => {
    const timer: RunningTimer = { habit: "partner", task: "Walk", start: "2026-11-23T09:00:00+01:00" };
    expect(plan.items.map((i) => isRunning(timer, i))).toEqual([false, true]);
    expect(isRunning({ ...timer, task: "" }, plan.items[1])).toBe(false);
    expect(isRunning(null, plan.items[0])).toBe(false);
  });
});

describe("reorder", () => {
  it("moves one item and keeps the others in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
  });

  it("drops a dragged card past every card whose centre it passed", () => {
    const centers = [50, 150, 250, 350];
    expect(dropIndex(centers, 0, 0)).toBe(0);
    expect(dropIndex(centers, 0, 99)).toBe(0); // centre 149 has not passed 150 yet
    expect(dropIndex(centers, 0, 101)).toBe(1);
    expect(dropIndex(centers, 0, 1000)).toBe(3);
    expect(dropIndex(centers, 3, -101)).toBe(2);
    expect(dropIndex(centers, 3, -1000)).toBe(0);
  });

  it("rewrites today's plan rows in the new order", () => {
    const reordered = withItems(plan, "2026-11-23", moveItem(plan.items, 1, 0));
    expect(reordered).toEqual({ ...plan, items: [plan.items[1], plan.items[0]] });
  });
});

describe("add out of plan", () => {
  it("offers active sub-goals of active goals not yet on the list, in goal rank order", () => {
    expect(addableHabits(config, plan.items).map((h) => h.id)).toEqual(["apply"]);
    expect(addableHabits(config, []).map((h) => h.id)).toEqual(["cv", "apply", "partner"]);
  });

  it("appends a row to today's plan", () => {
    const added = withItems(plan, "2026-11-23", [...plan.items, addedItem("apply")]);
    expect(added.items.at(-1)).toEqual({ habit: "apply", task: "" });
  });

  it("starts a new plan for today when the stored one is for another day", () => {
    expect(withItems(plan, "2026-11-24", [addedItem("apply")])).toEqual({
      date: "2026-11-24",
      items: [{ habit: "apply", task: "" }],
    });
    expect(withItems(null, "2026-11-24", []).items).toEqual([]);
  });
});

describe("one timer at a time", () => {
  const running: RunningTimer = { habit: "cv", task: "", start: "2026-11-23T09:00:00+01:00" };

  it("ends the running timer as a session where the next one starts", () => {
    const { session, timer } = switchTimer(running, { habit: "partner", task: " Walk " }, new Date("2026-11-23T09:30:00+01:00"));
    expect(session).toEqual({
      type: "session",
      habit: "cv",
      task: "",
      start: "2026-11-23T09:00:00+01:00",
      end: "2026-11-23T09:30:00+01:00",
      note: "",
    });
    expect(timer).toEqual({ habit: "partner", task: "Walk", start: "2026-11-23T09:30:00+01:00" });
  });

  it("saves nothing when no timer runs", () => {
    expect(switchTimer(null, { habit: "cv", task: "" }, new Date("2026-11-23T09:30:00+01:00")).session).toBeNull();
  });

  it("gives a session a minute when it would end at or before its start", () => {
    expect(timerSession(running, new Date("2026-11-23T08:59:00+01:00")).end).toBe("2026-11-23T09:01:00+01:00");
    expect(timerSession(running, new Date("2026-11-23T09:00:10+01:00")).end).toBe("2026-11-23T09:00:10+01:00");
  });
});

describe("time today", () => {
  const now = new Date("2026-11-23T10:00:00+01:00");
  const entries = [
    s("cv", "2026-11-23T08:00:00", "2026-11-23T08:30:00"),
    s("partner", "2026-11-22T23:00:00", "2026-11-23T01:00:00"), // past midnight: 1h today
    s("cv", "2026-11-22T08:00:00", "2026-11-22T09:00:00"), // yesterday
  ];

  it("adds the running timer to the saved sessions", () => {
    const timer: RunningTimer = { habit: "cv", task: "", start: "2026-11-23T09:45:00+01:00" };
    expect(msToday(entries, null, now)).toBe(90 * 60_000);
    expect(msToday(entries, timer, now)).toBe(105 * 60_000);
    expect(msToday(entries, timer, now, "cv")).toBe(45 * 60_000);
    expect(msToday(entries, timer, now, "partner")).toBe(60 * 60_000);
  });

  it("counts only today's part of a timer started yesterday", () => {
    const timer: RunningTimer = { habit: "apply", task: "", start: "2026-11-22T23:00:00+01:00" };
    expect(msToday([], timer, now, "apply")).toBe(10 * 3600_000);
  });
});
