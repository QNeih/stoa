// Roll-up: push changed days to logs/, sync config.json, read today's plan.
import type { Config, LogEntry, Plan, StoredEntry } from "./types";
import { GitHubError, type GitHub } from "./github";
import { parseJsonl, toJsonl } from "./logs";

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
  importEntries(entries: LogEntry[]): Promise<void>;
}

export interface RollUpResult {
  pushedDays: string[];
  configPushed: boolean;
  plan: Plan | null;
  errors: string[];
}

const configText = (c: Config) => JSON.stringify(c, null, 2) + "\n";

async function putWithRetry(gh: GitHub, path: string, text: string, message: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    const remote = await gh.get(path);
    if (remote?.text === text) return false;
    try {
      await gh.put(path, text, remote?.sha, message);
      return true;
    } catch (e) {
      // 409/422: the file changed between read and write; read the new sha once more.
      const stale = e instanceof GitHubError && (e.status === 409 || e.status === 422);
      if (!stale || attempt > 0) throw e;
    }
  }
}

export async function rollUp(store: SyncStore, gh: GitHub, today: string): Promise<RollUpResult> {
  const result: RollUpResult = { pushedDays: [], configPushed: false, plan: null, errors: [] };

  // Unmark before reading so a change made during the push marks the day again.
  for (const day of await store.dirtyDays()) {
    await store.unmarkDirty(day);
    try {
      const text = toJsonl(await store.entriesForDay(day));
      if (await putWithRetry(gh, `logs/${day}.jsonl`, text, `log ${day}`)) result.pushedDays.push(day);
    } catch (e) {
      await store.markDirty(day);
      result.errors.push(String(e instanceof Error ? e.message : e));
    }
  }

  try {
    if (await store.isConfigDirty()) {
      const config = await store.getConfig();
      await store.setConfig(config, false);
      try {
        result.configPushed = await putWithRetry(gh, "config.json", configText(config), "config from app");
      } catch (e) {
        await store.setConfig(config, true);
        throw e;
      }
    } else {
      const remote = await gh.get("config.json");
      if (remote) await store.setConfig(JSON.parse(remote.text) as Config, false);
    }
  } catch (e) {
    result.errors.push(String(e instanceof Error ? e.message : e));
  }

  try {
    const plan = await gh.get(`plans/${today}.json`);
    result.plan = plan ? (JSON.parse(plan.text) as Plan) : null;
    await store.setPlan(result.plan);
  } catch (e) {
    result.errors.push(String(e instanceof Error ? e.message : e));
  }

  return result;
}

/** Fill an empty phone from the data repo (new install or cleared storage). Returns entries imported. */
export async function restore(store: SyncStore, gh: GitHub): Promise<number> {
  if (await store.hasEntries()) return 0;
  const files = (await gh.list("logs")).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  const entries: LogEntry[] = [];
  for (const name of files) {
    const file = await gh.get(`logs/${name}`);
    if (file) entries.push(...parseJsonl(file.text));
  }
  if (entries.length) await store.importEntries(entries);
  return entries.length;
}
