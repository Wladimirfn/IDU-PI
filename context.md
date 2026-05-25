# Code Context

## Files Retrieved
1. `src/supervisor-improvement-proposals.ts` (lines 1-512) - core LEARN-1 implementation: proposal schema, creation/review APIs, formatting, sorting/dedupe, JSON output naming.
2. `test/supervisor-improvement-proposals.test.ts` (lines 1-430) - unit coverage for valid/invalid drafts, proposal generation, safety guarantees, dedupe, max limit, file creation.
3. `test/supervisor-improvement-proposals-command-wiring.test.ts` (lines 1-20) - wiring regression that checks Telegram/Pi extension commands exist and no apply command exists.
4. `src/semantic-compaction.ts` (lines 1-620) - reusable draft path/JSON validation used by LEARN-1 and likely needed by LEARN-2.
5. `src/cli.ts` (lines 90-190, 300-510, 860-930) - CLI runtime type, factory wiring, command switch, required args, help text.
6. `src/index.ts` (lines 145-164, 1250-1290, 1910-1980) - Telegram imports/handlers for supervisor improvements plus existing `/report <id> [decision]` decision pattern.
7. `src/command-catalog.ts` (lines 100-140, 540-565) - Telegram catalog entries and local command catalog entries.
8. `src/telegram-command-registry.ts` (lines 1-45) - public Telegram command allowlist/registry entries.
9. `.pi/extensions/idu-pi-commands.ts` (lines 1-300) - Pi extension command registration pattern and existing supervisor improvement commands.
10. `test/idu-cli.test.ts` (lines 500-550, 780-835) - CLI fake runtime and existing supervisor improvement command tests.
11. `src/lab-db.ts` (lines 120-155, 374-419) - existing SQLite `proposals` table/status fields; possibly reusable but not used by LEARN-1 JSON proposals.
12. `src/lab-reports.ts` (lines 1-110) - existing JSONL decision-status store pattern used by `/report` decisions.
13. `package.json` (lines 1-24) - build/test command (`pnpm test`).

## Key Code

LEARN-1 core public API is in `src/supervisor-improvement-proposals.ts`:

```ts
export type SupervisorImprovementAction =
  | "approve_for_agent_review"
  | "approve_for_manual_apply"
  | "reject"
  | "defer";
export type SupervisorImprovementStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "deferred";

export type SupervisorImprovementProposal = {
  id: string;
  type: SupervisorImprovementProposalType;
  title: string;
  description: string;
  evidence: string[];
  sourceDraftPath: string;
  riskLevel: SupervisorImprovementRisk;
  expectedBenefit: SupervisorImprovementBenefit[];
  requiresHumanApproval: true;
  suggestedAction: SupervisorImprovementAction;
  status: SupervisorImprovementStatus;
  createdAt: string;
};
```

Important behavior:
- `buildSupervisorImprovementPlan(pathOrLatest, reportsPath)` calls `reviewSemanticCompactionDraft`; invalid drafts return `validDraft: false`, errors, and no proposals.
- `createSupervisorImprovementProposals(...)` writes only `reports/supervisor-improvement-proposals-YYYYMMDD-HHMMSS.json` with warning, source draft path, project id, and proposals. It does not mutate rules/skills/code.
- Proposal IDs are assigned only in memory at build time: `improvement-001`, etc. The JSON file has no top-level run id.
- `formatSupervisorImprovementPlan` currently tells the user to create proposals only; there is no decision/apply flow yet.

Reusable path/JSON validation is in `src/semantic-compaction.ts`:

```ts
function resolveDraftPath(pathOrLatest, reportsPath, errors) {
  if (pathOrLatest === "latest") { /* newest semantic-compaction-draft-* */ }
  const candidate = resolve(isAbsolute(pathOrLatest) ? pathOrLatest : join(reportsPath, pathOrLatest));
  const relativeToReports = relative(reportsPath, candidate);
  if (relativeToReports.startsWith("..") || isAbsolute(relativeToReports) || relativeToReports === "") {
    errors.push("La ruta debe estar dentro de AGENT_WORKSPACE_ROOT/reports.");
    return undefined;
  }
  if (!isDraftFileName(basename(candidate))) {
    errors.push("El archivo debe llamarse semantic-compaction-draft-*.json.");
    return undefined;
  }
}
```

Validation gotchas:
- Only `latest` resolves automatically, and only for `semantic-compaction-draft-*.json` files.
- Absolute or relative paths must stay inside `reportsPath`.
- Empty relative path is rejected.
- Draft must have warning `Borrador IA. No es fuente de verdad.`, `generatedAt`, `projectId`, and no `rawOutput`.
- `normalizeDraft` tolerates missing arrays/objects by coercing to empty/default values.

