// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "../src/components/Toast";
import type { Store } from "../src/db";
import { dayOf } from "../src/logs";
import { autoDoneDays } from "../src/results";
import { LogScreen } from "../src/screens/Log";
import { SessionForm } from "../src/screens/SessionForm";
import { StoaProvider, loadData, type StoaData } from "../src/state";
import type { Config, LogEntry, Result, StoredEntry } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The part of the phone's store the Log uses, in memory, with the store's day rules: an entry is filed
 * under its start day, and every change marks the days it touches dirty. Signed out, so nothing syncs.
 */
class FakeStore {
  entries: StoredEntry[] = [];
  dirty = new Set<string>();
  /** Day ranges the Log asked for, to check it never reads the whole log. */
  reads: [string, string][] = [];
  private nextId = 1;
  constructor(public config: Config) {}
  seed(e: LogEntry): StoredEntry {
    const stored = { ...e, id: this.nextId, uid: `u${this.nextId++}`, day: dayOf(e) };
    this.entries.push(stored);
    return stored;
  }
  getConfig = async () => this.config;
  allEntries = async () => [...this.entries];
  allChecks = async () => [];
  getTimer = async () => null;
  getPlan = async () => null;
  isPlanDirty = async () => false;
  getAccount = async () => null;
  getSyncStatus = async () => null;
  dirtyDays = async () => [...this.dirty].sort();
  isConfigDirty = async () => false;
  entriesBetween = async (from: string, to: string) => {
    this.reads.push([from, to]);
    return this.entries.filter((e) => e.day >= from && e.day <= to);
  };
  latestDayBefore = async (day: string) =>
    this.entries
      .map((e) => e.day)
      .filter((d) => d < day)
      .sort()
      .at(-1) ?? null;
  addEntry = async (e: LogEntry) => void this.dirty.add(this.seed(e).day);
  updateEntry = async (id: number, e: LogEntry) => {
    const i = this.entries.findIndex((x) => x.id === id);
    const old = this.entries[i];
    this.entries[i] = { ...e, id, uid: old.uid, day: dayOf(e) };
    this.dirty.add(old.day).add(dayOf(e));
  };
  deleteEntry = async (id: number) => {
    const old = this.entries.find((x) => x.id === id);
    this.entries = this.entries.filter((x) => x.id !== id);
    if (old) this.dirty.add(old.day);
    return old;
  };
  restoreEntry = async (e: StoredEntry) => {
    this.entries.push(e);
    this.dirty.add(e.day);
  };
}

const config: Config = {
  goals: [{ id: "body", name: "Body", rank: 1, archived: false, color: "rose" }],
  habits: [
    { id: "gym", goal: "body", name: "Gym", archived: false, created: "" },
    { id: "read", goal: "body", name: "Reading", archived: false, created: "" },
    { id: "swim", goal: "body", name: "Swim", archived: true, created: "" },
  ],
  results: [],
};

const session = (habit: string, day: string, from: string, to: string): LogEntry => ({
  type: "session",
  habit,
  task: "",
  start: `${day}T${from}:00+01:00`,
  end: `${day}T${to}:00+01:00`,
  note: "",
});

