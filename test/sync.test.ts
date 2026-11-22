import { describe, expect, it } from "vitest";
import { AuthError } from "../src/googleAuth";
import { dayOf } from "../src/logs";
import { SheetsApi, TABS, type Cell, type Tab } from "../src/sheets";
import { restore, rollUp, type SyncStore } from "../src/sync";
import type { Config, LogEntry, Plan, StoredEntry } from "../src/types";

/** Shows a stored cell the way Sheets returns formatted values: all text, booleans upper case. */
const shown = (c: Cell) => (typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : String(c));
const tabOf = (range: string) => /^'([^']+)'/.exec(range)![1];

/**
 * In-memory Drive and Sheets behind a fake fetch, speaking the few REST calls Stoa makes.
 * `data` fills an existing Stoa sheet (data rows; headers are added); without it the Drive is empty.
 */
function fakeGoogle(data?: Partial<Record<Tab, Cell[][]>>, failWrites = false) {
  const files: { id: string; appProperties: Record<string, string> }[] = [];
  const tabs = new Map<string, Cell[][]>();
  const calls: string[] = [];
  if (data) {
    files.push({ id: "sheet-1", appProperties: { stoa: "sheet" } });
    for (const t of Object.keys(TABS) as Tab[]) tabs.set(t, [[...TABS[t]], ...(data[t] ?? [])]);
  }

  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
    calls.push(`${method} ${u.pathname}`);
    if (!String((init?.headers as Record<string, string>)?.Authorization).startsWith("Bearer ")) return json(401, {});

    if (u.pathname === "/drive/v3/about") return json(200, { user: { emailAddress: "me@example.com" } });
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q")!;
      return json(200, { files: files.filter((f) => q.includes(`key='stoa' and value='${f.appProperties.stoa}'`)) });
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      expect(body.mimeType).toBe("application/vnd.google-apps.spreadsheet");
      files.push({ id: `sheet-${files.length + 1}`, appProperties: body.appProperties });
      tabs.set("Sheet1", []);
      return json(200, { id: files.at(-1)!.id });
    }

    const [, op] = /\/v4\/spreadsheets\/[^/:]+(.*)$/.exec(u.pathname)!;
    const writing = method === "POST" && op !== ":batchUpdate";
    if (writing && failWrites) return json(500, { error: { message: "backend error" } });
    if (op === "") {
      return json(200, { sheets: [...tabs.keys()].map((title, sheetId) => ({ properties: { sheetId, title } })) });
    }
    if (op === ":batchUpdate") {
      const names = [...tabs.keys()];
      for (const r of body.requests) {
        if (r.addSheet) tabs.set(r.addSheet.properties.title, []);
        if (r.deleteSheet) tabs.delete(names[r.deleteSheet.sheetId]);
      }
      return json(200, {});
    }
    if (op === "/values:batchGet") {
      const valueRanges = u.searchParams.getAll("ranges").map((r) => {
        const rows = (tabs.get(tabOf(r)) ?? []).map((row) => {
          const text = row.map(shown);
          while (text.length && text.at(-1) === "") text.pop();
          return text;
        });
        while (rows.length && !rows.at(-1)!.length) rows.pop();
        return { values: rows };
      });
      return json(200, { valueRanges });
    }
    if (op === "/values:batchUpdate") {
      expect(body.valueInputOption).toBe("RAW");
      for (const d of body.data) {
        expect(d.range).toMatch(/!A1$/);
        const rows = tabs.get(tabOf(d.range))!;
        d.values.forEach((row: Cell[], i: number) => (rows[i] = row));
      }
      return json(200, {});
    }
    if (op === "/values:batchClear") {
      for (const r of body.ranges) {
        const from = Number(/!A(\d+):Z$/.exec(r)![1]);
        tabs.get(tabOf(r))!.length = Math.min(tabs.get(tabOf(r))!.length, from - 1);
      }
      return json(200, {});
    }
    return json(404, { error: { message: "unknown call" } });
  }) as unknown as typeof fetch;

  const api = new SheetsApi(async () => "token", fetchFn);
  /** A tab's data rows as Sheets would show them. */
  const rows = (t: string) => (tabs.get(t) ?? []).slice(1).map((r) => r.map(shown));
  return { api, tabs, rows, calls, files };
}

function memStore(initial: Config, initialDirty = false) {
  let config = initial;
  let configDirty = initialDirty;
  let plan: Plan | null = null;
  const entries: StoredEntry[] = [];
  const dirty = new Set<string>();
  const store: SyncStore = {
    dirtyDays: async () => [...dirty],
    markDirty: async (d) => void dirty.add(d),
    unmarkDirty: async (d) => void dirty.delete(d),
    entriesForDay: async (d) => entries.filter((e) => e.day === d),
    getConfig: async () => config,
    isConfigDirty: async () => configDirty,
    setConfig: async (c, d) => {
      config = c;
      configDirty = d;
    },
    setPlan: async (p) => {
      plan = p;
    },
    hasEntries: async () => entries.length > 0,
    importEntries: async (es) => void entries.push(...es.map((e) => ({ ...e, day: dayOf(e) }))),
  };
  const add = (e: LogEntry, uid = "u1") => {
    entries.push({ ...e, uid, day: dayOf(e) });
    dirty.add(dayOf(e));
  };
  return { store, add, entries, dirty, plan: () => plan, config: () => config };
}