Existing command wiring pattern:
- CLI imports functions and extends `CliRuntime` (`src/cli.ts` lines 106-181).
- Runtime factory binds `reportsPath` as `join(config.agentWorkspaceRoot, "reports")` (`src/cli.ts` lines 326-337).
- `runCliCommand` switch supports both `idu-supervisor-improvements-*` and shorter aliases (`src/cli.ts` lines 475-490).
- Telegram handlers use `ctx.match?.trim() || "latest"`, `guard(ctx)`, `reportsPath()`, and `replyLong(...)` (`src/index.ts` lines 1265-1285).
- Catalog/allowlist/ext all require explicit additions: `src/command-catalog.ts`, `src/telegram-command-registry.ts`, `.pi/extensions/idu-pi-commands.ts`.

Existing decision-flow pattern to copy is `/report <id> [work|defer|ignore|save]` in `src/index.ts` lines 1935-1968: parse args, validate allowed decision, update JSONL store, set timestamp, reply with confirmation. For LEARN-2, use analogous explicit human decision commands, but against supervisor-improvement proposal JSON files.

## Architecture

Current LEARN-1 flow:
1. SG4 semantic compaction produces `reports/semantic-compaction-draft-YYYYMMDD-HHMMSS.json`.
2. `buildSupervisorImprovementPlan` validates/reviews that draft through `reviewSemanticCompactionDraft`.
3. It derives review-only proposals from draft fields (`suggestedRuleUpdates`, `suggestedSkillUpdates`, classifier review, preserved rules, Project Core risks, critical bugs/reusable lessons).
4. `createSupervisorImprovementProposals` writes a separate JSON artifact in `reports/`.
5. CLI, Telegram, Pi extension, command catalog expose only review/create commands.

Likely LEARN-2 integration points:
1. Add decision/update functions in `src/supervisor-improvement-proposals.ts`, not a new unrelated module, because the schema/status/action types already exist there.
2. Add a path resolver for `supervisor-improvement-proposals-*.json`. Do not reuse `resolveDraftPath` directly because it is private and hard-coded to `semantic-compaction-draft-*`; copy/extract the reports-contained path validation pattern.
3. Add formatter(s) for decision result, similar to `formatSupervisorImprovementCreationResult`.
4. Add `CliRuntime` methods and runtime bindings in `src/cli.ts`.
5. Add CLI cases and help text in `src/cli.ts`.
6. Add Telegram bot command(s) in `src/index.ts` with guard + `replyLong`.
7. Add entries to `src/command-catalog.ts`, `src/telegram-command-registry.ts`, `.pi/extensions/idu-pi-commands.ts`.
8. Add unit tests in `test/supervisor-improvement-proposals.test.ts` and wiring/CLI tests in `test/supervisor-improvement-proposals-command-wiring.test.ts` and `test/idu-cli.test.ts`.

Suggested LEARN-2 command shape:
- Review decisions: `/supervisor_improvements_decide <latest|ruta> <proposal-id> <approve|reject|defer> [note]`
- CLI: `idu-pi idu-supervisor-improvements-decide latest improvement-001 approve "reason"`
- Keep it review-only: update proposal status/action metadata in JSON only; do not apply rules, skills, Project Core, or AgentLabs.

Potential result JSON additions:
- Existing proposal has `status`; update it to `approved|rejected|deferred`.
- Consider adding optional fields: `decidedAt`, `decision`, `decisionNote`, `decidedBy`.
- If adding fields to `SupervisorImprovementProposal`, update type/tests and ensure old JSON still parses if fields are absent.

## Start Here

Start in `src/supervisor-improvement-proposals.ts`. It owns the LEARN-1 schema and artifact writing, and it is the right place to add a safe `decideSupervisorImprovementProposal(...)` API plus path validation for `supervisor-improvement-proposals-*.json`.

## Gotchas

- There is intentionally no `supervisor_improvements_apply`; tests assert no apply command exists. LEARN-2 should remain a decision flow unless requirements explicitly say apply.
- `latest` currently means latest semantic compaction draft for review/create. For decision flow, `latest` should probably mean latest `supervisor-improvement-proposals-*.json`, not latest semantic draft.
- Proposal IDs (`improvement-001`) are stable only within a generated file. Always require a file/latest artifact plus proposal id.
- Existing `SupervisorImprovementAction` includes `approve_for_agent_review`, `approve_for_manual_apply`, `reject`, `defer`; existing `Status` has `approved/rejected/deferred`. Decide whether user command maps to `status` only or also overwrites `suggestedAction`.
- `createSupervisorImprovementProposals` returns no `path` if invalid/no proposals; decision flow must handle missing artifact/no proposals distinctly.
- Existing private helpers (`timestamp`, `short`, `normalize`, semantic `resolveDraftPath`) are not exported.
- Tests are in `test/`, not `tests/`.
- Full validation command is `corepack pnpm test` (runs TypeScript build then node tests).
- Engram save was requested if available, but no Engram/memory tool is exposed in this subagent runtime.

## Supervisor coordination

No blocker. No files were edited except this requested `context.md` artifact.
