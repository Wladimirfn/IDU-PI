# Apply progress — living-loop-harness-b2 (TUI panel pagination + summary + B3 split + B4 read-only Tareas + live Cola)

## Status: complete (B2 + B3 + B4)

## Scope (focused TUI fix in two sub-slices)

The TUI "Cola de acciones" panel in the idu-pi CLI was being used
as a decision surface for the structured task queue (with `👁 Ver /
✓ Aprobar / ✗ Rechazar` per task). The user clarified in Spanish
(paraphrased):

> "I do not understand why you added the 3 options (👁 / ✓ / ✗)
> because I only want in the queue to see what tasks or jobs some
> supervisor or some agentlab is currently working on. That should
> be for me Cola de acciones. ... when some trigger fires or a
> supervisor model or agentlab worked and what was the output, and
> obviously as it happens in Proyecto actual, this is refreshed or
> shown when I am with the cola view open at the moment"

So the B4 fix splits the single "Tareas y cola" menu entry into
two separate home-menu entries and re-purposes the "Cola de
acciones" view as a live read-only feed of supervisor/agentlab/
trigger activity, with auto-refresh while the view is open.

### B2: pagination + summary in the row (already shipped)

Done in the B2 commit (`9191014`). The user reported the panel
was unusable on a normal terminal.

### B3: split the panel into read-only task list + actionable queue (already shipped)

Done in the B3 commit (`9191014` and the follow-up
`0a4f82f`). The B3 split put the read-only "Lista de tareas"
and the actionable "Cola de acciones" in the same panel body,
with the menu options built only from the actionable subset.

### B4: split into two home-menu entries — Tareas (read-only) and Cola de acciones (live feed, no decisions)

The B3 sub-panels were still inside ONE panel with ONE menu (the
"Cola de acciones" actions). The user explicitly asked for:

- "Cola de acciones" = LIVE READ-ONLY VIEW, no menu options per
  task. It must AUTO-REFRESH while open (similar to the existing
  "Proyecto actual" panel which has autoRefresh support at
  `src/cli.ts:4838-4848`).
- The body of "Cola de acciones" must show the most recent
  supervisor activity events + agentlab runs + trigger fires, with
  their kind, summary, and timestamp, sorted by `ts` DESC.
- "Tareas" = read-only task list, paginated, sorted by `createdAt`
  DESC, body shows `id | status | guard | priority | age | category
  | summary` (first 60 chars of details with ellipsis). Page
  navigation only. NO per-task menu options.

The two views are now SEPARATE entries on the home menu (entries
6 and 7). The "Tareas y cola" label is gone from the home menu,
the `formatMainMenu` text, and the `formatTaskQueueStatus` helper
text. The "Tareas" / "Cola de acciones" entries appear in the
command catalog too so `/comandos` lists them.

## Tasks (B4)

- [x] T1 — RED: tests for `sortTasksByCreatedAtDesc` (sorts by
  createdAt DESC; deterministic tie-breaker on id).
- [x] T2 — RED: tests for `formatTareasView`:
  - shows ALL tasks including done and skipped (read-only);
  - sorts by createdAt DESC;
  - paginates 30 tasks into 2 pages of 15/15 (the new page size
    is 15, not 10);
  - truncates the summary to 60 chars with ellipsis
    (`TAREAS_VIEW_SUMMARY_MAX = 60`, NOT 80);
  - shows the empty-state marker for an empty list;
  - clamps out-of-range page index to the last page.
- [x] T3 — RED: tests for the new `cola-acciones-feed` module:
  - `readColaDeAccionesFeed` returns an empty list when stateRoot
    is undefined;
  - includes supervisor activity events (`SupervisorActivityEvent`);
  - includes idu usage events as "trigger fires" (excluding
    `pi_compaction_detected` noise);
  - includes agentlab runs from `stateRoot/agentlabs/runs/`;
  - sorts the merged events by `ts` DESC;
  - combines supervisor + agentlab + trigger into one sorted feed
    (newest first).
- [x] T4 — RED: tests for `formatColaDeAccionesFeed`:
  - renders the empty-state marker for an empty list;
  - renders the count header and rows with kind and ts;
  - body NEVER contains per-task action labels
    (`👁 Ver / ✓ Aprobar / ✗ Rechazar`) because the Cola de
    acciones is a read-only live feed;
  - handles a single-event feed.
