// The user's "Stoa" spreadsheet in their own Drive, through the Drive and Sheets REST APIs,
// and the mapping between its rows and the app's types.
import { AuthError } from "./googleAuth";
import { isPaletteKey } from "./palette";
import type { Config, LogEntry, Plan, Result, ResultCheck, StoredEntry } from "./types";

/**
 * Tabs and their header rows. Rows are read by header name, written in this order. A column added
 * to a tab goes at the end of its list, so opening an older sheet only appends it to the header row.
 * Counters are retired: the `counters` tab and the `counter` and `delta` columns of `logs` stay for
 * old rows, which the app neither reads nor removes. Time planning is retired too: older sheets keep a
 * `minutes` column on `plans` (see `RETIRED_COLUMNS`) and a `plan_days` tab, which the app ignores.
 * Sub-goals were once habits: an older sheet's `habits` tab and `habit` columns are renamed on open.
 */
export const TABS = {
  goals: ["id", "name", "rank", "archived", "color"],
  sub_goals: ["id", "goal", "name", "archived", "created"],
  results: ["id", "sub_goal", "name", "type", "min_minutes", "archived"],
  result_checks: ["id", "result", "day", "checked_at", "note", "minutes_since_last", "removed_at"],
  counters: ["id", "goal", "name"],
  plans: ["date", "sub_goal", "task"],
  logs: ["id", "day", "type", "sub_goal", "task", "start", "end", "note", "counter", "delta"],
} as const;

/**
 * Columns retired from the end of a tab, as how many an older sheet may still hold after the tab's
 * header. Rewriting the tab clears them, so a stale column never sits next to rewritten rows.
 */
const RETIRED_COLUMNS: Partial<Record<Tab, number>> = { plans: 1 };

/** Tabs renamed since older sheets: old title to new. Opening an older sheet renames the tab in place. */
const RENAMED_TABS: Record<string, Tab> = { habits: "sub_goals" };

/** Header cells renamed since older sheets: old name to new. Opening an older sheet renames the cell in place. */
const RENAMED_COLUMNS: Record<string, string> = { habit: "sub_goal" };

export type Tab = keyof typeof TABS;
export type Cell = string | number | boolean;
/** A data row keyed by its tab's header names; every value is the text Sheets shows. */
export type Row = Record<string, string>;
export type Tables = Record<Tab, Row[]>;

/** The Drive app property that marks a user's Stoa spreadsheet, so a new phone finds it again. */
const APP_PROPERTY = { key: "stoa", value: "sheet" };
const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Quoted A1 range: `'logs'!A1`. */
const range = (tab: Tab, a1 = "") => `'${tab}'${a1 ? `!${a1}` : ""}`;

