# Stoa

A phone app that tracks time spent on your goals, shows today's plan and what got done.
It is an installable offline web app (PWA): plain TypeScript, IndexedDB and no backend.

## Use

- **Today**: time today, done list, time this week per big goal, days since time was last spent, result counters (+1).
- **Plan**: today's plan from the data repo; any habit can also start without a plan.
- **Running**: only the timer and the task. One timer at a time. It survives closing the app; after 4 hours a reopened app asks "still going?".
- **Stop**: an optional one-line note, which goes into the done list.
- **Log**: add a past session, fix it or delete it, or delete a counter tap.
- **Habits**: goals (ranked, archived, never deleted), habits (one field plus a goal, can move to another goal) and counters.
- **Settings**: the data repo and its token, Sync now, and Export (one JSON file as a backup).

## Data

Live state stays on the phone. A roll-up writes changed days to a separate private data repo through the GitHub contents API.
It runs when the app opens, after a stop, after a habit change, and from Sync now.

- `config.json`: goals, habits and counters. The app pulls it and pushes its own edits.
- `plans/YYYY-MM-DD.json`: written by the daily check-in. The app only reads it.
- `logs/YYYY-MM-DD.jsonl`: written by the app, one entry per line, filed under the local start date. Sessions are stored unsplit; the stats split them at local midnight.

A phone with no entries restores them from `logs/` when the repo is connected.

### Token

Create a fine-grained token on GitHub (Settings → Developer settings → Fine-grained tokens):
repository access is only the data repo, the permission is Contents read and write, and it expires after 90 days.
Paste it under Settings on the phone. It is stored in the phone's browser storage only.

## Develop

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests for time, stats, log format and roll-up
npm run build     # typecheck and build to dist/
npm run preview   # serve dist/ at http://localhost:4173 (service worker on)
npm run icons     # redraw the PNG icons in public/
```

## Deploy

`dist/` is a static site with relative paths, so any static host works. Installing to the home screen needs HTTPS.
The service worker caches the build, and a new deploy is picked up on the next app start.
