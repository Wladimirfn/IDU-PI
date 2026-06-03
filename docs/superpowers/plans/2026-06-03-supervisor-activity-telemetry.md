# Supervisor Activity Telemetry Implementation Plan

## Goal

Add first-class local supervisor activity telemetry, separate from Idu-pi usage call metrics.

## Scope

Implement the first slice:

- new `src/supervisor-activity-events.ts`;
- new `test/supervisor-activity-events.test.ts`;
- record automatic supervisor hook terminal events from `src/idu-supervisor-hooks.ts`;
- record manual `idu-supervisor-tick` events from `src/cli.ts`;
- show supervisor activity in the current project panel via `src/cli-home.ts`;
- update focused tests.

## Constraints

- stateRoot-only JSONL: `reports/idu-supervisor-activity-events.jsonl`.
- No remote analytics.
- No token/cost/context estimates.
- No prompts/full user text/env/headers/secrets/tokens/raw task text.
- No AgentLabs execution.
- No fake autonomy: origins must distinguish `supervisor_auto_hook` and `supervisor_manual_tick`.
- Do not increment `llamadas Idu-pi` when supervisor activity is recorded.

## TDD steps

### 1. Core telemetry RED

Create `test/supervisor-activity-events.test.ts` covering:

- append safe JSONL under `stateRoot/reports`;
- sanitize labels;
- ignore malformed events;
- summarize by origin, trigger, status, reason;
- count created tasks, audit runs, semantic drafts, and agent task plans;
- render `tokens supervisor: no medido` and `% contexto supervisor: no medido`;
- bound recent events.

Expected: build/test fail because module does not exist.

### 2. Core telemetry GREEN

Create `src/supervisor-activity-events.ts` mirroring safe patterns from `usage-events.ts`, but with a separate model and file path.

### 3. Hook telemetry RED

Extend `test/idu-supervisor-hooks.test.ts`:

- inactive hook records `status=skipped`, `reason=idu_inactive`, origin `supervisor_auto_hook`;
- throttled hook records `reason=throttled`;
- completed hook records trigger, bypass flag, step counts, and created task count;
- hook telemetry failure does not block the hook result.

### 4. Hook telemetry GREEN

Add optional recorder/dependency injection or direct best-effort deferred writer in `src/idu-supervisor-hooks.ts`.

Preferred: dependency injection for tests, direct runtime default for production.

### 5. Manual tick telemetry RED

Extend CLI tests so `idu-supervisor-tick` records one supervisor activity event with origin `supervisor_manual_tick` and does not increase usage call count.

### 6. Manual tick telemetry GREEN

Wire `src/cli.ts` around `activeRuntime.supervisorTick()`.

### 7. Panel RED/GREEN

Add fixture tests in `test/cli-home.test.ts` for a separate `Actividad supervisor local` block.

Wire `src/cli-home.ts` to read supervisor activity events from `project.stateRoot` and render the block. Keep `Uso local` unchanged.

## Validation

Run:

```bash
corepack pnpm build
node --test dist/test/supervisor-activity-events.test.js dist/test/idu-supervisor-hooks.test.js dist/test/idu-cli.test.js dist/test/cli-home.test.js --test-name-pattern "supervisor activity|supervisor tick|current project panel"
corepack pnpm test
git diff --check
```

Then run Idu-pi postflight with expected files and contract `agent`.

## Review

Run a fresh reviewer before commit/push.

## Commit

Stage explicit paths only. Suggested message:

```text
feat(idu): measure supervisor activity
```
