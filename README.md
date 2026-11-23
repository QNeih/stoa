# Stoa

A phone app that tracks time spent on your goals, shows today's plan and what got done.
It is an installable offline web app (PWA): React and TypeScript, IndexedDB, and a Google Sheet in the user's own Drive instead of a backend.

## Use

- **Today**: today's plan from the Stoa sheet as cards in row order, each with its goal colour, and the time spent today at the top.
  Drag a card's handle to reorder. Play starts a timer; one timer at a time, so starting another ends the running one as a session.
  Pause ends the session; a note can be added later in Log. The running card stands out and counts today's time on its sub-goal.
  Forgot to start? Change the running timer's start (up to 24 hours back). The timer survives closing the app; after 4 hours a
  reopened app asks "still going?", where an earlier end can be set. "+ Add" puts another sub-goal on today's list and starts it.
- **Time** and **Results**: coming next.
- **Goals**: goals (ranked, archived, never deleted) and their sub-goals (one field plus a goal, can move to another goal). Goal stats are coming next.
- **Log**: fix sessions. The past week shows by day; scrolling down loads a week more at a time.
  Tap a session to edit it (note included); a long press or "…" opens Edit and Delete. Delete acts at once, with Undo.
  Quick input at the top reads one line, e.g. "45m gym yesterday", "1h30 job search 14:00", "gym 9:00-10:15 friday" or
  "gym 45 min on 2026-11-20": a duration or start-end times, a sub-goal (any part of its name), and a date (today by
  default; yesterday, a weekday name or an ISO date). It shows the result before saving and says what is missing or wrong.
  A duration alone ends now for today and at 12:00 for other days; Change opens it in the full form.
  A session that overlaps saved ones asks first: keep both, trim (the earlier one ends where the later starts), or replace.
- **Settings** (the gear at the top): Sign in with Google (or the signed-in email and Sign out), Sync now, and Export (one JSON file as a backup).

## Data

Live state stays on the phone; logging and the timer never wait for the network or sign-in.
A roll-up writes changed days to a spreadsheet named "Stoa" in the user's own Google Drive.
It runs when the app opens, after a session ends, after a change to goals, sub-goals or today's list, and from Sync now.

### Sign-in

Settings → Sign in with Google opens Google's popup (Google Identity Services). Stoa asks only for `drive.file`:
it sees the files it created and nothing else in the Drive. Each user gets their own sheet, owned by them.
The access token lasts about an hour and is held in memory only, never stored. A later sync renews it without
asking when the browser allows; otherwise the sync badge shows "Sign in again" and one tap renews it.

The OAuth client id in `src/googleAuth.ts` is public by design; there is no client secret.
It belongs to a Google Cloud project with the Drive and Sheets APIs enabled and these JavaScript origins:
`https://qneih.github.io`, `http://localhost:5173` and `http://localhost:4173`.

### Sheet layout

On first sign-in Stoa creates the sheet with a Drive app property (`stoa=sheet`), so a new phone finds it again.
Every tab starts with a header row; rows are read by header name. Values are written raw, so times stay text.

A newer app version adds its new columns to the end of an existing tab's header row; old rows stay as they are.

- `goals`: id, name, rank, archived, color (one of eight palette keys; empty picks one from the id).
  `habits` (sub-goals): id, goal, name, archived, created (local date; empty means older than any session).
  The app reads them, and writes them back after a change on the phone. An empty sheet takes the phone's config.
- `results`: id, habit, name, type (`manual` or `auto`), min_minutes (auto only; empty means 30), archived.
  Created by the daily check-in, never by the app; the app only renames and archives them, merged by id.
  An automatic result is done on every day with at least min_minutes of sessions on its sub-goal; that is
  worked out on the phone and never stored.
- `result_checks`: id, result, day, checked_at, note, minutes_since_last, removed_at. Written by the app when a
  manual result is checked; unchecking fills `removed_at` and keeps the row. A roll-up replaces the rows of each
  changed day, like `logs`. `minutes_since_last` is the sub-goal time since the result's previous check.
- `plans`: date, habit, task, minutes (one row per item; row order is the card order). `plan_days`: date,
  time_budget_min, note. Written by the daily check-in. The app may reorder a day's rows and add a sub-goal
  at 0 minutes; it then rewrites that day's rows. Without a `plan_days` row the budget is the planned total.
- `logs`: id, day, type, habit, task, start, end, note, counter, delta. Written by the app: a roll-up replaces
  the session rows of each changed day with the phone's copy. `id` is made on the phone; `day` is the local
  start date. Sessions are stored unsplit; the stats split them at local midnight.
- Counters are retired: the `counters` tab and the `counter` and `delta` columns stay for old rows, which the
  app neither reads nor removes.

A phone with no sessions restores them from `logs` on sign-in, and a phone with no result checks restores them
from `result_checks`; a phone that had sessions writes all its days.

## Develop

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests for time, stats, results, Today, palette, log helpers, quick input, overlaps and roll-up (fake Sheets API), plus Today and Log screen checks
npm run build     # typecheck and build to dist/
npm run preview   # serve dist/ at http://localhost:4173 (service worker on)
npm run icons     # redraw the PNG icons in public/
```

## Deploy

Every push to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/pages.yml`).
`dist/` is a static site with relative paths, so any static host works. Installing to the home screen needs HTTPS.
The service worker caches the build, and a new deploy is picked up on the next app start.
