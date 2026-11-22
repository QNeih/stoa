import { describe, expect, it } from "vitest";
import { GitHub, decodeBase64, encodeBase64 } from "../src/github";
import { rollUp, restore, type SyncStore } from "../src/sync";
import type { Config, LogEntry, Plan, StoredEntry } from "../src/types";
import { dayOf } from "../src/logs";

/** In-memory data repo behind a fake fetch that speaks the contents API. */
function fakeRepo(files: Record<string, string>) {
  let n = 0;
  const shas: Record<string, string> = Object.fromEntries(Object.keys(files).map((k) => [k, `s${n++}`]));
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = decodeURIComponent(url.split("/contents/")[1]);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (shas[path] && body.sha !== shas[path]) return json(409, { message: "sha mismatch" });
      files[path] = decodeBase64(body.content);
      shas[path] = `s${n++}`;
      return json(200, {});
    }
    if (path in files) return json(200, { content: encodeBase64(files[path]), sha: shas[path] });
    const children = Object.keys(files).filter((k) => k.startsWith(path + "/"));
    if (children.length) return json(200, children.map((k) => ({ name: k.slice(path.length + 1), type: "file" })));
    return json(404, { message: "Not Found" });
  }) as unknown as typeof fetch;
  return { files, gh: new GitHub({ token: "t", repo: "o/r" }, fetchFn) };
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
    importEntries: async (es: LogEntry[]) => void entries.push(...es.map((e) => ({ ...e, day: dayOf(e) }))),
  };
  const add = (e: LogEntry) => {
    entries.push({ ...e, day: dayOf(e) });
    dirty.add(dayOf(e));
  };
  return { store, add, entries, plan: () => plan, config: () => config };
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

describe("roll-up", () => {
  it("writes changed days to logs/, pulls config and reads today's plan", async () => {
    const remoteConfig: Config = { goals: [{ id: "g", name: "G", rank: 1, archived: false }], habits: [], counters: [] };
    const plan: Plan = { date: "2026-11-22", time_budget_min: 60, items: [{ habit: "gym", task: "Legs", minutes: 60 }], note: "" };
    const { files, gh } = fakeRepo({
      "config.json": JSON.stringify(remoteConfig),
      "plans/2026-11-22.json": JSON.stringify(plan),
      "logs/2026-11-22.jsonl": "old\n",
    });
    const m = memStore(empty);
    m.add(session);

    const r = await rollUp(m.store, gh, "2026-11-22");

    expect(r.errors).toEqual([]);
    expect(r.pushedDays).toEqual(["2026-11-22"]);
    expect(files["logs/2026-11-22.jsonl"]).toContain('"note":"ok"');
    expect(m.config()).toEqual(remoteConfig);
    expect(m.plan()).toEqual(plan);
    expect(await m.store.dirtyDays()).toEqual([]);
  });

  it("pushes a config edited on the phone", async () => {
    const local: Config = { goals: [], habits: [{ id: "h", goal: "g", name: "H", archived: false }], counters: [] };
    const { files, gh } = fakeRepo({ "config.json": "{}" });
    const m = memStore(local, true);
    const r = await rollUp(m.store, gh, "2026-11-22");
    expect(r.configPushed).toBe(true);
    expect(JSON.parse(files["config.json"])).toEqual(local);
    expect(await m.store.isConfigDirty()).toBe(false);
  });

  it("keeps a day marked when the push fails", async () => {
    const failing = new GitHub({ token: "t", repo: "o/r" }, (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const m = memStore(empty);
    m.add(session);
    const r = await rollUp(m.store, failing, "2026-11-22");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(await m.store.dirtyDays()).toEqual(["2026-11-22"]);
  });

  it("restores an empty phone from logs/", async () => {
    const { gh } = fakeRepo({ "logs/2026-11-22.jsonl": JSON.stringify(session) + "\n", "logs/README.md": "x" });
    const m = memStore(empty);
    expect(await restore(m.store, gh)).toBe(1);
    expect(m.entries[0]).toMatchObject({ habit: "gym", day: "2026-11-22" });
    expect(await restore(m.store, gh)).toBe(0);
  });
});
