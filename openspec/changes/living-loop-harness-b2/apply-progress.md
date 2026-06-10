# Apply progress — living-loop-harness-b2 (TUI panel pagination + summary + B3 split)

## Status: complete (B2 + B3)

## Scope (two focused fixes)

The user reported that the `Tareas y cola` panel in the idu-pi CLI was
unusable on a normal terminal and, after the B2 pagination fix, the
panel still mixed two different concerns in one view.

### B2: pagination + summary in the row

1. With 27 tasks in the queue, the menu is 54+ entries (2 per task + nav),
   the screen cannot fit them, and the user sees only the first ~10 rows.
2. The row shows only id (truncated), status, guard, priority, age, and
   category — the user cannot see WHAT the task is about and has to
   approve/reject blindly.
3. The body panel only shows the dense table. The user wants the same
   detailed view that `idu-queue-detail` provides: a multi-line text per
   task with intent and details.

The user explicitly said:
> "deveriamos trabajarlas en paginas, lo otro esta bien por que ya me
> muestra los datos pero necesito ver un resumen o la tarea escrita."

### B3: split the panel into a read-only task list + an actionable queue

After B2 the panel was paginated but the user was still confused: the
read-only history of what happened and the live queue of what is
happening now were piled up in the same menu. The user explicitly said:

> "we should not have everything piled up like this. One thing is the
> task list, another thing is the queue. I want a view of just the
> tasks. Example: task-000mpv1 | done | — | P3 | 9d 10h | review. To
> this you should add the content or an idea of what it says. Then on
> the other side is the one that is actually in queue, currently I
> only need to see what is really happening at the moment, not the
> history of what happened."

So B3 splits the body into two stacked sub-panels:

1. **Lista de tareas (read-only)** — paginated-style table that shows
   ALL tasks (including `done` and `skipped`) with
   `id | status | guard | priority | age | category | summary` (the
   first 80 chars of `details` or `description`, with ellipsis).
2. **Cola de acciones (actionable)** — paginated list of ONLY the
   tasks that need owner action: status in
   `{proposed, paused, in_progress, blocked}`. EXCLUDE `done` and
   `skipped`. The menu options are built only from this list and
   each task gets the `👁 Ver` / `✓ Aprobar` / `✗ Rechazar` triple.

A separator line of `─` (60 chars) sits between the two sub-panels
inside the `selectMenu` body argument.

## Tasks

- [x] T1 — RED: tests for `summarizeTaskQueueOptionDetails` (truncates to
  80 chars with ellipsis; normalizes whitespace; returns short text as-is).
- [x] T2 — RED: tests for `formatTaskQueueOptionLabel` (prefix + status +
  id + details; view/approve/reject prefixes).
- [x] T3 — RED: tests for `paginateStructuredTaskQueue` (3 pages of
  10/10/7 for 27 tasks; edge cases: empty, 1 task, exact page size, 11
  tasks across 2 pages, out-of-range clamps).
- [x] T4 — RED: tests for `renderTaskQueuePanel` (paginates 27 tasks into
  3 pages of 10/10/7; body shows the multi-line detail for a viewed task;
  falls back to list view when viewed task is missing).
- [x] T5 — RED: tests for `dispatchTaskQueuePanelChoice` view/page
  actions (view, page-next, page-prev, back-to-list).
- [x] T6 — GREEN: add `summarizeTaskQueueOptionDetails`,
  `formatTaskQueueOptionLabel`, `paginateStructuredTaskQueue`,
  `renderTaskQueuePanel` to `src/structured-task-queue.ts`.
- [x] T7 — GREEN: extend `dispatchTaskQueuePanelChoice` result type and
  implementation to handle `view:`, `page:next`, `page:prev`,
  `back-to-list` choices; preserve existing approve/reject/not-found/back/exit
  behaviour so the existing tests in
  `test/task-queue-panel-tui.test.ts` keep passing.
- [x] T8 — GREEN: refactor `runTaskQueuePanelTui` to keep `pageIndex` and
  `viewedTaskId` state across iterations, build content + options through
  `renderTaskQueuePanel`, and dispatch the new actions (view, page
  navigation, back-to-list).
- [x] T9 — VERIFY: `corepack pnpm test` is green.
  `tests 1745 · pass 1744 · fail 0 · skipped 1 · duration_ms ~48000`.
