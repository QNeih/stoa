// Phone storage in IndexedDB: log entries, result checks, and a key-value store for
// config, plan, running timer, the signed-in account and the days not yet rolled up.
// The Google access token is never stored here.
import type { Config, LogEntry, Plan, ResultCheck, RunningTimer, StoredCheck, StoredEntry } from "./types";
import { isPaletteKey } from "./palette";
import type { SyncStore } from "./sync";
import { dayOf } from "./logs";
import { newUid } from "./sheets";

const DB_NAME = "stoa";
const ENTRIES = "entries";
const CHECKS = "checks";
const KV = "kv";

/** The Google account the phone syncs with; the token stays in memory (googleAuth.ts). */
export interface Account {
  email: string;
}

export interface SyncStatus {
  at: string;
  ok: boolean;
  message: string;
}

/** A config as stored by any app version, with fields older versions lacked filled in. */
function normalizeConfig(c: Partial<Config> | undefined): Config {
  return {
    goals: (c?.goals ?? []).map((g) => ({ ...g, color: g.color && isPaletteKey(g.color) ? g.color : "" })),
    subGoals: (c?.subGoals ?? []).map((h) => ({ ...h, created: h.created ?? "" })),
    results: c?.results ?? [],
  };
}

/** Renames `habit` to `subGoal` on a value stored before version 4, when sub-goals were habits. */
function renamed<T extends object>(v: T): T {
  if (!v || !("habit" in v)) return v;
  const { habit, ...rest } = v as T & { habit: string };
  return { ...rest, subGoal: habit } as T;
}

/**
 * The config, plan and timer stored before version 4, with `habits` as `subGoals` and every
 * `habit` field as `subGoal`.
 */
