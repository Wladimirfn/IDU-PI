# Bibliotecario Evidence Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed concrete local Source Library digest/chunk evidence into librarian AgentLab request planning.

**Architecture:** Extend `external_source_intelligence` request creation with compact local Source Library recommendation evidence. Wire MCP/CLI request creation to call `recommendSourcesForTask()` for external-source-intelligence. Keep request creation advisory-only; execution remains explicit through `idu_agentlab_review_run`.

**Tech Stack:** TypeScript, Node test runner, Source Library stateRoot artifacts, MCP server.

---

### Task 1: Request-builder evidence support

**Files:**
- Modify: `src/agentlab-review-requests.ts`
- Test: `test/agentlab-review-requests.test.ts`

- [ ] **Step 1: Write failing test**

Add/update an `external_source_intelligence` test with compact Source Library evidence:

```ts
const evidence = {
  request: "audit current dependencies",
  generatedAt: "2026-06-03T00:00:00.000Z",
  matches: [{
    sourceId: "source-doc-1",
    title: "Dependency advisory digest",
    chunkIds: ["chunk-001", "chunk-002"],
    whyRelevant: "Mentions dependency security and upgrade notes.",
    confidence: "high",
  }],
  missingKnowledge: [],
  limitations: ["Local digest only; no web fetch."],
  contractPromotionAllowed: false,
};
```

Assert the created librarian request includes source/chunk refs and limitations in `evidence` / `contextSummary` / structured field, does not include raw chunk text, and keeps `contractPromotionAllowed:false`.

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/agentlab-review-requests.test.js --test-name-pattern "external-source|Source Library|bibliotecario"
```

Expected: FAIL because compact evidence is not accepted/threaded.

- [ ] **Step 3: Implement minimal evidence support**

Add `AgentLabSourceLibraryEvidence` and optional `externalSourceLibraryEvidence` to request creation input. Update `requestsFromExternalSourceIntelligence()` to use local evidence when provided.

- [ ] **Step 4: Run GREEN**

Run the same command. Expected: PASS.

### Task 2: CLI/MCP wiring

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP test**

For `idu_agentlab_request_create` with source `external-source-intelligence` and context/objective text, assert the returned plan includes concrete local Source Library evidence when fake runtime supplies it or runtime mapper calls recommendation.

Expected assertions:

```ts
assert.equal(result.ok, true);
assert.match(JSON.stringify(result.data.plan), /source-doc-1/);
assert.match(JSON.stringify(result.data.plan), /chunk-001/);
assert.match(result.safeNotes.join("\n"), /No ejecuté AgentLabs/u);
assert.match(result.safeNotes.join("\n"), /no web|Source Library|local/u);
```

- [ ] **Step 2: Run RED**

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "external-source|Source Library|agentlab_request_create"
```

Expected: FAIL until runtime/MCP passes evidence.

- [ ] **Step 3: Implement wiring**

Extend agentLabRequestCreate options with request/context/objective and optional source evidence. In CLI runtime, when source is external-source-intelligence, call `recommendSourcesForTask()` using local stateRoot/projectId and compact request text. Pass resulting compact evidence into `createAgentLabReviewRequests()`.

- [ ] **Step 4: Run GREEN**

Run the same command. Expected: PASS.

### Task 3: Docs and verification

**Files:**
- Modify: `docs/mcp-server.md`
- Modify: `docs/cli-commands.md`
- Modify: `docs/architecture.md`
- Modify if needed: `README.md`

- [ ] **Step 1: Update docs**

Document that external-source-intelligence first uses local Source Library/digest refs; it does not fetch web automatically and does not promote contracts.

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
git add src/agentlab-review-requests.ts src/cli.ts src/mcp-server.ts test/agentlab-review-requests.test.ts test/mcp-server.test.ts docs/mcp-server.md docs/cli-commands.md docs/architecture.md README.md docs/superpowers/specs/2026-06-03-bibliotecario-evidence-loop-design.md docs/superpowers/plans/2026-06-03-bibliotecario-evidence-loop.md
git commit -m "feat(idu): feed source evidence to librarian audits"
```
