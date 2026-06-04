# Supervisor Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make supervisor consultation visibly available in orchestrator-facing outputs.

---

### Task 1: Consultation object

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] RED: context pack exposes `data.supervisorConsultation` with plan objective, recommendation, risks, gates, contracts, evidence, proceed/stop rationale, and AgentLab audit-only flags.
- [ ] Implement local helper/type for compact `SupervisorConsultation`.
- [ ] Use it in `idu_supervisor_context_pack` and align decision envelope `allowedToProceed` with consultation.
- [ ] GREEN focused.

### Task 2: Other advisory surfaces

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] Add `supervisorConsultation` to `idu_task_context`, `idu_preflight`/`idu_advisory` where practical, and `idu_postflight`.
- [ ] Postflight derives proceed/stop from task trace and decision envelope.
- [ ] Ensure no raw prompt marker leaks.

### Task 3: Docs and verification

**Files:**
- Modify: `docs/mcp-server.md`
- Modify: `docs/cli-commands.md` if needed.
- Modify: `README.md` if needed.

- [ ] Document supervisorConsultation and visibility rule.
- [ ] LSP diagnostics.
- [ ] Full verification: `corepack pnpm build && corepack pnpm test && git diff --check`.
- [ ] Fresh review + Idu postflight.
- [ ] Commit explicit paths only.
