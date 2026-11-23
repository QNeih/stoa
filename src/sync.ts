// Roll-up: rewrite the `logs` and `result_checks` rows of changed days, sync the config tabs,
// read today's plan.
import type { Config, LogEntry, Plan, ResultCheck, StoredEntry } from "./types";
import {
  cellsText,
  checkFromRow,
  checkOrder,
  checkToRow,
  configFromRows,
  configToRows,
  entryFromRow,
  entryToRow,
  isSessionRow,
  logOrder,
  mergePlan,
  mergeResults,
  planFromRows,
  rowCells,
  type Cell,
  type Row,
  type SheetsApi,
  type Tab,
  type Tables,
} from "./sheets";

export interface SyncStore {
  /** Days whose sessions or result checks changed since the last roll-up. */
  dirtyDays(): Promise<string[]>;
  markDirty(day: string): Promise<void>;
  unmarkDirty(day: string): Promise<void>;
  entriesForDay(day: string): Promise<StoredEntry[]>;
  checksForDay(day: string): Promise<ResultCheck[]>;
  getConfig(): Promise<Config>;
  isConfigDirty(): Promise<boolean>;
  setConfig(config: Config, dirty: boolean): Promise<void>;
  getPlan(): Promise<Plan | null>;
  /** Whether the phone reordered or extended its plan since the last roll-up. */
  isPlanDirty(): Promise<boolean>;
  setPlan(plan: Plan | null, dirty: boolean): Promise<void>;
  hasEntries(): Promise<boolean>;
  importEntries(entries: (LogEntry & { uid: string })[]): Promise<void>;
  hasChecks(): Promise<boolean>;
  importChecks(checks: ResultCheck[]): Promise<void>;
}

export interface RollUpResult {
  pushedDays: string[];
  configPushed: boolean;
  plan: Plan | null;
  errors: string[];
}

const message = (e: unknown) => String(e instanceof Error ? e.message : e);
const same = (a: Cell[][], b: Cell[][]) => JSON.stringify(a.map(cellsText)) === JSON.stringify(b.map(cellsText));
const isEmpty = (c: Config) => !c.goals.length && !c.habits.length;

/** A tab whose rows the phone writes per day: the phone's copy of a changed day replaces the rows it owns. */
interface DayTab {
  tab: Extract<Tab, "logs" | "result_checks">;
  /** Rows the phone owns; others on the same day stay as they are. */
  owned(row: Row): boolean;
  rows(store: SyncStore, day: string): Promise<Cell[][]>;
  order(a: Cell[], b: Cell[]): number;
}

const DAY_TABS: DayTab[] = [
  // Old counter rows are not the phone's and stay.
  { tab: "logs", owned: isSessionRow, rows: async (s, d) => (await s.entriesForDay(d)).map(entryToRow), order: logOrder },
  { tab: "result_checks", owned: () => true, rows: async (s, d) => (await s.checksForDay(d)).map(checkToRow), order: checkOrder },
];

/**
 * Replaces the owned rows of the dirty days in `logs` and `result_checks` with the phone's copy,
 * writing only the tabs that changed. Returns the days whose rows changed.
 */
async function pushDays(store: SyncStore, api: SheetsApi, sheetId: string, remote: Pick<Tables, DayTab["tab"]>): Promise<string[]> {
  const days = await store.dirtyDays();
  if (!days.length) return [];
  // Unmark before reading so a change made during the push marks the day again.
  for (const day of days) await store.unmarkDirty(day);
  try {
    const changed = new Set<string>();
    const writes: Partial<Record<Tab, Cell[][]>> = {};
    for (const t of DAY_TABS) {
      const kept: Cell[][] = [];
      const before = new Map<string, Cell[][]>();
      for (const row of remote[t.tab]) {
        const cells = rowCells(t.tab, row);
        const day = row.day?.trim();
        if (days.includes(day) && t.owned(row)) before.set(day, [...(before.get(day) ?? []), cells]);
        else kept.push(cells);
      }
      const fresh: Cell[][] = [];
      let tabChanged = false;
      for (const day of days) {
        const rows = (await t.rows(store, day)).sort(t.order);
        if (!same(rows, (before.get(day) ?? []).sort(t.order))) {
          changed.add(day);
          tabChanged = true;
        }
        fresh.push(...rows);
      }
      if (tabChanged) writes[t.tab] = [...kept, ...fresh].sort(t.order);
    }
    if (Object.keys(writes).length) await api.write(sheetId, writes);
    return days.filter((d) => changed.has(d));
  } catch (e) {
    for (const day of days) await store.markDirty(day);
    throw e;
  }
}

