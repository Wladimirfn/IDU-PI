# Autonomous Alert Loop v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Autonomous Alert Engine through CLI/Telegram and prepare safe scheduled execution/richer domains without adding uncontrolled automation.

**Architecture:** Reuse the MCP alert engine behavior as the source of truth. Add thin CLI and Telegram wrappers first, keep task creation disabled by default outside MCP explicit calls, then add advisory cron-plan and evidence-first domain expansion in later tasks.

**Tech Stack:** TypeScript, Node.js, existing CLI switch/case patterns, Telegram bot handlers, Node test runner.

---

## File Structure

- Modify: `src/cli.ts`
  - Add CLI alert status/tick/control command cases.
  - Prefer helper functions that call existing alert modules rather than duplicating engine logic.

- Modify: `src/command-catalog.ts`
  - Add CLI/Telegram command metadata for alert commands.

- Modify: `src/telegram-command-registry.ts`
  - Add public Telegram alert command allowlist entries.

- Modify: `src/index.ts`
  - Add Telegram handlers for status/tick/pause/resume/off/on.
  - Keep tick read-only by default.

- Modify: `src/autonomous-alert-engine.ts`
  - Add richer evidence-first domains only after surfaces are stable.

- Tests:
  - `test/idu-cli.test.ts`
  - `test/command-catalog.test.ts`
  - `test/telegram-ui.test.ts` or relevant Telegram handler tests
  - `test/autonomous-alert-engine.test.ts`

---

## Task 1: CLI alert status/tick/control

**Files:**
- Modify: `src/cli.ts`
- Test: `test/idu-cli.test.ts` or existing CLI command wiring test file

Steps:

- [ ] Add failing tests for CLI command parsing/output:
  - `idu-pi alerts status` prints raw honesty + active/paused.
  - `idu-pi alerts tick` runs with task creation disabled by default.
  - `idu-pi alerts control pause 60` writes only alert stateRoot control state.

- [ ] Run focused CLI tests and verify failure.

- [ ] Implement minimal CLI cases:
  - `alerts status`
  - `alerts tick`
  - `alerts control enable|disable|pause|resume|disable-domain|enable-domain`

- [ ] Ensure status/tick do not create tasks unless explicit `--allow-task-creation` is provided.

- [ ] Run focused tests and commit:

```bash
git add src/cli.ts test/idu-cli.test.ts
git commit -m "feat(idu): add alert cli commands"
```

---

## Task 2: Command catalog and Telegram registry

**Files:**
- Modify: `src/command-catalog.ts`
- Modify: `src/telegram-command-registry.ts`
- Test: `test/command-catalog.test.ts`

Steps:

- [ ] Add failing tests that command catalog includes:
  - `/idu_alerts_status`
  - `/idu_alerts_tick`
  - `/idu_alerts_pause`
  - `/idu_alerts_resume`
  - `/idu_alerts_off`
  - `/idu_alerts_on`

- [ ] Add failing tests that registry allowlists those commands.

- [ ] Implement catalog and registry entries.

- [ ] Run focused tests and commit:

```bash
git add src/command-catalog.ts src/telegram-command-registry.ts test/command-catalog.test.ts
git commit -m "feat(idu): register alert telegram commands"
```

---

## Task 3: Telegram read-only alert handlers and safe controls

**Files:**
- Modify: `src/index.ts`
- Test: relevant Telegram handler tests, likely `test/telegram-ui.test.ts` or command wiring test

Steps:

- [ ] Add failing tests or handler-level checks for:
  - `/idu_alerts_status` returns compact raw-honesty status.
  - `/idu_alerts_tick` does not create tasks by default.
  - `/idu_alerts_pause` and `/idu_alerts_resume` call control state only.

- [ ] Implement Telegram handlers using the same runtime/helper path as CLI/MCP.

- [ ] Keep output compact:

```text
Alertas Idu-pi
Estado: active|paused|off
Decisiones: N
Escalaciones humanas: N
Tareas creadas: 0
Honestidad cruda: <top uncomfortable truth>
```

- [ ] Run focused tests and commit:

```bash
git add src/index.ts test/telegram-ui.test.ts
git commit -m "feat(idu): expose alert telegram controls"
```

---

## Task 4: Safe cron-plan for autonomous alerts

**Files:**
- Create or modify: `src/autonomous-alert-cron.ts`
- Modify: `src/mcp-server.ts` or `src/cli.ts` only if exposing surface
- Test: `test/autonomous-alert-cron.test.ts`

Steps:

- [ ] Add failing tests for cron-plan:
  - returns idle when Idu inactive;
  - returns paused when alert engine paused;
  - returns would-run with `allowTaskCreation=false` by default;
  - never executes AgentLabs/dependencies/rules/skills/contracts.

- [ ] Implement pure cron-plan builder.

- [ ] Expose via CLI or MCP only as advisory if small.

- [ ] Run tests and commit:

```bash
git add src/autonomous-alert-cron.ts test/autonomous-alert-cron.test.ts src/cli.ts src/mcp-server.ts
git commit -m "feat(idu): plan autonomous alert cron"
```

---

## Task 5: Richer domains advisory-only

**Files:**
- Modify: `src/autonomous-alert-engine.ts`
- Modify: `src/supervisor-self-maintenance-advisory.ts` if new signal categories are needed
- Test: `test/autonomous-alert-engine.test.ts`, `test/supervisor-self-maintenance-advisory.test.ts`

Steps:

- [ ] Add failing tests for evidence-first domains:
  - bibliotecario stale/source-required action creates `bibliotecario` report/task draft only when low/medium;
  - security/DB evidence defaults to `ask_human`;
  - optimization stale creates low/medium audit task draft;
  - npm/security unavailable reports raw honesty and no false coverage claim.

- [ ] Implement minimal domain inputs and mappings.

- [ ] Keep all dependency/news/live external fetches out of automatic tick unless explicitly called by existing allowlisted tools.

- [ ] Run tests and commit:

```bash
git add src/autonomous-alert-engine.ts src/supervisor-self-maintenance-advisory.ts test/autonomous-alert-engine.test.ts test/supervisor-self-maintenance-advisory.test.ts
git commit -m "feat(idu): enrich autonomous alert domains"
```

---

## Task 6: Final verification and review

Steps:

- [ ] LSP diagnostics on touched files: expect 0.

- [ ] Full gate:

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: all pass.

- [ ] Idu postflight with `ignoredFiles:["context.md"]` and expected touched files.

- [ ] Fresh reviewer: verify no uncontrolled scheduler, no task-creating Telegram button, no auto AgentLabs/dependency/rule/skill/contract mutation, CLI/Telegram default tick read-only, raw honesty preserved.

- [ ] Push only after PASS:

```bash
git push origin feat/idu-context-pressure
```

---

## Self-Review

Coverage:
- CLI/Telegram controls: Tasks 1-3.
- Scheduler/cron safe plan: Task 4.
- Richer domains: Task 5.
- Raw honesty and safety: all tasks.

Intentional v2 limits:
- No uncontrolled daemon.
- No Telegram task-creation button.
- No automatic external fetch beyond explicit existing allowlisted tools.
- No dependency updates or AgentLab auto-run.
