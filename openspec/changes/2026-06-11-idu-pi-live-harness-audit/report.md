# Idu-pi Live Harness Audit — 2026-06-11

## Verdict

**FAIL as a fully autonomous/live harness.**

Idu-pi is alive as an advisory supervisor: MCP responds, context pack works,
manual trigger tick runs, automaticov1 runs, autonomous alert status/tick runs,
external intelligence fetches allowlisted sources, task queue is populated, and
new MCP wrappers are visible.

But it is **not yet alive in the product sense the owner expects**:

- The supervisor does not show current invocations for `supervisor-main`,
  `supervisor-semantic`, or `supervisor-compaction`.
- It does not autonomously create or work pending tasks; it mostly escalates.
- Trigger/manual tick runs but emits no injections and creates no tasks.
- AgentLab execution is broken/stale.
- `idu_status` reports false negatives for `lab.db` and `tasks.jsonl` even when
  the real stateRoot has them.
- External/news intelligence works only for a small allowlist and does not cover
  all technologies requested.
- Repo still has uncommitted safety-fix diffs, so the previous safety slice is
  not fully closed in git.

## Owner-approved test mode

- Environment: real idu-pi stateRoot.
- Triggers: enabled and tested with manual real tick.
- AgentLabs: audit-only execution authorized.
- No repo implementation/fixes were made during this audit beyond existing dirty
  working tree from the previous safety slice.

## Evidence summary

### 1. Status and prepare

Command/tool:

- `idu_status({ projectPath })`
- `idu_prepare({ projectPath })`
- `idu_status({ projectPath })`

Result:

- Before prepare: `active=true`, `config=project_local_valid`, `alignment=stale`.
- `idu_prepare` ran and created `labReviewTaskId=task-000mq9ggj9x-000s`.
- After prepare, `idu_status` still reports `alignment=stale`.
- `idu_status` still warns:
  - `No existe lab.db todavía`
  - `No existe tasks.jsonl todavía`

But `idu_bibliotecario_init` reports:

- `dbPath=C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\lab.db`
- `dbCreated=false`
- bootstrap already present

**Failure ID LH-001 — false stateRoot readiness in idu_status**

`idu_status` reports missing lab.db/tasks.jsonl even though the real stateRoot has
lab.db and the structured queue is readable with 28 tasks.

Severity: **High**.

Impact: The supervisor keeps generating stale/needs-confirmation warnings and
blocks live automation with bogus readiness signals.

### 2. Queue / pending work

Tool:

- `idu_queue_detail({ projectPath, limit: 20 })`

Result:

- Queue contains 28 tasks.
- There is one stale/running test task:
  - `task-stuck-test-c408da`, status `running`, text `test stuck`.
- Several pending tasks are guarded by `needs_confirmation` due to the same false
  lab.db/tasks warning.

**Failure ID LH-002 — queue has stale/running task and no automatic triage**

The system detects pending/stale work but does not autonomously triage or resolve
it. This contradicts the desired behavior: "debería empezar a revisar sus tareas
pendientes".

Severity: **High**.

### 3. Trigger engine / injections

Tools:

- `idu_supervisor_trigger(status)` → disabled.
- `idu_supervisor_trigger(enable)` → enabled.
- `idu_pending_injections` → pending=0.
- `idu_supervisor_tick({ triggerEngine:true, force:true })` → completed,
  `reason=not_enough_data`, `createdTasks=0`.
- `idu_pending_injections` after tick → pending=0.

**Failure ID LH-003 — trigger tick runs but produces no injection/task**

The trigger engine is alive and can be enabled, but a forced manual tick does not
produce pending injections or new tasks. It reports `not_enough_data`.

Severity: **Medium/High**.

Impact: The harness is safe, but not "living" in the owner’s expected sense.

### 4. Autonomous alerts / automaticov1

Tools:

- `idu_autonomous_alerts_status`
- `idu_autonomous_alerts_tick`
- `idu_automaticov1_cycle`

Results:

`idu_autonomous_alerts_status` returns 7 decisions:

- backlog pressure: open=10, running=1, guarded=4
- stale tasks: stale-pending=2, stale-running=1
- neglected areas: agentlab/context
- security/db/optimization stale or incomplete
- external-security-coverage-gap: npm/security unproven

`idu_autonomous_alerts_tick`:

- 0 tasks created
- 5 human escalations
- `allowTaskCreation=false`

`idu_automaticov1_cycle`:

- status `ran`
- `allowedToProceed=false`
- `allowTaskCreation=false`
- `allowExternalFetch=false`
- `externalFetchExecuted=false`
- `AgentLabs auto-run=false`

**Failure ID LH-004 — autonomous loop detects but does not route executable work**

The autonomous loop can detect pressure and produce raw-honesty reports, but it
is still configured as advisory-only with `allowTaskCreation=false`. It does not
create bounded tasks or perform news/external checks by default.

Severity: **High** for the "vivo/automatico" product expectation.

### 5. Model routing / supervisor IA

Tool:

- `idu_model_invocation_status({ limit: 10 })`

Result:

- AgentLab invocations exist:
  - `agentlab-project-understanding`: opencode-go/qwen3.7-plus
  - `agentlab-architecture`: opencode-go/qwen3.7-plus
  - `agentlab-database`: opencode-go/qwen3.6-plus
  - `agentlab-ui-ux`: opencode-go/minimax-m2.5
- Supervisor roles show 0 invocations:
  - `supervisor-main`: 0
  - `supervisor-semantic`: 0
  - `supervisor-compaction`: 0

**Failure ID LH-005 — supervisor does not evidence IA/model invocation**

The owner expects the supervisor to answer using its predefined IA/model routing.
Current evidence shows only AgentLab model calls, not supervisor model calls.

