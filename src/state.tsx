// App state and every action that changes it. Screens read and call these through useStoa().
import { createContext, useContext, useEffect, useEffectEvent, useReducer, useRef, useState, type ReactNode } from "react";
import type { Account, Store, SyncStatus } from "./db";
import { activeGoals } from "./format";
import { AuthError, forgetToken, getAccessToken, loadGis, renewOnTap } from "./googleAuth";
import { slugify, toContract } from "./logs";
import { ApiError, SheetsApi } from "./sheets";
import { restore, rollUp } from "./sync";
import { isoLocal, localDate, validateStart } from "./time";
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
  /** The Google account to sync with; null when signed out. */
  account: Account | null;
  syncStatus: SyncStatus | null;
  /** Days plus config waiting to be written to the sheet. */
  pending: number;
}

export interface ToastMessage {
  text: string;
  undo?: () => void;
}

export async function loadData(store: Store): Promise<StoaData> {
  const [config, entries, timer, plan, account, syncStatus, dirtyDays, configDirty] = await Promise.all([
    store.getConfig(),
    store.allEntries(),
    store.getTimer(),
    store.getPlan(),
    store.getAccount(),
    store.getSyncStatus(),
    store.dirtyDays(),
    store.isConfigDirty(),
  ]);
  return { config, entries, timer, plan, account, syncStatus, pending: dirtyDays.length + (configDirty ? 1 : 0) };
}

/** Saves a timer as a session that ends at `end`, at least one minute long. */
async function saveTimerAsSession(store: Store, t: RunningTimer, end: Date, note: string): Promise<void> {
  const start = new Date(t.start);
  if (end <= start) end = new Date(start.getTime() + 60_000);
  await store.addEntry({ type: "session", habit: t.habit, task: t.task, start: t.start, end: isoLocal(end), note: note.trim() });
}

/** End of the latest saved session, or null when there is none. */
function latestSessionEnd(entries: StoredEntry[]): Date | null {
  let latest: Date | null = null;
  for (const e of entries) {
    if (e.type !== "session") continue;
    const end = new Date(e.end);
    if (!latest || end > latest) latest = end;
  }
  return latest;
}

