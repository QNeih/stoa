// App state and every action that changes it. Screens read and call these through useStoa().
import { createContext, useContext, useEffect, useEffectEvent, useReducer, useRef, useState, type ReactNode } from "react";
import type { Account, Store, SyncStatus } from "./db";
import type { PaletteKey } from "./palette";
import { AuthError, forgetToken, getAccessToken, loadGis, renewOnTap } from "./googleAuth";
import { toContract } from "./logs";
import type { OverlapFix } from "./overlap";
import { ApiError, SheetsApi } from "./sheets";
import { minutesSinceLastCheck, standingCheckByUid } from "./results";
import { restore, rollUp } from "./sync";
import { isoLocal, localDate, planDay, validateStart } from "./time";
import { addedItem, moveItem, switchTimer, timerSession, todayItems, withItems } from "./today";
import type { Config, Plan, PlanItem, RunningTimer, SessionEntry, StoredCheck, StoredEntry } from "./types";

/** After this long a reopened app asks whether the timer is still going. */
const STILL_GOING_MS = 4 * 3600_000;
const TOAST_MS = 4000;

/** Everything the screens show, as last read from the phone's store. */
export interface StoaData {
  config: Config;
  entries: StoredEntry[];
  checks: StoredCheck[];
  timer: RunningTimer | null;
  plan: Plan | null;
  /** The Google account to sync with; null when signed out. */
  account: Account | null;
  syncStatus: SyncStatus | null;
  /** Days, config and plan waiting to be written to the sheet. */
  pending: number;
}

export interface ToastMessage {
  text: string;
  undo?: () => void;
}

