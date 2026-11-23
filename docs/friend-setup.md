# Using Stoa with your own second brain

Stoa is a phone app that tracks time spent on your goals. It shows today's list and what got done.
Your data lives in a Google Sheet in your own Drive. Each morning, Claude Code runs a short check-in from your vault. It reads the sheet and writes today's list back to it.

How the pieces fit:

- **Stoa (phone):** timers, sessions, results. It writes to the sheet.
- **Google Sheet "Stoa":** Stoa creates it on first sign-in. You own it, and Stoa can only see this one file.
- **Claude Code in your vault:** the daily check-in. It creates your goals and sub-goals and writes today's list.

Setup takes about 20 minutes.

---

## 1. Before you start

Send me the Gmail address you'll sign in with. The app is still in Google's test mode, so I have to add you as a tester first. Wait until I confirm before you do step 2.

## 2. Install the app

1. On your phone, open **https://qneih.github.io/stoa/** in Chrome (on iPhone: Safari).
2. Add it to your home screen. In Chrome: menu ⋮ → *Install app* or *Add to home screen*. In Safari: Share → *Add to Home Screen*.
3. Open it from the home screen. Tap the gear (top right) → **Sign in with Google** and pick the Gmail you sent me.
4. Google shows a warning that the app isn't verified. Tap *Continue*. Stoa asks only for access to files it creates itself.
5. A spreadsheet called **Stoa** now sits in your Google Drive, with the tabs `goals`, `habits`, `results`, `result_checks`, `plans`, `logs` (and an unused `counters` tab). Leave the tab names and header rows as they are.
6. Open the sheet on a computer and copy its **id** from the URL: the part between `/d/` and `/edit`.

The app starts empty. Your goals come from the first check-in (step 5).

## 3. Connect Claude to Google Sheets

1. On claude.ai: **Settings → Connectors** → turn on **Google Sheets**, and sign in with the same Google account.
2. Check it in Claude Code: start a session in your vault and ask *"Read the header row of the goals tab in sheet `<your sheet id>`."* You should see `id, name, rank, archived, color`.

## 4. Add Stoa to your vault

Create two files in your vault.

### 4a. `wiki/Stoa.md`

```markdown
---
type: tool
sources:
  - resource: https://qneih.github.io/stoa/
updated: YYYY-MM-DD
---

# Stoa

Phone app that tracks time spent on my goals. Data lives in my Google Sheet "Stoa".

**Sheet id:** `<your sheet id>`

## Model
- **Goal** → **sub-goal** (the sheet calls it `habit`) → **result**.
- A **session** is one timed block on a sub-goal.
- A **manual result** is checked by hand, for example "application sent".
- An **automatic result** counts as done on any day with at least `min_minutes` (default 30) of sessions on its sub-goal, for example "gym".
- Goals, sub-goals and results are created only in the check-in. The app edits, archives, tracks and checks them.

## Tabs (header row first; values are plain text)
- `goals`: id, name, rank, archived, color. id is a lowercase slug (`career`). archived is TRUE/FALSE. color is one of rose, lime, amber, mint, lavender, peach, sky, sage, and each goal has its own.
- `habits` (sub-goals): id, goal, name, archived, created (YYYY-MM-DD).
- `results`: id, habit, name, type (`manual` or `auto`), min_minutes (auto only), archived.
- `plans`: date, habit, task. One row per item on a day's list. Row order is the card order in the app.
- `logs`, `result_checks`: written by the app. Claude never edits them.
- `counters`: retired. Ignore it.
```

### 4b. `wiki/Goals.md`

```markdown
---
type: concept
updated: YYYY-MM-DD
---

# Goals

**Last review:** YYYY-MM-DD

## 1. <Goal name>
Tracked: sub-goals <a>, <b>. Results: <x>.

### Next steps
- [ ] <short task, max 5 words>

### Progress
- YYYY-MM-DD: <what moved>
```

Leave it as a stub. The first check-in fills it with you.