/** Column letters for a zero-based column index: 0 is A, 26 is AA. */
const column = (i: number): string => (i >= 26 ? column(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

export class SheetsApi {
  constructor(
    private token: () => Promise<string>,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(url, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError("Google refused the sign-in");
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        /* body is not JSON */
      }
      const what = url.replace(/^https:\/\/[^/]+/, "").split("?")[0];
      throw new ApiError(`Google ${method} ${what}: ${res.status} ${detail}`.trim(), res.status);
    }
    return (await res.json()) as T;
  }

  /** The signed-in account's email address. */
  async email(): Promise<string> {
    const r = await this.call<{ user?: { emailAddress?: string } }>("GET", `${DRIVE}/about?fields=user(emailAddress)`);
    return r.user?.emailAddress ?? "";
  }

  /** The id of the user's Stoa spreadsheet, created on first use, with every tab and header row in place. */
  async open(): Promise<string> {
    const q = `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' } and trashed = false`;
    const found = await this.call<{ files: { id: string }[] }>(
      "GET",
      `${DRIVE}/files?q=${encodeURIComponent(q)}&orderBy=createdTime&fields=files(id)&spaces=drive`,
    );
    let id = found.files[0]?.id;
    const created = !id;
    if (!id) {
      const file = await this.call<{ id: string }>("POST", `${DRIVE}/files?fields=id`, {
        name: "Stoa",
        mimeType: "application/vnd.google-apps.spreadsheet",
        appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value },
      });
      id = file.id;
    }
    await this.ensureTabs(id, created);
    return id;
  }

  /**
   * Adds missing tabs with their header rows, and appends columns added since to the header row of
   * existing tabs (their data rows stay as they are). A spreadsheet Stoa has just created, or one still
   * without a single Stoa tab (an earlier setup that failed before its tabs were added), also loses
   * Google's default tab. A sheet that has any Stoa tab is the user's and keeps all its tabs.
   */
  private async ensureTabs(id: string, created: boolean): Promise<void> {
    const info = await this.call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      "GET",
      `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`,
    );
    const titles = new Set(info.sheets.map((s) => s.properties.title));
    const renames = info.sheets.filter((s) => {
      const to = RENAMED_TABS[s.properties.title];
      return to && !titles.has(to);
    });
    if (renames.length) {
      await this.call("POST", `${SHEETS}/${id}:batchUpdate`, {
        requests: renames.map((s) => ({
          updateSheetProperties: { properties: { sheetId: s.properties.sheetId, title: RENAMED_TABS[s.properties.title] }, fields: "title" },
        })),
      });
      for (const s of renames) {
        titles.delete(s.properties.title);
        titles.add(RENAMED_TABS[s.properties.title]);
      }
    }
    const all = Object.keys(TABS) as Tab[];
    const present = all.filter((t) => titles.has(t));
    if (present.length) await this.extendHeaders(id, present);
    const missing = all.filter((t) => !titles.has(t));
    if (!missing.length) return;
    const untouched = !present.length;
    const extra = created || untouched ? info.sheets.filter((s) => !(s.properties.title in TABS)) : [];
    await this.call("POST", `${SHEETS}/${id}:batchUpdate`, {
      requests: [
        ...missing.map((title) => ({ addSheet: { properties: { title } } })),
        ...extra.map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })),
      ],
    });
    await this.call("POST", `${SHEETS}/${id}/values:batchUpdate`, {
      valueInputOption: "RAW",
      data: missing.map((t) => ({ range: range(t, "A1"), values: [[...TABS[t]]] })),
    });
  }

  /**
   * Renames header cells renamed since (`RENAMED_COLUMNS`), then writes the columns a tab's header row
   * lacks after its last header cell.
   */
  private async extendHeaders(id: string, tabs: Tab[]): Promise<void> {
    const qs = tabs.map((t) => `ranges=${encodeURIComponent(range(t, "1:1"))}`).join("&");
    const r = await this.call<{ valueRanges: { values?: unknown[][] }[] }>("GET", `${SHEETS}/${id}/values:batchGet?${qs}`);
    const data = tabs.flatMap((t, i) => {
      const header = (r.valueRanges[i]?.values?.[0] ?? []).map((h) => String(h).trim());
      const renamed = header.flatMap((h, j) => {
        const to = RENAMED_COLUMNS[h];
        if (!to || header.includes(to) || !(TABS[t] as readonly string[]).includes(to)) return [];
        header[j] = to;
        return [{ range: range(t, `${column(j)}1`), values: [[to]] }];
      });
      const add = TABS[t].filter((k) => !header.includes(k));
      return [...renamed, ...(add.length ? [{ range: range(t, `${column(header.length)}1`), values: [add] }] : [])];
    });
    if (data.length) await this.call("POST", `${SHEETS}/${id}/values:batchUpdate`, { valueInputOption: "RAW", data });
  }

  /** The data rows of the given tabs, keyed by header name; blank rows are skipped. */
  async read<T extends Tab>(id: string, tabs: T[]): Promise<Pick<Tables, T>> {
    const qs = tabs.map((t) => `ranges=${encodeURIComponent(range(t))}`).join("&");
    const r = await this.call<{ valueRanges: { values?: unknown[][] }[] }>("GET", `${SHEETS}/${id}/values:batchGet?${qs}`);
    const out = {} as Pick<Tables, T>;
    tabs.forEach((t, i) => {
      const [header = [], ...rows] = r.valueRanges[i]?.values ?? [];
      const keys = header.map((h) => String(h).trim());
      out[t] = rows
        .filter((row) => row.some((c) => String(c ?? "").trim() !== ""))
        .map((row) => Object.fromEntries(keys.map((k, j) => [k, String(row[j] ?? "")])));
    });
    return out;
  }

  /**
   * Rewrites whole tabs: header plus rows, as raw values so times stay text.
   * Writes first, then clears the rows below, so a failed write loses nothing.
   */
  async write(id: string, tables: Partial<Record<Tab, Cell[][]>>): Promise<void> {
    const tabs = Object.keys(tables) as Tab[];
    if (!tabs.length) return;
    await this.call("POST", `${SHEETS}/${id}/values:batchUpdate`, {
      valueInputOption: "RAW",
      data: tabs.map((t) => ({ range: range(t, "A1"), values: [[...TABS[t]], ...tables[t]!] })),
    });
    await this.call("POST", `${SHEETS}/${id}/values:batchClear`, {
      ranges: tabs.flatMap((t) => [
        range(t, `A${tables[t]!.length + 2}:Z`),
        ...(RETIRED_COLUMNS[t] ? [range(t, `${column(TABS[t].length)}1:${column(TABS[t].length + RETIRED_COLUMNS[t]! - 1)}`)] : []),
      ]),
    });
  }
}