export async function loadData(store: Store): Promise<StoaData> {
  const [config, entries, checks, timer, plan, account, syncStatus, dirtyDays, configDirty, planDirty] = await Promise.all([
    store.getConfig(),
    store.allEntries(),
    store.allChecks(),
    store.getTimer(),
    store.getPlan(),
    store.getAccount(),
    store.getSyncStatus(),
    store.dirtyDays(),
    store.isConfigDirty(),
    store.isPlanDirty(),
  ]);
  return { config, entries, checks, timer, plan, account, syncStatus, pending: dirtyDays.length + (configDirty ? 1 : 0) + (planDirty ? 1 : 0) };
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
      const r = await rollUp(store, api, await openSheet(api), planDay(new Date()));
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
  async function startTimer(subGoal: string, task: string, startAt?: Date): Promise<string | null> {
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
    // One timer at a time: starting another ends the first as a session.
    const next = switchTimer(running, { subGoal, task }, start);
    if (next.session) await store.addEntry(next.session);
    await store.setTimer(next.timer);
    await reload();
    if (next.session) void sync();
    return null;
  }

  /** Moves the running timer's start and restarts the "still going?" count. Returns a message when not allowed. */
  async function setTimerStart(start: Date): Promise<string | null> {
    const t = dataRef.current.timer;
    if (!t) return null;
    const problem = validateStart(start, new Date(), latestSessionEnd(dataRef.current.entries));
    if (problem) return problem;
    await store.setTimer({ subGoal: t.subGoal, task: t.task, start: isoLocal(start) });
    await reload();
    return null;
  }

  /** Ends the running timer as a session at `end` (now by default); a note can be added later in Log. */
  async function pauseTimer(end = new Date()): Promise<void> {
    renewForTap();
    const running = dataRef.current.timer;
    if (!running) return;
    await store.addEntry(timerSession(running, end));
    await store.setTimer(null);
    await reload();
    void sync();
  }

  async function discardTimer(): Promise<void> {
    await store.setTimer(null);
    await reload();
  }

  const checkStillGoing = useEffectEvent(() => {
    const t = dataRef.current.timer;
    if (!t || stillGoingOpen) return;
    const since = new Date(t.checked ?? t.start).getTime();
    if (Date.now() - since >= STILL_GOING_MS) setStillGoingOpen(true);
  });

  async function confirmStillGoing(): Promise<void> {
    const t = dataRef.current.timer;
    if (t) await store.setTimer({ ...t, checked: isoLocal(new Date()) });
    await reload();
    setStillGoingOpen(false);
  }

  /** Answers "still going?" with an end time: the session is saved with it, capped at now. */
  async function endStillGoing(end: Date): Promise<void> {
    setStillGoingOpen(false);
    const now = new Date();
    await pauseTimer(end > now ? now : end);
  }

  // --- today's plan ---

  /**
   * Replaces today's plan items (a stale plan becomes today's) and marks the plan for the next roll-up.
   * The screen shows the new order at once, before the store has it, so a dropped card does not jump back.
   */
  async function writeTodayItems(items: PlanItem[]): Promise<void> {
    const plan = withItems(dataRef.current.plan, planDay(new Date()), items);
    dataRef.current = { ...dataRef.current, plan };
    setData(dataRef.current);
    await store.setPlan(plan, true);
    await reload();
  }

  /** Moves today's card at `from` to `to`, which rewrites the day's plan rows on the next roll-up. */
  async function moveTodayItem(from: number, to: number): Promise<void> {
    if (from === to) return;
    renewForTap();
    const items = todayItems(dataRef.current.plan, planDay(new Date()), dataRef.current.config, dataRef.current.checks);
    await writeTodayItems(moveItem(items, from, to));
    void sync();
  }

  /** Adds a sub-goal to today's list and starts its timer. */
  async function addAndStart(subGoal: string): Promise<void> {
    renewForTap();
    const items = todayItems(dataRef.current.plan, planDay(new Date()), dataRef.current.config, dataRef.current.checks);
    const item = addedItem(subGoal);
    await writeTodayItems([...items, item]);
    await startTimer(item.subGoal, item.task);
    void sync();
  }

  // --- log ---

  /** Saves a session; `others` rewrites or deletes the saved entries it overlapped (see overlap.ts). */
  async function saveSession(entry: SessionEntry, id?: number, others?: Pick<OverlapFix, "update" | "remove">): Promise<void> {
    renewForTap();
    for (const u of others?.update ?? []) await store.updateEntry(u.id, u.entry);
    for (const r of others?.remove ?? []) await store.deleteEntry(r);
    if (id !== undefined) await store.updateEntry(id, entry);
    else await store.addEntry(entry);
    await reload();
    void sync();
  }

  /** Deletes a session at once, with Undo in the toast putting the same entry back. */
  async function deleteEntry(id: number): Promise<void> {
    renewForTap();
    const old = await store.deleteEntry(id);
    await reload();
    if (old) showToast("Session deleted", () => void restoreEntry(old));
    void sync();
  }

  // --- results ---

  /**
   * Records a check of a manual result now, with an optional note and the sub-goal time since the last
   * check of any of its results (the running timer counts up to now). Each call adds its own check.
   */
  async function checkResult(resultId: string, note = ""): Promise<void> {
    renewForTap();
    const { config, checks, entries, timer } = dataRef.current;
    const result = config.results.find((r) => r.id === resultId);
    const subGoal = config.subGoals.find((h) => h.id === result?.subGoal);
    if (!result || result.type !== "manual" || !subGoal) return;
    const now = new Date();
    const day = localDate(now);
    const tracked = timer ? [...entries, timerSession(timer, now)] : entries;
    await store.addCheck({
      result: resultId,
      day,
      checked_at: isoLocal(now),
      note: note.trim(),
      minutes_since_last: minutesSinceLastCheck(config.results, subGoal, checks, tracked, now),
      removed_at: "",
    });
    await reload();
    void sync();
  }

  async function restoreEntry(e: StoredEntry): Promise<void> {
    await store.restoreEntry(e);
    await reload();
    void sync();
  }

  /** Undoes the check with row id `uid`: the check stays, with the time it was undone. */
  async function uncheckResult(uid: string): Promise<void> {
    renewForTap();
    const check = standingCheckByUid(dataRef.current.checks, uid);
    if (check?.id === undefined) return;
    await store.removeCheck(check.id, isoLocal(new Date()));
    await reload();
    void sync();
  }

  /** Sessions filed under the days `from` to `to` (inclusive), read a page at a time for the Log. */
  const loadEntries = (from: string, to: string) => store.entriesBetween(from, to);
  /** The latest day before `day` with a session, or null; the Log uses it to page further back. */
  const latestDayBefore = (day: string) => store.latestDayBefore(day);

  // --- config ---

  async function editConfig(change: (c: Config) => Config): Promise<void> {
    renewForTap();
    await store.setConfig(change(dataRef.current.config), true);
    await reload();
    void sync();
  }

  const setSubGoalArchived = (id: string, archived: boolean) =>
    editConfig((c) => ({ ...c, subGoals: c.subGoals.map((x) => (x.id === id ? { ...x, archived } : x)) }));
  const renameGoal = (id: string, name: string) =>
    editConfig((c) => ({ ...c, goals: c.goals.map((g) => (g.id === id ? { ...g, name } : g)) }));
  const setGoalColor = (id: string, color: PaletteKey) =>
    editConfig((c) => ({ ...c, goals: c.goals.map((g) => (g.id === id ? { ...g, color } : g)) }));
  const renameSubGoal = (id: string, name: string) =>
    editConfig((c) => ({ ...c, subGoals: c.subGoals.map((x) => (x.id === id ? { ...x, name } : x)) }));
  const setGoalArchived = (id: string, archived: boolean) =>
    editConfig((c) => ({ ...c, goals: c.goals.map((g) => (g.id === id ? { ...g, archived } : g)) }));

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
      const restored = await restore(store, api, sheetId);
      if (restored.entries || restored.checks) {
        showToast(`Restored ${restored.entries} entries and ${restored.checks} result checks from the sheet`);
      }
      // A phone that already had sessions writes all its days to the sheet.
      if (!restored.entries) await store.markAllDirty();
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
      {
        exported_at: isoLocal(new Date()),
        config: d.config,
        logs: d.entries.map(toContract),
        result_checks: d.checks.map(({ id: _, ...c }) => c),
        running_timer: d.timer,
        plan: d.plan,
      },
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
    stillGoingOpen,
    toast,
    dismissToast: () => setToast(null),
    sync: syncNow,
    startTimer,
    setTimerStart,
    pauseTimer: () => pauseTimer(),
    discardTimer,
    confirmStillGoing,
    endStillGoing,
    moveTodayItem,
    addAndStart,
    saveSession,
    deleteEntry,
    checkResult,
    uncheckResult,
    loadEntries,
    latestDayBefore,
    setSubGoalArchived,
    renameGoal,
    setGoalColor,
    setGoalArchived,
    renameSubGoal,
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