### 4c. Add the check-in routine to your vault's `CLAUDE.md`

Paste this section into your `CLAUDE.md` and change the city:

```markdown
## Daily check-in

I say "check-in" (or a scheduled prompt asks). The data format and the sheet id are in `wiki/Stoa.md`.

0. **First run** (the `goals` tab has no rows): interview me, one question at a time, about my 3–6 big goals in priority order, one or two sub-goals each, and any results worth tracking. Write them to `goals`, `habits` and `results`, and fill `wiki/Goals.md` to match. Then continue with step 2.
1. `git pull --rebase` (if the vault is a git repo). Read `wiki/Goals.md` and, through the Google Sheets connector, the last 7 days of `logs`, the `plans` rows of those days, and the `goals`, `habits`, `results` and `result_checks` tabs. A session belongs to a next step when its `task` equals the step's task text. Planned items from earlier days that got no session are candidates for today.
2. Open short, like a little interview, never a report: today's weekday and date, one sentence on the weather in <my city>, one quick win for today, and the list of active sub-goals. No calendar, no schedule, no times. The quick win is the smallest open next step on the Goals page (or a leftover planned item) that is doable in one sitting. Then ask one question: which sub-goals do I want to make progress on today?
3. After my answer, propose a short list, one line each, for those sub-goals: open next steps on the Goals page first, then leftover planned items, then the goals with the longest gap since their last logged time. Each item names a sub-goal. Reuse one when it fits; otherwise propose a new one. Add one line with the steps to tick (their sessions' notes say they are finished) and any new results. Ask one question at a time. Keep every message under 10 lines.
4. Write to the sheet, values as plain text (RAW) so Sheets does not turn dates into date cells. Never edit `logs` or `result_checks`. Append one row per list item to `plans` (date, habit, task), in the order I should see the cards. Append new sub-goals to `habits` (id slug, goal, name, archived FALSE, created today), new goals to `goals` (with rank and an unused color), new results to `results`. Each task is at most 5 words. An item taken from a next step uses the step's text exactly as `task`; shorten the step on the Goals page first if needed. If the `goals`/`habits` tabs differ from the Goals page, bring the page in step with the sheet.
5. Tick the confirmed steps in `wiki/Goals.md` and add a dated line under each goal's Progress. Log it in `wiki/log.md` and commit: `goals: check-in YYYY-MM-DD`.
```

## 5. Run your first check-in

1. Open Claude Code in your vault and type **check-in**.
2. Claude interviews you about your goals and writes them to the sheet.
3. In Stoa: gear → **Sync now**. Your goals appear, and today's list appears under **Today**.

## 6. Daily use

- **Morning:** type `check-in` in your vault. You pick the sub-goals, and Claude writes today's list.
- **During the day:** tap ▶ on a card to start a timer and ⏸ to stop it. One timer runs at a time. It keeps running when you close the app.
- **Results tab:** tick manual results ("application sent"). Automatic ones tick themselves once you've logged enough time.
- **Log tab:** fix sessions, or type one quickly, for example `45m gym yesterday`.
- **Time and Goals tabs:** where your time went, per week, month or year.

Optional: have Claude prepare the check-in each morning as a scheduled task. In Claude Code, ask: *"Create a scheduled task that runs every morning at 6:00, prepares the check-in opening message (step 2 of the routine in CLAUDE.md) and sends it to me as a push notification, without writing anything."*

## Good to know

- **Offline first:** logging never waits for the network. The app syncs when you open it, after each session, and from **Sync now**.
- **"Sign in again"** in the sync badge: Google's token lasts an hour. One tap renews it, and nothing gets lost.
- **New phone:** sign in with the same account. Stoa finds your sheet and restores your sessions.
- **Backup:** gear → **Export** saves one JSON file.
- **Privacy:** the sheet is yours. I can't see it, and Stoa's access covers only that file.
- **Don't** rename tabs or header cells, or edit `logs` by hand while the app has unsynced changes.

Questions or bugs: message me.
