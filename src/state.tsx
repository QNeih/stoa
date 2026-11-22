// App state and every action that changes it. Screens read and call these through useStoa().
import { createContext, useContext, useEffect, useEffectEvent, useReducer, useRef, useState, type ReactNode } from "react";
import type { Settings, Store, SyncStatus } from "./db";
import { activeGoals, counterName } from "./format";
import { GitHub } from "./github";
import { slugify, toContract } from "./logs";
import { restore, rollUp } from "./sync";
import { isoLocal, localDate } from "./time";
import type { Config, Plan, RunningTimer, SessionEntry, StoredEntry } from "./types";

/** After this long a reopened app asks whether the timer is still going. */
const STILL_GOING_MS = 4 * 3600_000;
const TOAST_MS = 4000;

/** Everything the screens show, as last read from the phone's store. */
export interface StoaData {
  config: Config;
  entries: StoredEntry[];
  timer: RunningTimer | null;
  plan: Plan | null;
  settings: Settings;
  syncStatus: SyncStatus | null;
  /** Days plus config waiting to be written to the data repo. */
  pending: number;
}

export interface ToastMessage {
  text: string;
  undo?: () => void;
}

export async function loadData(store: Store): Promise<StoaData> {
  const [config, entries, timer, plan, settings, syncStatus, dirtyDays, configDirty] = await Promise.all([
    store.getConfig(),
    store.allEntries(),
    store.getTimer(),
    store.getPlan(),
    store.getSettings(),
    store.getSyncStatus(),
    store.dirtyDays(),
    store.isConfigDirty(),
  ]);
  return { config, entries, timer, plan, settings, syncStatus, pending: dirtyDays.length + (configDirty ? 1 : 0) };
}

/** Saves a timer as a session that ends at `end`, at least one minute long. */
async function saveTimerAsSession(store: Store, t: RunningTimer, end: Date, note: string): Promise<void> {
  const start = new Date(t.start);
  if (end <= start) end = new Date(start.getTime() + 60_000);
  await store.addEntry({ type: "session", habit: t.habit, task: t.task, start: t.start, end: isoLocal(end), note: note.trim() });
}

