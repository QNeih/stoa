// Roll-up: rewrite the `logs` rows of changed days, sync the config tabs, read today's plan.
import type { Config, LogEntry, Plan, StoredEntry } from "./types";
import {
  cellsText,
  configFromRows,
  configToRows,
  entryFromRow,
  entryToRow,
  logOrder,
  planFromRows,
  rowCells,
  type Cell,
  type SheetsApi,
  type Tables,
} from "./sheets";

export interface SyncStore {
  dirtyDays(): Promise<string[]>;
  markDirty(day: string): Promise<void>;
  unmarkDirty(day: string): Promise<void>;
  entriesForDay(day: string): Promise<StoredEntry[]>;
  getConfig(): Promise<Config>;
  isConfigDirty(): Promise<boolean>;
  setConfig(config: Config, dirty: boolean): Promise<void>;
  setPlan(plan: Plan | null): Promise<void>;
  hasEntries(): Promise<boolean>;
  importEntries(entries: (LogEntry & { uid: string })[]): Promise<void>;
}

export interface RollUpResult {
  pushedDays: string[];
  configPushed: boolean;
  plan: Plan | null;
  errors: string[];
}

const message = (e: unknown) => String(e instanceof Error ? e.message : e);
const same = (a: Cell[][], b: Cell[][]) => JSON.stringify(a.map(cellsText)) === JSON.stringify(b.map(cellsText));
const isEmpty = (c: Config) => !c.goals.length && !c.habits.length && !c.counters.length;

/** Replaces the rows of the dirty days with the phone's entries; returns the days whose rows changed. */
async function pushDays(store: SyncStore, api: SheetsApi, sheetId: string, remote: Tables["logs"]): Promise<string[]> {
  const days = await store.dirtyDays();
  if (!days.length) return [];
  // Unmark before reading so a change made during the push marks the day again.
  for (const day of days) await store.unmarkDirty(day);
  try {
    const kept: Cell[][] = [];
    const before = new Map<string, Cell[][]>();
    for (const row of remote) {
      const cells = rowCells("logs", row);
      if (days.includes(row.day?.trim())) before.set(row.day.trim(), [...(before.get(row.day.trim()) ?? []), cells]);
      else kept.push(cells);
    }
    const changed: string[] = [];
    const fresh: Cell[][] = [];
    for (const day of days) {
      const rows = (await store.entriesForDay(day)).map(entryToRow).sort(logOrder);
      if (!same(rows, (before.get(day) ?? []).sort(logOrder))) changed.push(day);
      fresh.push(...rows);
    }
    if (changed.length) await api.write(sheetId, { logs: [...kept, ...fresh].sort(logOrder) });
    return changed;
  } catch (e) {
    for (const day of days) await store.markDirty(day);
    throw e;
  }
}

/** Pushes a config edited on the phone, else takes the sheet's. An empty sheet never empties the phone. */
async function syncConfig(store: SyncStore, api: SheetsApi, sheetId: string, remote: Tables): Promise<boolean> {
  const local = await store.getConfig();
  const remoteConfig = configFromRows(remote);
  if (!(await store.isConfigDirty()) && !(isEmpty(remoteConfig) && !isEmpty(local))) {
    await store.setConfig(remoteConfig, false);
    return false;
  }
  await store.setConfig(local, false);
  try {
    const rows = configToRows(local);
    const changed = (["goals", "habits", "counters"] as const).filter(
      (t) => !same(rows[t], remote[t].map((r) => rowCells(t, r))),
    );
    if (!changed.length) return false;
    await api.write(sheetId, Object.fromEntries(changed.map((t) => [t, rows[t]])));
    return true;
  } catch (e) {
    await store.setConfig(local, true);
    throw e;
  }
}

export async function rollUp(store: SyncStore, api: SheetsApi, sheetId: string, today: string): Promise<RollUpResult> {
  const result: RollUpResult = { pushedDays: [], configPushed: false, plan: null, errors: [] };
  const remote = await api.read(sheetId, ["logs", "goals", "habits", "counters", "plans", "plan_days"]);

  try {
    result.pushedDays = await pushDays(store, api, sheetId, remote.logs);
  } catch (e) {
    result.errors.push(message(e));
  }

  try {
    result.configPushed = await syncConfig(store, api, sheetId, remote);
  } catch (e) {
    result.errors.push(message(e));
  }

  result.plan = planFromRows(remote, today);
  await store.setPlan(result.plan);
  return result;
}

/** Fills an empty phone from the sheet's `logs` tab (new install or cleared storage). Returns entries imported. */
export async function restore(store: SyncStore, api: SheetsApi, sheetId: string): Promise<number> {
  if (await store.hasEntries()) return 0;
  const { logs } = await api.read(sheetId, ["logs"]);
  const entries = logs.map(entryFromRow).filter((e) => e !== null);
  if (entries.length) await store.importEntries(entries);
  return entries.length;
}
