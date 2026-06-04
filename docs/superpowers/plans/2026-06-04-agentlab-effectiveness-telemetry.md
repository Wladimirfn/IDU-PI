# AgentLab Effectiveness Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-only AgentLab effectiveness events and reports.

**Architecture:** Create `src/agentlab-effectiveness-events.ts` as a sibling to `usage-events.ts` and `supervisor-activity-events.ts`. Wire MCP AgentLab request/run/status cases to record sanitized, aggregate events only. Store JSONL under `stateRoot/reports/agentlab-effectiveness-events.jsonl`.

**Tech Stack:** TypeScript, Node test runner, local JSONL stateRoot reports.

---

### Task 1: Event store and summarizer

**Files:**
- Create: `src/agentlab-effectiveness-events.ts`
- Test: `test/agentlab-effectiveness-events.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```ts
const path = agentLabEffectivenessEventsPath(stateRoot);
assert.match(path, /reports.*agentlab-effectiveness-events\.jsonl/);

const report = buildAgentLabEffectivenessReport(events);
assert.equal(report.tokensMeasured, false);
assert.equal(report.contextPercentMeasured, false);
assert.equal(report.promptTextStored, false);
assert.equal(report.rawUserTextStored, false);
assert.equal(report.remoteAnalytics, false);
```

Also assert serialized events do not contain forbidden keys:

```ts
for (const forbidden of ["prompt", "rawUserText", "env", "headers", "tokens", "cost", "contextPercent"]) {
  assert.equal(JSON.stringify(event).includes(forbidden), false);
}
```

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/agentlab-effectiveness-events.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement event store**

Implement:
- `agentLabEffectivenessEventsPath(stateRoot)`
- `recordAgentLabEffectivenessEvent(...)`
- `recordAgentLabEffectivenessEventDeferred(...)`
- `flushAgentLabEffectivenessEvents()`
- `readAgentLabEffectivenessEvents(stateRoot, limit?)`
- `buildAgentLabEffectivenessReport(events)`
- helper builders from request plan, run result, and status/workload envelope.

- [ ] **Step 4: Run GREEN**

Run the same command. Expected: PASS.

### Task 2: MCP recording

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Invoke:
- `idu_agentlab_request_create`
- `idu_agentlab_review_run`
- `idu_agentlab_review_status`

Flush effectiveness events and assert:

```ts
assert.equal(report.requestsCreated, 1);
assert.equal(report.reviewRuns, 1);
assert.equal(report.statusChecks, 1);
assert.equal(report.remoteAnalytics, false);
assert.equal(JSON.stringify(events).includes("rawSummary"), false);
```

Also assert request-create did not create run events.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "AgentLab effectiveness|agentlab_request_create|agentlab_review_run|agentlab_review_status"
```

Expected: FAIL because MCP does not record effectiveness events.

- [ ] **Step 3: Implement MCP wiring**

Import new helpers and record after successful AgentLab request/run/status cases. Use the runtime/stateRoot already used for usage recording. Do not change AgentLab execution behavior.

- [ ] **Step 4: Run GREEN**

Run the same focused command. Expected: PASS.

### Task 3: Docs and verification

**Files:**
- Modify: `docs/mcp-server.md`
- Modify: `docs/architecture.md`
- Modify if needed: `README.md`

- [ ] **Step 1: Update docs**

Document local-only AgentLab effectiveness telemetry and forbidden stored data.

- [ ] **Step 2: LSP diagnostics**

Run diagnostics on modified TypeScript files. Expected: no diagnostics.

- [ ] **Step 3: Full verification**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: PASS, no blocking diff-check errors.

- [ ] **Step 4: Fresh review and postflight**

Run fresh reviewer and `idu_postflight`. Fix blockers before commit.

- [ ] **Step 5: Commit explicit paths only**

```bash
git add src/agentlab-effectiveness-events.ts src/mcp-server.ts test/agentlab-effectiveness-events.test.ts test/mcp-server.test.ts docs/mcp-server.md docs/architecture.md README.md docs/superpowers/specs/2026-06-04-agentlab-effectiveness-telemetry-design.md docs/superpowers/plans/2026-06-04-agentlab-effectiveness-telemetry.md
git commit -m "feat(idu): measure AgentLab effectiveness"
```
