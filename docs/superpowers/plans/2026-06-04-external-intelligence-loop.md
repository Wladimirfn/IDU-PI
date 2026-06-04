# External Intelligence Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add controlled external intelligence reporting for Bibliotecario.

---

### Task 1: Pure report module

**Files:**
- Create: `src/external-intelligence.ts`
- Test: `test/external-intelligence.test.ts`

- [x] RED: tests for exact allowlist, fake fetch, normalized-only output, partial failures, stateRoot report paths, and safety booleans.
- [x] Implement source IDs, allowlist validation, injected fetch client, report builder, and stateRoot report writer.
- [x] GREEN focused.

### Task 2: MCP surface

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [x] Add `idu_external_intelligence_report` to tool list.
- [x] Add handler with safe notes: allowlist only, stateRoot only, no auto update, no AgentLab, no contracts, no raw content.
- [x] GREEN focused.

### Task 3: Docs

**Files:**
- Modify: `docs/mcp-server.md`
- Modify: `docs/architecture.md`
- Modify: `README.md` if relevant.

- [x] Document External Intelligence Loop as advisory-only.
- [x] Full verification.
- [ ] Fresh review + postflight.
