# Skill Draft From Lessons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Idu-pi surface that turns recorded failures/lessons into skill improvement proposals and, once approved proposals exist, skill draft artifacts.

**Architecture:** Add a small coordinator that composes the existing semantic compaction, skill improvement proposal, and approved skill draft flows without bypassing human approval. Expose it through MCP as advisory JSON and document the workflow.

**Tech Stack:** TypeScript, Node test runner, existing Idu-pi reports/stateRoot architecture, MCP tool registry.

---

## File Structure

- Create `src/skill-draft-from-lessons.ts`: coordinator and formatter for `proposal-only` / `approved-only` modes.
- Create `test/skill-draft-from-lessons.test.ts`: focused RED/GREEN tests for coordinator behavior.
- Modify `src/cli.ts`: add runtime methods if needed for MCP factory reuse.
- Modify `src/mcp-server.ts`: add `idu_skill_draft_from_lessons` MCP tool and handler.
- Modify `test/mcp-server.test.ts`: MCP contract tests.
- Modify `docs/mcp-server.md`: document tool safety and workflow.

## Tasks

### Task 1: Coordinator module

- [ ] Write failing tests for `proposal-only` creating proposals from a semantic compaction draft and not creating skill drafts.
- [ ] Write failing tests for `approved-only` creating skill drafts only from approved proposals.
- [ ] Implement `createSkillDraftFromLessons(input)` by composing existing functions.
- [ ] Add a small formatter for CLI/diagnostics if needed.

### Task 2: MCP exposure

- [ ] Add MCP tool definition `idu_skill_draft_from_lessons` with `mode?: "proposal-only" | "approved-only"` and `selector?: string`.
- [ ] Add handler returning advisory envelope, safe notes, proposal/draft paths, and next required actions.
- [ ] Add MCP tests for default mode, approved mode, and no auto-install/no AgentLabs claims.

### Task 3: Documentation and verification

- [ ] Document the tool in `docs/mcp-server.md`.
- [ ] Run `corepack pnpm build && corepack pnpm test && git diff --check`.
- [ ] Run fresh reviewer before commit.

## Self-Review

- Coverage: plan covers coordinator, MCP surface, docs, tests, and verification.
- Safety: no direct writes to `.agents`, `.atl`, contracts, commits, push, or AgentLabs.
- Scope: one bounded feature, reusing existing governance gates.