// --- mapping between rows and the app's types ---

const isTrue = (s: string | undefined) => /^true$/i.test((s ?? "").trim());
/** The YYYY-MM-DD start of a cell, or "" when it holds no date. */
const isoDay = (s: string | undefined) => /^\d{4}-\d{2}-\d{2}/.exec((s ?? "").trim())?.[0] ?? "";
const num = (s: string | undefined, fallback = 0) => {
  const n = Number((s ?? "").trim());
  return (s ?? "").trim() !== "" && Number.isFinite(n) ? n : fallback;
};

/** A row id for a new log entry or result check. */
export const newUid = () => crypto.randomUUID();

/** Minutes a day needs for an automatic result whose `min_minutes` cell is empty. */
export const DEFAULT_MIN_MINUTES = 30;

/** The `results` rows with an id; any type other than `auto` counts as manual. */
export function resultsFromRows(rows: Row[]): Result[] {
  return rows
    .filter((r) => r.id?.trim())
    .map((r) => ({
      id: r.id.trim(),
      subGoal: r.sub_goal ?? "",
      name: r.name ?? "",
      type: (r.type ?? "").trim().toLowerCase() === "auto" ? "auto" : "manual",
      min_minutes: num(r.min_minutes, DEFAULT_MIN_MINUTES),
      archived: isTrue(r.archived),
    }));
}

/**
 * The sheet's results with the phone's names and archived flags applied by id. Rows the check-in
 * added since the phone last read them stay; results the sheet no longer has are dropped, since only
 * the check-in creates or removes results. Other cells keep their text.
 */
export function mergeResults(remote: Row[], local: Result[]): { rows: Cell[][]; results: Result[] } {
  const mine = new Map(local.map((r) => [r.id, r]));
  const rows = remote.map((r) => {
    const cells = rowCells("results", r);
    const l = mine.get(r.id?.trim());
    if (l && l.name !== (r.name ?? "")) cells[TABS.results.indexOf("name")] = l.name;
    if (l && l.archived !== isTrue(r.archived)) cells[TABS.results.indexOf("archived")] = l.archived;
    return cells;
  });
  const results = resultsFromRows(remote).map((r) => {
    const l = mine.get(r.id);
    return l ? { ...r, name: l.name, archived: l.archived } : r;
  });
  return { rows, results };
}

export function configFromRows(t: Pick<Tables, "goals" | "sub_goals" | "results">): Config {
  return {
    goals: t.goals
      .filter((r) => r.id)
      .map((r) => {
        const color = (r.color ?? "").trim();
        return { id: r.id, name: r.name ?? "", rank: num(r.rank), archived: isTrue(r.archived), color: isPaletteKey(color) ? color : "" };
      }),
    subGoals: t.sub_goals
      .filter((r) => r.id)
      .map((r) => ({ id: r.id, goal: r.goal ?? "", name: r.name ?? "", archived: isTrue(r.archived), created: isoDay(r.created) })),
    results: resultsFromRows(t.results),
  };
}