- [x] T5 — RED: tests for `paginateColaDeAccionesFeed`:
  - paginates 50 events into 2 pages of 30/20;
  - clamps out-of-range page index to the last page;
  - `COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT` is a positive number.
- [x] T6 — RED: wiring tests for the new home-menu cases:
  - "tareas-view" case shows the 3 tasks read-only with no
    per-task options;
  - "tareas-view" case shows the empty-state marker for an empty
    queue;
  - "cola-view" case renders the live feed with auto-refresh
    enabled (intervalMs === 5000, getContent is a function);
  - "cola-view" body never contains per-task action labels.
- [x] T7 — GREEN: add `sortTasksByCreatedAtDesc`,
  `formatTareasViewRow`, `formatTareasView`,
  `TAREAS_VIEW_SUMMARY_MAX`, `TAREAS_VIEW_PAGE_SIZE_DEFAULT` to
  `src/structured-task-queue.ts`. Pure functions, no behaviour
  change for the existing `formatTareasYCola`,
  `formatTaskListTable`, `formatActionQueueTable`, or
  `renderTaskQueuePanel` helpers.
- [x] T8 — GREEN: add `src/cola-acciones-feed.ts` with the
  `ColaDeAccionesEvent` type, `readColaDeAccionesFeed`,
  `formatColaDeAccionesFeed`, `paginateColaDeAccionesFeed`, and
  `COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT`. The feed reads from
  `readSupervisorActivityEvents(stateRoot)`, the agentlab runs
  directory (`stateRoot/agentlabs/runs/`), and
  `readIduUsageEvents(stateRoot)`; sorts by `ts` DESC; never
  throws and never writes.
- [x] T9 — GREEN: add `runTareasViewTui` and
  `runColaDeAccionesViewTui` to `src/cli.ts`; replace the single
  `tasks` case in `runInteractiveHome` with two separate cases
  (`tareas-view` and `cola-view`); add the two entries to
  `mainMenuOptions`; add the `autoRefresh` setting to the cola
  view's `selectMenuImpl` call (intervalMs 5000, mirroring the
  "Proyecto actual" panel pattern at `src/cli.ts:4838-4848`).
- [x] T10 — GREEN: extend the `InteractiveHomeSelectMenu` type
  signature to accept the optional `settings.autoRefresh` arg so
  the home-menu shim can capture the auto-refresh wiring in tests.
- [x] T11 — GREEN: update `formatMainMenu` in `src/cli-home.ts`:
  entry 6 is "Tareas", entry 7 is "Cola de acciones", entry 8 is
  "Diagnóstico", entry 9 is "Exit". Update `formatTaskQueueStatus`
  text accordingly. Update `runInteractiveHomeWithQuestion` to
  match (option 7 is now the Cola de acciones snapshot, option 8
  is Diagnóstico, option 9 is Exit).
- [x] T12 — GREEN: update the command catalog in
  `src/command-catalog.ts` to expose the two new entries
  ("Tareas" targeting `corepack pnpm cli -- idu-queue-detail`
  and "Cola de acciones" targeting
  `corepack pnpm cli -- idu-supervisor-tick`) so `/comandos`
  lists them.
- [x] T13 — GREEN: update the wiring tests in
  `test/home-menu-tareas-y-cola-wiring.test.ts` to drive the
  new `tareas-view` and `cola-view` cases; update the
  `test/command-catalog-tareas-y-cola.test.ts` to assert the
  new labels; update `test/cli-home.test.ts` to match the new
  9-entry home menu.
- [x] T14 — VERIFY: `corepack pnpm test` is green.
  `tests 1784 · pass 1783 · fail 0 · skipped 1 · duration_ms ~49000`.
  N = 1783 ≥ 1760 ✓.

## TDD Cycle Evidence

Strict-TDD cycle, recorded as RED → GREEN.

### B4 cycle (this commit)

