// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "../src/db";
import { ResultsScreen } from "../src/screens/Results";
import { StoaProvider, loadData, useStoa, type Stoa, type StoaData } from "../src/state";
import type { Config, ResultCheck, RunningTimer, StoredCheck, StoredEntry } from "../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The part of the phone's store the Results tab uses, in memory. Signed out, so nothing syncs. */
class FakeStore {
  checks: StoredCheck[] = [];
  dirty = new Set<string>();
  constructor(
    public config: Config,
    public entries: StoredEntry[],
    public timer: RunningTimer | null = null,
  ) {}
  getConfig = async () => this.config;
  allEntries = async () => this.entries;
  allChecks = async () => this.checks.map((c) => ({ ...c }));
  getTimer = async () => this.timer;
  getPlan = async () => null;
  isPlanDirty = async () => false;
  getAccount = async () => null;
  getSyncStatus = async () => null;
  dirtyDays = async () => [...this.dirty];
  isConfigDirty = async () => false;
  addCheck = async (c: Omit<ResultCheck, "uid">) => {
    this.checks.push({ ...c, id: this.checks.length + 1, uid: `c${this.checks.length + 1}` });
    this.dirty.add(c.day);
  };
  removeCheck = async (id: number, at: string) => {
    const c = this.checks.find((x) => x.id === id)!;
    c.removed_at = at;
    this.dirty.add(c.day);
  };
}

const at = (day: string, time: string) => `2026-11-${day}T${time}:00+01:00`;
const session = (id: number, habit: string, day: string, start: string, end: string): StoredEntry => ({
  type: "session",
  habit,
  task: "",
  start: at(day, start),
  end: at(day, end),
  note: "",
  id,
  uid: `s${id}`,
  day: `2026-11-${day}`,
});

const config: Config = {
  goals: [
    { id: "body", name: "Body", rank: 1, archived: false, color: "rose" },
    { id: "old", name: "Old", rank: 2, archived: true, color: "sage" },
  ],
  habits: [
    { id: "run", goal: "body", name: "Run", archived: false, created: "2026-11-01" },
    { id: "gym", goal: "body", name: "Gym", archived: false, created: "" },
    { id: "chess", goal: "old", name: "Chess", archived: false, created: "" },
  ],
  results: [
    { id: "5k", habit: "run", name: "Ran 5k", type: "manual", min_minutes: 30, archived: false },
    { id: "pb", habit: "run", name: "Personal best", type: "manual", min_minutes: 30, archived: false },
    { id: "trained", habit: "gym", name: "Trained", type: "auto", min_minutes: 30, archived: false },
    { id: "marathon", habit: "run", name: "Marathon", type: "manual", min_minutes: 30, archived: true },
    { id: "rated", habit: "chess", name: "Rated 1500", type: "manual", min_minutes: 30, archived: false },
  ],
};

/** A store on 23 Nov: Personal best checked on the 21st, gym 40 minutes yesterday and 12 so far today. */
function seeded(timer: RunningTimer | null = null): FakeStore {
  const s = new FakeStore(
    config,
    [
      session(1, "run", "20", "08:00", "08:30"),
      session(2, "run", "22", "08:00", "08:20"),
      session(3, "gym", "22", "18:00", "18:40"),
      session(4, "gym", "23", "09:30", "09:42"),
    ],
    timer,
  );
  s.checks.push({ id: 1, uid: "c1", result: "pb", day: "2026-11-21", checked_at: at("21", "09:00"), note: "felt easy", minutes_since_last: 30, removed_at: "" });
  return s;
}