export function useStoaState(store: Store, initial: StoaData) {
  const [data, setData] = useState(initial);
  // Async actions read the latest data from here, since their closure may predate a reload.
  const dataRef = useRef(initial);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  /** Set while the stop screen asks for a note; the session ends at this time. */
  const [stopEnd, setStopEnd] = useState<Date | null>(null);
  const [stillGoingOpen, setStillGoingOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  // Bumped when the app comes back to the foreground, so time-based numbers are recomputed.
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  async function reload(): Promise<void> {
    const next = await loadData(store);
    dataRef.current = next;
    setData(next);
  }

  function showToast(text: string, undo?: () => void): void {
    setToast({ text, undo });
  }

  /** Roll-up to the data repo; quiet no-op without settings. */
  async function sync(): Promise<void> {
    const { token, repo } = dataRef.current.settings;
    if (!token || !repo || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    let status: SyncStatus;
    try {
      const r = await rollUp(store, new GitHub({ token, repo }), localDate(new Date()));
      status = r.errors.length
        ? { at: new Date().toISOString(), ok: false, message: r.errors[0] }
        : { at: new Date().toISOString(), ok: true, message: r.pushedDays.length ? `Wrote ${r.pushedDays.join(", ")}` : "Up to date" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = { at: new Date().toISOString(), ok: false, message: /fetch/i.test(msg) ? "Offline, will retry" : msg };
    }
    await store.setSyncStatus(status);
    syncingRef.current = false;
    setSyncing(false);
    await reload();
  }

  // --- timer ---

  async function startTimer(habit: string, task: string): Promise<void> {
    const now = new Date();
    const running = dataRef.current.timer;
    // One timer at a time: starting another stops the first.
    if (running) await saveTimerAsSession(store, running, now, "");
    await store.setTimer({ habit, task: task.trim(), start: isoLocal(now) });
    await reload();
    location.hash = "#/today";
  }

  async function stopTimer(note: string): Promise<void> {
    const running = dataRef.current.timer;
    if (!running) return;
    await saveTimerAsSession(store, running, stopEnd ?? new Date(), note);
    await store.setTimer(null);
    await reload();
    setStopEnd(null);
    location.hash = "#/today";
    void sync();
  }

  async function discardTimer(): Promise<void> {
    await store.setTimer(null);
    await reload();
    setStopEnd(null);
  }

  const checkStillGoing = useEffectEvent(() => {
    const t = dataRef.current.timer;
    if (!t || stillGoingOpen || stopEnd) return;
    const since = new Date(t.checked ?? t.start).getTime();
    if (Date.now() - since >= STILL_GOING_MS) setStillGoingOpen(true);
  });

  async function confirmStillGoing(): Promise<void> {
    const t = dataRef.current.timer;
    if (t) await store.setTimer({ ...t, checked: isoLocal(new Date()) });
    await reload();
    setStillGoingOpen(false);
  }

  /** Answers "still going?" with an end time: the stop screen opens with it, capped at now. */
  function endStillGoing(end: Date): void {
    setStillGoingOpen(false);
    const now = new Date();
    setStopEnd(end > now ? now : end);
  }

  // --- log ---

  async function tapCounter(id: string): Promise<void> {
    const entry = { type: "counter" as const, counter: id, at: isoLocal(new Date()), delta: 1 };
    await store.addEntry(entry);
    await reload();
    showToast(`${counterName(dataRef.current.config, id)} +1`, async () => {
      const tap = (await store.allEntries()).filter((e) => e.type === "counter" && e.counter === id && e.at === entry.at).pop();
      if (tap?.id !== undefined) await store.deleteEntry(tap.id);
      await reload();
    });
  }

  async function saveSession(entry: SessionEntry, id?: number): Promise<void> {
    if (id !== undefined) await store.updateEntry(id, entry);
    else await store.addEntry(entry);
    await reload();
  }

  async function deleteEntry(id: number): Promise<void> {
    await store.deleteEntry(id);
    await reload();
  }

  // --- config ---

  async function editConfig(change: (c: Config) => Config): Promise<void> {
    await store.setConfig(change(dataRef.current.config), true);
    await reload();
    void sync();
  }

  const newId = (c: Config, name: string) => slugify(name, [...c.goals, ...c.habits, ...c.counters].map((x) => x.id));

  const addHabit = (name: string, goal: string) =>
    editConfig((c) => ({ ...c, habits: [...c.habits, { id: newId(c, name), goal, name, archived: false }] }));
  const setHabitGoal = (id: string, goal: string) =>
    editConfig((c) => ({ ...c, habits: c.habits.map((x) => (x.id === id ? { ...x, goal } : x)) }));
  const setHabitArchived = (id: string, archived: boolean) =>
    editConfig((c) => ({ ...c, habits: c.habits.map((x) => (x.id === id ? { ...x, archived } : x)) }));
  const addCounter = (name: string, goal: string) =>
    editConfig((c) => ({ ...c, counters: [...c.counters, { id: newId(c, name), goal, name }] }));
  const removeCounter = (id: string) => editConfig((c) => ({ ...c, counters: c.counters.filter((x) => x.id !== id) }));
  const addGoal = (name: string) =>
    editConfig((c) => {
      const rank = Math.max(0, ...c.goals.map((g) => g.rank)) + 1;
      return { ...c, goals: [...c.goals, { id: newId(c, name), name, rank, archived: false }] };
    });
  const setGoalArchived = (id: string, archived: boolean) =>
    editConfig((c) => ({ ...c, goals: c.goals.map((g) => (g.id === id ? { ...g, archived } : g)) }));

  /** Swaps a goal with its neighbour and renumbers the ranks; archived goals go last. */
  const moveGoal = (id: string, dir: -1 | 1) =>
    editConfig((c) => {
      const order = activeGoals(c).map((g) => g.id);
      const i = order.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= order.length) return c;
      [order[i], order[j]] = [order[j], order[i]];
      const archived = c.goals.filter((g) => g.archived);
      return {
        ...c,
        goals: [
          ...order.map((gid, k) => ({ ...c.goals.find((g) => g.id === gid)!, rank: k + 1 })),
          ...archived.map((g, k) => ({ ...g, rank: order.length + k + 1 })),
        ],
      };
    });

  // --- settings ---

  async function connect(repo: string, token: string): Promise<void> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return alert("Repository must look like owner/name.");
    const settings = { repo, token };
    await store.setSettings(settings);
    // A phone without goals takes the repo's config instead of overwriting it.
    const { config } = dataRef.current;
    if (!config.goals.length) await store.setConfig(config, false);
    try {
      const n = await restore(store, new GitHub(settings));
      if (n) showToast(`Restored ${n} entries from the repo`);
    } catch (e) {
      alert(`Could not read the repo: ${e instanceof Error ? e.message : e}`);
    }
    await reload();
    await sync();
  }

  /** Downloads everything on this phone as one JSON file. */
  function exportAll(): void {
    const d = dataRef.current;
    const json = JSON.stringify(
      { exported_at: isoLocal(new Date()), config: d.config, logs: d.entries.map(toContract), running_timer: d.timer, plan: d.plan },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stoa-export-${localDate(new Date())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const syncOnOpen = useEffectEvent(() => void sync());

  useEffect(() => {
    checkStillGoing();
    syncOnOpen();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      checkStillGoing();
      refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timeout);
  }, [toast]);

  return {
    ...data,
    syncing,
    stopEnd,
    stillGoingOpen,
    toast,
    dismissToast: () => setToast(null),
    sync,
    startTimer,
    requestStop: () => setStopEnd(new Date()),
    cancelStop: () => setStopEnd(null),
    stopTimer,
    discardTimer,
    confirmStillGoing,
    endStillGoing,
    tapCounter,
    saveSession,
    deleteEntry,
    addHabit,
    setHabitGoal,
    setHabitArchived,
    addCounter,
    removeCounter,
    addGoal,
    setGoalArchived,
    moveGoal,
    connect,
    exportAll,
  };
}

export type Stoa = ReturnType<typeof useStoaState>;

const StoaContext = createContext<Stoa | null>(null);

export function StoaProvider({ store, initial, children }: { store: Store; initial: StoaData; children: ReactNode }) {
  return <StoaContext value={useStoaState(store, initial)}>{children}</StoaContext>;
}

export function useStoa(): Stoa {
  const stoa = useContext(StoaContext);
  if (!stoa) throw new Error("useStoa needs a StoaProvider");
  return stoa;
}
