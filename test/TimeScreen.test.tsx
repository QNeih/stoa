// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../src/db";
import { dayOf } from "../src/logs";
import { TimeScreen } from "../src/screens/Time";
import { StoaProvider, loadData } from "../src/state";
import type { Config, LogEntry, StoredEntry } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeStore {
  constructor(public config: Config, public entries: StoredEntry[]) {}
  getConfig = async () => this.config;
  allEntries = async () => this.entries;
  allChecks = async () => [];
  getTimer = async () => null;
  getPlan = async () => null;
  isPlanDirty = async () => false;
  getAccount = async () => null;
  getSyncStatus = async () => null;
  dirtyDays = async () => [];
  isConfigDirty = async () => false;
}

const config: Config = {
  goals: [
    { id: "craft", name: "Craft", rank: 1, archived: false, color: "sage" },
    { id: "body", name: "Body", rank: 2, archived: false, color: "rose" },
  ],
  habits: [
    { id: "read", goal: "craft", name: "Read", archived: false, created: "" },
    { id: "walk", goal: "body", name: "Walk", archived: false, created: "" },
  ],
  results: [],
};

let n = 0;
const session = (habit: string, day: string, minutes: number): StoredEntry => {
  const start = `${day}T09:00:00+01:00`;
  const e: LogEntry = { type: "session", habit, task: "", start, end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), note: "" };
  return { ...e, id: ++n, uid: `u${n}`, day: dayOf(e) };
};

describe("Time screen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T10:00:00+01:00"));
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(entries: StoredEntry[]) {
    const store = new FakeStore(config, entries);
    const initial = await loadData(store as unknown as Store);
    act(() => root.render(<StoaProvider store={store as unknown as Store} initial={initial}><TimeScreen /></StoaProvider>));
  }

  const rangeButtons = () => [...container.querySelectorAll<HTMLButtonElement>(".range-buttons button")];

  it("shows an empty-state message without enough data", async () => {
    await render([session("read", "2026-11-23", 30)]);
    expect(rangeButtons()).toHaveLength(0);
    expect(container.textContent).toContain("Not enough time logged yet");
  });

  it("offers only ranges with data, week selected first", async () => {
    await render([session("read", "2026-11-16", 60), session("walk", "2026-11-23", 30)]);
    expect(rangeButtons().map((b) => b.textContent)).toEqual(["Week"]);
    expect(rangeButtons()[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the all-time total and switches range with a single selection", async () => {
    await render([session("read", "2025-10-05", 60), session("read", "2026-11-16", 60), session("walk", "2026-11-23", 30)]);
    expect(rangeButtons().map((b) => b.textContent)).toEqual(["Week", "Month", "Year"]);
    expect(container.querySelector(".time-total")!.textContent).toContain("2h 30m");
    act(() => rangeButtons()[2].click());
    expect(rangeButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    expect(container.querySelectorAll(".bar")).toHaveLength(2);
  });

  it("shows minutes per goal of a tapped bar, and a legend and table", async () => {
    await render([session("read", "2026-11-16", 60), session("walk", "2026-11-17", 30)]);
    expect([...container.querySelectorAll(".legend li")].map((l) => l.textContent)).toEqual(["Craft", "Body"]);
    const bar = container.querySelector(".bar")!;
    act(() => (bar as unknown as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector(".readout")!.textContent).toContain("Craft: 60 min");
    expect(container.querySelector(".readout")!.textContent).toContain("Body: 30 min");
    expect(container.querySelector("table.sr-only")).not.toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toContain("1h 30m");
  });
});