const empty: Config = { goals: [], habits: [], counters: [] };
const session: LogEntry = {
  type: "session",
  habit: "gym",
  task: "",
  start: "2026-11-22T09:00:00+01:00",
  end: "2026-11-22T10:00:00+01:00",
  note: "ok",
};
const sessionRow = ["u1", "2026-11-22", "session", "gym", "", "2026-11-22T09:00:00+01:00", "2026-11-22T10:00:00+01:00", "ok"];

describe("Stoa sheet", () => {
  it("is created with every tab and header row on first use, and found again later", async () => {
    const g = fakeGoogle();
    const id = await g.api.open();
    expect([...g.tabs.keys()].sort()).toEqual(Object.keys(TABS).sort());
    expect(g.tabs.get("logs")![0]).toEqual([...TABS.logs]);
    expect(await g.api.open()).toBe(id);
    expect(g.files).toHaveLength(1);
  });

  it("reports a refused token as a sign-in problem", async () => {
    const refusing = new SheetsApi(async () => "token", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(refusing.open()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("roll-up", () => {
  it("rewrites the rows of changed days, pulls config and reads today's plan", async () => {
    const g = fakeGoogle({
      goals: [["g", "G", 1, false]],
      plans: [
        ["2026-11-22", "gym", "Legs", 45],
        ["2026-11-23", "gym", "Arms", 30],
      ],
      plan_days: [["2026-11-22", 60, "Easy"]],
      logs: [
        ["old", "2026-11-22", "session", "gym", "", "2026-11-22T08:00:00+01:00", "2026-11-22T08:30:00+01:00", ""],
        ["keep", "2026-11-21", "counter", "", "", "2026-11-21T12:00:00+01:00", "", "", "apps", 1],
      ],
    });
    const m = memStore(empty);
    m.add(session);

    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");

    expect(r.errors).toEqual([]);
    expect(r.pushedDays).toEqual(["2026-11-22"]);
    expect(g.rows("logs")).toEqual([
      ["keep", "2026-11-21", "counter", "", "", "2026-11-21T12:00:00+01:00", "", "", "apps", "1"],
      [...sessionRow, "", ""],
    ]);
    expect(m.config()).toEqual({ goals: [{ id: "g", name: "G", rank: 1, archived: false }], habits: [], counters: [] });
    expect(m.plan()).toEqual({ date: "2026-11-22", time_budget_min: 60, items: [{ habit: "gym", task: "Legs", minutes: 45 }], note: "Easy" });
    expect(await m.store.dirtyDays()).toEqual([]);
  });

  it("writes nothing when the sheet already holds the day", async () => {
    const g = fakeGoogle({ logs: [sessionRow] });
    const m = memStore(empty);
    m.add(session);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.pushedDays).toEqual([]);
    expect(g.calls.filter((c) => c.includes("values:batchUpdate"))).toEqual([]);
  });

  it("pushes a config edited on the phone", async () => {
    const local: Config = { goals: [], habits: [{ id: "h", goal: "g", name: "H", archived: false }], counters: [] };
    const g = fakeGoogle({ habits: [["old", "g", "Old", true]] });
    const m = memStore(local, true);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.configPushed).toBe(true);
    expect(g.rows("habits")).toEqual([["h", "g", "H", "FALSE"]]);
    expect(await m.store.isConfigDirty()).toBe(false);
  });

  it("gives an empty sheet the phone's config instead of emptying the phone", async () => {
    const local: Config = { goals: [{ id: "g", name: "G", rank: 1, archived: false }], habits: [], counters: [{ id: "c", goal: "g", name: "C" }] };
    const g = fakeGoogle({});
    const m = memStore(local);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.configPushed).toBe(true);
    expect(m.config()).toEqual(local);
    expect(g.rows("goals")).toEqual([["g", "G", "1", "FALSE"]]);
    expect(g.rows("counters")).toEqual([["c", "g", "C"]]);
    expect(m.plan()).toBeNull();
  });

  it("keeps a day marked when the write fails", async () => {
    const g = fakeGoogle({}, true);
    const m = memStore(empty);
    m.add(session);
    const r = await rollUp(m.store, g.api, "sheet-1", "2026-11-22");
    expect(r.errors[0]).toContain("500 backend error");
    expect(await m.store.dirtyDays()).toEqual(["2026-11-22"]);
  });

  it("restores an empty phone from the logs tab, keeping row ids", async () => {
    const g = fakeGoogle({ logs: [sessionRow, ["", "2026-11-22", "counter", "", "", "2026-11-22T11:00:00+01:00", "", "", "apps", 2], ["x", "2026-11-22", "other"]] });
    const m = memStore(empty);
    const id = await g.api.open();
    expect(await restore(m.store, g.api, id)).toBe(2);
    expect(m.entries[0]).toMatchObject({ uid: "u1", habit: "gym", note: "ok", day: "2026-11-22" });
    expect(m.entries[1]).toMatchObject({ type: "counter", counter: "apps", at: "2026-11-22T11:00:00+01:00", delta: 2 });
    expect(m.entries[1].uid).toMatch(/\w{8}-/);
    expect(await restore(m.store, g.api, id)).toBe(0);
  });
});
