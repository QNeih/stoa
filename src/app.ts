import { h } from "./dom";
import { Store, type Settings, type SyncStatus } from "./db";
import { GitHub } from "./github";
import { slugify, toContract } from "./logs";
import { dashboard, planProgress } from "./stats";
import { restore, rollUp } from "./sync";
import { formatClock, formatDuration, formatTime, isoLocal, localDate } from "./time";
import type { Config, Habit, Plan, RunningTimer, SessionEntry, StoredEntry } from "./types";

/** After this long a reopened app asks whether the timer is still going. */
const STILL_GOING_MS = 4 * 3600_000;
const TABS = [
  ["today", "Today"],
  ["plan", "Plan"],
  ["log", "Log"],
  ["habits", "Habits"],
  ["settings", "Settings"],
] as const;

type Route = { tab: string; sub?: string; id?: number };

function parseRoute(): Route {
  const [tab = "today", sub, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { tab: tab || "today", sub, id: id ? Number(id) : undefined };
}

const toLocalInput = (d: Date) => isoLocal(d).slice(0, 16);
const daysAgoText = (n: number | null) =>
  n === null ? "no time yet" : n === 0 ? "last time spent: today" : n === 1 ? "last time spent: yesterday" : `last time spent: ${n} days ago`;

export class App {
  private config: Config = { goals: [], habits: [], counters: [] };
  private entries: StoredEntry[] = [];
  private timer: RunningTimer | null = null;
  private plan: Plan | null = null;
  private settings: Settings = { token: "", repo: "" };
  private syncStatus: SyncStatus | null = null;
  private pending = 0;
  private syncing = false;
  /** Set while the stop screen asks for a note; the session ends at this time. */
  private stopEnd: Date | null = null;
  private stillGoingOpen = false;
  private clock?: number;
  private toastTimer?: number;
  private showAllDays = false;

  private constructor(
    private root: HTMLElement,
    private store: Store,
  ) {}

  static async start(root: HTMLElement): Promise<App> {
    const app = new App(root, await Store.open());
    await app.reload();
    app.render();
    window.addEventListener("hashchange", () => app.render());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        app.checkStillGoing();
        app.render();
      }
    });
    app.checkStillGoing();
    void app.sync();
    return app;
  }

  // --- data ---

  private async reload(): Promise<void> {
    [this.config, this.entries, this.timer, this.plan, this.settings, this.syncStatus] = await Promise.all([
      this.store.getConfig(),
      this.store.allEntries(),
      this.store.getTimer(),
      this.store.getPlan(),
      this.store.getSettings(),
      this.store.getSyncStatus(),
    ]);
    this.pending = (await this.store.dirtyDays()).length + ((await this.store.isConfigDirty()) ? 1 : 0);
  }

  private habit = (id: string): Habit | undefined => this.config.habits.find((x) => x.id === id);
  private habitName = (id: string) => this.habit(id)?.name ?? id;
  private goalName = (id: string) => this.config.goals.find((g) => g.id === id)?.name ?? id;
  private counterName = (id: string) => this.config.counters.find((c) => c.id === id)?.name ?? id;
  private activeGoals = () => this.config.goals.filter((g) => !g.archived).sort((a, b) => a.rank - b.rank);

  /** Roll-up to the data repo; quiet no-op without settings. */
  async sync(): Promise<void> {
    const { token, repo } = this.settings;
    if (!token || !repo || this.syncing) return;
    this.syncing = true;
    this.updateSyncBadge();
    let status: SyncStatus;
    try {
      const r = await rollUp(this.store, new GitHub({ token, repo }), localDate(new Date()));
      status = r.errors.length
        ? { at: new Date().toISOString(), ok: false, message: r.errors[0] }
        : { at: new Date().toISOString(), ok: true, message: r.pushedDays.length ? `Wrote ${r.pushedDays.join(", ")}` : "Up to date" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status = { at: new Date().toISOString(), ok: false, message: /fetch/i.test(msg) ? "Offline, will retry" : msg };
    }
    await this.store.setSyncStatus(status);
    this.syncing = false;
    await this.reload();
    // Re-rendering would wipe what the user is typing.
    const typing = document.activeElement?.matches("input, textarea, select");
    if (!typing) this.render();
    else this.updateSyncBadge();
  }

  private toast(text: string, undo?: () => void): void {
    document.querySelector(".toast")?.remove();
    const el = h(
      "div",
      { class: "toast", role: "status" },
      h("span", null, text),
      undo &&
        h("button", {
          class: "link",
          onclick: () => {
            el.remove();
            undo();
          },
        }, "Undo"),
    );
    document.body.append(el);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), 4000);
  }

  // --- timer ---

  private async startTimer(habit: string, task: string): Promise<void> {
    const now = new Date();
    // One timer at a time: starting another stops the first.
    if (this.timer) await this.saveSession(this.timer, now, "");
    this.timer = { habit, task: task.trim(), start: isoLocal(now) };
    await this.store.setTimer(this.timer);
    location.hash = "#/today";
    this.render();
  }

  private async saveSession(t: RunningTimer, end: Date, note: string): Promise<void> {
    const start = new Date(t.start);
    if (end <= start) end = new Date(start.getTime() + 60_000);
    await this.store.addEntry({ type: "session", habit: t.habit, task: t.task, start: t.start, end: isoLocal(end), note: note.trim() });
  }

  private async stopTimer(note: string): Promise<void> {
    if (!this.timer) return;
    await this.saveSession(this.timer, this.stopEnd ?? new Date(), note);
    this.timer = null;
    this.stopEnd = null;
    await this.store.setTimer(null);
    await this.reload();
    location.hash = "#/today";
    this.render();
    void this.sync();
  }

  private async discardTimer(): Promise<void> {
    if (!confirm("Discard this timer without saving?")) return;
    this.timer = null;
    this.stopEnd = null;
    await this.store.setTimer(null);
    this.render();
  }

  private checkStillGoing(): void {
    if (!this.timer || this.stillGoingOpen || this.stopEnd) return;
    const since = new Date(this.timer.checked ?? this.timer.start).getTime();
    if (Date.now() - since < STILL_GOING_MS) return;
    this.stillGoingOpen = true;
    const t = this.timer;
    const endInput = h("input", { type: "datetime-local", value: toLocalInput(new Date(new Date(t.start).getTime() + 3600_000)) });
    const close = () => {
      dialog.close();
      dialog.remove();
      this.stillGoingOpen = false;
    };
    const dialog = h(
      "dialog",
      { class: "modal" },
      h("h2", null, "Still going?"),
      h("p", null, `${this.habitName(t.habit)} started ${formatDuration(Date.now() - new Date(t.start).getTime())} ago.`),
      h("button", {
        class: "primary",
        onclick: async () => {
          this.timer = { ...t, checked: isoLocal(new Date()) };
          await this.store.setTimer(this.timer);
          close();
        },
      }, "Yes, still going"),
      h("button", {
        onclick: () => {
          close();
          this.stopEnd = new Date();
          this.render();
        },
      }, "Stop now"),
      h("label", null, "It ended at", endInput),
      h("button", {
        onclick: () => {
          const end = new Date(endInput.value);
          if (isNaN(end.getTime()) || end <= new Date(t.start)) return alert("The end must be after the start.");
          close();
          this.stopEnd = end > new Date() ? new Date() : end;
          this.render();
        },
      }, "Save with that end"),
    );
    document.body.append(dialog);
    dialog.showModal();
  }

  // --- rendering ---

  render(): void {
    clearInterval(this.clock);
    const route = parseRoute();
    let screen: HTMLElement;
    if (this.timer && this.stopEnd) screen = this.stopScreen(this.timer);
    else if (this.timer) screen = this.runningScreen(this.timer);
    else {
      const body =
        route.tab === "plan" ? this.planScreen()
        : route.tab === "log" ? (route.sub ? this.sessionForm(route.id) : this.logScreen())
        : route.tab === "habits" ? this.habitsScreen()
        : route.tab === "settings" ? this.settingsScreen()
        : this.todayScreen();
      screen = h("div", { class: "shell" }, h("main", null, body), this.nav(route.tab));
    }
    this.root.replaceChildren(screen);
    this.updateSyncBadge();
  }

  private updateSyncBadge(): void {
    const el = document.querySelector(".sync-badge");
    if (!el) return;
    el.textContent = this.syncing ? "Syncing…" : !this.settings.token ? "Not connected" : this.syncStatus && !this.syncStatus.ok ? "Sync issue" : this.pending ? `${this.pending} to sync` : "Synced";
    el.classList.toggle("warn", !!this.settings.token && !!this.syncStatus && !this.syncStatus.ok);
  }

  private nav(active: string): HTMLElement {
    return h(
      "nav",
      { class: "tabs" },
      TABS.map(([id, label]) => h("a", { href: `#/${id}`, class: id === active ? "active" : "" }, label)),
    );
  }

  private header(title: string, extra?: Node): HTMLElement {
    return h("header", { class: "top" }, h("h1", null, title), extra ?? null, h("span", { class: "sync-badge" }));
  }

  private todayScreen(): HTMLElement {
    const now = new Date();
    const d = dashboard(this.config, this.entries, now);
    const counterRows = this.activeGoals().flatMap((g) => this.config.counters.filter((c) => c.goal === g.id));
    return h(
      "div",
      null,
      this.header("Today", h("span", { class: "muted" }, now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }))),
      h("section", { class: "card hero" }, h("div", { class: "big" }, formatDuration(d.todayMs)), h("div", { class: "muted" }, "spent on goals today"),
        h("a", { class: "button primary", href: "#/plan" }, "Start")),
      h("section", null, h("h2", null, "Done today"),
        d.done.length
          ? h("ul", { class: "list" }, d.done.map(({ session: s, ms }) =>
              h("li", null,
                h("div", { class: "row" }, h("strong", null, this.habitName(s.habit)), h("span", null, formatDuration(ms))),
                s.task && h("div", null, s.task),
                s.note && h("div", { class: "note" }, s.note),
                h("div", { class: "muted small" }, `${formatTime(new Date(s.start))}–${formatTime(new Date(s.end))}`))))
          : h("p", { class: "muted" }, "Nothing logged yet today.")),
      h("section", null, h("h2", null, "This week"),
        h("ul", { class: "list" }, d.weekByGoal.map((g) =>
          h("li", null,
            h("div", { class: "row" }, h("strong", null, this.goalName(g.goal)), h("span", null, formatDuration(g.ms))),
            h("div", { class: "muted small" }, daysAgoText(g.lastSpentDaysAgo)))))),
      counterRows.length > 0 && h("section", null, h("h2", null, "Results"),
        h("ul", { class: "list" }, counterRows.map((c) => {
          const s = d.counters.find((x) => x.counter === c.id)!;
          return h("li", { class: "row" },
            h("div", null, h("strong", null, c.name), h("div", { class: "muted small" }, `${s.week} this week · ${s.total} total`)),
            h("button", { class: "plus", "aria-label": `Add one to ${c.name}`, onclick: () => this.tapCounter(c.id) }, "+1"));
        }))),
    );
  }

  private async tapCounter(id: string): Promise<void> {
    const entry = { type: "counter" as const, counter: id, at: isoLocal(new Date()), delta: 1 };
    await this.store.addEntry(entry);
    await this.reload();
    this.render();
    this.toast(`${this.counterName(id)} +1`, async () => {
      const last = this.entries.filter((e) => e.type === "counter" && e.counter === id && e.at === entry.at).pop();
      if (last?.id !== undefined) await this.store.deleteEntry(last.id);
      await this.reload();
      this.render();
    });
  }

  private runningScreen(t: RunningTimer): HTMLElement {
    const clock = h("div", { class: "clock" }, formatClock(Date.now() - new Date(t.start).getTime()));
    this.clock = window.setInterval(() => {
      clock.textContent = formatClock(Date.now() - new Date(t.start).getTime());
    }, 1000);
    return h(
      "div",
      { class: "running" },
      h("div", { class: "muted" }, this.habitName(t.habit)),
      h("div", { class: "task" }, t.task || this.habitName(t.habit)),
      clock,
      h("button", { class: "primary stop", onclick: () => { this.stopEnd = new Date(); this.render(); } }, "Stop"),
      h("button", { class: "link", onclick: () => this.discardTimer() }, "Discard timer"),
    );
  }

  private stopScreen(t: RunningTimer): HTMLElement {
    const note = h("input", { type: "text", placeholder: "Optional, one line", maxLength: 200, enterKeyHint: "done" });
    const save = () => this.stopTimer(note.value);
    note.addEventListener("keydown", (e) => e.key === "Enter" && save());
    queueMicrotask(() => note.focus());
    return h(
      "div",
      { class: "running" },
      h("div", { class: "muted" }, `${this.habitName(t.habit)} · ${formatDuration(this.stopEnd!.getTime() - new Date(t.start).getTime())}`),
      h("label", { class: "stack" }, "What came out of it?", note),
      h("button", { class: "primary", onclick: save }, "Save"),
      h("button", { class: "link", onclick: () => { this.stopEnd = null; this.render(); } }, "Back to the timer"),
    );
  }

  private habitSelect(selected?: string): HTMLSelectElement {
    const sel = h("select", { required: true },
      this.activeGoals().map((g) =>
        h("optgroup", { label: g.name }, this.config.habits.filter((x) => x.goal === g.id && !x.archived).map((x) =>
          h("option", { value: x.id, selected: x.id === selected }, x.name)))));
    // Keep a habit that is archived now selectable when editing an old session.
    if (selected && !this.config.habits.some((x) => x.id === selected && !x.archived)) {
      sel.append(h("option", { value: selected, selected: true }, this.habitName(selected)));
    }
    return sel;
  }

  private planScreen(): HTMLElement {
    const today = localDate(new Date());
    const plan = this.plan?.date === today ? this.plan : null;
    const progress = plan ? planProgress(plan, this.entries, today) : null;
    const task = h("input", { type: "text", placeholder: "Task (optional)" });
    const habit = this.habitSelect();
    const hasHabits = this.config.habits.some((x) => !x.archived);
    return h(
      "div",
      null,
      this.header("Plan"),
      plan && progress
        ? h("section", null,
            h("section", { class: "card" },
              h("div", { class: "row" }, h("span", null, "Planned"), h("strong", null, formatDuration(progress.plannedMs))),
              h("div", { class: "row" }, h("span", null, "Spent on the plan"), h("strong", null, formatDuration(progress.onPlanMs))),
              h("div", { class: "row muted" }, h("span", null, "Spent on other things"), h("span", null, formatDuration(progress.offPlanMs))),
              plan.time_budget_min * 60_000 !== progress.plannedMs &&
                h("div", { class: "muted small" }, `Time budget ${formatDuration(plan.time_budget_min * 60_000)}`)),
            plan.note && h("p", { class: "note" }, plan.note),
            h("ul", { class: "list" }, progress.items.map(({ item: it, spentMs }) => {
              const full = spentMs >= it.minutes * 60_000;
              return h("li", { class: full ? "row done" : "row" },
                h("div", null, h("strong", null, it.task || this.habitName(it.habit)),
                  h("div", { class: "muted small" }, `${this.habitName(it.habit)} · ${Math.floor(spentMs / 60_000)} of ${it.minutes} min`)),
                h("button", { onclick: () => this.startTimer(it.habit, it.task) }, "Start"));
            })))
        : h("section", { class: "card" }, h("p", null, "No plan for today yet."),
            h("p", { class: "muted small" }, this.settings.token
              ? "It comes from the daily check-in with Claude and loads on the next sync."
              : "Connect the data repo in Settings to load plans from the check-in.")),
      h("section", null, h("h2", null, "Start without a plan"),
        hasHabits
          ? h("form", { class: "stack", onsubmit: (e: Event) => { e.preventDefault(); void this.startTimer(habit.value, task.value); } },
              habit, task, h("button", { class: "primary", type: "submit" }, "Start"))
          : h("p", { class: "muted" }, "Add a habit under Habits first.")),
    );
  }

  private logScreen(): HTMLElement {
    const byDay = new Map<string, StoredEntry[]>();
    for (const e of [...this.entries].sort((a, b) => (b.type === "session" ? b.start : b.at).localeCompare(a.type === "session" ? a.start : a.at))) {
      if (!byDay.has(e.day)) byDay.set(e.day, []);
      byDay.get(e.day)!.push(e);
    }
    const days = [...byDay.keys()].sort().reverse();
    const shown = this.showAllDays ? days : days.slice(0, 14);
    return h(
      "div",
      null,
      this.header("Log"),
      h("a", { class: "button primary", href: "#/log/new" }, "Add past session"),
      !days.length && h("p", { class: "muted" }, "No sessions yet."),
      shown.map((day) =>
        h("section", null, h("h2", null, new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })),
          h("ul", { class: "list" }, byDay.get(day)!.map((e) =>
            e.type === "session"
              ? h("li", { class: "tap", onclick: () => (location.hash = `#/log/edit/${e.id}`) },
                  h("div", { class: "row" }, h("strong", null, this.habitName(e.habit)),
                    h("span", null, formatDuration(new Date(e.end).getTime() - new Date(e.start).getTime()))),
                  e.task && h("div", null, e.task),
                  e.note && h("div", { class: "note" }, e.note),
                  h("div", { class: "muted small" }, `${formatTime(new Date(e.start))}–${formatTime(new Date(e.end))}${localDate(new Date(e.end)) !== e.day ? " (next day)" : ""}`))
              : h("li", { class: "row" },
                  h("span", null, `${formatTime(new Date(e.at))} · ${this.counterName(e.counter)} ${e.delta > 0 ? "+" : ""}${e.delta}`),
                  h("button", { class: "link", onclick: async () => {
                    if (!confirm("Delete this counter tap?")) return;
                    await this.store.deleteEntry(e.id!);
                    await this.reload();
                    this.render();
                  } }, "Delete")))))),
      days.length > shown.length && h("button", { class: "link", onclick: () => { this.showAllDays = true; this.render(); } }, "Show older days"),
    );
  }

  private sessionForm(id?: number): HTMLElement {
    const existing = id !== undefined ? this.entries.find((e) => e.id === id && e.type === "session") as (StoredEntry & SessionEntry) | undefined : undefined;
    const now = new Date();
    const habit = this.habitSelect(existing?.habit);
    const task = h("input", { type: "text", placeholder: "Task (optional)", value: existing?.task ?? "" });
    const start = h("input", { type: "datetime-local", required: true, value: toLocalInput(existing ? new Date(existing.start) : new Date(now.getTime() - 3600_000)) });
    const end = h("input", { type: "datetime-local", required: true, value: toLocalInput(existing ? new Date(existing.end) : now) });
    const note = h("input", { type: "text", placeholder: "What came out of it? (optional)", value: existing?.note ?? "" });
    const save = async (e: Event) => {
      e.preventDefault();
      const s = new Date(start.value);
      const en = new Date(end.value);
      if (isNaN(s.getTime()) || isNaN(en.getTime()) || en <= s) return alert("The end must be after the start.");
      const entry: SessionEntry = { type: "session", habit: habit.value, task: task.value.trim(), start: isoLocal(s), end: isoLocal(en), note: note.value.trim() };
      if (existing?.id !== undefined) await this.store.updateEntry(existing.id, entry);
      else await this.store.addEntry(entry);
      await this.reload();
      location.hash = "#/log";
    };
    return h(
      "div",
      null,
      this.header(existing ? "Edit session" : "Add past session"),
      id !== undefined && !existing && h("p", { class: "muted" }, "This session no longer exists."),
      h("form", { class: "stack", onsubmit: save },
        h("label", { class: "stack" }, "Habit", habit),
        h("label", { class: "stack" }, "Task", task),
        h("label", { class: "stack" }, "Start", start),
        h("label", { class: "stack" }, "End", end),
        h("label", { class: "stack" }, "Note", note),
        h("button", { class: "primary", type: "submit" }, "Save"),
        existing && h("button", { type: "button", class: "danger", onclick: async () => {
          if (!confirm("Delete this session?")) return;
          await this.store.deleteEntry(existing.id!);
          await this.reload();
          location.hash = "#/log";
        } }, "Delete"),
        h("a", { class: "button", href: "#/log" }, "Cancel")),
    );
  }

  private async saveConfig(config: Config): Promise<void> {
    await this.store.setConfig(config, true);
    await this.reload();
    this.render();
    void this.sync();
  }

  private habitsScreen(): HTMLElement {
    const c = this.config;
    const goals = this.activeGoals();
    const goalSelect = (selected?: string) => h("select", null, goals.map((g) => h("option", { value: g.id, selected: g.id === selected }, g.name)));

    const newHabit = h("input", { type: "text", placeholder: "New habit", required: true });
    const newHabitGoal = goalSelect();
    const newCounter = h("input", { type: "text", placeholder: "New result counter", required: true });
    const newCounterGoal = goalSelect();
    const newGoal = h("input", { type: "text", placeholder: "New big goal", required: true });

    const ids = () => [...c.goals, ...c.habits, ...c.counters].map((x) => x.id);
    const update = (patch: Partial<Config>) => this.saveConfig({ ...c, ...patch });
    const move = (goalId: string, dir: -1 | 1) => {
      const order = goals.map((g) => g.id);
      const i = order.indexOf(goalId);
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      const archived = c.goals.filter((g) => g.archived);
      update({ goals: [...order.map((id, k) => ({ ...c.goals.find((g) => g.id === id)!, rank: k + 1 })), ...archived.map((g, k) => ({ ...g, rank: order.length + k + 1 }))] });
    };
    const archivedGoals = c.goals.filter((g) => g.archived);
    const archivedHabits = c.habits.filter((x) => x.archived);

    return h(
      "div",
      null,
      this.header("Habits"),
      goals.length > 0 && h("form", { class: "card stack", onsubmit: (e: Event) => {
        e.preventDefault();
        const name = newHabit.value.trim();
        if (!name) return;
        update({ habits: [...c.habits, { id: slugify(name, ids()), goal: newHabitGoal.value, name, archived: false }] });
      } }, h("h2", null, "Add a habit"), newHabit, newHabitGoal, h("button", { class: "primary", type: "submit" }, "Add habit")),
      goals.map((g, i) =>
        h("section", { class: "card" },
          h("div", { class: "row" }, h("h2", null, `${g.rank}. ${g.name}`),
            h("span", { class: "actions" },
              h("button", { class: "icon", disabled: i === 0, "aria-label": "Move up", onclick: () => move(g.id, -1) }, "↑"),
              h("button", { class: "icon", disabled: i === goals.length - 1, "aria-label": "Move down", onclick: () => move(g.id, 1) }, "↓"))),
          h("ul", { class: "list" },
            c.habits.filter((x) => x.goal === g.id && !x.archived).map((x) =>
              h("li", { class: "row" }, h("span", null, x.name),
                h("span", { class: "actions" },
                  (() => {
                    const sel = goalSelect(x.goal);
                    sel.setAttribute("aria-label", `Goal of ${x.name}`);
                    sel.onchange = () => update({ habits: c.habits.map((y) => (y.id === x.id ? { ...y, goal: sel.value } : y)) });
                    return sel;
                  })(),
                  h("button", { class: "link", onclick: () => update({ habits: c.habits.map((y) => (y.id === x.id ? { ...y, archived: true } : y)) }) }, "Archive")))),
            c.counters.filter((x) => x.goal === g.id).map((x) =>
              h("li", { class: "row" }, h("span", null, `${x.name} (counter)`),
                h("button", { class: "link", onclick: () => {
                  if (confirm(`Remove the counter "${x.name}"? Past taps stay in the logs.`)) update({ counters: c.counters.filter((y) => y.id !== x.id) });
                } }, "Remove")))),
          h("button", { class: "link", onclick: () => {
            if (confirm(`Archive the goal "${g.name}"? Its habits stay as they are.`)) update({ goals: c.goals.map((y) => (y.id === g.id ? { ...y, archived: true } : y)) });
          } }, "Archive goal"))),
      goals.length > 0 && h("form", { class: "card stack", onsubmit: (e: Event) => {
        e.preventDefault();
        const name = newCounter.value.trim();
        if (!name) return;
        update({ counters: [...c.counters, { id: slugify(name, ids()), goal: newCounterGoal.value, name }] });
      } }, h("h2", null, "Add a result counter"), newCounter, newCounterGoal, h("button", { type: "submit" }, "Add counter")),
      h("form", { class: "card stack", onsubmit: (e: Event) => {
        e.preventDefault();
        const name = newGoal.value.trim();
        if (!name) return;
        const rank = Math.max(0, ...c.goals.map((g) => g.rank)) + 1;
        update({ goals: [...c.goals, { id: slugify(name, ids()), name, rank, archived: false }] });
      } }, h("h2", null, "Add a big goal"), newGoal, h("button", { type: "submit" }, "Add goal")),
      (archivedGoals.length > 0 || archivedHabits.length > 0) && h("section", null, h("h2", null, "Archived"),
        h("ul", { class: "list" },
          archivedGoals.map((g) => h("li", { class: "row" }, h("span", null, `${g.name} (goal)`),
            h("button", { class: "link", onclick: () => update({ goals: c.goals.map((y) => (y.id === g.id ? { ...y, archived: false } : y)) }) }, "Restore"))),
          archivedHabits.map((x) => h("li", { class: "row" }, h("span", null, `${x.name} · ${this.goalName(x.goal)}`),
            h("button", { class: "link", onclick: () => update({ habits: c.habits.map((y) => (y.id === x.id ? { ...y, archived: false } : y)) }) }, "Restore"))))),
    );
  }

  private settingsScreen(): HTMLElement {
    const repo = h("input", { type: "text", placeholder: "owner/stoa-data", value: this.settings.repo, autocapitalize: "off", spellcheck: false, required: true });
    const token = h("input", { type: "password", placeholder: "github_pat_…", value: this.settings.token, autocomplete: "off", required: true });
    const s = this.syncStatus;
    return h(
      "div",
      null,
      this.header("Settings"),
      h("form", { class: "card stack", onsubmit: (e: Event) => { e.preventDefault(); void this.connect(repo.value.trim(), token.value.trim()); } },
        h("h2", null, "Data repo"),
        h("label", { class: "stack" }, "Repository", repo),
        h("label", { class: "stack" }, "Access token", token),
        h("p", { class: "muted small" }, "A fine-grained GitHub token for this one repository, with Contents read and write. It is stored on this phone only."),
        h("button", { class: "primary", type: "submit" }, "Save and sync")),
      h("section", { class: "card stack" },
        h("h2", null, "Sync"),
        h("p", null, s ? `${s.ok ? "Last sync" : "Last try"} ${new Date(s.at).toLocaleString()}: ${s.message}` : "Not synced yet."),
        h("p", { class: "muted small" }, this.pending ? `${this.pending} change(s) waiting to be written.` : "Nothing waiting."),
        h("button", { disabled: !this.settings.token, onclick: () => this.sync() }, "Sync now")),
      h("section", { class: "card stack" },
        h("h2", null, "Backup"),
        h("p", { class: "muted small" }, "Downloads everything on this phone as one JSON file."),
        h("button", { onclick: () => this.exportAll() }, "Export")),
    );
  }

  private async connect(repo: string, token: string): Promise<void> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return alert("Repository must look like owner/name.");
    this.settings = { repo, token };
    await this.store.setSettings(this.settings);
    // A phone without goals takes the repo's config instead of overwriting it.
    if (!this.config.goals.length) await this.store.setConfig(this.config, false);
    try {
      const n = await restore(this.store, new GitHub(this.settings));
      if (n) this.toast(`Restored ${n} entries from the repo`);
    } catch (e) {
      alert(`Could not read the repo: ${e instanceof Error ? e.message : e}`);
    }
    await this.reload();
    await this.sync();
  }

  private exportAll(): void {
    const data = {
      exported_at: isoLocal(new Date()),
      config: this.config,
      logs: this.entries.map(toContract),
      running_timer: this.timer,
      plan: this.plan,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = h("a", { href: url, download: `stoa-export-${localDate(new Date())}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
