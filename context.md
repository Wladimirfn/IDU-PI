# Code Context

## Files Retrieved
1. `src/semantic-compaction.ts` (lines 1-253, 305-694) - draft/review types, formatting, deterministic draft generation, safe draft path validation, sanitization.
2. `src/semantic-agent-tasks.ts` (lines 1-579) - existing conversion from compaction draft suggestions into safe review tasks; strongest reusable pattern for LEARN-1.
3. `src/cli.ts` (lines 1-320, 360-454, 703-729) - runtime dependencies, command dispatch, project context loading for compaction.
4. `src/index.ts` (lines 1-260, 1028-1067, 1140-1258) - Telegram command wiring and shared bridge runtime helpers.
5. `src/command-catalog.ts` (lines 1-130, 480-603) - Telegram command catalog, CLI local commands, formatting for `/help`, `/comandos`, BotFather API commands.
6. `src/telegram-command-registry.ts` (imported by `src/index.ts`; no semantic-specific entries found) - session/work prompt registry, not the main semantic command registry.
7. `src/idu-supervisor-loop.ts` (lines 1-331) - supervisor tick flow and safety contract; existing integration for semantic draft + agent-task creation.
8. `src/structured-task-queue.ts` (lines 26-120) - persisted task shape and `enqueueTask` API used by semantic agent tasks.
9. `test/semantic-compaction.test.ts` (lines 1-266) - tests for draft creation/review, sanitization, latest/path rejection, rawOutput invalidation.
10. `test/semantic-agent-tasks.test.ts` (lines 1-357) - tests for draft-to-task planning, grouping, dedupe, queue writes.
11. `test/semantic-compaction-command-wiring.test.ts` (lines 1-14) - source-level Telegram wiring guard; verifies no apply command.
12. `test/semantic-agent-tasks-command-wiring.test.ts` (lines 1-13) - source-level Telegram wiring guard; verifies no AgentLabs apply command.
13. `test/idu-cli.test.ts` (lines 656-724) - CLI command tests for semantic audit/compact/agent-tasks.
14. `test/idu-supervisor-loop.test.ts` (lines 227-331) - supervisor loop tests for thresholds, draft/task toggles, safety flags.
15. `package.json` (lines 1-23) - test command: `pnpm test` builds then runs node tests.

## Key Code

### Draft/review model and safety fields
`src/semantic-compaction.ts` exposes the core draft/review types and public review function:

```ts
export type SemanticCompactionDraft = {
  generatedAt: string;
  projectId: string;
  warning: "Borrador IA. No es fuente de verdad.";
  sourceAuditRunIds: string[];
  inputSummary: Record<string, unknown>;
  preservedRules: string[];
  criticalBugs: Array<Record<string, unknown>>;
  humanDecisions: string[];
  reusableLessons: string[];
  architecturalRisks: string[];
  classifierQualityReview: SemanticCompactionClassifierQualityReview;
  misclassifiedExamples: SemanticCompactionClassificationSample[];
  suggestedRuleUpdates: string[];
  suggestedSkillUpdates: string[];
  suggestedMemoryItems: string[];
  suggestedAgentTasks: string[];
  noiseToIgnore: string[];
  openQuestions: string[];
  rawOutput?: string;
};
```

`reviewSemanticCompactionDraft(pathOrLatest, reportsPath)` validates warning, rejects `rawOutput`, normalizes arrays, and summarizes `suggestedRuleUpdates`, `suggestedSkillUpdates`, and `suggestedAgentTasks`. Reuse this instead of parsing JSON directly.

### Existing draft path validation
`src/semantic-compaction.ts` lines 481-526 implements the safest current path behavior:

- accepts `latest` by scanning `reportsPath` for `semantic-compaction-draft-*.json`, sorted lexically;
- resolves relative paths under `reportsPath`;
- rejects outside paths via `relative(reportsPath, candidate)` checks;
- rejects empty/self paths;
- requires basename regex `^semantic-compaction-draft-\d{8}-\d{6}\.json$`;
- checks existence.

