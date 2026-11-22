# Stoa

Offline PWA for tracking time on goals. See `README.md` for features, sign-in and the sheet layout.

## Layout

- `src/types.ts` and `TABS` in `src/sheets.ts`: the data contract (config, plan, log entries) and the sheet layout. They match the Stoa page in the second brain and the check-in routine in the vault's `CLAUDE.md`. Change all three together.
- `src/time.ts`, `src/stats.ts`, `src/logs.ts`: pure logic (midnight split, dashboard numbers, day of an entry, slugs). They are covered by `test/`.
- `src/googleAuth.ts`: Google Identity Services token client, loaded on demand. The access token stays in memory; `AuthError` means the user must sign in.
- `src/sheets.ts`, `src/sync.ts`: Drive and Sheets REST client (find or create the sheet, read tabs, rewrite tabs), row mapping, roll-up and restore. The tests use a fake Drive and Sheets API behind a fake fetch.
- `src/db.ts`: IndexedDB store. Every entry change marks its day dirty; roll-up rewrites all `logs` rows of a dirty day from the phone's copy. Entries carry `uid`, their row id in the sheet.
- `src/state.tsx`: React app state and all actions (timer, still-going check, sync, counters, log and config edits) in `useStoaState`, shared through `StoaProvider` and read with `useStoa()`. Components hold only form and view state.
- `src/App.tsx`: picks the screen: a running timer takes the whole screen, otherwise the URL hash (`useHashRoute.ts`) picks a tab.
- `src/screens/`: one component per screen (Today, Plan, Running, Stop, Log, SessionForm, Habits, Settings). `src/components/`: Nav, Header (with the sync badge), StillGoingDialog, Toast, HabitSelect.
- `src/format.ts`: display helpers (names by id, active goals, datetime-local values).
- `test/PlanScreen.test.tsx`: component check in jsdom, rendering a screen inside `StoaProvider` with seeded data.
- `sw/sw.js`: service worker template; the Vite plugin in `vite.config.ts` fills in the built file list.

## Rules

- v1 scope is fixed until four weeks of use: no milestones, money line, targets or reminders. Accounts are Google sign-in with one sheet per user in their own Drive, nothing more.
- No tokens, secrets or personal data in this repo (the OAuth client id is public). The access token lives in memory only, never in IndexedDB; personal data lives in each user's sheet.
- The CSP in `vite.config.ts` allows only Google sign-in and the Drive and Sheets APIs; widen it only for a call the app really makes.
- Run `npm test` and `npm run build` before committing.