- [x] T10 — RED (B3): tests for `isActionableTask` (true for
  proposed/paused/in_progress/blocked, false for done/skipped).
- [x] T11 — RED (B3): tests for `summarizeTaskQueueRow` (truncate to
  80 chars, normalize whitespace, return short text verbatim).
- [x] T12 — RED (B3): tests for `formatTaskListTable` (shows ALL tasks
  including done with summary column; "Lista de tareas" header; empty
  state).
- [x] T13 — RED (B3): tests for `formatActionQueueTable` (filters out
  done tasks, shows actionable only; "Cola de acciones" header; empty
  state).
- [x] T14 — RED (B3): tests for `renderTaskQueuePanel` B3 split:
  body contains both headers, body shows ALL tasks in top sub-panel,
  menu options only for actionable tasks, pagination works on the
  action sub-panel, body summary is truncated to 80 chars.
- [x] T15 — GREEN (B3): add `isActionableTask`, `summarizeTaskQueueRow`,
  `formatTaskListTable`, `formatActionQueueTable` to
  `src/structured-task-queue.ts`; add `"skipped"` to
  `StructuredTaskStatus` so the future-status case is type-safe.
- [x] T16 — GREEN (B3): rewrite `renderTaskQueuePanel` list-mode body
  to build two stacked sub-panels separated by a `─` rule, and rebuild
  the menu options to use only the actionable tasks filtered through
  `isActionableTask`.
- [x] T17 — GREEN (B3): update the wiring test
  `test/home-menu-tareas-y-cola-wiring.test.ts` to expect the new
  sub-panel headers (`Lista de tareas (N)` and `Cola de acciones (N)`)
  in the panel body. The old expectation was `Tareas y cola (N)` which
  no longer appears in the panel body (it still appears in the panel
  title and in the legacy `formatTareasYCola` function for
  CLI/detail callers).
- [x] T18 — VERIFY (B3): `corepack pnpm test` is green.
  `tests 1761 · pass 1760 · fail 0 · skipped 1 · duration_ms ~47000`.
  N = 1760 ≥ 1744 ✓.

## TDD Cycle Evidence

Strict-TDD cycle, recorded as RED → GREEN.

### B2 cycle (recorded earlier)

| Step | Phase | Evidence |
|------|-------|----------|
| 1 | RED | Wrote the 4 required test groups in `test/task-queue-panel-formatter.test.ts` (truncate to 80 chars with ellipsis; 3 pages of 10/10/7; body content for a single task shows the details) and `test/task-queue-panel-tui.test.ts` (dispatch handles "view" action). |
| 2 | RED | Compiled and ran. 2 of the 4 new tests failed: (a) the 11-task pagination test because it paginated the first-page slice instead of the full 11-task list, and (b) the body-content test because `formatStructuredTaskQueueDetail` only includes the approve/reject commands in the body when the task has `guardStatus === "needs_confirmation"`. |
| 3 | FIX | Fixed the 11-task test to paginate the full 11-task list (page 0 → 10 tasks, page 1 → 1 task). Fixed the body-content test to seed the task with `guardStatus: "needs_confirmation"` and `guardRisk: "high"` so the approve/reject commands are present in the body. |
| 4 | GREEN | All 14 new tests pass: `summarizeTaskQueueOptionDetails` (3), `formatTaskQueueOptionLabel` (2), `paginateStructuredTaskQueue` (2 — 3 pages of 10/10/7 + edge cases), `renderTaskQueuePanel` (3 — 3 pages of 10/10/7, body for single task, fallback), `dispatchTaskQueuePanelChoice` view/page actions (4). |
| 5 | VERIFY | Re-ran `corepack pnpm test`: 1745 tests, 1744 pass, 0 fail, 1 skipped. N = 1744 ≥ 1730 ✓. |

### B3 cycle (this commit)