Best LEARN-1 approach: call `reviewSemanticCompactionDraft()` and fail closed when `validDraft === false`. If another feature needs path resolution directly, export a small public helper from `semantic-compaction.ts`; do not duplicate a weaker resolver.

### Existing conversion from draft proposals to safe work items
`src/semantic-agent-tasks.ts` already turns draft content into review-only queue tasks:

- `buildSemanticAgentTaskPlan(pathOrLatest, reportsPath)` -> validates draft via `reviewSemanticCompactionDraft()` and builds grouped candidates.
- `createSemanticAgentTasks(input)` -> writes `StructuredTask`s to `StructuredTaskQueue`, max 7 by default, dedupes by `Dedupe:` marker.
- Candidate text always includes `No ejecutar cambios sin aprobación humana.`
- Queue source is `semantic-audit`; category is `review`; semantic priority maps to queue priority 1..5.

Important helpers are private but reusable by pattern: `classifyType`, `priorityFor`, `recommendationFor`, `groupCandidatesByDomain`, `dedupeKeyFor`, `domainKeyFor`, `short`.

### CLI pattern
`src/cli.ts` pattern for adding a command:

1. Import public feature functions/types near lines 77-93.
2. Extend `CliRuntime` with function + formatter slots near lines 144-160.
3. Add runtime implementation in `createCliRuntime()` near lines 243-283 using `join(config.agentWorkspaceRoot, "reports")` and active project id.
4. Add aliases in `runCliCommand` switch near lines 398-438, usually both `idu-...` and shorter alias.
5. Add help text near lines 863-871.

Existing required-argument commands use `requiredText(rest)`. Telegram defaults path args to `latest`; CLI currently requires explicit `latest` for review/create.

### Telegram pattern
`src/index.ts` pattern for adding a Telegram command:

```ts
bot.command("semantic_agent_tasks_review", async (ctx) => {
  if (!(await guard(ctx))) return;
  const pathOrLatest = ctx.match?.trim() || "latest";
  await replyLong(ctx, formatSemanticAgentTaskPlan(buildSemanticAgentTaskPlan(pathOrLatest, reportsPath())));
});
```

Shared helpers:

- `guard(ctx)` authorization (`src/index.ts` lines 410-413).
- `reportsPath()` = `join(config.agentWorkspaceRoot, "reports")` (`src/index.ts` lines 1032-1034).
- `labDbPath()` for DB (`src/index.ts` lines 1028-1030).
- `currentProjectId()` and `activeProjectPath()` for project context.
- `semanticCompactionProjectContext()` is read-only and suppresses failures; it loads Project Core/Constitution only for prompt context, not mutation.

### Command catalog pattern
Add a `TELEGRAM_COMMANDS` entry with `command`, `description`, `help`, and `usage`. Add matching `CLI_COMMANDS` local shortcut near semantic entries. `formatHelpText`, `telegramCommandsForApi`, and `formatCommandCatalog` derive output from these arrays.

### Supervisor loop safety contract
`src/idu-supervisor-loop.ts` already states safety flags:

```ts
safety: {
  agentLabsExecuted: false;
  rulesApplied: false;
  memoryDeleted: false;
  projectCoreModified: false;
}
```

The loop may create semantic drafts and queue review tasks, but does not execute AgentLabs, apply rules, delete memory, or modify Project Core. Any LEARN-1 “improvement proposal” path should preserve this model.

## Architecture

Semantic audit flow today:

1. `LabDbRepository`/semantic audit stats determine thresholds.
2. `saveSemanticCompactionDraft()` snapshots recent local signals from `lab.db` + `reports/tasks.jsonl`, sanitizes secrets and raw output, writes `reports/semantic-compaction-draft-YYYYMMDD-HHMMSS.json`.
3. `reviewSemanticCompactionDraft()` safely resolves and validates a draft.
4. `buildSemanticAgentTaskPlan()` reads a valid draft and maps suggestions/bugs/risks/classifier review into grouped review candidates.
5. `createSemanticAgentTasks()` writes review-only `StructuredTask`s; dedupe is text-marker based.
6. CLI and Telegram are thin wrappers around the same functions.
7. Supervisor tick composes status -> optional audit run -> optional draft -> optional task creation, with explicit safety flags.

