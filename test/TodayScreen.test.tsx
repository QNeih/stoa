// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../src/db";
import { dayOf } from "../src/logs";
import { TodayScreen } from "../src/screens/Today";
import { StoaProvider, loadData, type StoaData } from "../src/state";
import type { Config, LogEntry, Plan, RunningTimer, StoredEntry } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The part of the phone's store the Today tab uses, in memory. Signed out, so nothing syncs. */
class FakeStore {
  entries: StoredEntry[] = [];
  planDirty = false;
  constructor(
    public config: Config,
    public plan: Plan | null,
    public timer: RunningTimer | null,
  ) {}
  getConfig = async () => this.config;
  allEntries = async () => this.entries;
  allChecks = async () => [];
  getTimer = async () => this.timer;
  setTimer = async (t: RunningTimer | null) => void (this.timer = t);
  getPlan = async () => this.plan;
  isPlanDirty = async () => this.planDirty;
  setPlan = async (p: Plan | null, dirty = false) => {
    this.plan = p;
    this.planDirty = dirty;
  };
  getAccount = async () => null;
  getSyncStatus = async () => null;
  dirtyDays = async () => [];
  isConfigDirty = async () => false;
  addEntry = async (e: LogEntry) => void this.entries.push({ ...e, id: this.entries.length + 1, uid: `u${this.entries.length}`, day: dayOf(e) });
}

const at = (time: string) => `2026-11-23T${time}:00+01:00`;

const config: Config = {
  goals: [
    { id: "craft", name: "Craft", rank: 1, archived: false, color: "sage" },
    { id: "body", name: "Body", rank: 2, archived: false, color: "rose" },
  ],
  habits: [
    { id: "read", goal: "craft", name: "Read", archived: false, created: "" },
    { id: "write", goal: "craft", name: "Write", archived: false, created: "" },
    { id: "walk", goal: "body", name: "Walk", archived: false, created: "" },
    { id: "swim", goal: "body", name: "Swim", archived: true, created: "" },
  ],
  results: [],
};

const plan = (date = "2026-11-23"): Plan => ({
  date,
  time_budget_min: 90,
  note: "",
  items: [
    { habit: "read", task: "", minutes: 60 },
    { habit: "write", task: "", minutes: 30 },
  ],
});

describe("Today screen", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: FakeStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(at("10:00")));
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(s: FakeStore): Promise<void> {
    store = s;
    const initial: StoaData = await loadData(s as unknown as Store);
    act(() => root.render(<StoaProvider store={s as unknown as Store} initial={initial}><TodayScreen /></StoaProvider>));
  }

  /** Lets the store calls of a tapped action finish. */
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
  const cards = () => [...container.querySelectorAll(".plan-card")];
  const names = () => cards().map((c) => c.querySelector(".sub-goal")!.textContent);
  const running = () => cards().map((c) => c.classList.contains("running"));
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const tap = async (el: Element) => {
    act(() => (el as HTMLElement).click());
    await settle();
  };

  it("shows today's plan as cards in row order, with goal and sub-goal, and time today at the top", async () => {
    const s = new FakeStore(config, plan(), null);
    s.entries.push({ type: "session", habit: "read", task: "", start: at("08:00"), end: at("08:25"), note: "", id: 1, uid: "a", day: "2026-11-23" });
    await render(s);
    expect(names()).toEqual(["Read", "Write"]);
    expect(cards().map((c) => c.querySelector(".goal-name")!.textContent)).toEqual(["Craft", "Craft"]);
    expect(container.querySelector("header")!.textContent).toContain("25m today");
    expect(running()).toEqual([false, false]);
    expect(button("Start Read")).not.toBeNull();
  });

  it("leaves yesterday's plan off the list", async () => {
    await render(new FakeStore(config, plan("2026-11-22"), null));
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain("Nothing planned for today yet.");
  });

  it("marks the running card, shows Pause and counts today's time on its sub-goal each second", async () => {
    await render(new FakeStore(config, plan(), { habit: "write", task: "", start: at("09:15") }));
    expect(running()).toEqual([false, true]);
    expect(button("Pause Write")).not.toBeNull();
    expect(button("Start Write")).toBeNull();
    expect(cards()[1].querySelector(".clock")!.textContent).toBe("0:45:00");
    act(() => vi.advanceTimersByTime(1000));
    expect(cards()[1].querySelector(".clock")!.textContent).toBe("0:45:01");
  });

  it("runs one timer at a time: starting another card ends the running one as a session", async () => {
    await render(new FakeStore(config, plan(), { habit: "read", task: "", start: at("09:30") }));
    await tap(button("Start Write"));
    expect(store.entries.map((e) => [e.habit, e.start, e.end])).toEqual([["read", at("09:30"), at("10:00")]]);
    expect(store.timer).toMatchObject({ habit: "write", start: at("10:00") });
    expect(running()).toEqual([false, true]);
  });

  it("pauses without asking for a note", async () => {
    await render(new FakeStore(config, plan(), { habit: "read", task: "", start: at("09:30") }));
    await tap(button("Pause Read"));
    expect(store.entries.map((e) => [e.habit, e.end, e.note])).toEqual([["read", at("10:00"), ""]]);
    expect(store.timer).toBeNull();
    expect(running()).toEqual([false, false]);
    expect(cards()[0].querySelector(".today-time")!.textContent).toBe("30m");
  });

  it("adds a sub-goal that is not on the list at 0 minutes and starts it", async () => {
    await render(new FakeStore(config, plan(), null));
    await tap(container.querySelector("button.add")!);
    const picks = [...container.querySelectorAll(".sheet .pick")];
    // Read and Write are on the list, Swim is archived.
    expect(picks.map((p) => p.textContent)).toEqual(["Walk"]);
    await tap(picks[0]);
    expect(store.plan!.items.at(-1)).toEqual({ habit: "walk", task: "", minutes: 0 });
    expect(store.planDirty).toBe(true);
    expect(store.timer).toMatchObject({ habit: "walk", task: "" });
    expect(names()).toEqual(["Read", "Write", "Walk"]);
    expect(running()).toEqual([false, false, true]);
    expect(container.querySelector(".sheet")).toBeNull();
  });

  it("reorders by dragging a card's handle and rewrites today's plan", async () => {
    await render(new FakeStore(config, plan(), null));
    const grip = button("Move Read");
    // jsdom lays nothing out, so every card centre is 0 and any drag down passes all of them.
    act(() => {
      grip.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }));
      grip.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 160 }));
    });
    expect((cards()[0] as HTMLElement).style.transform).toBe("translateY(60px)");
    act(() => {
      grip.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 160 }));
    });
    // The new order shows at once, before the store has it.
    expect(names()).toEqual(["Write", "Read"]);
    await settle();
    expect(store.plan!.items.map((i) => i.habit)).toEqual(["write", "read"]);
    expect(store.plan!.time_budget_min).toBe(90);
    expect(store.planDirty).toBe(true);
  });

  it("moves a card with the arrow keys on its handle", async () => {
    await render(new FakeStore(config, plan(), null));
    act(() => button("Move Write").dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })));
    await settle();
    expect(store.plan!.items.map((i) => i.habit)).toEqual(["write", "read"]);
  });
});
