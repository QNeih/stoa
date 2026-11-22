// Phone storage in IndexedDB: log entries plus a key-value store for
// config, plan, running timer, the signed-in account and the days not yet rolled up.
// The Google access token is never stored here.
import type { Config, LogEntry, Plan, RunningTimer, StoredEntry } from "./types";
import type { SyncStore } from "./sync";
import { dayOf } from "./logs";
import { newUid } from "./sheets";

const DB_NAME = "stoa";
const ENTRIES = "entries";
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

const EMPTY_CONFIG: Config = { goals: [], habits: [], counters: [] };

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
    const open = indexedDB.open(DB_NAME, 2);
    open.onupgradeneeded = (event) => {
      const db = open.result;
      const tx = open.transaction!;
      if (event.oldVersion < 1) {
        db.createObjectStore(ENTRIES, { keyPath: "id", autoIncrement: true }).createIndex("day", "day");
        db.createObjectStore(KV);
      }
      if (event.oldVersion < 2) {
        // Version 2 syncs to a Google Sheet: every entry gets its row id, and the GitHub token goes.
        const cursor = tx.objectStore(ENTRIES).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          if (!c.value.uid) c.update({ ...c.value, uid: newUid() });
          c.continue();
        };
        tx.objectStore(KV).delete("settings");
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
  getConfig = () => this.kvGet<Config>("config", EMPTY_CONFIG);
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

  /** Marks every day with entries, so the next roll-up writes the phone's copy of all of them. */
  async markAllDirty(): Promise<void> {
    const days = new Set([...(await this.dirtyDays()), ...(await this.allEntries()).map((e) => e.day)]);
    await this.kvSet("dirtyDays", [...days].sort());
  }

  /** Bulk import from the sheet; these days are already in sync. */
  async importEntries(entries: (LogEntry & { uid: string })[]): Promise<void> {
    const tx = this.db.transaction(ENTRIES, "readwrite");
    for (const e of entries) tx.objectStore(ENTRIES).add({ ...e, day: dayOf(e) });
    await done(tx);
  }
}
