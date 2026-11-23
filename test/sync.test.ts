import { describe, expect, it } from "vitest";
import { AuthError } from "../src/googleAuth";
import { dayOf } from "../src/logs";
import { SheetsApi, TABS, configFromRows, type Cell, type Tab } from "../src/sheets";
import { restore, rollUp, type SyncStore } from "../src/sync";
import type { Config, LogEntry, Plan, ResultCheck, StoredEntry } from "../src/types";

/** Shows a stored cell the way Sheets returns formatted values: all text, booleans upper case. */
const shown = (c: Cell) => (typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : String(c));
const tabOf = (range: string) => /^'([^']+)'/.exec(range)![1];

/**
 * In-memory Drive and Sheets behind a fake fetch, speaking the few REST calls Stoa makes.
 * `data` fills an existing Stoa sheet (data rows; headers are added); without it the Drive is empty.
 */
function fakeGoogle(data?: Partial<Record<Tab, Cell[][]>>, failWrites = false, failBatchUpdates = 0) {
  const files: { id: string; appProperties: Record<string, string> }[] = [];
  const tabs = new Map<string, Cell[][]>();
  const calls: string[] = [];
  /** Tabs written by values:batchUpdate, in call order. */
  const written: string[] = [];
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
      if (failBatchUpdates-- > 0) return json(500, { error: { message: "backend error" } });
      const names = [...tabs.keys()];
      for (const r of body.requests) {
        if (r.addSheet) tabs.set(r.addSheet.properties.title, []);
        if (r.deleteSheet) tabs.delete(names[r.deleteSheet.sheetId]);
      }
      return json(200, {});
    }
    if (op === "/values:batchGet") {
      const valueRanges = u.searchParams.getAll("ranges").map((r) => {
        const all = tabs.get(tabOf(r)) ?? [];
        const rows = (r.endsWith("!1:1") ? all.slice(0, 1) : all).map((row) => {
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
        // Writes start in row 1, at column A or (for header columns) further right.
        const col = /!([A-Z]+)1$/.exec(d.range)![1];
        const from = [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const rows = tabs.get(tabOf(d.range))!;
        written.push(tabOf(d.range));
        d.values.forEach((row: Cell[], i: number) => {
          rows[i] = [...Array.from({ length: from }, (_, j) => rows[i]?.[j] ?? ""), ...row];
        });
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
  return { api, tabs, rows, calls, files, written };
}

function memStore(initial: Config, initialDirty = false) {
  let config = initial;
  let configDirty = initialDirty;
  let plan: Plan | null = null;
  let planDirty = false;
  const entries: StoredEntry[] = [];
  const checks: ResultCheck[] = [];
  const dirty = new Set<string>();
  const store: SyncStore = {
    dirtyDays: async () => [...dirty],
    markDirty: async (d) => void dirty.add(d),
    unmarkDirty: async (d) => void dirty.delete(d),
    entriesForDay: async (d) => entries.filter((e) => e.day === d),
    checksForDay: async (d) => checks.filter((c) => c.day === d),
    getConfig: async () => config,
    isConfigDirty: async () => configDirty,
    setConfig: async (c, d) => {
      config = c;
      configDirty = d;
    },
    getPlan: async () => plan,
    isPlanDirty: async () => planDirty,
    setPlan: async (p, d) => {
      plan = p;
      planDirty = d;
    },
    hasEntries: async () => entries.length > 0,
    importEntries: async (es) => void entries.push(...es.map((e) => ({ ...e, day: dayOf(e) }))),
    hasChecks: async () => checks.length > 0,
    importChecks: async (cs) => void checks.push(...cs),
  };
  const add = (e: LogEntry, uid = "u1") => {
    entries.push({ ...e, uid, day: dayOf(e) });
    dirty.add(dayOf(e));
  };
  const addCheck = (c: ResultCheck) => {
    checks.push(c);
    dirty.add(c.day);
  };
  const uncheck = (uid: string, at: string) => {
    const c = checks.find((x) => x.uid === uid)!;
    c.removed_at = at;
    dirty.add(c.day);
  };
  /** A plan the phone reordered or extended. */
  const editPlan = (p: Plan) => {
    plan = p;
    planDirty = true;
  };
  return { store, add, addCheck, uncheck, editPlan, entries, checks, dirty, plan: () => plan, config: () => config };
}

const empty: Config = { goals: [], habits: [], results: [] };
const session: LogEntry = {
  type: "session",
  habit: "gym",
  task: "",
  start: "2026-11-22T09:00:00+01:00",
  end: "2026-11-22T10:00:00+01:00",
  note: "ok",
};
const sessionRow = ["u1", "2026-11-22", "session", "gym", "", "2026-11-22T09:00:00+01:00", "2026-11-22T10:00:00+01:00", "ok"];
const check: ResultCheck = {
  uid: "c1",
  result: "r1",
  day: "2026-11-22",
  checked_at: "2026-11-22T20:00:00+01:00",
  note: "first 5k",
  minutes_since_last: 90,
  removed_at: "",
};
const checkRow = ["c1", "r1", "2026-11-22", "2026-11-22T20:00:00+01:00", "first 5k", "90", ""];

describe("Stoa sheet", () => {
  it("is created with every tab and header row on first use, and found again later", async () => {
    const g = fakeGoogle();
    const id = await g.api.open();
    expect([...g.tabs.keys()].sort()).toEqual(Object.keys(TABS).sort());
    expect(g.tabs.get("logs")![0]).toEqual([...TABS.logs]);
    expect(await g.api.open()).toBe(id);
    expect(g.files).toHaveLength(1);
  });

  it("leaves a new sheet with only the Stoa tabs, not Google's default tab", async () => {
    const g = fakeGoogle();
    await g.api.open();
    expect([...g.tabs.keys()]).not.toContain("Sheet1");
    expect([...g.tabs.keys()].sort()).toEqual(Object.keys(TABS).sort());
  });

  it("still removes the default tab when the first setup failed and a later open finishes it", async () => {
    const g = fakeGoogle(undefined, false, 1);
    await expect(g.api.open()).rejects.toThrow();
    expect([...g.tabs.keys()]).toEqual(["Sheet1"]);
    await g.api.open();
    expect([...g.tabs.keys()].sort()).toEqual(Object.keys(TABS).sort());
    expect(g.files).toHaveLength(1);
  });

  it("never deletes tabs from an existing sheet", async () => {
    const g = fakeGoogle({});
    g.tabs.set("Notes", [["mine"]]);
    g.tabs.delete("plans");
    await g.api.open();
    expect(g.tabs.has("Notes")).toBe(true);
    expect(g.tabs.has("plans")).toBe(true);
  });

  it("appends columns added since to the header rows of an older sheet, keeping its rows", async () => {
    const g = fakeGoogle({});
    g.tabs.set("goals", [["id", "name", "rank", "archived"], ["g", "G", 1, false]]);
    g.tabs.set("habits", [["id", "goal", "name", "archived", "mine"], ["h", "g", "H", false, "x"]]);
    await g.api.open();
    expect(g.tabs.get("goals")).toEqual([[...TABS.goals], ["g", "G", 1, false]]);
    expect(g.tabs.get("habits")).toEqual([["id", "goal", "name", "archived", "mine", "created"], ["h", "g", "H", false, "x"]]);
    const { goals, habits } = await g.api.read("sheet-1", ["goals", "habits"]);
    expect(configFromRows({ goals, habits, results: [] })).toEqual({
      goals: [{ id: "g", name: "G", rank: 1, archived: false, color: "" }],
      habits: [{ id: "h", goal: "g", name: "H", archived: false, created: "" }],
      results: [],
    });
  });

  it("writes no header cells when every tab is up to date", async () => {
    const g = fakeGoogle({});
    await g.api.open();
    expect(g.calls.filter((c) => c.includes("values:batchUpdate"))).toEqual([]);
  });

  it("reports a refused token as a sign-in problem", async () => {
    const refusing = new SheetsApi(async () => "token", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    await expect(refusing.open()).rejects.toBeInstanceOf(AuthError);
  });
});

describe("roll-up", () => {
  it("rewrites the session rows of changed days, keeps old counter rows, pulls config and reads today's plan", async () => {
    const g = fakeGoogle({
      goals: [["g", "G", 1, false, "sky"]],
      habits: [["gym", "g", "Gym", false, "2026-11-01"], ["old", "g", "Old", true, ""], ["bad", "g", "Bad", false, "soon"]],
      plans: [
        ["2026-11-22", "gym", "Legs", 45],
        ["2026-11-23", "gym", "Arms", 30],
      ],
      plan_days: [["2026-11-22", 60, "Easy"]],
      logs: [
        ["old", "2026-11-22", "session", "gym", "", "2026-11-22T08:00:00+01:00", "2026-11-22T08:30:00+01:00", ""],
        ["keep", "2026-11-21", "counter", "", "", "2026-11-21T12:00:00+01:00", "", "", "apps", 1],
        ["tap", "2026-11-22", "counter", "", "", "2026-11-22T12:00:00+01:00", "", "", "apps", 1],
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
      ["tap", "2026-11-22", "counter", "", "", "2026-11-22T12:00:00+01:00", "", "", "apps", "1"],
    ]);
    expect(m.config()).toEqual({
      goals: [{ id: "g", name: "G", rank: 1, archived: false, color: "sky" }],
      habits: [
        { id: "gym", goal: "g", name: "Gym", archived: false, created: "2026-11-01" },
        { id: "old", goal: "g", name: "Old", archived: true, created: "" },
        { id: "bad", goal: "g", name: "Bad", archived: false, created: "" },
      ],
      results: [],
    });
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
    const local: Config = { goals: [], habits: [{ id: "h", goal: "g", name: "H", archived: false, created: "2026-11-20" }], results: [] };
    const g = fakeGoogle({ habits: [["old", "g", "Old", true, ""]] });
    const m = memStore(local, true);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.configPushed).toBe(true);
    expect(g.rows("habits")).toEqual([["h", "g", "H", "FALSE", "2026-11-20"]]);
    expect(await m.store.isConfigDirty()).toBe(false);
  });

  it("gives an empty sheet the phone's config instead of emptying the phone", async () => {
    const local: Config = { goals: [{ id: "g", name: "G", rank: 1, archived: false, color: "mint" }], habits: [], results: [] };
    const g = fakeGoogle({});
    const m = memStore(local);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.configPushed).toBe(true);
    expect(m.config()).toEqual(local);
    expect(g.rows("goals")).toEqual([["g", "G", "1", "FALSE", "mint"]]);
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

  it("restores an empty phone from the sessions in the logs tab, keeping row ids and skipping counter rows", async () => {
    const noId = ["", ...sessionRow.slice(1, 3), "read", ...sessionRow.slice(4)];
    const g = fakeGoogle({ logs: [sessionRow, ["", "2026-11-22", "counter", "", "", "2026-11-22T11:00:00+01:00", "", "", "apps", 2], noId, ["x", "2026-11-22", "other"]] });
    const m = memStore(empty);
    const id = await g.api.open();
    expect(await restore(m.store, g.api, id)).toEqual({ entries: 2, checks: 0 });
    expect(m.entries[0]).toMatchObject({ uid: "u1", habit: "gym", note: "ok", day: "2026-11-22" });
    expect(m.entries[1]).toMatchObject({ habit: "read" });
    expect(m.entries[1].uid).toMatch(/\w{8}-/);
    expect(await restore(m.store, g.api, id)).toEqual({ entries: 0, checks: 0 });
  });

  it("restores result checks to a phone without any, even when it has sessions", async () => {
    const g = fakeGoogle({ logs: [sessionRow], result_checks: [checkRow, ["", "", "2026-11-22"], ["", "r2", "2026-11-23", "", "", "", ""]] });
    const m = memStore(empty);
    m.add(session);
    const id = await g.api.open();
    expect(await restore(m.store, g.api, id)).toEqual({ entries: 0, checks: 2 });
    expect(m.checks[0]).toEqual(check);
    expect(m.checks[1]).toMatchObject({ result: "r2", day: "2026-11-23", minutes_since_last: 0, removed_at: "" });
    expect(m.checks[1].uid).toMatch(/\w{8}-/);
    expect(m.entries).toHaveLength(1);
  });
});

describe("result checks", () => {
  it("writes a checked result into its day's rows, and an uncheck keeps the row with its time", async () => {
    const g = fakeGoogle({ result_checks: [["c0", "r9", "2026-11-20", "2026-11-20T08:00:00+01:00", "", 15, ""]] });
    const m = memStore(empty);
    m.addCheck({ ...check });

    let r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.errors).toEqual([]);
    expect(r.pushedDays).toEqual(["2026-11-22"]);
    expect(g.rows("result_checks")).toEqual([["c0", "r9", "2026-11-20", "2026-11-20T08:00:00+01:00", "", "15", ""], checkRow]);
    expect(g.rows("logs")).toEqual([]);

    m.uncheck("c1", "2026-11-22T21:00:00+01:00");
    r = await rollUp(m.store, g.api, "sheet-1", "2026-11-22");
    expect(r.pushedDays).toEqual(["2026-11-22"]);
    expect(g.rows("result_checks")).toEqual([
      ["c0", "r9", "2026-11-20", "2026-11-20T08:00:00+01:00", "", "15", ""],
      [...checkRow.slice(0, 6), "2026-11-22T21:00:00+01:00"],
    ]);
  });

  it("writes only the tab that changed", async () => {
    const g = fakeGoogle({ logs: [sessionRow] });
    const m = memStore(empty);
    m.add(session);
    m.addCheck({ ...check });
    await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(g.written).toEqual(["result_checks"]);
    expect(g.rows("result_checks")).toEqual([checkRow]);
    expect(await m.store.dirtyDays()).toEqual([]);
  });
});

describe("plan edits", () => {
  const plans = [
    ["2026-11-21", "gym", "Arms", 30],
    ["2026-11-22", "gym", "Legs", 45],
    ["2026-11-22", "read", "", 30],
    ["2026-11-23", "gym", "Back", 20],
  ];
  const edited: Plan = {
    date: "2026-11-22",
    time_budget_min: 60,
    note: "",
    items: [
      { habit: "read", task: "", minutes: 30 },
      { habit: "gym", task: "Legs", minutes: 45 },
      { habit: "walk", task: "", minutes: 0 },
    ],
  };

  it("rewrite the day's rows in card order, with an out-of-plan sub-goal at 0 minutes, keeping other days", async () => {
    const g = fakeGoogle({ plans, plan_days: [["2026-11-22", 60, ""]] });
    const m = memStore(empty);
    m.editPlan(edited);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.errors).toEqual([]);
    expect(g.tabs.get("plans")!.slice(1)).toEqual([
      ["2026-11-21", "gym", "Arms", 30],
      ["2026-11-22", "read", "", 30],
      ["2026-11-22", "gym", "Legs", 45],
      ["2026-11-22", "walk", "", 0],
      ["2026-11-23", "gym", "Back", 20],
    ]);
    expect(r.plan).toEqual(edited);
    expect(m.plan()).toEqual(edited);
    expect(await m.store.isPlanDirty()).toBe(false);
  });

  it("are appended for a day the check-in did not plan", async () => {
    const g = fakeGoogle({ plans: plans.slice(0, 1) });
    const m = memStore(empty);
    const walk: Plan = { date: "2026-11-22", time_budget_min: 0, note: "", items: [{ habit: "walk", task: "", minutes: 0 }] };
    m.editPlan(walk);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(g.rows("plans")).toEqual([
      ["2026-11-21", "gym", "Arms", "30"],
      ["2026-11-22", "walk", "", "0"],
    ]);
    expect(r.plan).toEqual(walk);
  });

  it("stay on the phone and waiting when the write fails", async () => {
    const g = fakeGoogle({ plans }, true);
    const m = memStore(empty);
    m.editPlan(edited);
    const r = await rollUp(m.store, g.api, "sheet-1", "2026-11-22");
    expect(r.errors[0]).toContain("500 backend error");
    expect(r.plan).toEqual(edited);
    expect(m.plan()).toEqual(edited);
    expect(await m.store.isPlanDirty()).toBe(true);
  });
});

describe("results", () => {
  const remoteResults = [
    ["r1", "gym", "Ran 5k", "manual", "", false],
    ["r2", "gym", "Trained", "auto", "", false],
    ["r3", "read", "Read a book", "auto", 45, true],
  ];

  it("are taken from the sheet when the phone changed nothing", async () => {
    const g = fakeGoogle({ results: remoteResults });
    const m = memStore(empty);
    await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(m.config().results).toEqual([
      { id: "r1", habit: "gym", name: "Ran 5k", type: "manual", min_minutes: 30, archived: false },
      { id: "r2", habit: "gym", name: "Trained", type: "auto", min_minutes: 30, archived: false },
      { id: "r3", habit: "read", name: "Read a book", type: "auto", min_minutes: 45, archived: true },
    ]);
  });

  it("take the phone's names and archived flags, keep rows the check-in added and drop removed ones", async () => {
    const g = fakeGoogle({ results: remoteResults });
    const local: Config = {
      ...empty,
      goals: [{ id: "g", name: "G", rank: 1, archived: false, color: "" }],
      results: [
        { id: "r1", habit: "gym", name: "Ran 10k", type: "manual", min_minutes: 30, archived: true },
        { id: "gone", habit: "gym", name: "Removed in the sheet", type: "manual", min_minutes: 30, archived: false },
      ],
    };
    const m = memStore(local, true);
    const r = await rollUp(m.store, g.api, await g.api.open(), "2026-11-22");
    expect(r.errors).toEqual([]);
    expect(g.rows("results")).toEqual([
      ["r1", "gym", "Ran 10k", "manual", "", "TRUE"],
      ["r2", "gym", "Trained", "auto", "", "FALSE"],
      ["r3", "read", "Read a book", "auto", "45", "TRUE"],
    ]);
    expect(m.config().results.map((x) => [x.id, x.name, x.archived])).toEqual([
      ["r1", "Ran 10k", true],
      ["r2", "Trained", false],
      ["r3", "Read a book", true],
    ]);
    expect(await m.store.isConfigDirty()).toBe(false);
  });
});
