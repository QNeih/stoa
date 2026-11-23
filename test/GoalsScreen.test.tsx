// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../src/db";
import { GoalsScreen } from "../src/screens/Goals";
import { StoaProvider, loadData } from "../src/state";
import type { Config, StoredEntry } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The part of the phone's store the Goals tab uses, in memory. Signed out, so nothing syncs. */
class FakeStore {
  constructor(
    public config: Config,
    public entries: StoredEntry[],
  ) {}
  getConfig = async () => this.config;
  setConfig = async (c: Config) => void (this.config = c);
  isConfigDirty = async () => false;
  allEntries = async () => this.entries;
  allChecks = async () => [];
  getTimer = async () => null;
  getPlan = async () => null;
  isPlanDirty = async () => false;
  getAccount = async () => null;
  getSyncStatus = async () => null;
  dirtyDays = async () => [];
}

// 2026-11-23 is a Monday.
const at = (day: string, time: string) => `${day}T${time}:00+01:00`;
const session = (habit: string, day: string, from: string, to: string, i: number): StoredEntry => ({
  type: "session",
  habit,
  task: "",
  start: at(day, from),
  end: at(day, to),
  note: "",
  id: i,
  uid: `u${i}`,
  day,
});

const config: Config = {
  goals: [
    { id: "mind", name: "Mind", rank: 1, archived: false, color: "lavender" },
    { id: "craft", name: "Craft", rank: 2, archived: false, color: "sage" },
    { id: "body", name: "Body", rank: 3, archived: false, color: "rose" },
    { id: "old", name: "Old", rank: 4, archived: true, color: "sky" },
  ],
  habits: [
    { id: "meditate", goal: "mind", name: "Meditate", archived: false, created: "" },
    { id: "read", goal: "craft", name: "Read", archived: false, created: "" },
    { id: "write", goal: "craft", name: "Write", archived: false, created: "" },
    { id: "draw", goal: "craft", name: "Draw", archived: true, created: "" },
    { id: "walk", goal: "body", name: "Walk", archived: false, created: "" },
  ],
  results: [{ id: "read30", habit: "read", name: "Read 30 minutes", type: "auto", min_minutes: 30, archived: false }],
};

const entries = (): StoredEntry[] => [
  session("walk", "2026-11-23", "08:00", "10:00", 1),
  session("read", "2026-11-23", "07:00", "08:00", 2),
  session("read", "2026-11-20", "07:00", "07:45", 3),
  session("draw", "2026-11-22", "07:00", "07:30", 4),
  // Mind: only long ago, so it is neglected and has no time this week.
  session("meditate", "2026-11-01", "07:00", "07:20", 5),
];

