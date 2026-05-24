# Code Context

## Files Retrieved
1. `.agents/skills/project-understanding/SKILL.md` (lines 1-183) - required skill; establishes project-type-first, no unsafe project-map edits, no assumptions.
2. `package.json` (lines 1-25) - Node/TypeScript private package, CLI bin, build/test scripts.
3. `README.md` (lines 1-35) - project purpose: private Telegram bridge for operating local Pi.
4. `src/user-signal.ts` (lines 1-68) - existing deterministic keyword-based emotion/urgency analyzer.
5. `src/structured-task-queue.ts` (lines 1-260) - structured task model, JSONL queue, priority/emotion from user signal.
6. `src/project-preflight.ts` (lines 1-45, 88-395) - deterministic preflight intent/risk analyzer and report formatter.
7. `src/cli.ts` (lines 1-535) - CLI runtime, task/preflight/queue commands, signal recording, guard integration.
8. `src/index.ts` (lines 185-219, 388-421, 626-840, 1193-1281, 1959-2019) - Telegram wiring for queues, preflight, /task, guard approval/rejection.
9. `src/lab-db.ts` (lines 55-67, 174-184, 421-439) - existing user_signal_events storage; schema must not change for INT-1.
10. `src/command-catalog.ts` (lines 121-218) - Telegram command catalog entries for preflight/advisory/task/queue.
11. `test/user-signal.test.ts` (lines 1-70) - current tests for deterministic emotion analyzer.
12. `test/structured-task-queue.test.ts` (lines 190-318) - current tests for signal-derived priority/emotion and guard state.
13. `test/project-preflight.test.ts` (lines 121-250) - current tests for deterministic intent/risk categories.
14. `test/idu-cli.test.ts` (lines 450-610) - current tests for CLI task, guard, queue commands.
15. `test/guarded-queue-command-wiring.test.ts` (lines 1-123) - source-level Telegram wiring tests for guarded queue and /task.
16. `test/preflight-command-wiring.test.ts` (lines 1-12) - source-level preflight command wiring test.

## Key Code

Project type:
- Primary: `telegram-bot`.
- Secondary: `cli-tool` and Node/TypeScript local automation bridge.
- Evidence: `README.md:1-3`, `package.json:1-18`, `src/index.ts` Telegram bot wiring, `src/cli.ts` bin runtime.

Existing user-signal layer:
```ts
// src/user-signal.ts:1-15
export type UserEmotion = "neutral" | "molesto" | "urgente" | "cansado" | "feliz" | "confundido";
export interface UserSignal {
  emotion: UserEmotion;
  urgency: number;
  confidence: UserSignalConfidence;
  matchedKeywords: string[];
}
```
- `analyzeUserSignal(text)` is deterministic: lowercase Spanish locale, keyword includes, strongest urgency wins (`src/user-signal.ts:60-68`).
- It is emotion/urgency only, not full human intent.

Structured queue:
```ts
// src/structured-task-queue.ts:19-43
export type StructuredTask = { id; text; category; priority; status; ... emotion?; source?; projectId?; guardRisk?; guardStatus?; guardReason? };
export type StructuredTaskInput = { text; category; priority?; emotion?; source?; projectId? };
```
- Persists to `AGENT_WORKSPACE_ROOT/reports/tasks.jsonl` when constructed with `workspaceRoot` (`src/structured-task-queue.ts:59-64`, `236-244`).
- Priority is currently derived from emotion urgency (`src/structured-task-queue.ts:256-260` onward; tests at `test/structured-task-queue.test.ts:195-233`).
- JSONL can tolerate optional fields, so INT-1 can add optional intent fields here without SQLite schema changes.

Preflight:
- `analyzeProjectPreflight()` already detects deterministic request intent via term lists: architecture/data/security/functional/flow/simple/newModule/moduleConnection (`src/project-preflight.ts:38-45`, `88-127`, `336-355`).
- It raises risk and human-confirmation flags deterministically (`src/project-preflight.ts:205-263`).
- It currently can set `shouldRunAgentLab` true for architecture/new module connection (`src/project-preflight.ts:260-262`); INT-1 constraints say no AgentLabs, so any new layer should not trigger execution and should preserve current “plan only/manual” wording.

CLI integration:
- `createCliTask()` builds a prompt, analyzes structured signal, enqueues task, optionally applies preflight guard when `/idu` active, and records user signal to SQLite if available (`src/cli.ts:453-509`).
- CLI commands already promise no IA/AgentLabs for task approval (`src/cli.ts:301-315`, `530-535` onward).

Telegram integration:
- `guardTaskPrompt()` blocks only high/blocker preflight risks when automatic guardrails are active (`src/index.ts:664-762`).
- `/task` builds prompt then guards before running Pi (`src/index.ts:1258-1281`).
- Busy-session queue records structured task + user signal (`src/index.ts:811-840`).
- `/queue_detail`, `/queue_approve`, `/queue_reject` are wired at `src/index.ts:1964-2019`.

SQLite storage (do not change schema):
- `user_signal_events` already stores raw text, emotion, urgency, confidence, matched keywords (`src/lab-db.ts:174-184`).
- `recordUserSignal()` inserts only those fields (`src/lab-db.ts:421-439`).
- INT-1 should not add columns/tables. If intent persistence is required, use JSONL `reports/tasks.jsonl` optional fields or encode extra deterministic evidence in existing `matchedKeywords` only if acceptable; otherwise keep intent in runtime/report formatting only.

