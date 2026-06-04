# Semantic Debt Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only advisory report for context pruning and semantic debt control.

**Architecture:** Create `src/context-pruning-advisory.ts` as a pure/read-only aggregator. Expose it via one MCP tool `idu_context_pruning_advisory`. The report uses safe metadata/counts only and never deletes or promotes contracts.

**Tech Stack:** TypeScript, Node test runner, local stateRoot reports and repo metadata.

---

### Task 1: Advisory report module

**Files:**
- Create: `src/context-pruning-advisory.ts`
- Test: `test/context-pruning-advisory.test.ts`

- [ ] Write tests for safety flags, context bloat signal, stale evidence/digest signal, old plan/spec signal, and no raw fields.
- [ ] Run RED: `corepack pnpm build && node --test dist/test/context-pruning-advisory.test.js`.
- [ ] Implement a read-only report builder using context quality events, source status/digest status helpers, and metadata scans of `docs/superpowers/plans` and `docs/superpowers/specs`.
- [ ] Run GREEN.

### Task 2: MCP advisory surface

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] Add failing test for `idu_context_pruning_advisory` tool list and response safety.
- [ ] Implement MCP schema/handler with advisory decision envelope and safe notes.
- [ ] Run focused GREEN.

### Task 3: Docs and verification

**Files:**
- Modify: `docs/mcp-server.md`
- Modify: `docs/architecture.md`
- Modify if needed: `README.md`

- [ ] Document semantic debt control as read-only advisory.
- [ ] Run LSP diagnostics.
- [ ] Run full verification: `corepack pnpm build && corepack pnpm test && git diff --check`.
- [ ] Fresh review + Idu postflight.
- [ ] Commit explicit paths only:

```bash
git add src/context-pruning-advisory.ts src/mcp-server.ts test/context-pruning-advisory.test.ts test/mcp-server.test.ts docs/mcp-server.md docs/architecture.md README.md docs/superpowers/specs/2026-06-04-semantic-debt-control-design.md docs/superpowers/plans/2026-06-04-semantic-debt-control.md
git commit -m "feat(idu): report semantic debt"
```
