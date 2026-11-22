# Stoa

A phone app that tracks time spent on your goals, shows today's plan and what got done.
It is an installable offline web app (PWA): React and TypeScript, IndexedDB, and a Google Sheet in the user's own Drive instead of a backend.

## Use

- **Today**: time today, done list, time this week per big goal, days since time was last spent, result counters (+1).
- **Plan**: today's plan from the Stoa sheet, with planned and spent minutes per item and the time spent off the plan. Any habit can also start without a plan.
- **Running**: only the timer and the task. One timer at a time. Forgot to start? Change its start time (up to 24 hours back), or set "Started at" under Plan. It survives closing the app; after 4 hours a reopened app asks "still going?".
- **Stop**: an optional one-line note, which goes into the done list.
- **Log**: add a past session, fix it or delete it, or delete a counter tap.
- **Habits**: goals (ranked, archived, never deleted), habits (one field plus a goal, can move to another goal) and counters.
- **Settings**: Sign in with Google (or the signed-in email and Sign out), Sync now, and Export (one JSON file as a backup).

## Data

Live state stays on the phone; logging and the timer never wait for the network or sign-in.
A roll-up writes changed days to a spreadsheet named "Stoa" in the user's own Google Drive.
It runs when the app opens, after a stop, after a habit change, and from Sync now.

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

- `goals`: id, name, rank, archived. `habits`: id, goal, name, archived. `counters`: id, goal, name.
  The app reads them, and writes them back after a change on the phone. An empty sheet takes the phone's config.
- `plans`: date, habit, task, minutes (one row per item). `plan_days`: date, time_budget_min, note.
  Written by the daily check-in; the app only reads them. Without a `plan_days` row the budget is the planned total.
- `logs`: id, day, type, habit, task, start, end, note, counter, delta. Written by the app: a roll-up replaces
  all rows of each changed day with the phone's copy. `id` is made on the phone; `day` is the local start date.
  A counter tap keeps its time in `start`. Sessions are stored unsplit; the stats split them at local midnight.

A phone with no entries restores them from `logs` on sign-in; a phone with entries writes all its days.

## Develop

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests for time, stats, log helpers and roll-up (fake Sheets API), plus a Plan screen check
npm run build     # typecheck and build to dist/
npm run preview   # serve dist/ at http://localhost:4173 (service worker on)
npm run icons     # redraw the PNG icons in public/
```

## Deploy

Every push to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/pages.yml`).
`dist/` is a static site with relative paths, so any static host works. Installing to the home screen needs HTTPS.
The service worker caches the build, and a new deploy is picked up on the next app start.