## Architecture

Flow today:
1. User sends Telegram `/task` or CLI `idu-task`.
2. Task template builds operational prompt (`src/task-templates.ts`).
3. Deterministic `analyzeUserSignal()` extracts emotion/urgency.
4. `structuredTaskInputForText()` creates queue input with priority/emotion.
5. If `/idu` guardrails are active, `analyzeProjectPreflight()` determines risk and may pause task for human confirmation.
6. Structured queue persists task to JSONL; SQLite logs user signal as secondary telemetry.
7. Approval/rejection is explicitly human-driven via queue commands.

INT-1 minimal shape:
- Add a deterministic “human intent” module beside `user-signal`, not inside AgentRouter/lab prompt/project maps.
- Compose existing layers rather than replace them:
  - `user-signal` = emotional/urgency signal.
  - `human-intent` = user intent class/actionability/safety stance/evidence.
  - `project-preflight` = project-context risk gate.
- Keep the layer pure and dependency-light: `(text: string) => HumanIntentSignal`; no AI, no DB, no AgentLabs.

Suggested minimal files to add/edit:
1. Add `src/human-intent.ts`.
   - Types: `HumanIntentKind` (e.g. `ask_info | request_task | approve | reject | cancel | status | configure | unknown`), `HumanIntentAction` (e.g. `answer | enqueue | require_confirmation | cancel | inspect_status | none`), `HumanIntentSignal` with `kind`, `action`, `confidence`, `urgency`, `matchedRules`, `requiresHumanConfirmation`.
   - Deterministic rule tables only; normalize accents if needed.
   - Should import `analyzeUserSignal` or accept it as dependency to include emotion/urgency.
2. Edit `src/structured-task-queue.ts` minimally.
   - Add optional fields to `StructuredTask`/`StructuredTaskInput`, such as `intentKind?: string`, `intentAction?: string`, `intentConfidence?: string`.
   - Update `structuredTaskInputForText()` to call `analyzeHumanIntent()` and include optional fields.
   - Update formatter to show intent succinctly in `/queue_detail` if present.
3. Optionally edit `src/project-preflight.ts` only if INT-1 must influence preflight report.
   - Prefer adding an optional `humanIntent?: HumanIntentSignal` to `ProjectPreflightReport` only if tests demand visible preflight output.
   - Do not edit project-core/constitution/blueprint/flows modules.
4. Edit `src/cli.ts` and/or `src/index.ts` only if formatter/output must show intent.
   - Current integration may already pick up intent through `structuredTaskInputForText()`.
   - Avoid changing AgentRouter or prompt execution behavior.
5. Edit `src/command-catalog.ts` only if a new human-intent command is required. Minimal INT-1 likely does not need a new command.

## Start Here
Open `src/structured-task-queue.ts` first. It is the lowest-risk integration point: it already bridges user-signal, task priority, JSONL persistence, CLI, and Telegram queue display without requiring SQLite schema changes or touching prohibited project-map/AgentRouter areas.

## Risks
- `project-preflight.ts` imports/uses constitution gates; do not modify `src/project-constitution.ts`, `src/project-core.ts`, `src/project-blueprint.ts`, or `src/project-flows.ts` per constraint.
- `src/index.ts` contains AgentRouter/lab prompt paths nearby. Keep edits strictly inside queue/task command wiring if needed; do not touch `AgentRouter` construction or `generateAiProjectDraft()`.
- SQLite schema is already defined in `src/lab-db.ts`; do not add INT-1 columns/tables.
- The existing tests include source-regex wiring tests; small wording/function-name changes in `src/index.ts` may break them.
- Priority semantics are inverted numerically: lower number dequeues first (`src/structured-task-queue.ts:174-181`), but current signal urgency is stored directly; existing tests expect urgent priority `5`, not highest dequeue priority. Do not “fix” this unless INT-1 explicitly includes priority redesign.
- Some CLI helper names say `idOrPrefix`, but tests enforce full ID for approve/reject (`test/idu-cli.test.ts:591-610`). Preserve exact-ID behavior unless requested.

## Suggested TDD Slices
1. RED: `test/human-intent.test.ts`
   - Pure deterministic classifications: question/status/cancel/approve/reject/task request/unknown.
   - Include Spanish/Rioplatense examples and English technical terms if needed.
   - Assert no AI/AgentLabs dependencies by keeping module pure.
2. GREEN: add `src/human-intent.ts` only.
3. RED: extend `test/structured-task-queue.test.ts`
   - `structuredTaskInputForText()` stores `intentKind/action/confidence` alongside emotion.
   - `formatStructuredTaskQueueDetail()` shows intent without breaking existing output.
4. GREEN: minimal optional fields in `src/structured-task-queue.ts`.
5. RED: extend `test/idu-cli.test.ts`
   - CLI task output/queue detail includes local deterministic intent if required.
   - Assert “No ejecuté IA ni AgentLabs” remains.
6. GREEN: minimal CLI formatter/runtime adjustment only if needed.
7. RED: extend `test/guarded-queue-command-wiring.test.ts` only if Telegram output changes.
8. GREEN: minimal `src/index.ts` display/wiring change; avoid AgentRouter/labPrompt areas.

Recommended validation command: `pnpm test` (runs `tsc -p tsconfig.json && node --test dist/test/*.test.js`).
