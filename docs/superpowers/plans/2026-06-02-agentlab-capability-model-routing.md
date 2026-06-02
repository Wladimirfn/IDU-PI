# AgentLab Capability Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Idu-pi AgentLab model configuration usable and honest: discover known models, avoid bad fallback recommendations, and let users select models/profiles from a responsive picker instead of typing full ids.

**Architecture:** Keep profile execution through existing `PI_AGENT_PROFILES`/`AgentRouter`, but improve configuration UX and proposal quality. `model-assignments` gains capability metadata and diversity checks. CLI model menus gain model/profile inventory and searchable selection inspired by Gentle AI's `/gentle:models` panel. Gentle global routing is read-only evidence for known model ids.

**Tech Stack:** TypeScript, Node test runner, existing CLI TUI helpers, existing `stateRoot/model-assignments.json`, optional read-only `~/.pi/gentle-ai/models.json`.

---

## Tasks

### Task 1: Capability-aware recommendations

**Files:**
- Modify: `src/model-assignments.ts`
- Test: `test/model-assignments.test.ts`

- [x] Add capability labels per AgentLab role: general, project_understanding, architecture, database, security, ui_ux, performance, code_quality, docs, librarian.
- [x] Detect unique model ids from profile model labels. Profiles with same model id count as one model.
- [x] If fewer than 2 unique real models are available, proposal must return blocked/insufficient diversity instead of recommending one profile for all roles.
- [x] Proposal output must say why it is blocked and tell user to add/select more models.

### Task 2: Read known model ids from Gentle config

**Files:**
- Modify: `src/model-assignments.ts` or create focused helper if cleaner.
- Test: `test/model-assignments.test.ts`

- [x] Add safe read-only helper for `~/.pi/gentle-ai/models.json` and legacy `.pi/gentle-ai/models.json` if passed a cwd.
- [x] Extract model ids from entries shaped `{ model: string }` or legacy string entries.
- [x] Do not write Gentle config from Idu-pi.

### Task 3: Responsive picker for model/profile assignment

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-home.test.ts` and any CLI tests affected.

- [x] Replace raw `role id`/`profile id` typing path with a navigable option path where possible: select role from list, then select profile/model option from list.
- [x] Include a search/filter behavior in TUI mode if feasible; otherwise numbered options in non-TTY fallback.
- [x] Allow custom profile/model id only as explicit custom option, not default requirement.
- [x] Keep confirmation before writing `stateRoot/model-assignments.json`.

### Task 4: Model/profile inventory in UI

**Files:**
- Modify: `src/cli-home.ts`
- Test: `test/cli-home.test.ts`

- [x] Show unique profile models and flag duplicate profiles using same model.
- [x] Show known Gentle model ids as read-only hints when present.
- [x] In proposal section, show blocked state if diversity is insufficient.

### Task 5: Verify

- [x] Run `corepack pnpm build`.
- [x] Run focused tests: `node --test dist/test/model-assignments.test.js dist/test/cli-home.test.js`.
- [x] Run full `corepack pnpm test`.
- [x] Run fresh reviewer before commit.