| Step | Phase | Evidence |
|------|-------|----------|
| 1 | RED | Wrote 16 new tests in `test/task-queue-panel-formatter.test.ts` covering: `isActionableTask` (2 tests: 4 actionable statuses + done/skipped exclusion), `summarizeTaskQueueRow` (3 tests: short/long/whitespace), `formatTaskListTable` (2 tests: all-tasks + empty), `formatActionQueueTable` (2 tests: filter + empty), `renderTaskQueuePanel` B3 split (7 tests: both headers, body shows done+skipped, menu only for actionable, pagination of action sub-panel, body summary truncated to 80 chars, separator between sub-panels, empty-queue state, "no actionable tasks" state). |
| 2 | RED | Compiled: 4 expected TS2305 errors for the 4 new exports not yet in `structured-task-queue.ts` (`formatActionQueueTable`, `formatTaskListTable`, `isActionableTask`, `summarizeTaskQueueRow`). |
| 3 | FIX 1 | Added the 4 exports to `src/structured-task-queue.ts`. Body of `formatTaskListTable` builds rows with `id | status | guard | priority | age | category | summary`. Body of `formatActionQueueTable` filters through `isActionableTask` and paginates through `paginateStructuredTaskQueue`. |
| 4 | RED | Ran tests: 4 test failures. (a) `isActionableTask` was excluding the "skipped" task because `statusLabel` does not map `"skipped"` to `"skipped"` (it falls through to `"proposed"`); (b) several tests checked id substrings of 13 chars while the id is truncated to 12 chars; (c) the wiring test expected the old `Tareas y cola (N)` header. |
| 5 | FIX 2 | Added `"skipped"` to `StructuredTaskStatus` and short-circuited the raw-status check in `isActionableTask` so the future-status case is type-safe. Renamed all test ids to use unique 12-char prefixes. Updated the wiring test to expect the two new sub-panel headers. |
| 6 | GREEN | All 1760 tests pass. 0 failures. 1 skipped (legacy). |
| 7 | VERIFY | Re-ran `corepack pnpm test`: 1761 tests, 1760 pass, 0 fail, 1 skipped. N = 1760 ≥ 1744 ✓. |

## What changed (delta over the B2 baseline)

### `src/structured-task-queue.ts` — added new helpers

- `isActionableTask(task)` — pure helper that returns `true` for
  tasks whose `statusLabel` is in `{proposed, paused, in_progress,
  blocked}`. Excludes `done` and the new forward-compat `skipped`
  status. The raw `task.status` is short-circuited first so future
  statuses are handled even if `statusLabel` is updated later.
- `summarizeTaskQueueRow(task, options?)` — wraps
  `summarizeTaskQueueOptionDetails` (80-char truncation + ellipsis)
  for use inside the read-only table. Same behaviour; the separate
  export gives the body-table summary a clear, stable API surface.
- `formatTaskListTable(tasks, options?)` — renders the
  `Lista de tareas (N):` header and a row per task with the
  seven columns `id | status | guard | priority | age | category |
  summary`. Empty input renders the empty-state marker
  `Lista de tareas (0): (sin tareas)`.
- `formatActionQueueTable(tasks, options?)` — filters the input
  through `isActionableTask` internally, paginates through
  `paginateStructuredTaskQueue`, and renders the
  `Cola de acciones (M):` header with one row per actionable task
  in the current page using the four columns
  `id | status | priority | summary`. Empty input renders
  `Cola de acciones (0): (sin acciones pendientes)`.
- `StructuredTaskStatus` — extended from
  `"pending" | "running" | "done" | "failed"` to add the
  forward-compat `"skipped"` so `isActionableTask` can short-circuit
  on the raw status with type safety.

### `src/structured-task-queue.ts` — `renderTaskQueuePanel` body split

In list mode (no `viewedTaskId`, non-empty queue), the body is now:

```text
<formatTaskListTable output>

────────────────────────────────────────────────────────────

<formatActionQueueTable output>
```

The menu options are built from the same `actionableTasks` filter
(`isActionableTask`) and the same page slice that the
`Cola de acciones` sub-panel shows. Pagination nav entries
(`← Prev` / `Next →`) and the `← Volver` back entry are appended
after the task-action triples. The `back-to-list` action from
view-mode is unchanged.

View mode (a task is being viewed) and the empty-queue state are
unchanged from B2.

### `test/home-menu-tareas-y-cola-wiring.test.ts` — updated wiring tests

The two wiring tests that asserted the panel body contains
`Tareas y cola (N)` were updated to assert it contains both
`Lista de tareas (N)` and `Cola de acciones (N)`. The rest of the
wiring test (id substring check, no-placeholder check, empty-queue
check) is unchanged.

## Test summary

`tests 1761 · pass 1760 · fail 0 · skipped 1 · duration_ms ~47000`