export function useStoaState(store: Store, initial: StoaData) {
  const [data, setData] = useState(initial);
  // Async actions read the latest data from here, since their closure may predate a reload.
  const dataRef = useRef(initial);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  /** Signed in, but the token expired and could not be renewed without the user. */
  const [signInNeeded, setSignInNeeded] = useState(false);
  /** The spreadsheet id once found this session. */
  const sheetIdRef = useRef<string | null>(null);
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

  /** The Sheets API with a token that renews itself without the user, failing with AuthError. */
  function sheetsApi(email: string): SheetsApi {
    return new SheetsApi(() => getAccessToken({ interactive: false, hint: email }));
  }

  async function openSheet(api: SheetsApi): Promise<string> {
    sheetIdRef.current ??= await api.open();
    return sheetIdRef.current;
  }

  /** Roll-up to the sheet; quiet no-op when signed out. */
  async function sync(): Promise<void> {
    const account = dataRef.current.account;
    if (!account || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    let status: SyncStatus;
    try {
      const api = sheetsApi(account.email);
      const r = await rollUp(store, api, await openSheet(api), localDate(new Date()));
      status = r.errors.length
        ? { at: new Date().toISOString(), ok: false, message: r.errors[0] }
        : { at: new Date().toISOString(), ok: true, message: r.pushedDays.length ? `Wrote ${r.pushedDays.join(", ")}` : "Up to date" };
      setSignInNeeded(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof AuthError) {
        forgetToken();
        setSignInNeeded(true);
      } else if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        // The sheet was deleted or is no longer shared with Stoa; find or create it again next time.
        sheetIdRef.current = null;
      }
      status = {
        at: new Date().toISOString(),
        ok: false,
        message: e instanceof AuthError ? "Sign in again" : /fetch/i.test(msg) ? "Offline, will retry" : msg,
      };
    }
    await store.setSyncStatus(status);
    syncingRef.current = false;
    setSyncing(false);
    await reload();
  }

  /**
   * Renews the Google token from inside a tap, so the browser lets the renewal popup open.
   * Call it first in a tap handler, before any await. It never waits and never fails the action.
   */
  function renewForTap(): void {
    renewOnTap(dataRef.current.account?.email);
  }

  /** The Sync now button: renews the token in the tap, then syncs. */
  function syncNow(): Promise<void> {
    renewForTap();
    return sync();
  }

  // --- timer ---

  /**
   * Starts a timer, now or at `startAt` in the past. Returns a message when `startAt` is not allowed,
   * and null once the timer runs.
   */
  async function startTimer(habit: string, task: string, startAt?: Date): Promise<string | null> {
    renewForTap();
    const now = new Date();
    const start = startAt ?? now;
    const running = dataRef.current.timer;
    if (startAt) {
      // A running timer is stopped at the new start, so the new start must leave it a minute.
      const runningFloor = running ? new Date(new Date(running.start).getTime() + 60_000) : null;
      const saved = latestSessionEnd(dataRef.current.entries);
      const notBefore = runningFloor && (!saved || runningFloor > saved) ? runningFloor : saved;
      const problem = validateStart(startAt, now, notBefore);
      if (problem) return problem;
    }
    // One timer at a time: starting another stops the first.
    if (running) await saveTimerAsSession(store, running, start, "");
    await store.setTimer({ habit, task: task.trim(), start: isoLocal(start) });
    await reload();
    location.hash = "#/today";
    return null;
  }

  /** Moves the running timer's start and restarts the "still going?" count. Returns a message when not allowed. */
  async function setTimerStart(start: Date): Promise<string | null> {
    const t = dataRef.current.timer;
    if (!t) return null;
    const problem = validateStart(start, new Date(), latestSessionEnd(dataRef.current.entries));
    if (problem) return problem;
    await store.setTimer({ habit: t.habit, task: t.task, start: isoLocal(start) });
    await reload();
    return null;
  }

  async function stopTimer(note: string): Promise<void> {
    renewForTap();
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

  async function saveSession(entry: SessionEntry, id?: number): Promise<void> {
    renewForTap();
    if (id !== undefined) await store.updateEntry(id, entry);
    else await store.addEntry(entry);
    await reload();
    void sync();
  }

  async function deleteEntry(id: number): Promise<void> {
    await store.deleteEntry(id);
    await reload();
  }

  // --- config ---

  async function editConfig(change: (c: Config) => Config): Promise<void> {
    renewForTap();
    await store.setConfig(change(dataRef.current.config), true);
    await reload();
    void sync();
  }

  const newId = (c: Config, name: string) => slugify(name, [...c.goals, ...c.habits].map((x) => x.id));

  const addHabit = (name: string, goal: string) =>
    editConfig((c) => ({ ...c, habits: [...c.habits, { id: newId(c, name), goal, name, archived: false }] }));
  const setHabitGoal = (id: string, goal: string) =>
    editConfig((c) => ({ ...c, habits: c.habits.map((x) => (x.id === id ? { ...x, goal } : x)) }));
  const setHabitArchived = (id: string, archived: boolean) =>
    editConfig((c) => ({ ...c, habits: c.habits.map((x) => (x.id === id ? { ...x, archived } : x)) }));
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

  /**
   * Opens Google's popup (call it straight from a tap, or the browser blocks the popup), then finds or
   * creates the sheet. An empty phone restores from it; otherwise every day on the phone is written to it.
   */
  async function signIn(): Promise<void> {
    const hint = dataRef.current.account?.email;
    try {
      await getAccessToken({ interactive: true, hint });
      sheetIdRef.current = null;
      const api = new SheetsApi(() => getAccessToken({ interactive: false }));
      const email = await api.email();
      const sheetId = await openSheet(api);
      await store.setAccount({ email });
      setSignInNeeded(false);
      // A phone without goals takes the sheet's config instead of overwriting it.
      const { config } = dataRef.current;
      if (!config.goals.length) await store.setConfig(config, false);
      const n = await restore(store, api, sheetId);
      if (n) showToast(`Restored ${n} entries from the sheet`);
      else await store.markAllDirty();
    } catch (e) {
      alert(`Could not sign in: ${e instanceof Error ? e.message : e}`);
      return;
    } finally {
      await reload();
    }
    await sync();
  }

  /** Forgets the account and token; everything logged stays on the phone. */
  async function signOut(): Promise<void> {
    forgetToken();
    sheetIdRef.current = null;
    setSignInNeeded(false);
    await store.setAccount(null);
    await reload();
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
    // Loaded ahead so a tap can open the renewal popup without waiting for the script.
    loadGis().catch(() => undefined);
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
    signInNeeded,
    stopEnd,
    stillGoingOpen,
    toast,
    dismissToast: () => setToast(null),
    sync: syncNow,
    startTimer,
    setTimerStart,
    requestStop: () => setStopEnd(new Date()),
    cancelStop: () => setStopEnd(null),
    stopTimer,
    discardTimer,
    confirmStillGoing,
    endStillGoing,
    saveSession,
    deleteEntry,
    addHabit,
    setHabitGoal,
    setHabitArchived,
    addGoal,
    setGoalArchived,
    moveGoal,
    signIn,
    signOut,
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