describe("Log screen", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: FakeStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Monday 23 November 2026, 18:20.
    vi.setSystemTime(new Date("2026-11-23T18:20:30+01:00"));
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    store = new FakeStore(config);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    location.hash = "";
  });

  async function render(screen: React.ReactNode = <LogScreen />): Promise<void> {
    const initial: StoaData = await loadData(store as unknown as Store);
    act(() =>
      root.render(
        <StoaProvider store={store as unknown as Store} initial={initial}>
          {screen}
          <Toast />
        </StoaProvider>,
      ),
    );
    await settle();
  }

  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
  const tap = async (el: Element | null) => {
    expect(el).not.toBeNull();
    act(() => (el as HTMLElement).click());
    await settle();
  };
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent!.trim().startsWith(text)) ?? null;
  const rows = () => [...container.querySelectorAll("li.entry")].map((li) => `${li.querySelector("strong")!.textContent} ${li.querySelector(".muted")!.textContent}`);
  const sections = () => container.querySelectorAll("section").length;
  const setValue = (el: HTMLInputElement, value: string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const type = async (text: string) => {
    setValue(container.querySelector<HTMLInputElement>('input[aria-label="Quick add"]')!, text);
    await settle();
  };
  const preview = () =>
    Object.fromEntries(
      [...container.querySelectorAll(".quick-preview dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );

  it("shows the past week by day, and loads older sessions a week at a time", async () => {
    store.seed(session("gym", "2026-11-23", "07:00", "07:45"));
    store.seed(session("read", "2026-11-17", "20:00", "20:30"));
    store.seed(session("gym", "2026-11-12", "07:00", "08:00"));
    store.seed(session("read", "2026-10-01", "21:00", "21:20"));
    await render();
    expect(rows()).toEqual(["Gym 07:00–07:45", "Reading 20:00–20:30"]);
    expect(store.reads).toEqual([["2026-11-17", "9999-12-31"]]);

    await tap(buttonByText("Load older sessions"));
    expect(rows()).toEqual(["Gym 07:00–07:45", "Reading 20:00–20:30", "Gym 07:00–08:00"]);
    expect(store.reads.at(-1)).toEqual(["2026-11-10", "9999-12-31"]);

    // The empty weeks in between are skipped.
    await tap(buttonByText("Load older sessions"));
    expect(sections()).toBe(4);
    expect(store.reads.at(-1)).toEqual(["2026-09-29", "9999-12-31"]);
    expect(buttonByText("Load older sessions")).toBeNull();
  });

  it("deletes from the … menu at once, and Undo puts the same entry back", async () => {
    const kept = store.seed(session("gym", "2026-11-23", "07:00", "07:45"));
    const gone = store.seed(session("read", "2026-11-22", "20:00", "20:30"));
    await render();
    await tap(container.querySelector('button[aria-label="Actions for Reading 20:00"]'));
    expect(container.querySelector('[role="dialog"]')!.textContent).toContain("Reading 20:00–20:30");
    await tap(buttonByText("Delete"));
    expect(rows()).toEqual(["Gym 07:00–07:45"]);
    expect(store.dirty.has("2026-11-22")).toBe(true);
    expect(container.querySelector(".toast")!.textContent).toContain("Session deleted");

    await tap(buttonByText("Undo"));
    expect(rows()).toEqual(["Gym 07:00–07:45", "Reading 20:00–20:30"]);
    expect(store.entries.find((e) => e.id === gone.id)).toEqual(gone);
    expect(store.entries.find((e) => e.id === kept.id)).toEqual(kept);
  });

  it("opens the menu on a long press instead of editing", async () => {
    store.seed(session("gym", "2026-11-23", "07:00", "07:45"));
    await render();
    const row = container.querySelector("li.entry")!;
    act(() => void row.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 })));
    await act(() => new Promise<void>((r) => setTimeout(r, 600)));
    act(() => {
      row.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      (row as HTMLElement).click();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(location.hash).toBe("");
  });

  it("previews quick input and saves it", async () => {
    await render();
    await type("45m gym yesterday");
    expect(preview()).toMatchObject({ "Sub-goal": "Gym", Time: "11:15–12:00", Duration: "45m" });
    expect(container.querySelector(".quick-preview")!.textContent).toContain("Placed to end at 12:00.");
    await tap(buttonByText("Save"));
    expect(store.entries.map((e) => [e.habit, e.start, e.end])).toEqual([["gym", "2026-11-22T11:15:00+01:00", "2026-11-22T12:00:00+01:00"]]);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Quick add"]')!.value).toBe("");
    expect(rows()).toEqual(["Gym 11:15–12:00"]);
  });

  it("flags quick input it cannot save, with the reason", async () => {
    await render();
    await type("45m swim");
    expect(container.querySelector(".problems")!.textContent).toBe('No sub-goal matches "swim".');
    expect(buttonByText("Save")!.disabled).toBe(true);
    await type("gym 19:00-20:00");
    expect(container.querySelector(".problems")!.textContent).toBe("That ends in the future.");
  });

  it("opens quick input in the full form to change it", async () => {
    await render();
    await type("45m gym yesterday");
    await tap(buttonByText("Change"));
    expect(container.querySelector<HTMLInputElement>('input[name="start"]')!.value).toBe("2026-11-22T11:15");
    expect(container.querySelector<HTMLSelectElement>('select[name="habit"]')!.value).toBe("gym");
  });

  it("warns when quick input overlaps a saved session, and trim ends the earlier one where the new one starts", async () => {
    const earlier = store.seed(session("read", "2026-11-22", "11:00", "11:30"));
    await render();
    await type("45m gym yesterday");
    await tap(buttonByText("Save"));
    expect(container.querySelector(".overlap")!.textContent).toContain("Overlaps a saved session");
    expect(store.entries).toHaveLength(1);
    await tap(buttonByText("Trim"));
    expect(store.entries.find((e) => e.id === earlier.id)!.end).toBe("2026-11-22T11:15:00+01:00");
    expect(store.entries.find((e) => e.habit === "gym")!.start).toBe("2026-11-22T11:15:00+01:00");
  });

  it("warns when an edit overlaps a saved session, and replace deletes it", async () => {
    const edited = store.seed(session("gym", "2026-11-20", "07:00", "07:30"));
    const other = store.seed(session("read", "2026-11-20", "07:45", "08:30"));
    await render(<SessionForm id={edited.id} />);
    setValue(container.querySelector<HTMLInputElement>('input[name="end"]')!, "2026-11-20T08:00");
    await tap(buttonByText("Save"));
    expect(container.querySelector(".overlap")!.textContent).toContain("Reading");
    await tap(buttonByText("Replace"));
    expect(store.entries.map((e) => [e.id, e.end])).toEqual([[edited.id, "2026-11-20T08:00:00+01:00"]]);
    expect(store.entries.some((e) => e.id === other.id)).toBe(false);
  });

  it("editing an old day's session changes its automatic result and marks that day for sync", async () => {
    const result: Result = { id: "lift", habit: "gym", name: "Lift", type: "auto", min_minutes: 30, archived: false };
    const old = store.seed(session("gym", "2026-11-02", "07:00", "07:20"));
    store.seed(session("gym", "2026-11-23", "07:00", "07:45"));
    expect(autoDoneDays(result, store.entries)).toEqual(["2026-11-23"]);
    await render(<SessionForm id={old.id} />);
    setValue(container.querySelector<HTMLInputElement>('input[name="end"]')!, "2026-11-02T07:40");
    await tap(buttonByText("Save"));
    expect(autoDoneDays(result, store.entries)).toEqual(["2026-11-02", "2026-11-23"]);
    expect([...store.dirty]).toEqual(["2026-11-02"]);
    expect(location.hash).toBe("#/log");
  });
});