Severity: **High**.

### 6. AgentLabs audit-only execution

Tools:

- `idu_agentlab_request_create(source:"specialist-audit-plan", specialties:[architecture, code_quality, database, security])`
- `idu_agentlab_review_run(selector:"current")`
- `idu_agentlab_review_run(selector:"current.json")`
- `idu_agentlab_review_status`

Results:

- Request creation succeeds and writes
  `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\agentlabs\requests\current.json`.
- The request contains 4 specialist requests with expected opencode-go model
  assignments.
- `idu_agentlab_review_run(selector:"current")` fails because it looks for
  `requests/current` instead of `requests/current.json`.
- `idu_agentlab_review_run(selector:"current.json")` times out.
- `idu_agentlab_review_status` reports stale/invalid run and 4 pending requests.

**Failure ID LH-006 — AgentLab execution is broken/stale**

AgentLab request creation works, but actual execution is unreliable: one selector
path bug plus a timeout. Status remains stale.

Severity: **High**.

### 7. Bibliotecario / external/news intelligence

Tools:

- `idu_bibliotecario_proactive_advisory`
- `idu_external_intelligence_report`

Results:

`idu_bibliotecario_proactive_advisory`:

- Works as a local/source recommendation surface.
- `webFetchAllowed=false`, `fetchAllowed=false`, `rawDocsStored=false`.
- It warns `resourceContextCheck.pressure=high`.

`idu_external_intelligence_report`:

- Successfully fetches allowlisted sources:
  - Node releases from `https://nodejs.org/dist/index.json`
  - Next.js releases from GitHub releases
- Stores normalized report under stateRoot reports.
- npm advisories are explicitly skipped.
- Does not cover all requested technologies:
  - TypeScript
  - pnpm/corepack
  - better-sqlite3
  - MCP/Pi runtime
  - opencode-go models

**Failure ID LH-007 — news/current intelligence coverage is incomplete**

There is an external intelligence mechanism, but coverage is too narrow for the
owner’s expectation: it does not yet watch the actual stack comprehensively.

Severity: **Medium/High**.

### 8. Git/release hygiene

Command:

- `git status --short`
- `git diff --stat`

Result:

Working tree is dirty after previous safety slice:

- `src/cli.ts`
- `src/mcp-server.ts`
- `test/cli-bibliotecario-init.test.ts`

Diff stat:

```text
src/cli.ts                          | 14 ++---
src/mcp-server.ts                   | 103 +++++++++++++++++++++++++++++-------
test/cli-bibliotecario-init.test.ts | 5 +-
3 files changed, 97 insertions(+), 25 deletions(-)
```

**Failure ID LH-008 — safety-fix slice not fully closed in git**

Even though tests were reported green and commit `7f65de7` exists, the working
tree still contains uncommitted source/test changes. The repo is not in a clean
trial-ready state.

Severity: **High**.

## What passed

- MCP server responds and project resolves with explicit `projectPath`.
- `idu_supervisor_context_pack` produces a detailed advisory package.
- `idu_preflight` correctly blocks high-risk live validation until owner approval.
- `idu_bibliotecario_init` works and uses the correct stateRoot lab.db path.
- New MCP wrappers are present and callable:
  - `idu_bibliotecario_init`
  - `idu_model_invocation_status`
  - `idu_supervisor_trigger`
- Trigger can be enabled through MCP.
- Manual supervisor tick runs safely.
- Autonomous alert status/tick runs safely.
- `automaticov1_cycle` runs safely and returns objective, task tree, readiness,
  and Bibliotecario snapshot.
- External intelligence fetch works for allowlisted Node and Next.js sources.
- AgentLab request creation works and writes a formal audit-only request.

## Recommended next implementation slices

### Slice 1 — Close dirty Safety Fix + status path correctness

Fix LH-001 and LH-008 first.

Acceptance:

- `git status --short` clean after commit.
- `idu_status` sees `lab.dbExists=true` when canonical lab.db exists.
- `idu_status` sees queue/tasks status consistently with `idu_queue_detail`.

### Slice 2 — AgentLab runner reliability

Fix LH-006.

Acceptance:

- `idu_agentlab_review_run(selector:"current")` resolves to `current.json`.
- `selector:"current.json"` does not timeout for a bounded 4-specialist request.
- `idu_agentlab_review_status` becomes valid and reports completed/partial findings.

### Slice 3 — Supervisor model invocation evidence

Fix LH-005.

Acceptance:

- At least one supervisor role (`supervisor-main` or `supervisor-semantic`) invokes
  its configured opencode-go model during an explicit supervisor advisory path.
- `idu_model_invocation_status` shows fresh supervisor invocation with provider,
  model, status, prompt chars, response chars.

### Slice 4 — Living task routing

Fix LH-002/LH-004.

Acceptance:

- Stale/running tasks are surfaced as bounded remediation proposals or tasks.
- `allowTaskCreation` can be enabled by explicit owner/orchestrator approval.
- `autonomous_alerts_tick` creates capped low-risk tasks when enabled, while
  high-risk/security/db/core items remain human escalation.

### Slice 5 — External intelligence coverage

Fix LH-007.

Acceptance:

- External intelligence allowlist covers actual stack:
  - Node
  - TypeScript
  - pnpm/corepack
  - better-sqlite3
  - MCP/Pi runtime
  - opencode-go/model provider source
- npm/security coverage has a stable source or a clear permanent limitation.
- Reports distinguish security, breaking changes, bugfixes, and normal releases.

## Bottom line

Idu-pi is **alive enough to observe and warn**. It is **not yet alive enough to
claim autonomous operating harness**. The next work should not add new features;
it should close these live-harness failures in the order above.
