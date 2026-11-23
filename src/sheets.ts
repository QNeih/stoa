// The user's "Stoa" spreadsheet in their own Drive, through the Drive and Sheets REST APIs,
// and the mapping between its rows and the app's types.
import { AuthError } from "./googleAuth";
import type { Config, LogEntry, Plan, StoredEntry } from "./types";

/**
 * Tabs and their header rows. Rows are read by header name, written in this order.
 * Counters are retired: the `counters` tab and the `counter` and `delta` columns of `logs` stay for
 * old rows, which the app neither reads nor removes.
 */
export const TABS = {
  goals: ["id", "name", "rank", "archived"],
  habits: ["id", "goal", "name", "archived"],
  counters: ["id", "goal", "name"],
  plans: ["date", "habit", "task", "minutes"],
  plan_days: ["date", "time_budget_min", "note"],
  logs: ["id", "day", "type", "habit", "task", "start", "end", "note", "counter", "delta"],
} as const;

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
   * Adds missing tabs with their header rows. A spreadsheet Stoa has just created, or one still
   * without a single Stoa tab (an earlier setup that failed before its tabs were added), also loses
   * Google's default tab. A sheet that has any Stoa tab is the user's and keeps all its tabs.
   */
  private async ensureTabs(id: string, created: boolean): Promise<void> {
    const info = await this.call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      "GET",
      `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`,
    );
    const titles = new Set(info.sheets.map((s) => s.properties.title));
    const missing = (Object.keys(TABS) as Tab[]).filter((t) => !titles.has(t));
    if (!missing.length) return;
    const untouched = missing.length === Object.keys(TABS).length;
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
      ranges: tabs.map((t) => range(t, `A${tables[t]!.length + 2}:Z`)),
    });
  }
}

// --- mapping between rows and the app's types ---

const isTrue = (s: string | undefined) => /^true$/i.test((s ?? "").trim());
const num = (s: string | undefined, fallback = 0) => {
  const n = Number((s ?? "").trim());
  return (s ?? "").trim() !== "" && Number.isFinite(n) ? n : fallback;
};

/** A row id for a new log entry. */
export const newUid = () => crypto.randomUUID();

export function configFromRows(t: Pick<Tables, "goals" | "habits">): Config {
  return {
    goals: t.goals.filter((r) => r.id).map((r) => ({ id: r.id, name: r.name ?? "", rank: num(r.rank), archived: isTrue(r.archived) })),
    habits: t.habits.filter((r) => r.id).map((r) => ({ id: r.id, goal: r.goal ?? "", name: r.name ?? "", archived: isTrue(r.archived) })),
  };
}

export function configToRows(c: Config): Record<"goals" | "habits", Cell[][]> {
  return {
    goals: c.goals.map((g) => [g.id, g.name, g.rank, g.archived]),
    habits: c.habits.map((h) => [h.id, h.goal, h.name, h.archived]),
  };
}

/** The plan for `date`, or null when neither tab has a row for it. Without a budget row the budget is the planned total. */
export function planFromRows(t: Pick<Tables, "plans" | "plan_days">, date: string): Plan | null {
  const items = t.plans
    .filter((r) => r.date?.trim() === date)
    .map((r) => ({ habit: r.habit ?? "", task: r.task ?? "", minutes: num(r.minutes) }));
  const day = t.plan_days.find((r) => r.date?.trim() === date);
  if (!items.length && !day) return null;
  const planned = items.reduce((sum, i) => sum + i.minutes, 0);
  return { date, time_budget_min: day ? num(day.time_budget_min, planned) : planned, items, note: day?.note ?? "" };
}

/** A session as a `logs` row. */
export function entryToRow(e: StoredEntry): Cell[] {
  return [e.uid, e.day, "session", e.habit, e.task, e.start, e.end, e.note, "", ""];
}

/** Whether the app owns a `logs` row: sessions. Other rows (old counter taps) are kept as they are. */
export const isSessionRow = (r: Row) => r.type?.trim() === "session";

/** A `logs` row as a session with its row id (a new id when the row has none); null for any other row. */
export function entryFromRow(r: Row): (LogEntry & { uid: string }) | null {
  if (!isSessionRow(r)) return null;
  const uid = r.id?.trim() || newUid();
  return { uid, type: "session", habit: r.habit ?? "", task: r.task ?? "", start: r.start ?? "", end: r.end ?? "", note: r.note ?? "" };
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
