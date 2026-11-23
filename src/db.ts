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
    habits: (c?.habits ?? []).map((h) => ({ ...h, created: h.created ?? "" })),
    results: c?.results ?? [],
  };
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
    const open = indexedDB.open(DB_NAME, 3);
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
      if (event.oldVersion >= 1 && event.oldVersion < 3) {
        // Every entry gets its row id (version 2); counter taps are retired and go (version 3).
        // Taps already in the sheet stay there.
        const cursor = tx.objectStore(ENTRIES).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (c.value.type !== "session") c.delete();
          else if (!c.value.uid) c.update({ ...c.value, uid: newUid() });
          c.continue();
        };
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
  getPlan = () => this.kvGet<Plan | null>("plan", null);
  setPlan = (p: Plan | null) => this.kvSet("plan", p);
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

  async deleteEntry(id: number): Promise<void> {
    const old = (await req(this.db.transaction(ENTRIES).objectStore(ENTRIES).get(id))) as StoredEntry | undefined;
    const tx = this.db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).delete(id);
    await done(tx);
    if (old) await this.markDirty(old.day);
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