describe("Results", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: FakeStore;
  let stoa: Stoa;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at("23", "10:00")));
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  /** Exposes the app state to the test, so actions can be called directly. */
  function Capture() {
    stoa = useStoa();
    return null;
  }

  async function render(s: FakeStore): Promise<void> {
    store = s;
    const initial: StoaData = await loadData(s as unknown as Store);
    act(() =>
      root.render(
        <StoaProvider store={s as unknown as Store} initial={initial}>
          <Capture />
          <ResultsScreen />
        </StoaProvider>,
      ),
    );
  }

  /** Lets the store calls of an action finish. */
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
  const tap = async (el: Element) => {
    act(() => (el as HTMLElement).click());
    await settle();
  };
  const type = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const text = (els: Iterable<Element>) => [...els].map((e) => e.textContent);
  const openRows = () => [...container.querySelectorAll(".result:not(.done)")];
  const doneRows = () => [...container.querySelectorAll(".result.done")];
  const openRow = (name: string) => openRows().find((r) => r.querySelector(".result-name")!.textContent === name)!;
  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;

  describe("actions", () => {
    it("check a manual result today with the note and the sub-goal time since the last check of any of its results", async () => {
      await render(seeded());
      await act(() => stoa.checkResult("5k", "  sub 30  "));
      expect(store.checks.at(-1)).toEqual({
        id: 2,
        uid: "c2",
        result: "5k",
        day: "2026-11-23",
        checked_at: at("23", "10:00"),
        note: "sub 30",
        // Run time since Personal best was checked on the 21st: the session on the 22nd.
        minutes_since_last: 20,
        removed_at: "",
      });
      expect(store.dirty).toEqual(new Set(["2026-11-23"]));
    });

    it("count the running timer up to now, and the sub-goal's time since it was created for the first check", async () => {
      const s = seeded({ habit: "run", task: "", start: at("23", "09:50") });
      s.checks = [];
      await render(s);
      await act(() => stoa.checkResult("5k"));
      expect(store.checks[0]).toMatchObject({ note: "", minutes_since_last: 30 + 20 + 10 });
    });

    it("leave a result checked today as it is, and never check an automatic result", async () => {
      await render(seeded());
      await act(() => stoa.checkResult("5k"));
      await act(() => stoa.checkResult("5k", "again"));
      await act(() => stoa.checkResult("trained"));
      expect(store.checks.map((c) => c.result)).toEqual(["pb", "5k"]);
    });

    it("uncheck by setting removed_at and keeping the row", async () => {
      await render(seeded());
      await act(() => stoa.uncheckResult("pb", "2026-11-21"));
      expect(store.checks).toHaveLength(1);
      expect(store.checks[0].removed_at).toBe(at("23", "10:00"));
      expect(store.dirty).toEqual(new Set(["2026-11-21"]));
    });
  });

  describe("screen", () => {
    it("groups open and done results by goal and sub-goal and hides archived ones", async () => {
      await render(seeded());
      expect(text(container.querySelectorAll(".goal-headline"))).toEqual(["Body", "Body"]);
      expect(text(container.querySelectorAll(".divider"))).toEqual(["Run", "Gym", "Run", "Gym"]);
      expect(text(openRows().map((r) => r.querySelector(".result-name")!))).toEqual(["Ran 5k", "Personal best", "Trained"]);
      expect(container.textContent).not.toContain("Marathon");
      expect(container.textContent).not.toContain("Rated 1500");
    });

    it("shows an open automatic result with today's progress and no checkbox", async () => {
      await render(seeded());
      const trained = openRow("Trained");
      expect(trained.textContent).toContain("12 / 30 min today");
      expect(trained.querySelector("input")).toBeNull();
    });

    it("lists done entries with their day: manual ones with the note and a checkbox, automatic ones pointing to Log", async () => {
      await render(seeded());
      const [pb, trained] = doneRows();
      expect(pb.textContent).toContain("Personal best");
      expect(pb.textContent).toContain("21");
      expect(pb.querySelector(".note")!.textContent).toBe("felt easy");
      expect(pb.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
      expect(trained.textContent).toContain("Yesterday · 40m · edit in Log");
      expect(trained.querySelector("input")).toBeNull();
      expect(trained.querySelector("a")!.getAttribute("href")).toBe("#/log");
    });

    it("checks a result with a note from the inline sheet, which moves it to the done list", async () => {
      await render(seeded());
      await tap(openRow("Ran 5k").querySelector("input")!);
      type(container.querySelector<HTMLInputElement>('input[aria-label="Note"]')!, "sub 30");
      await tap(button("Save"));
      expect(store.checks.at(-1)).toMatchObject({ result: "5k", note: "sub 30" });
      expect(openRow("Ran 5k")).toBeUndefined();
      expect(doneRows()[0].textContent).toContain("Ran 5kTodaysub 30");
      expect(container.querySelector(".note-sheet")).toBeNull();
    });

    it("checks without a note in one tap on Skip note", async () => {
      await render(seeded());
      await tap(openRow("Personal best").querySelector("input")!);
      await tap(button("Skip note"));
      expect(store.checks.at(-1)).toMatchObject({ result: "pb", day: "2026-11-23", note: "" });
    });

    it("closes the sheet without checking when the box is tapped again", async () => {
      await render(seeded());
      const box = openRow("Ran 5k").querySelector("input")!;
      await tap(box);
      expect(box.checked).toBe(true);
      await tap(box);
      expect(container.querySelector(".note-sheet")).toBeNull();
      expect(store.checks).toHaveLength(1);
    });

    it("unchecking a result checked today returns it to the open list", async () => {
      await render(seeded());
      await act(() => stoa.checkResult("5k"));
      await tap(container.querySelector('input[aria-label="Uncheck Ran 5k"]')!);
      expect(store.checks.at(-1)!.removed_at).toBe(at("23", "10:00"));
      expect(openRow("Ran 5k")).toBeDefined();
    });
  });
});