describe("Goals tab", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: FakeStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(at("2026-11-23", "10:30")));
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    location.hash = "";
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(goalId?: string): Promise<void> {
    store = new FakeStore(config, entries());
    const initial = await loadData(store as unknown as Store);
    act(() =>
      root.render(
        <StoaProvider store={store as unknown as Store} initial={initial}>
          <GoalsScreen goalId={goalId} />
        </StoaProvider>,
      ),
    );
  }

  const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
  const cards = () => [...container.querySelectorAll(".goal-card")];
  const text = (el: Element, sel: string) => el.querySelector(sel)!.textContent;
  const click = async (el: Element | null) => {
    act(() => (el as HTMLElement).click());
    await settle();
  };
  const buttonByText = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  const longPress = async (el: Element) => {
    act(() => void el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    await act(() => vi.advanceTimersByTimeAsync(600));
  };
  const typeName = (name: string) => {
    const input = container.querySelector<HTMLInputElement>("input[aria-label=Name]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("lists active goals by time this week and marks the ones without time in 7 days as neglected", async () => {
    await render();
    expect(cards().map((c) => text(c, ".goal-title"))).toEqual(["Body", "Craft", "Mind"]);
    expect(text(cards()[0], ".goal-week")).toContain("2h 00m");
    // Craft: 1h today; all time adds 45m on Friday and the archived Draw's 30m.
    expect(cards()[1].textContent).toContain("1h 00m");
    expect(cards()[1].textContent).toContain("2h 15m all time");
    expect(cards().map((c) => !!c.querySelector(".neglected"))).toEqual([false, false, true]);
    expect(cards()[2].querySelector(".neglected")!.textContent).toBe("Neglected");
    // The archived goal is not a card but sits in the Archived section.
    expect(container.querySelector("section")!.textContent).toContain("Old");
  });

  it("shows the trend against all of last week", async () => {
    await render();
    // Body had nothing last week, so it is up by its whole week.
    expect(cards()[0].querySelector(".trend.up")!.getAttribute("aria-label")).toBe("2h 00m more than last week");
    // Craft: 1h this Monday morning against all of last week (45m Friday, the archived Draw's 30m Sunday).
    expect(cards()[1].querySelector(".trend.down")!.getAttribute("aria-label")).toBe("15m less than last week");
  });

  it("renames, recolours and archives a goal from the long-press menu", async () => {
    await render();
    await longPress(cards()[1]);
    expect(container.querySelector(".sheet")).not.toBeNull();
    await click(buttonByText("Cancel"));
    // The press that opened the menu does not open the detail.
    await click(cards()[1]);
    expect(location.hash).toBe("");

    await longPress(cards()[1]);
    await click(buttonByText("Rename"));
    typeName("Making");
    await click(buttonByText("Save"));
    expect(store.config.goals.find((g) => g.id === "craft")!.name).toBe("Making");
    expect(container.querySelector(".sheet")).toBeNull();

    await longPress(cards()[1]);
    await click(buttonByText("Change colour"));
    expect(container.querySelectorAll(".swatches .pick")).toHaveLength(8);
    await click(buttonByText("Sky"));
    expect(store.config.goals.find((g) => g.id === "craft")!.color).toBe("sky");

    await longPress(cards()[1]);
    await click(buttonByText("Archive"));
    expect(store.config.goals.find((g) => g.id === "craft")!.archived).toBe(true);
    expect(cards().map((c) => text(c, ".goal-title"))).toEqual(["Body", "Mind"]);
    // Nothing is deleted: the goal keeps its sub-goals and time, and can be restored.
    expect(store.config.habits).toHaveLength(5);
    const restore = [...container.querySelectorAll("section button")].find((b) => b.closest("li")!.textContent!.includes("Making"));
    await click(restore!);
    expect(cards()).toHaveLength(3);
  });

  it("opens the goal detail on a tap", async () => {
    await render();
    await click(cards()[0]);
    expect(location.hash).toBe("#/goals/body");
  });

  it("shows time per sub-goal and each automatic result's total, and restores archived sub-goals", async () => {
    await render("craft");
    const rows = () => [...container.querySelectorAll(".sub-goal-row")];
    expect(rows().map((r) => text(r, "strong"))).toEqual(["Read", "Write"]);
    expect(rows()[0].textContent).toContain("1h 00m this week");
    expect(rows()[0].textContent).toContain("1h 45m all time");
    // Both days had 30 minutes or more on Read: 1h + 45m over 2 days.
    expect(text(rows()[0], ".auto-result")).toBe("Read 30 minutes: 1h 45m over 2 days");
    // The archived Draw is out of the list, but its 30m stays in the goal total.
    expect(container.textContent).toContain("2h 15m all time");
    expect(container.textContent).toContain("Archived sub-goals");

    await click(container.querySelector("button[aria-label='Menu for Write']"));
    await click(buttonByText("Rename"));
    typeName("Compose");
    await click(buttonByText("Save"));
    expect(store.config.habits.find((h) => h.id === "write")!.name).toBe("Compose");

    await click(container.querySelector("button[aria-label='Menu for Compose']"));
    await click(buttonByText("Archive"));
    expect(store.config.habits.find((h) => h.id === "write")!.archived).toBe(true);
    expect(rows()).toHaveLength(1);

    await click(buttonByText("Restore"));
    expect(rows()).toHaveLength(2);
  });
});
