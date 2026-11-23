# Stoa

Offline PWA for tracking time on goals. See `README.md` for features, sign-in and the sheet layout.

## Layout

- `src/types.ts` and `TABS` in `src/sheets.ts`: the data contract (goals, sub-goals, results, result checks, plan, sessions) and the sheet layout. They match the Stoa page in the second brain and the check-in routine in the vault's `CLAUDE.md`. Change all three together. A sub-goal is a `Habit` in code and a row of the `habits` tab. New columns go at the end of a tab's list in `TABS`; opening a sheet appends them to its header row.
- `src/time.ts`, `src/stats.ts`, `src/results.ts`, `src/logs.ts`: pure logic (midnight split, dashboard and goal stats, time per week/month/year, automatic results and the done list, minutes since the last check, day of an entry, slugs). They are covered by `test/`.
- `src/palette.ts`: the eight goal colours (a goal stores the key), the colour for a goal without one or a new goal, and contrast helpers; `test/palette.test.ts` checks contrast against the chart surfaces and text.
- `src/googleAuth.ts`: Google Identity Services token client, loaded on demand. The access token stays in memory; `AuthError` means the user must sign in.
- `src/sheets.ts`, `src/sync.ts`: Drive and Sheets REST client (find or create the sheet and its tabs and header columns, read tabs, rewrite tabs), row mapping, roll-up and restore. The tests use a fake Drive and Sheets API behind a fake fetch.
- `src/db.ts`: IndexedDB store. Every session or result check change marks its day dirty; roll-up rewrites the session rows of a dirty day in `logs` and its `result_checks` rows from the phone's copy (old counter rows stay). Entries and checks carry `uid`, their row id in the sheet. A plan the phone reorders or extends is marked dirty and replaces its date's `plans` rows. Results come from the check-in; the phone's renames and archiving are merged onto the sheet's rows by id.
- `src/state.tsx`: React app state and all actions (timer, still-going check, sync, log and config edits) in `useStoaState`, shared through `StoaProvider` and read with `useStoa()`. Components hold only form and view state.
- `src/App.tsx`: picks the screen: a running timer takes the whole screen, otherwise the URL hash (`useHashRoute.ts`) picks a tab.
- `src/screens/`: one component per screen (Today, Plan, Running, Stop, Log, SessionForm, Habits, Settings). `src/components/`: Nav, Header (with the sync badge), StillGoingDialog, Toast, HabitSelect.
- `src/format.ts`: display helpers (names by id, active goals, datetime-local values).
- `test/PlanScreen.test.tsx`: component check in jsdom, rendering a screen inside `StoaProvider` with seeded data.
- `sw/sw.js`: service worker template; the Vite plugin in `vite.config.ts` fills in the built file list.

## Rules

- The app improves continuously; there is no frozen scope. Accounts are Google sign-in with one sheet per user in their own Drive, nothing more. Forgotten-timer reminders are out for now (the still-going check on reopen stays).
- No tokens, secrets or personal data in this repo (the OAuth client id is public). The access token lives in memory only, never in IndexedDB; personal data lives in each user's sheet.
- The CSP in `vite.config.ts` allows only Google sign-in and the Drive and Sheets APIs; widen it only for a call the app really makes.
- Run `npm test` and `npm run build` before committing.
