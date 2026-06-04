# Context Quality Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-only context quality signals and a project status panel for supervisor context packs.

**Architecture:** Create `src/context-quality-events.ts` as a sibling to local telemetry modules. Record derived quality events after successful `idu_supervisor_context_pack` calls. Read events in `cli-home.ts` to show a compact qualitative panel.

**Tech Stack:** TypeScript, Node test runner, local JSONL stateRoot reports.

---

### Task 1: Event store and report

**Files:**
- Create: `src/context-quality-events.ts`
- Test: `test/context-quality-events.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for path, privacy flags, malformed JSONL tolerance, and rating derivation from a representative context pack.

Expected assertions:

```ts
assert.match(contextQualityEventsPath(stateRoot), /reports.*context-quality-events\.jsonl/);
assert.equal(report.promptTextStored, false);
assert.equal(report.rawUserTextStored, false);
assert.equal(report.rawDocsStored, false);
assert.equal(report.tokensMeasured, false);
assert.equal(report.costMeasured, false);
assert.equal(report.contextPercentMeasured, false);
assert.equal(report.remoteAnalytics, false);
```

Also assert serialized events do not contain forbidden strings such as `prompt`, `rawUserText`, `rawDocs`, `tokens`, `cost`, `contextPercent`, `headers`, `env`.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/context-quality-events.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement event store/report**

Implement path, record/deferred/flush/read, report builder, formatter, and `contextQualityEventFromSupervisorContextPack(projectId, pack, source)`.

- [ ] **Step 4: Run GREEN**

Run the same command. Expected: PASS.

### Task 2: MCP recording

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP test**

After calling `idu_supervisor_context_pack`, flush context quality events and assert one event was recorded without raw huge request marker.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "supervisor_context_pack|context quality"
```

Expected: FAIL until recording is wired.

- [ ] **Step 3: Implement MCP recording**

Record only for successful `idu_supervisor_context_pack` results. Use derived counts only; do not persist pack text.

- [ ] **Step 4: Run GREEN**

Run the focused command. Expected: PASS.

### Task 3: Project status panel

**Files:**
- Modify: `src/cli-home.ts`
- Test: `test/cli-home.test.ts`

- [ ] **Step 1: Write failing panel test**

Create one context quality event in temp stateRoot and assert project status includes:

```text
Calidad de contexto local
prompts/docs crudos: no almacenado
tokens/costo/% contexto: no medido
analytics remota: no
```

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js --test-name-pattern "contexto|Calidad"
```

Expected: FAIL until panel is added.

- [ ] **Step 3: Implement panel**

Read context quality events from stateRoot and append a compact panel like usage/supervisor panels.

- [ ] **Step 4: Run GREEN**

Run focused command. Expected: PASS.

### Task 4: Docs and verification

**Files:**
- Modify: `docs/mcp-server.md`
- Modify: `docs/architecture.md`
- Modify if needed: `README.md`

- [ ] **Step 1: Update docs**

Document local-only context quality events and privacy boundaries.

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
git add src/context-quality-events.ts src/mcp-server.ts src/cli-home.ts test/context-quality-events.test.ts test/mcp-server.test.ts test/cli-home.test.ts docs/mcp-server.md docs/architecture.md README.md docs/superpowers/specs/2026-06-04-context-quality-optimizer-design.md docs/superpowers/plans/2026-06-04-context-quality-optimizer.md
git commit -m "feat(idu): measure context quality"
```