function migrateKv(key: string, v: any): unknown {
  if (!v) return v;
  if (key === "config") {
    const { habits, ...rest } = v;
    return { ...rest, subGoals: rest.subGoals ?? habits ?? [], results: (v.results ?? []).map(renamed) };
  }
  if (key === "plan") return { ...v, items: (v.items ?? []).map(renamed) };
  if (key === "timer") return renamed(v);
  return v;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class Store implements SyncStore {
  private constructor(private db: IDBDatabase) {}

  static async open(): Promise<Store> {
    const open = indexedDB.open(DB_NAME, 4);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction!;
      if (event.oldVersion < 1) {
        db.createObjectStore(ENTRIES, { keyPath: "id", autoIncrement: true }).createIndex("day", "day");
        db.createObjectStore(KV);
      }
      // Version 2 syncs to a Google Sheet, so the GitHub token goes.
      if (event.oldVersion < 2) tx.objectStore(KV).delete("settings");
      if (event.oldVersion < 3) db.createObjectStore(CHECKS, { keyPath: "id", autoIncrement: true }).createIndex("day", "day");
      if (event.oldVersion >= 1 && event.oldVersion < 4) {
        // Every entry gets its row id (version 2); counter taps are retired and go (version 3);
        // taps already in the sheet stay there. Sub-goals were habits until version 4: stored entries,
        // config, plan and timer get the new names.
        const entries = tx.objectStore(ENTRIES).openCursor();
        entries.onsuccess = () => {
          const c = entries.result;
          if (!c) return;
          if (c.value.type !== "session") c.delete();
          else if (!c.value.uid || "habit" in c.value) c.update(renamed({ ...c.value, uid: c.value.uid || newUid() }));
          c.continue();
        };
        const kv = tx.objectStore(KV);
        for (const key of ["config", "plan", "timer"]) {
          const get = kv.get(key);
          get.onsuccess = () => {
            if (get.result !== undefined) kv.put(migrateKv(key, get.result), key);
          };
        }
      }
    };
    const store = new Store(await req(open));
    // Ask the browser not to evict data under storage pressure.
    navigator.storage?.persist?.().catch(() => undefined);
    return store;
  }

  // --- key-value ---

  private async kvGet<T>(key: string, fallback: T): Promise<T> {
    const v = await req(this.db.transaction(KV).objectStore(KV).get(key));
    return v === undefined ? fallback : (v as T);
  }

  private async kvSet(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(KV, "readwrite");
    if (value === undefined || value === null) tx.objectStore(KV).delete(key);
    else tx.objectStore(KV).put(value, key);
    await done(tx);
  }

  getAccount = () => this.kvGet<Account | null>("account", null);
  setAccount = (a: Account | null) => this.kvSet("account", a);
  getTimer = () => this.kvGet<RunningTimer | null>("timer", null);
  setTimer = (t: RunningTimer | null) => this.kvSet("timer", t);
  /** The stored plan; one stored before time planning was dropped still carries minutes, a budget and a note, which are left out. */
  async getPlan(): Promise<Plan | null> {
    const p = await this.kvGet<Plan | null>("plan", null);
    return p && { date: p.date, items: p.items.map((i) => ({ subGoal: i.subGoal, task: i.task })) };
  }
  isPlanDirty = () => this.kvGet<boolean>("planDirty", false);

  /** Stores the plan; `dirty` when the phone changed it (reorder, an added sub-goal), so a roll-up writes it. */
  async setPlan(p: Plan | null, dirty = false): Promise<void> {
    await this.kvSet("plan", p);
    await this.kvSet("planDirty", dirty);
  }

  getSyncStatus = () => this.kvGet<SyncStatus | null>("syncStatus", null);
  setSyncStatus = (s: SyncStatus) => this.kvSet("syncStatus", s);
  getConfig = async () => normalizeConfig(await this.kvGet<Partial<Config> | undefined>("config", undefined));
  isConfigDirty = () => this.kvGet<boolean>("configDirty", false);

  async setConfig(config: Config, dirty: boolean): Promise<void> {
    await this.kvSet("config", config);
    await this.kvSet("configDirty", dirty);
  }

  dirtyDays = () => this.kvGet<string[]>("dirtyDays", []);

  async markDirty(day: string): Promise<void> {
    const days = new Set(await this.dirtyDays());
    days.add(day);
    await this.kvSet("dirtyDays", [...days].sort());
  }

  async unmarkDirty(day: string): Promise<void> {
    await this.kvSet("dirtyDays", (await this.dirtyDays()).filter((d) => d !== day));
  }

  // --- entries ---

  async allEntries(): Promise<StoredEntry[]> {
    return req(this.db.transaction(ENTRIES).objectStore(ENTRIES).getAll());
  }

  async entriesForDay(day: string): Promise<StoredEntry[]> {
    return req(this.db.transaction(ENTRIES).objectStore(ENTRIES).index("day").getAll(day));
  }

  /** Entries filed under the days from `from` to `to`, both included (YYYY-MM-DD). */
  async entriesBetween(from: string, to: string): Promise<StoredEntry[]> {
    return req(this.db.transaction(ENTRIES).objectStore(ENTRIES).index("day").getAll(IDBKeyRange.bound(from, to)));
  }

  /** The latest day before `day` that has an entry, or null when there is none. */
  async latestDayBefore(day: string): Promise<string | null> {
    const index = this.db.transaction(ENTRIES).objectStore(ENTRIES).index("day");
    const cursor = await req(index.openKeyCursor(IDBKeyRange.upperBound(day, true), "prev"));
    return cursor ? String(cursor.key) : null;
  }

  async hasEntries(): Promise<boolean> {
    return (await req(this.db.transaction(ENTRIES).objectStore(ENTRIES).count())) > 0;
  }

  async addEntry(e: LogEntry): Promise<void> {
    const day = dayOf(e);
    const tx = this.db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).add({ ...e, day, uid: newUid() });
    await done(tx);
    await this.markDirty(day);
  }

  async updateEntry(id: number, e: LogEntry): Promise<void> {
    const store = this.db.transaction(ENTRIES).objectStore(ENTRIES);
    const old = (await req(store.get(id))) as StoredEntry | undefined;
    const day = dayOf(e);
    const tx = this.db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).put({ ...e, day, id, uid: old?.uid ?? newUid() });
    await done(tx);
    if (old) await this.markDirty(old.day);
    await this.markDirty(day);
  }

  /** Deletes an entry and returns it, so it can be restored. */
  async deleteEntry(id: number): Promise<StoredEntry | undefined> {
    const old = (await req(this.db.transaction(ENTRIES).objectStore(ENTRIES).get(id))) as StoredEntry | undefined;
    const tx = this.db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).delete(id);
    await done(tx);
    if (old) await this.markDirty(old.day);
    return old;
  }

  /** Puts a deleted entry back as it was: same storage key, row id and day. */
  async restoreEntry(e: StoredEntry): Promise<void> {
    const tx = this.db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).put(e);
    await done(tx);
    await this.markDirty(e.day);
  }

  /** Marks every day with entries or checks, so the next roll-up writes the phone's copy of all of them. */
  async markAllDirty(): Promise<void> {
    const days = new Set([
      ...(await this.dirtyDays()),
      ...(await this.allEntries()).map((e) => e.day),
      ...(await this.allChecks()).map((c) => c.day),
    ]);
    await this.kvSet("dirtyDays", [...days].sort());
  }

  /** Bulk import from the sheet; these days are already in sync. */
  async importEntries(entries: (LogEntry & { uid: string })[]): Promise<void> {
    const tx = this.db.transaction(ENTRIES, "readwrite");
    for (const e of entries) tx.objectStore(ENTRIES).add({ ...e, day: dayOf(e) });
    await done(tx);
  }

  // --- result checks ---

  async allChecks(): Promise<StoredCheck[]> {
    return req(this.db.transaction(CHECKS).objectStore(CHECKS).getAll());
  }

  async checksForDay(day: string): Promise<StoredCheck[]> {
    return req(this.db.transaction(CHECKS).objectStore(CHECKS).index("day").getAll(day));
  }

  async hasChecks(): Promise<boolean> {
    return (await req(this.db.transaction(CHECKS).objectStore(CHECKS).count())) > 0;
  }

  /** Stores a check of a manual result with a new row id. */
  async addCheck(c: Omit<ResultCheck, "uid">): Promise<void> {
    const tx = this.db.transaction(CHECKS, "readwrite");
    tx.objectStore(CHECKS).add({ ...c, uid: newUid() });
    await done(tx);
    await this.markDirty(c.day);
  }

  /** Undoes a check: it stays, with the time it was undone. */
  async removeCheck(id: number, at: string): Promise<void> {
    const old = (await req(this.db.transaction(CHECKS).objectStore(CHECKS).get(id))) as StoredCheck | undefined;
    if (!old || old.removed_at) return;
    const tx = this.db.transaction(CHECKS, "readwrite");
    tx.objectStore(CHECKS).put({ ...old, removed_at: at });
    await done(tx);
    await this.markDirty(old.day);
  }

  /** Bulk import from the sheet; these days are already in sync. */
  async importChecks(checks: ResultCheck[]): Promise<void> {
    const tx = this.db.transaction(CHECKS, "readwrite");
    for (const c of checks) tx.objectStore(CHECKS).add(c);
    await done(tx);
  }
}
