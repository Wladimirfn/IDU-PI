# External Source Registry v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static no-fetch registry and recommendation surface for Bibliotecario external sources and programming-structure guidance.

---

### Task 1: Registry module

**Files:**
- Create: `src/external-source-registry.ts`
- Test: `test/external-source-registry.test.ts`

- [ ] RED: registry includes required categories/domains/sources and safety booleans.
- [ ] RED: recommendations for HTML no embedded JS, Next.js/TypeScript structure, standards/civil works, academic discovery, and blocked/manual sources.
- [ ] Implement pure no-fetch registry and recommender.
- [ ] GREEN focused.

### Task 2: MCP read-only recommendation tool

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] Add `idu_external_source_recommend` to tool list and schema.
- [ ] Handler returns advisory envelope, result, and safe notes: no web/live fetch, no raw docs, no Source Library import, no AgentLabs, no contract promotion.
- [ ] GREEN focused.

### Task 3: Docs and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/mcp-server.md`

- [ ] Document difference between source registry (no-fetch catalog) and external intelligence report (controlled allowlisted fetch report).
- [ ] LSP diagnostics.
- [ ] Full verification: `corepack pnpm build && corepack pnpm test && git diff --check`.
- [ ] Fresh review + Idu postflight.
- [ ] Commit explicit paths only.