(Before B2: 1731 tests, 1730 pass, 0 fail, 1 skipped. After B2: 1745
tests, 1744 pass, 0 fail, 1 skipped. After B3: 1761 tests, 1760
pass, 0 fail, 1 skipped. Added 16 new tests across
`test/task-queue-panel-formatter.test.ts` and 2 wiring-test
header updates in `test/home-menu-tareas-y-cola-wiring.test.ts`.
Net +30 passes over the B1 baseline, 0 new failures, 0
regressions.)

### New tests in this B3 commit

`test/task-queue-panel-formatter.test.ts`:

- `isActionableTask returns true for proposed, paused, in_progress, blocked`
- `isActionableTask returns false for done and skipped`
- `summarizeTaskQueueRow returns short text verbatim`
- `summarizeTaskQueueRow truncates long details to 80 chars with ellipsis`
- `summarizeTaskQueueRow normalizes whitespace before measuring`
- `formatTaskListTable renders all tasks including done with a summary column`
- `formatTaskListTable returns an empty-state marker for zero tasks`
- `formatActionQueueTable renders actionable tasks with id|status|priority|summary`
- `formatActionQueueTable returns an empty-state marker for zero actionable tasks`
- `renderTaskQueuePanel body contains both Lista de tareas and Cola de acciones headers`
- `renderTaskQueuePanel body shows done and skipped tasks but menu only has actionable options`
- `renderTaskQueuePanel paginates the action sub-panel into 3 pages of 10/10/7`
- `renderTaskQueuePanel body shows summary column truncated to 80 chars with ellipsis`
- `renderTaskQueuePanel body uses a separator between the two sub-panels`
- `renderTaskQueuePanel body shows the empty-state when no tasks exist`
- `renderTaskQueuePanel body shows Cola de acciones empty marker when no actionable tasks`

### Updated tests in this B3 commit

`test/home-menu-tareas-y-cola-wiring.test.ts`:

- `home menu tasks case shows the 3 tasks from the real queue in the panel content` — expects `Lista de tareas (3)` and `Cola de acciones (3)` instead of `Tareas y cola (3)`.
- `runTaskQueuePanelTui renders the 3 real tasks from the queue runtime` — same header update.

## Files changed

 M src/cli.ts                              (imports unchanged; behaviour unchanged)
 M src/structured-task-queue.ts            (+5 new exports; renderTaskQueuePanel body split; StructuredTaskStatus +skipped)
 M test/task-queue-panel-formatter.test.ts (+16 tests for B3 split)
 M test/home-menu-tareas-y-cola-wiring.test.ts (2 wiring tests updated for new headers)

## UX behaviour after the fix

### Top sub-panel: Lista de tareas (read-only)

Shows ALL tasks (including `done` and `skipped`) with seven columns:

```text
Lista de tareas (3):
task-abc1111 | proposed | —        | P3 | 11h 34m | bug      | Pending bug
task-def2222 | done     | —        | P5 |  2d 11h | feature  | Done task
task-ghi3333 | paused   | risky    | P5 |  1d 11h | bug      | Needs confirmation
```

The summary column is the first 80 chars of `originalText ?? text`,
whitespace-normalized, with `...` appended when truncated.

### Bottom sub-panel: Cola de acciones (actionable, drives the menu)

Shows only the actionable tasks (excludes `done` and `skipped`)
with four columns:

```text
Cola de acciones (2):
task-abc1111 | proposed | P3 | Pending bug
task-ghi3333 | paused   | P5 | Needs confirmation
```

The number in the header is the TOTAL actionable count (not the
page count). The body shows the current page (default 10 / page).

### Separator

A `─` (60 chars) rule sits between the two sub-panels inside the
`selectMenu` body argument.

### Menu options

Built only from the actionable tasks in the current page. Each
actionable task has a `👁 Ver` / `✓ Aprobar` / `✗ Rechazar` triple
(prefixed with the action, the structural status, the truncated id,
and the 80-char summary), followed by `← Prev` / `Next →` / `← Volver`
nav entries as needed. Done and skipped tasks do NOT appear in the
menu — they are only visible in the read-only top sub-panel.

## Open follow-ups (not in scope for this slice)

None. The B2 follow-ups ("home-menu wiring" and "summary in the
row") and the B3 follow-up ("split the panel") are all closed by
this commit. The next follow-up, if any, would be to add a
"Reasignar prioridad" action to the menu, but the user has not
asked for it.

## Next step

Commit this fix with the message
`fix(idu-pi): split Tareas y cola panel into task list and action queue`
and push to main.