export function configToRows(c: Config): Record<"goals" | "sub_goals", Cell[][]> {
  return {
    goals: c.goals.map((g) => [g.id, g.name, g.rank, g.archived, g.color]),
    sub_goals: c.subGoals.map((h) => [h.id, h.goal, h.name, h.archived, h.created]),
  };
}

/**
 * The latest plan on or before `today`: the `plans` rows of the latest such date, in order, or null
 * when there is none. Today then carries that list over until a list for today arrives.
 */
export function latestPlanFromRows(plans: Tables["plans"], today: string): Plan | null {
  const date = plans.map((r) => isoDay(r.date)).reduce((a, d) => (d && d <= today && d > a ? d : a), "");
  return date ? planFromRows(plans, date) : null;
}

/** The plan for `date`: its `plans` rows in order, or null when it has none. */
export function planFromRows(plans: Tables["plans"], date: string): Plan | null {
  const items = plans.filter((r) => r.date?.trim() === date).map((r) => ({ subGoal: r.sub_goal ?? "", task: r.task ?? "" }));
  return items.length ? { date, items } : null;
}

/**
 * The `plans` rows with the rows of the plan's date replaced by its items in card order, placed where
 * that date's first row was (at the end when it had none). Rows of other dates stay as they are.
 */
export function mergePlan(remote: Row[], plan: Plan): Row[] {
  const mine: Row[] = plan.items.map((i) => ({ date: plan.date, sub_goal: i.subGoal, task: i.task }));
  const out: Row[] = [];
  let placed = false;
  for (const r of remote) {
    if (r.date?.trim() !== plan.date) out.push(r);
    else if (!placed) {
      out.push(...mine);
      placed = true;
    }
  }
  if (!placed) out.push(...mine);
  return out;
}

/** A session as a `logs` row. */
export function entryToRow(e: StoredEntry): Cell[] {
  return [e.uid, e.day, "session", e.subGoal, e.task, e.start, e.end, e.note, "", ""];
}

/** Whether the app owns a `logs` row: sessions. Other rows (old counter taps) are kept as they are. */
export const isSessionRow = (r: Row) => r.type?.trim() === "session";

/** A `logs` row as a session with its row id (a new id when the row has none); null for any other row. */
export function entryFromRow(r: Row): (LogEntry & { uid: string }) | null {
  if (!isSessionRow(r)) return null;
  const uid = r.id?.trim() || newUid();
  return { uid, type: "session", subGoal: r.sub_goal ?? "", task: r.task ?? "", start: r.start ?? "", end: r.end ?? "", note: r.note ?? "" };
}

/** A result check as a `result_checks` row. */
export function checkToRow(c: ResultCheck): Cell[] {
  return [c.uid, c.result, c.day, c.checked_at, c.note, c.minutes_since_last, c.removed_at];
}

/** A `result_checks` row as a check (a new row id when the row has none); null without a result or day. */
export function checkFromRow(r: Row): ResultCheck | null {
  const result = r.result?.trim() ?? "";
  const day = isoDay(r.day);
  if (!result || !day) return null;
  return {
    uid: r.id?.trim() || newUid(),
    result,
    day,
    checked_at: r.checked_at ?? "",
    note: r.note ?? "",
    minutes_since_last: num(r.minutes_since_last),
    removed_at: r.removed_at ?? "",
  };
}

/** A row in header order as the text Sheets would show, without trailing blanks, for comparing. */
export function cellsText(cells: Cell[]): string[] {
  const text = cells.map((c) => (typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : String(c)));
  while (text.length && text[text.length - 1] === "") text.pop();
  return text;
}

export const rowCells = (tab: Tab, r: Row): Cell[] => TABS[tab].map((k) => r[k] ?? "");

/** Sort key for `logs` rows: day, then start time. */
export const logOrder = (a: Cell[], b: Cell[]) =>
  String(a[1]).localeCompare(String(b[1])) || Date.parse(String(a[5])) - Date.parse(String(b[5])) || 0;

/** Sort key for `result_checks` rows: day, then check time. */
export const checkOrder = (a: Cell[], b: Cell[]) =>
  String(a[2]).localeCompare(String(b[2])) || Date.parse(String(a[3])) - Date.parse(String(b[3])) || 0;
