# Parallel Specialist Audit Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add advisory-only specialist AgentLab audit planning through existing request creation.

**Architecture:** Extend AgentLab request planning with a new `specialist_audit_plan` source and expose it through `idu_agentlab_request_create` as `specialist-audit-plan`. The plan writes only request artifacts under stateRoot and returns aggregate plus per-specialty workload envelopes. Execution remains explicit through `idu_agentlab_review_run`.

**Tech Stack:** TypeScript, Node test runner, MCP server, JSON stateRoot artifacts.

---

### Task 1: Request-plan support

**Files:**
- Modify: `src/agentlab-review-requests.ts`
- Test: `test/agentlab-review-requests.test.ts`

- [ ] **Step 1: Write failing tests**

Add a test creating source `specialist_audit_plan` with explicit specialties such as `security`, `architecture`, and `database`.

Expected assertions:

```ts
assert.equal(plan.requests.length, 3);
assert.deepEqual(plan.requests.map((request) => request.specialty), ["security", "architecture", "database"]);
assert.equal(plan.explicitRunRequirement?.required, true);
assert.equal(plan.explicitRunRequirement?.tool, "idu_agentlab_review_run");
assert.equal(plan.specialtyWorkloadEnvelopes?.length, 3);
assert.equal(plan.specialtyWorkloadEnvelopes?.[0]?.workloadEnvelope.status, "requested");
assert.equal(plan.workloadEnvelope?.autoRunAllowed, false);
```

Add invalid-specialty behavior if the request API accepts raw strings.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/agentlab-review-requests.test.js --test-name-pattern "specialist"
```

Expected: FAIL because `specialist_audit_plan` does not exist.

- [ ] **Step 3: Implement minimal request-plan support**

Add source type/normalization, optional `specialties`, request builder, `explicitRunRequirement`, and per-specialty workload envelopes. Keep request creation stateRoot-only and no-run.

- [ ] **Step 4: Run GREEN**

Run the same command. Expected: PASS.

### Task 2: MCP exposure

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Call `idu_agentlab_request_create` with:

```ts
{
  source: "specialist-audit-plan",
  objective: "Audit MCP and AgentLab governance",
  specialties: ["security", "architecture", "code_quality"]
}
```

Assert:

```ts
assert.equal(response.ok, true);
assert.deepEqual(response.data.specialties, ["security", "architecture", "code_quality"]);
assert.equal(response.data.plan.explicitRunRequirement.required, true);
assert.equal(response.data.plan.specialtyWorkloadEnvelopes.length, 3);
assert.match(response.safeNotes.join("\n"), /No ejecuté AgentLabs/u);
```

Add invalid specialty test returning `ok: false` or errors.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "specialist-audit|agentlab_request_create"
```

Expected: FAIL until MCP accepts and passes options.

- [ ] **Step 3: Implement MCP schema/handler plumbing**

Add source alias, optional fields, validation, and pass options into runtime request creation. Do not call review-run.

- [ ] **Step 4: Run GREEN**

Run the same command. Expected: PASS.

### Task 3: Runtime/docs alignment

**Files:**
- Modify if needed: `src/cli.ts`
- Modify: `docs/mcp-server.md`
- Modify: `docs/cli-commands.md`
- Modify: `docs/architecture.md`
- Modify if needed: `README.md`

- [ ] **Step 1: Runtime signature compatibility**

If `CliRuntime.agentLabRequestCreate` is used by MCP, extend its signature safely with optional planning options. Keep existing calls working.

- [ ] **Step 2: Docs**

Document specialist audit planning as request-only and advisory-only. State that parallel/specialist plan does not run labs automatically and actual execution remains `idu_agentlab_review_run`.

### Task 4: Verification

**Files:**
- All modified files.

- [ ] **Step 1: LSP diagnostics**

Run diagnostics on modified TypeScript files. Expected: no diagnostics.

- [ ] **Step 2: Full verification**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: PASS, no blocking diff-check errors.

- [ ] **Step 3: Fresh review and postflight**

Run a fresh reviewer and `idu_postflight`. Fix blockers before commit.

- [ ] **Step 4: Commit explicit paths only**

```bash
git add src/agentlab-review-requests.ts src/mcp-server.ts src/cli.ts test/agentlab-review-requests.test.ts test/mcp-server.test.ts docs/mcp-server.md docs/cli-commands.md docs/architecture.md README.md docs/superpowers/specs/2026-06-03-parallel-specialist-audit-plan-design.md docs/superpowers/plans/2026-06-03-parallel-specialist-audit-plan.md
git commit -m "feat(idu): plan specialist AgentLab audits"
```