| Step | Phase | Evidence |
|------|-------|----------|
| 1 | RED | Wrote 23 new tests in `test/tareas-view-formatter.test.ts` covering: `sortTasksByCreatedAtDesc` (1), `formatTareasView` (7 — all-tasks, sort, paginate 15, summary 60, empty, out-of-range clamp, `TAREAS_VIEW_PAGE_SIZE_DEFAULT === 15`), `readColaDeAccionesFeed` (6 — empty stateRoot, supervisor events, idu usage events, agentlab runs, sort by ts DESC, ignores pi_compaction_detected, combined feed), `formatColaDeAccionesFeed` (4 — empty, header + rows, no per-task action labels, single event), `paginateColaDeAccionesFeed` (3 — 30/20 split, out-of-range clamp, page size > 0). |
| 2 | RED | Compiled: TS2305 + TS2552 errors for missing exports (`formatTareasView`, `readColaDeAccionesFeed`, etc.) and TS2554 for the `selectMenuImpl` 5th-arg mismatch. |
| 3 | FIX 1 | Added the new exports to `src/structured-task-queue.ts` and `src/cola-acciones-feed.ts`. Updated the `InteractiveHomeSelectMenu` type to accept the 5th `settings` arg. |
| 4 | RED | Ran tests: 5 failures. (a) `formatTareasView` clamps pageIndex 99 to the last page and the LAST task is the OLDEST, not the newest (id was the OLDEST id); (b) 4 tests had type errors (record APIs don't accept `timestamp` and reject the trigger names `"periodic"` / `"schedule"`); (c) the autoRefresh wiring test failed because the shim signature wasn't updated to capture the 5th arg. |
| 5 | FIX 2 | Replaced `require("node:fs")` with the top-of-file `mkdirSync` import (the compiled JS doesn't have `require`). Replaced the invalid trigger names with valid ones from `IduSupervisorTrigger` (`"manual"`, `"after_task_registered"`, `"after_postflight"`). Removed the `timestamp` overrides and wrote JSONL files directly with controlled timestamps (so the DESC sort is deterministic). |
| 6 | FIX 3 | Updated the home-menu wiring test 3 ("cola-view" case) to capture the 5th arg (`settings`) and assert `settings.autoRefresh.intervalMs === 5000` + `typeof settings.autoRefresh.getContent === "function"`. |
| 7 | GREEN | All 1783 tests pass. 0 failures. 1 skipped (legacy). |
| 8 | VERIFY | Re-ran `corepack pnpm test`: 1784 tests, 1783 pass, 0 fail, 1 skipped. N = 1783 ≥ 1760 ✓. |

## What changed (delta over the B3 baseline)

### `src/structured-task-queue.ts` — added new read-only helpers

- `sortTasksByCreatedAtDesc(tasks)` — sorts a `StructuredTask[]` by
  `createdAt` DESC. Stable tie-breaker on `id` so the order is
  deterministic when two tasks share a `createdAt`. Pure.
- `formatTareasViewRow(task, options)` — single-row formatter for
  the read-only "Tareas" TUI view. Mirrors `formatTaskQueueRow` and
  appends the summary column truncated to
  `TAREAS_VIEW_SUMMARY_MAX` (60) chars.
- `formatTareasView(tasks, options)` — paginated read-only body for
  the "Tareas" TUI view. ALL tasks (no actionable filter). Sorted
  by `createdAt` DESC. Default page size 15. Pure.
- `TAREAS_VIEW_SUMMARY_MAX = 60` — constant for the new view
  (legacy `TASK_QUEUE_OPTION_DETAILS_MAX` stays at 80 for
  backward compat with the actionable menu labels).
- `TAREAS_VIEW_PAGE_SIZE_DEFAULT = 15` — constant for the new
  view (legacy `TASK_QUEUE_PAGE_SIZE_DEFAULT` stays at 10 for
  backward compat with the B3 panel).

The legacy `formatTareasYCola`, `formatTaskListTable`,
`formatActionQueueTable`, `renderTaskQueuePanel`, and
`paginateStructuredTaskQueue` are unchanged. The B3 wiring is
preserved so the legacy `runTaskQueuePanelTui` /
`dispatchTaskQueuePanelChoice` flows used by
`idu-queue-detail` and other CLI surfaces keep working as
before.

### `src/cola-acciones-feed.ts` — NEW FILE

- `ColaDeAccionesEvent` type — common shape for the live feed:
  `{ kind: "supervisor" | "agentlab" | "trigger"; summary: string;
  ts: string; source: string }`. Pure.
- `readColaDeAccionesFeed(stateRoot, options)` — reads supervisor
  activity events (`src/supervisor-activity-events.ts`), idu usage
  events (`src/usage-events.ts`), and agentlab runs
  (`stateRoot/agentlabs/runs/`); normalizes each into the common
  shape; sorts by `ts` DESC; returns the merged feed. Pure
  (read-only, never throws, never writes).
- `formatColaDeAccionesFeed(events)` — renders the feed with a
  `Cola de acciones (N):` header, rows of
  `ts | kind | summary`. The body NEVER carries per-task action
  labels (👁 / ✓ / ✗) because the Cola de acciones is a read-only
  live feed.
- `paginateColaDeAccionesFeed(events, pageIndex, pageSize)` —
  pagination helper for the feed (default page size 30). Pure.
- `COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT = 30` — constant.

### `src/cli.ts` — added two new TUI flows

- `runTareasViewTui(runtime, selectMenuImpl)` — paginated read-only
  task list. Body is `formatTareasView` output. Menu options are
  ONLY `← Prev`, `Next →`, `↻ Actualizar`, `← Volver`, `Exit`. No
  per-task action labels. Page size 15.
- `runColaDeAccionesViewTui(status, selectMenuImpl)` — live
  read-only feed. Body is `formatColaDeAccionesFeed` output. Menu
  options are ONLY `↻ Actualizar ahora`, `← Volver`, `Exit`. NO
  per-task action labels. Wired with `autoRefresh` at
  `intervalMs: COLA_DE_ACCIONES_AUTOREFRESH_MS = 5000` (mirrors
  the existing "Proyecto actual" panel pattern at
  `src/cli.ts:4838-4848`).
- `runInteractiveHome` — the single `tasks` case was replaced by
  two separate cases: `tareas-view` (calls `runTareasViewTui`) and
  `cola-view` (calls `runColaDeAccionesViewTui`).
- `mainMenuOptions` — replaced the `Tareas y cola` entry with
  `Tareas` (value `tareas-view`) and `Cola de acciones` (value
  `cola-view`).
- `InteractiveHomeSelectMenu` type — extended to accept the
  optional 5th `settings.autoRefresh` arg so the home-menu shim
  used by tests can capture the auto-refresh wiring.
- `runInteractiveHomeWithQuestion` — option numbers re-mapped: 6
  is "Tareas", 7 is "Cola de acciones" (returns the formatted
  feed snapshot, since the non-TUI surface has no auto-refresh),
  8 is "Diagnóstico", 9 is Exit.

### `src/cli-home.ts` — updated menu text

- `formatMainMenu` — entry 6 is "Tareas", 7 is "Cola de
  acciones", 8 is "Diagnóstico", 9 is Exit.
- `formatTaskQueueStatus` — header is now "Tareas"; the legacy
  "Tareas y cola" label is gone; text now reflects the read-only
  intent ("Vista de solo lectura del task list estructurado" +
  "MVP seguro: esta pantalla no ejecuta IA ni AgentLabs").

### `src/command-catalog.ts` — added two entries

- `CLI_COMMANDS` — replaced the `Tareas y cola` entry with two
  new entries: `Tareas` (targeting
  `corepack pnpm cli -- idu-queue-detail`) and `Cola de acciones`
  (targeting `corepack pnpm cli -- idu-supervisor-tick`). Both
  appear in the `formatCommandCatalog` output so `/comandos` lists
  them.

## Test summary

`tests 1784 · pass 1783 · fail 0 · skipped 1 · duration_ms ~49000`

(Before B4: 1761 tests, 1760 pass, 0 fail, 1 skipped. After B4:
1784 tests, 1783 pass, 0 fail, 1 skipped. Added 23 new tests
across `test/tareas-view-formatter.test.ts` and rewrote the
wiring/header assertions in
`test/home-menu-tareas-y-cola-wiring.test.ts`,
`test/command-catalog-tareas-y-cola.test.ts`, and
`test/cli-home.test.ts`. Net +23 passes over the B3 baseline,
0 new failures, 0 regressions.)

### New tests in this B4 commit

`test/tareas-view-formatter.test.ts` (23 tests):

- `sortTasksByCreatedAtDesc sorts by createdAt DESC (newest first)`
- `formatTareasView shows ALL tasks including done and skipped`
- `formatTareasView sorts tasks by createdAt DESC`
- `formatTareasView paginates 30 tasks into 2 pages of 15/15`
- `formatTareasView truncates the summary to 60 chars with ellipsis`
- `formatTareasView shows the empty-state marker for an empty list`
- `TAREAS_VIEW_PAGE_SIZE_DEFAULT is 15`
- `formatTareasView clamps out-of-range page index to the last page`
- `readColaDeAccionesFeed returns an empty list when stateRoot is undefined`
- `readColaDeAccionesFeed includes supervisor activity events`
- `readColaDeAccionesFeed includes idu usage events as trigger fires`
- `readColaDeAccionesFeed includes agentlab runs from agentlabs/runs`
- `readColaDeAccionesFeed sorts the merged events by ts DESC`
- `formatColaDeAccionesFeed renders the empty-state marker for an empty list`
- `formatColaDeAccionesFeed renders the count header and rows with kind and ts`
- `formatColaDeAccionesFeed body never contains per-task action labels`
- `paginateColaDeAccionesFeed paginates 50 events into 2 pages of 30/20`
- `COLA_DE_ACCIONES_PAGE_SIZE_DEFAULT is a positive number`
- `readColaDeAccionesFeed ignores pi_compaction_detected events`
- `readColaDeAccionesFeed combines supervisor + agentlab + trigger into one sorted feed`
- `paginateColaDeAccionesFeed clamps out-of-range page index to the last page`
- `formatColaDeAccionesFeed handles a single-event feed`
- `formatTareasView renders the truncated id and count header for a 1-task queue` (wiring sanity check)

### Updated tests in this B4 commit

- `test/home-menu-tareas-y-cola-wiring.test.ts` — rewrote 5 tests
  to drive the new `tareas-view` and `cola-view` home-menu cases
  instead of the legacy single `tasks` case. The "cola-view" test
  captures the 5th `settings` arg and asserts `autoRefresh` is
  wired with `intervalMs === 5000` and a callable `getContent`.
- `test/command-catalog-tareas-y-cola.test.ts` — replaced the 2
  legacy "Tareas y cola" assertions with 3 new assertions for the
  "Tareas" and "Cola de acciones" entries.
- `test/cli-home.test.ts` — updated
  `main and installation menus render unified control options` to
  expect entries 6-9 of the new menu (was 6-8 of the old menu).

## UX behaviour after the fix

### Home menu

```text
1. Configurar IDU-Pi
2. Proyecto actual
3. Telegram remoto
4. Modelos y perfiles
5. Supervisor
6. Tareas            ← new: read-only task list, paginated 15/page
7. Cola de acciones  ← new: live read-only feed, auto-refresh 5s
8. Diagnóstico
9. Exit
```

### Tareas view (entry 6)

Read-only paginated task list, sorted by `createdAt` DESC. The
body shows `id | status | guard | priority | age | category |
summary` (first 60 chars of details with ellipsis). All tasks
(including `done` and `skipped`) are visible. Menu options are
ONLY `← Prev`, `Next →`, `↻ Actualizar`, `← Volver`, `Exit`. There
are NO per-task action labels.

```text
Tareas (3) — página 1/1:
task-abc1111 | proposed | —        | P3 | 11h 34m | bug      | Pending bug
task-def2222 | done     | —        | P5 |  2d 11h | feature  | Done task
task-ghi3333 | paused   | risky    | P5 |  1d 11h | bug      | Needs confirmation
```

### Cola de acciones view (entry 7)

Live read-only feed of supervisor activity + agentlab runs +
trigger fires, sorted by `ts` DESC. The body shows
`ts | kind | summary`. Menu options are ONLY `↻ Actualizar ahora`,
`← Volver`, `Exit`. There are NO per-task action labels. The view
auto-refreshes every 5000 ms while open (mirrors the "Proyecto
actual" panel pattern).

```text
Cola de acciones (3):
2026-06-10T12:00:00.000Z | agentlab   | agentlab security (test-project) status=completed — No issues
2026-06-10T11:55:00.000Z | trigger    | trigger fire: cli/idu-supervisor-tick
2026-06-10T11:50:00.000Z | supervisor | supervisor supervisor_tick/orchestrator_requested status=completed (manual)
```

## Open follow-ups (not in scope for this slice)

None for B4. The next follow-up, if any, would be to add a
"Reasignar prioridad" action to the menu — but the user has not
asked for it. The user explicitly said the Cola de acciones must
be read-only, so no actions are added there.

## Next step

Commit this fix with the message
`fix(idu-pi): Tareas (read-only) and Cola de acciones (live feed, no decisions)`
and push to main.

## Push status

Local commit `64c6773` is ready. The harness safety policy
("Gentle AI safety policy requires interactive confirmation before
this command") blocked `git push origin main` from the worker
side, so the commit is currently local-only on
`main` (1 commit ahead of `origin/main`). The previous commit
`8051256` is at `origin/main` and the revert `ead299b` plus the
new B4 fix `64c6773` need to be pushed manually (or by the
parent session) to update `origin/main` to the B4 state.
