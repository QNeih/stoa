# Stoa

Offline PWA for tracking time on goals. See `README.md` for features and the data repo layout.

## Layout

- `src/types.ts`: the data contract (config, plan, log entries). It matches the Stoa page in the second brain and the check-in routine in the vault's `CLAUDE.md`. Change all three together.
- `src/time.ts`, `src/stats.ts`, `src/logs.ts`: pure logic (midnight split, dashboard numbers, JSONL, slugs). They are covered by `test/`.
- `src/github.ts`, `src/sync.ts`: contents API client, roll-up and restore. The tests use a fake repo behind a fake fetch.
- `src/db.ts`: IndexedDB store. Every entry change marks its day dirty; roll-up rewrites whole day files from the phone's copy.
- `src/state.tsx`: React app state and all actions (timer, still-going check, sync, counters, log and config edits) in `useStoaState`, shared through `StoaProvider` and read with `useStoa()`. Components hold only form and view state.
- `src/App.tsx`: picks the screen: a running timer takes the whole screen, otherwise the URL hash (`useHashRoute.ts`) picks a tab.
- `src/screens/`: one component per screen (Today, Plan, Running, Stop, Log, SessionForm, Habits, Settings). `src/components/`: Nav, Header (with the sync badge), StillGoingDialog, Toast, HabitSelect.
- `src/format.ts`: display helpers (names by id, active goals, datetime-local values).
- `test/PlanScreen.test.tsx`: component check in jsdom, rendering a screen inside `StoaProvider` with seeded data.
- `sw/sw.js`: service worker template; the Vite plugin in `vite.config.ts` fills in the built file list.

## Rules

- v1 scope is fixed until four weeks of use: no milestones, money line, targets, reminders, sign-in or multi-user.
- No tokens or personal data in this repo. The token lives in the phone's IndexedDB only; personal data lives in the data repo.
- Run `npm test` and `npm run build` before committing.
