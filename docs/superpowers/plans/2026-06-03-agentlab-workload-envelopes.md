# AgentLab Workload Envelopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advisory AgentLab workload envelopes so request/run/status evidence reports workload and incomplete outcomes honestly.

**Architecture:** Add shared envelope types/helpers in `src/agentlab-supervisor-contract.ts`, then thread them through request creation, runner/status summaries, MCP responses, and docs. Keep AgentLabs explicit, sandboxed, audit-only, and non-implementing.

**Tech Stack:** TypeScript, Node test runner, MCP server, JSON stateRoot artifacts.

---

### Task 1: Contract helper and request envelope

**Files:**
- Modify: `src/agentlab-supervisor-contract.ts`
- Modify: `src/agentlab-review-requests.ts`
- Test: `test/agentlab-supervisor-contract.test.ts`
- Test: `test/agentlab-review-requests.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert an AgentLab workload envelope is advisory-only and request plans include a `requested` envelope with counts and budgets.

Expected assertions:

```ts
assert.equal(envelope.authority, "advisory");
assert.equal(envelope.advisoryOnly, true);
assert.equal(envelope.autoRunAllowed, false);
assert.equal(envelope.repoWriteAllowed, false);
assert.equal(envelope.contractPromotionAllowed, false);
assert.equal(plan.workloadEnvelope.status, "requested");
assert.equal(plan.workloadEnvelope.totalRequests, plan.requests.length);
```

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/agentlab-supervisor-contract.test.js dist/test/agentlab-review-requests.test.js --test-name-pattern "workload envelope|AgentLab"
```

Expected: FAIL because workload envelope helpers/fields do not exist.

- [ ] **Step 3: Implement minimal helper and request plan field**

Add types and a builder such as `buildAgentLabWorkloadEnvelope(input)` with hardcoded safety flags. Add optional `workloadEnvelope` to request plan shape and include it when creating plans.

- [ ] **Step 4: Run GREEN**

Run the same focused command. Expected: PASS.

### Task 2: Runner/status envelope

**Files:**
- Modify: `src/agentlab-review-runner.ts`
- Test: `test/agentlab-review-runner.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for run/status workload envelopes:

```ts
assert.equal(status.data?.workloadEnvelope?.status, "stale");
assert.equal(runResult.workloadEnvelope.authority, "advisory");
assert.equal(runResult.workloadEnvelope.autoRunAllowed, false);
```

For deterministic timeout behavior, assert timeout mapping only on an existing timeout test or helper if available.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/agentlab-review-runner.test.js --test-name-pattern "workload envelope|stale|timeout|partial"
```

Expected: FAIL because runner/status does not expose workload envelopes.

- [ ] **Step 3: Implement runner/status envelope synthesis**

Add `workloadEnvelope` to run result/status output. Synthesize `stale` envelope in status read path when current request binding errors exist. Map run statuses into counts. Preserve security violation dominance.

- [ ] **Step 4: Run GREEN**

Run the same focused command. Expected: PASS.

### Task 3: MCP visibility

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing tests**

Assert MCP AgentLab request/status/run responses expose `data.workloadEnvelope` and stale status remains blocking:

```ts
assert.equal(response.data.workloadEnvelope.authority, "advisory");
assert.equal(response.data.workloadEnvelope.autoRunAllowed, false);
assert.equal(stale.data.workloadEnvelope.status, "stale");
assert.equal(stale.data.decisionEnvelope.allowedToProceed, false);
```

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "AgentLab|workload|stale"
```

Expected: FAIL until MCP threads the envelope.

- [ ] **Step 3: Implement MCP response fields**

Expose `workloadEnvelope` under `data` for request-create, review-run, and review-status. Do not trigger review-run from request-create.

- [ ] **Step 4: Run GREEN**

Run the same focused command. Expected: PASS.

### Task 4: Docs and final verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/mcp-server.md`
- Modify: `docs/cli-commands.md`
- Modify if needed: `README.md`

- [ ] **Step 1: Update docs**

Document workload envelopes as advisory evidence metadata. State that they do not authorize execution, promotion, or repo writes.

- [ ] **Step 2: LSP diagnostics**

Run diagnostics on modified TypeScript files. Expected: no diagnostics.

- [ ] **Step 3: Full verification**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: build/tests pass; no blocking diff-check errors.

- [ ] **Step 4: Fresh review and postflight**

Run fresh reviewer and `idu_postflight`. Fix blockers before commit.

- [ ] **Step 5: Commit explicit paths only**

```bash
git add src/agentlab-supervisor-contract.ts src/agentlab-review-requests.ts src/agentlab-review-runner.ts src/mcp-server.ts test/agentlab-supervisor-contract.test.ts test/agentlab-review-requests.test.ts test/agentlab-review-runner.test.ts test/mcp-server.test.ts docs/architecture.md docs/mcp-server.md docs/cli-commands.md README.md docs/superpowers/specs/2026-06-03-agentlab-workload-envelopes-design.md docs/superpowers/plans/2026-06-03-agentlab-workload-envelopes.md
git commit -m "feat(idu): add AgentLab workload envelopes"
```
