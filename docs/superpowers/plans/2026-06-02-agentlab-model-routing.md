# AgentLab Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Idu-pi recommend, show, and persist model/profile assignments per real AgentLab specialty, while keeping user approval mandatory for changes.

**Architecture:** Extend the existing `model-assignments` module instead of adding a new subsystem. The menu gains a recommendation/approval path, and `agentlab-review-runner` resolves each real AgentLab specialty to an explicit configurable role before falling back to profile-name heuristics.

**Tech Stack:** TypeScript, Node test runner, existing CLI TUI/menu helpers, existing `stateRoot/model-assignments.json`.

---

## File Structure

- Modify `src/model-assignments.ts`: add real AgentLab roles, recommendation helpers, and formatted proposal output.
- Modify `src/agentlab-review-runner.ts`: map `database`, `ui_ux`, `docs`, `librarian`, and `project_understanding` to explicit roles.
- Modify `src/cli-home.ts`: show proposal-oriented model status and all real AgentLab roles.
- Modify `src/cli.ts`: add `Propuesta automática por AgentLab` menu action and user-approved save flow.
- Modify `test/model-assignments.test.ts`: cover new roles and proposal generation.
- Modify `test/agentlab-review-runner.test.ts`: cover explicit specialty-to-role routing.
- Modify docs if needed after implementation.

## Tasks

### Task 1: Expand model roles to real AgentLab specialties

**Files:**
- Modify: `src/model-assignments.ts`
- Test: `test/model-assignments.test.ts`

- [ ] Add role ids: `agentlab-project-understanding`, `agentlab-database`, `agentlab-ui-ux`, `agentlab-docs`, `agentlab-librarian`.
- [ ] Update `IDU_MODEL_ROLES` labels so status output lists every configurable AgentLab.
- [ ] Add a test asserting all new role ids are accepted by `saveModelAssignment`.

### Task 2: Add automatic recommendation helper

**Files:**
- Modify: `src/model-assignments.ts`
- Test: `test/model-assignments.test.ts`

- [ ] Add `recommendAgentLabModelAssignments(profiles, current?)` that returns one recommended profile id per AgentLab role.
- [ ] Use profile labels/ids/model strings as heuristic evidence: security prefers security/sec; database prefers database/db/data; architecture/project-understanding prefers architecture/arch; ui_ux prefers ui/ux/frontend; performance prefers performance/perf; docs/librarian prefer docs/librarian; otherwise fallback to general or first lab profile.
- [ ] Add `formatAgentLabModelAssignmentProposal(...)` showing role, current, recommended, and reason.
- [ ] Test that specialty-named profiles are selected over generic fallback.

### Task 3: Wire runner to explicit roles

**Files:**
- Modify: `src/agentlab-review-runner.ts`
- Test: `test/agentlab-review-runner.test.ts`

- [ ] Update `agentLabRoleForSpecialty` so `project_understanding`, `database`, `ui_ux`, `docs`, and `librarian` have exact roles.
- [ ] Add tests proving `selectAgentLabProfile` uses assignment for `database` and `ui_ux` instead of falling back to general.

### Task 4: Add CLI/menu proposal and approved save

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli-home.ts`
- Test: existing CLI/menu tests if assertions break.

- [ ] Add menu option `Propuesta automática por AgentLab`.
- [ ] Handler shows proposal and asks confirmation before writing.
- [ ] If approved, save all recommendations to `stateRoot/model-assignments.json` with backup.
- [ ] If rejected, report no changes and suggest manual assignment.

### Task 5: Verify

- [ ] Run `corepack pnpm build`.
- [ ] Run focused tests: `node --test dist/test/model-assignments.test.js dist/test/agentlab-review-runner.test.js`.
- [ ] Run full `corepack pnpm test`.
- [ ] Run fresh review before commit.
