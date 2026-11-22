// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../src/db";
import { PlanScreen } from "../src/screens/Plan";
import { StoaProvider, type StoaData } from "../src/state";
import type { SessionEntry } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (habit: string, task: string, start: string, end: string): SessionEntry & { uid: string; day: string } => ({
  type: "session",
  habit,
  task,
  start: `2026-11-22T${start}:00+01:00`,
  end: `2026-11-22T${end}:00+01:00`,
  note: "",
  uid: `${habit}-${start}`,
  day: "2026-11-22",
});

const data: StoaData = {
  config: {
    goals: [{ id: "craft", name: "Craft", rank: 1, archived: false }],
    habits: [
      { id: "read", goal: "craft", name: "Read", archived: false },
      { id: "write", goal: "craft", name: "Write", archived: false },
      { id: "walk", goal: "craft", name: "Walk", archived: false },
    ],
    counters: [],
  },
  entries: [
    session("read", "Chapter 3", "09:00", "09:45"),
    session("write", "", "10:00", "10:40"),
    session("walk", "", "11:00", "11:20"),
  ],
  timer: null,
  plan: {
    date: "2026-11-22",
    time_budget_min: 120,
    note: "Light day",
    items: [
      { habit: "read", task: "Chapter 3", minutes: 60 },
      { habit: "write", task: "", minutes: 30 },
    ],
  },
  account: null,
  syncStatus: null,
  pending: 0,
};

describe("Plan screen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T18:00:00+01:00"));
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows planned against spent time per item and in total", () => {
    // Signed out, the provider never touches the store, so an empty one will do.
    act(() => root.render(<StoaProvider store={{} as Store} initial={data}><PlanScreen /></StoaProvider>));

    const rows = [...container.querySelectorAll(".card .row")].map((r) => r.textContent);
    expect(rows).toEqual(["Planned1h 30m", "Spent on the plan1h 25m", "Spent on other things20m"]);
    expect(container.textContent).toContain("Time budget 2h 00m");
    expect(container.textContent).toContain("Light day");

    const items = [...container.querySelectorAll(".list li")];
    expect(items.map((li) => li.querySelector(".small")?.textContent)).toEqual(["Read · 45 of 60 min", "Write · 40 of 30 min"]);
    // An item whose minutes are used up is struck through.
    expect(items.map((li) => li.classList.contains("done"))).toEqual([false, true]);
  });
});
