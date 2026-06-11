# Apply progress — 2026-06-11-idu-pi-safety-fixes

## Status: complete

## Tasks
- [x] T1 — Fix 1: trigger opt-in defaults to disabled (scripts/idu-supervisor-tick.ps1)
- [x] T2 — Fix 2: idu-model-invocation-status uses runtime.labDbPath (src/cli.ts)
- [x] T3 — Fix 3: detectTools() tries corepack pnpm first (src/idu-installer.ts)
- [x] T4 — Fix 4: runBibliotecarioInit() takes projectId (src/cli-bibliotecario-init.ts + src/cli.ts)
- [x] T5 — Fix 5: MCP wrappers for idu-bibliotecario-init, idu-model-invocation-status, idu-skill-rating, idu-supervisor-trigger
- [x] T6 — Fix 6: idu-onboard-project CLI + smoke test
- [x] T7 — GREEN: tests for all 6 fixes (TDD-first)
- [x] T8 — verification: corepack pnpm test is green

## TDD Cycle Evidence
- T1: parent scripted the trigger opt-in change directly with a regression test coming from the worker.
- T2-T4: parent scripted the fixes; tests added in T7 by the worker.
- T5-T6 RED: added hermetic MCP wrapper tests and onboard smoke test before implementation; initial compile/test run failed because `cli-onboard-project` and MCP tools were missing.
- T5-T6 GREEN: implemented MCP wrappers and `runOnboardProject`; targeted tests passed.
- T8 verification: `corepack pnpm test` passed: pass 1821 fail 0 (1 skipped).
- Manual smoke: `node dist/src/cli.js idu-onboard-project` against a fresh tmp runtime exited 0 and created `lab.db` plus `supervisor-trigger.json`.

## Test Summary
- `corepack pnpm test` — pass 1821 fail 0.
- Manual smoke — pass.

## Files changed
- `src/mcp-server.ts`
- `src/cli-onboard-project.ts`
- `src/cli.ts`
- `test/mcp-bibliotecario-init.test.ts`
- `test/mcp-model-invocation-status.test.ts`
- `test/mcp-skill-rating.test.ts`
- `test/mcp-supervisor-trigger.test.ts`
- `test/onboard-project.test.ts`
- `test/mcp-server.test.ts`
- `test/cli-bibliotecario-init.test.ts`
- `openspec/changes/2026-06-11-idu-pi-safety-fixes/apply-progress.md`

## Follow-up: how to enable the trigger (Fix 1)
The trigger is now DISABLED by default. Operators must:
- export `IDU_PI TRIGGER_ENGINE=1` before invoking `idu-supervisor-tick.ps1`, OR
- set the env var in the Windows Task Scheduler environment for the task.

The `idu-supervisor-trigger enable` CLI command (already shipped in B2 carry-over) toggles a separate user-facing opt-in at `<stateRoot>/supervisor-trigger.json`. The two are independent. The first gates whether the engine runs; the second gates whether the tick even starts.

## Follow-up: nested duplicate lab.db (Fix 2)
The operator has two lab.db files in the real stateRoot:
- `C:/Users/elmas/Documents/bridge-agents/projects/idu-pi/lab.db` (canonical, the one being read now)
- `C:/Users/elmas/Documents/bridge-agents/projects/idu-pi/projects/idu-pi/lab.db` (orphan from the bug)

The operator can delete the orphan manually after verifying the canonical lab.db is the one being read. The fix did NOT delete the operator's data.

## Next step
Begin sdd-verify.