For LEARN-1, the least invasive implementation is a new semantic module that consumes only `reviewSemanticCompactionDraft()` output and produces review-only “supervisor improvement proposals” as either formatted read-only plan or `StructuredTask` review items. Avoid new DB tables or schema; avoid changing human-intent/project-core/constitution/skills. If persisted output is needed, prefer existing `StructuredTaskQueue` (like semantic agent tasks) over `proposals` DB table because `proposals` has `finding_id` FK coupling.

## Start Here

Start in `src/semantic-agent-tasks.ts`. It is the closest existing implementation: safe draft validation, transformation of compaction suggestions into review-only candidates, grouping/dedupe, queue persistence, and formatter patterns are already solved.

Then wire through `src/cli.ts`, `src/index.ts`, and `src/command-catalog.ts`; add tests mirroring `test/semantic-agent-tasks.test.ts`, `test/idu-cli.test.ts`, and the source-level Telegram wiring tests.

## Safest path validation approach

Use `reviewSemanticCompactionDraft(pathOrLatest, reportsPath)` as the only entry point to draft files. It already validates location, filename, existence, JSON shape enough for current code, warning, and rawOutput. Do not accept arbitrary absolute paths outside reports. Do not relax filename regex. If the new feature needs to surface invalid paths, return the review errors and do not create tasks/proposals.

## Test patterns

- Unit tests create temp roots with `mkdtempSync(join(tmpdir(), ...))`, write draft JSON under `reports/semantic-compaction-draft-20260102-030405.json`, then `rmSync(..., { recursive: true, force: true })`.
- Path safety tests cover outside path and invalid basename.
- Formatter tests assert safe notices (`No ejecuté AgentLabs`, no apply/mutation).
- Queue tests use `new StructuredTaskQueue({ filePath: join(root, "tasks.jsonl") })`, assert category/source/projectId/dedupe and duplicate skip behavior.
- CLI tests inject a fake `CliRuntime` and call `runCliCommand([...], runtime)`.
- Telegram wiring tests are source-text assertions on `src/index.ts` to ensure commands exist and no `*_apply`/AgentLabs path was added.
- Supervisor tests use dependency injection (`saveSemanticCompactionDraft`, `buildSemanticAgentTaskPlan`, `createSemanticAgentTasks`) and assert flags remain false.

## Risks

- Existing `resolveDraftPath` is private; copying it risks divergence. Prefer public `reviewSemanticCompactionDraft()` or export a helper deliberately.
- “Apply supervisor improvement proposals” wording is dangerous: existing safety language forbids applying rules/skills/memory automatically. Interpret as “create review-only proposals/tasks” unless supervisor explicitly approves more.
- `suggestedMemoryItems` currently appears in drafts but is not included in review summary formatter; a LEARN-1 feature that needs it should read from `review.draft.suggestedMemoryItems`, not `review.summary`.
- `suggestedSkillUpdates` must not mutate skills under the stated constraints; only surface as review items.
- `suggestedRuleUpdates` likely relates to human-intent rules, but constraints forbid human-intent mutation; only queue/report.
- `projectCore`/constitution helpers are read-only, but constraints forbid mutation; do not touch `config/project-core.json` or constitution files.
- `semantic-agent-tasks` uses source `semantic-audit`; if adding supervisor-specific proposals, choose a stable source string and update tests/dedupe expectations.
- CLI review commands currently require explicit arg while Telegram defaults to `latest`; decide whether new CLI command follows required arg or defaults. Existing pattern favors required CLI arg for review/create.
- Engram memory tools were not available in this subagent toolset, so findings were not saved there.