/**
 * Pushes a config edited on the phone, else takes the sheet's. An empty sheet never empties the phone.
 * Goals and sub-goals are written as the phone has them. Results belong to the check-in: the phone's
 * names and archived flags go onto the sheet's rows, and the phone then takes the merged list.
 */
async function syncConfig(store: SyncStore, api: SheetsApi, sheetId: string, remote: Pick<Tables, "goals" | "habits" | "results">): Promise<boolean> {
  const local = await store.getConfig();
  const remoteConfig = configFromRows(remote);
  if (!(await store.isConfigDirty()) && !(isEmpty(remoteConfig) && !isEmpty(local))) {
    await store.setConfig(remoteConfig, false);
    return false;
  }
  await store.setConfig(local, false);
  try {
    const merged = mergeResults(remote.results, local.results);
    const rows = { ...configToRows(local), results: merged.rows };
    const changed = (["goals", "habits", "results"] as const).filter((t) => !same(rows[t], remote[t].map((r) => rowCells(t, r))));
    if (changed.length) await api.write(sheetId, Object.fromEntries(changed.map((t) => [t, rows[t]])));
    // An edit made during the push leaves the config dirty; the next roll-up merges it.
    if (!(await store.isConfigDirty())) await store.setConfig({ ...(await store.getConfig()), results: merged.results }, false);
    return changed.length > 0;
  } catch (e) {
    await store.setConfig(local, true);
    throw e;
  }
}

/**
 * Writes a plan reordered or extended on the phone into its date's `plans` rows. Returns the `plans`
 * rows as they now stand in the sheet. On failure the plan stays dirty.
 */
async function pushPlan(store: SyncStore, api: SheetsApi, sheetId: string, remote: Tables["plans"]): Promise<Tables["plans"]> {
  if (!(await store.isPlanDirty())) return remote;
  const plan = await store.getPlan();
  // Unmark before writing so an edit made during the push marks the plan again.
  await store.setPlan(plan, false);
  if (!plan) return remote;
  try {
    const rows = mergePlan(remote, plan);
    const cells = rows.map((r) => rowCells("plans", r));
    if (!same(cells, remote.map((r) => rowCells("plans", r)))) await api.write(sheetId, { plans: cells });
    return rows;
  } catch (e) {
    if (!(await store.isPlanDirty())) await store.setPlan(plan, true);
    throw e;
  }
}

export async function rollUp(store: SyncStore, api: SheetsApi, sheetId: string, today: string): Promise<RollUpResult> {
  const result: RollUpResult = { pushedDays: [], configPushed: false, plan: null, errors: [] };
  const remote = await api.read(sheetId, ["logs", "result_checks", "goals", "habits", "results", "plans"]);

  try {
    result.pushedDays = await pushDays(store, api, sheetId, remote);
  } catch (e) {
    result.errors.push(message(e));
  }

  try {
    result.configPushed = await syncConfig(store, api, sheetId, remote);
  } catch (e) {
    result.errors.push(message(e));
  }

  let plans = remote.plans;
  try {
    plans = await pushPlan(store, api, sheetId, remote.plans);
  } catch (e) {
    result.errors.push(message(e));
  }

  // A plan still waiting to be written (failed push, or edited meanwhile) stays as the phone has it.
  if (await store.isPlanDirty()) result.plan = await store.getPlan();
  else {
    result.plan = planFromRows(plans, today);
    await store.setPlan(result.plan, false);
  }
  return result;
}

export interface Restored {
  entries: number;
  checks: number;
}

/**
 * Fills an empty phone from the sheet (new install or cleared storage): sessions from `logs` when it
 * has none, result checks from `result_checks` when it has none. Returns how many of each it imported.
 */
export async function restore(store: SyncStore, api: SheetsApi, sheetId: string): Promise<Restored> {
  const out: Restored = { entries: 0, checks: 0 };
  const needEntries = !(await store.hasEntries());
  const needChecks = !(await store.hasChecks());
  if (!needEntries && !needChecks) return out;
  const remote = await api.read(sheetId, ["logs", "result_checks"]);
  if (needEntries) {
    const entries = remote.logs.map(entryFromRow).filter((e) => e !== null);
    if (entries.length) await store.importEntries(entries);
    out.entries = entries.length;
  }
  if (needChecks) {
    const checks = remote.result_checks.map(checkFromRow).filter((c) => c !== null);
    if (checks.length) await store.importChecks(checks);
    out.checks = checks.length;
  }
  return out;
}
