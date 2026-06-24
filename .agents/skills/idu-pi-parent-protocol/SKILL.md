---
name: idu-pi-parent-protocol
description: |
  Use this skill whenever the user mentions idu-pi, supervisor, "Proyecto actual",
  MCP audit, or asks the orchestrator (MiniMax, Claude, Qwen, KM5) to work on the
  idu-pi project. Triggers: "usemos idu-pi", "trabajemos en idu-pi", "llamá al
  supervisor", "registrar en Proyecto actual", "preflight", "postflight",
  "contexto del proyecto", "qué dice el plan maestro", "verificar el objetivo",
  "agentlab", or any request that involves idu-pi MCP tools. This skill is the
  mandatory protocol for any parent orchestrator that has access to the
  idu-pi MCP tool surface.
---

# idu-pi Parent Protocol (v4)

> **Audience**: parent/orchestrator model (MiniMax, Claude, Qwen, KM5) in a Pi CLI or OpenCode session.
> **Path**: this file lives in three places (must stay byte-identical):
>   - `C:\Users\elmas\pi-telegram-bridge\.pi\skills\idu-pi-parent-protocol\SKILL.md` (Pi project)
>   - `C:\Users\elmas\.pi\agent\skills\idu-pi-parent-protocol\SKILL.md` (Pi global)
>   - `C:\Users\elmas\pi-telegram-bridge\.agents\skills\idu-pi-parent-protocol\SKILL.md` (OpenCode project)
> **Triggers**: any mention of idu-pi, supervisor, Proyecto actual, preflight, postflight, AgentLab, master plan, or MCP audit on the idu-pi project.

## Tool name prefix — pick by harness

The idu-pi MCP server exposes the same tool surface under two prefixes, one per harness:

- **Pi CLI** uses `mcp__idu-pi__<base>` → e.g. `mcp__idu-pi__idu_status`
- **OpenCode** uses `idu-pi_<base>` → e.g. `idu-pi_idu_status`

The table below lists **base names only** (`idu_status`, `idu_supervisor_context_pack`, …). Prepend the prefix your harness exposes. **Never invent a base name** — if it isn't in the table, it doesn't exist.

## TL;DR — 5-step protocol

1. **Session start**: `idu_status` then `idu_supervisor_context_pack`. Always pass `projectPath` if the user mentions a different project.
2. **Before delegating**: `idu_preflight`. If `risk: high` or `requiresHuman: true`, **stop and ask the user**.
3. **Delegate** to the worker with the context pack and stop conditions.
4. **After the diff**: `idu_postflight`.
5. **Before commit/push**: postflight + `idu_proposal_outbox`.

## What is idu-pi?

Idu-pi is a **normative supervisor/auditor** exposed through MCP. It does NOT implement, does NOT commit, does NOT run code. It informs, audits, recommends. You (the parent) decide, execute, communicate.

**Three actors, three boundaries:**

- **idu-pi** — auditor, contracts, Plan Maestro, drift detection, advisory only.
- **AgentLabs** — audit-only reviewers (architecture, code_quality, security). Never implement.
- **Orchestrator (you)** — final decision, communication, worker/scout/reviewer subagents, worktrees, implementation, tests, commits.

## Tool surface (base names — prepend your harness prefix)

| Base tool | When |
|---|---|
| `idu_status` | session start, before/after any work. Pass `projectPath` if the active project is not the default. |
| `idu_supervisor_context_pack` | before delegating implementation. Pass `projectPath` if needed. |
| `idu_preflight` | before risky/structural changes |
| `idu_postflight` | after a diff, before commit |
| `idu_advisory` | quick advisory |
| `idu_task_context` | per-task advisory fallback |
| `idu_task_package_create` | create a task package for the orchestrator to govern |
| `idu_master_plan_status` | check Plan Maestro state |
| `idu_master_plan_review` | review latest plan |
| `idu_master_plan_approve` | approve a draft plan |
| `idu_proposal_outbox` | list pending proposals |
| `idu_bibliotecario_proactive_advisory` | coordinated evidence from local sources + external registry |
| `idu_autonomous_alerts_status` | check the autonomous alert engine |
| `idu_autonomous_alerts_tick` | run an advisory tick |
| `idu_pending_injections` | list pending trigger injections |
| `idu_subscribe_triggers` | subscribe to trigger emissions |
| `idu_orchestrator_procedure` | official procedure for a given purpose |
| `idu_agentlab_request_create` | create an audit-only request |
| `idu_agentlab_review_run` | run an audit (orchestrator explicit) |
| `idu_project_enroll` | register a project (see ⚠️ warning below) |
| `idu_project_status` | inspect a registered project (path + stateRoot) |

## ⚠️ Enrolling a project without orphaning the confirmed state

Verified in `src/idu-installer.ts:533` (`projectEnroll`):

- **No `idu_project_list` exists**. To inspect registered projects, use `idu_project_status` / `idu_status`, or read the registry file directly.
- **`idu_project_enroll` does NOT accept a `stateRoot` argument**. It derives it from `workspaceRoot + projectId` via `resolveProjectStatePaths`.
- **The default `projectId` is the slug of the last directory segment of the repo path**. For `C:\Users\elmas\pi-telegram-bridge` the default becomes `pi-telegram-bridge` — that yields a **fresh/empty stateRoot**, NOT the confirmed `<workspace>/projects/idu-pi/` where the Project Core lives.
- **To reuse the confirmed state**: pass `projectId: "idu-pi"` explicitly AND verify that the MCP's `workspaceRoot` points to the workspace that contains `projects/idu-pi`.

**Procedure** (do this BEFORE enrolling, otherwise the Project Core goes missing and you effectively revert the loader fix):

1. Call `idu_status({ projectPath })` to read the current resolution.
2. Compute the would-be derived `projectId` (slug of the directory name).
3. Compare against the existing confirmed `projectId` in the registry (read the registry file or call `idu_project_status`).
4. If the derived `projectId` would orphan the confirmed state — **STOP, do not enroll, report to the human**.
5. Only then call `idu_project_enroll({ projectPath, projectId: "<the-confirmed-id>" })`.

## Paths layout (Layout A vs B) — verified in code

Two layouts coexist; some files are migrated, others are not.

- **Layout A (canonical, read via `readIdPathWithMigration`)**: `.idu/config/`
  - `project-core.json`
  - `project-flows.json`
  - `project-blueprint.json` ← *yes, blueprint was moved to Layout A even though some inspector code still hardcodes Layout B — that's a separate live bug (F-Blueprint-Inspector-Drift), not your problem as a reader of this skill.*
- **Layout B (legacy, direct read)**: `config/`
  - `project-constitution.json` — does NOT use the migration reader; the loader at `src/project-constitution.ts:126` hardcodes `config/project-constitution.json`.

**Rule of thumb**: if the loader imports `readIdPathWithMigration`, the canonical file lives in `.idu/config/`. Otherwise, it lives in `config/`. Constitution is the only Layout-B file in the project core set.

## Anti-patterns (never do)

- ❌ Calling idu-pi from a worker subagent. The worker does not have the MCP tool surface.
- ❌ Treating `node dist/src/cli.js idu-postflight` as equivalent to `idu_postflight`. CLI does not register in "Proyecto actual".
- ❌ Inventing tool names like `idu_status_check`, `idu_get_context`, `mcp_idu_status`. Use the **base names** in the table; never invent.
- ❌ Treating AgentLabs as workers. AgentLabs are audit-only. They are **white-hat hackers** that write tests to find vulnerabilities, NOT workers that implement.
- ❌ Saying "idu-pi says X" without having actually called the tool.
- ❌ Skipping `idu_supervisor_context_pack` because you "already know the project".
- ❌ **Escalating to the owner on every `requiresHuman: true`**. The proper escalation gate is severity of impact, not the flag. See the **Escalation rules** section below.
- ❌ **Calling `idu_status` without `projectPath` after switching projects**: it will silently fall back to the default project (idu-pi) even if the active project is different. Always pass `projectPath` when not working on the default.
- ❌ **Enrolling with the default `projectId` when the active project is already registered under a different id** — see the ⚠️ section above.

## Escalation rules (refined v3, paths updated to Layout A in v4)

idu-pi returns `requiresHuman: true` for many things — **do not blindly escalate every one of them**. Apply this gate:

**Escalate to the owner (elmas) ONLY when the change touches**:

1. **Core of the system** (e.g. `src/idu-session.ts`, `src/mcp-server.ts`, `src/cli.ts` core flows, anything marked `core` in the project map).
2. **Plan Maestro** (`.idu/config/project-core.json`, `master-plan.json`, `master-plan.flows.json`).
3. **Global spec / contracts** (`config/project-constitution.json` [Layout B], `.idu/config/project-blueprint.json` [Layout A]).
4. **A bug that is a critical security vulnerability** (CVSS >= high, exploitable in production, or auth/authn broken).
5. **Bibliotecario reports a critical risk** in a language, framework, or library version (e.g. "node 18 has CVE-2024-XXXX, RCE in <module>").

**Everything else the gerente (you, the orchestrator) resolves autonomously**, including:
- New features that don't touch core/master-plan/spec.
- Refactors within a module.
- Tests, docs, examples.
- Skill improvements with score >= 7/10.
- New proposals where `recommendedAction: create_task` and risk <= medium.

**Owner behavior** (id 2274):
- Reads code, observes behavior, intervenes with course-corrections when work drags.
- Contributes new ideas.
- Does NOT approve every single `requiresHuman: true` — that's what gerente is for.

**Supervisor (idu-pi) alerts** that the gerente MUST relay upward:
- Objective drift (work no longer aligned to planObjective).
- Global spec drift (work no longer aligned to spec global).
- Security failures (any finding from a security AgentLab).
- Data analysis surprises (métricas fuera de rango, drift en adoption, etc.).

## Common pitfalls (learned from real sessions)

### 1. "Stuck to the wrong project"

`idu_status` and `idu_supervisor_context_pack` without a `projectPath` argument fall back to the **default** active project, which is `idu-pi` in this repo. If you switched to a new project (e.g. via `idu_project_enroll` + `idu_start`), the calls may return `idu-pi` data instead of the new project's data.

**Fix**: always pass `projectPath` explicitly when the active project is not `idu-pi`:

```js
idu_status({ projectPath: "C:\\path\\to\\other\\project" })
idu_supervisor_context_pack({
  projectPath: "C:\\path\\to\\other\\project",
  request: "..."
})
```

### 2. "No proposals, no injections, no librarian news"

If `idu_proposal_outbox` is empty, `idu_pending_injections` is 0, and `idu_bibliotecario_proactive_advisory` returns `pressure: high` with `review_resource_and_semantic_debt_before_adding_more_context`, the **setup is incomplete**. Check:

1. `idu_status` → `connection.workspace.labDbExists`. If false, init with `idu-task` (creates tasks.jsonl) or via the lab init flow if available.
2. `idu_status` → `connection.alignmentStatus`. If `stale`, run `idu_prepare` or `idu-master-plan-redraft` then re-approve.
3. `idu_proposal_outbox` → if there are pending proposals, you must `idu-supervisor-improvements-approve` or `-reject` them. Procrastinating keeps them in `proposed`.
4. `idu_lab_review_plan postflight` → close the lab review plan that the last `idu-prepare` flagged.

### 3. "Tasks stuck in `proposed` or `paused`"

`idu_status` shows `requiresHuman: true` for most tasks because idu-pi **always requires explicit orchestrator decision** before any work. This is by design, not a bug. To unblock:

- `idu-queue-approve <id>` to let idu-pi proceed.
- `idu-queue-reject <id>` to drop the task.
- `idu-queue-complete <id> <evidence>` once the worker is done.

### 4. "Trigger engine not firing"

The trigger engine is **opt-in**. It only runs when the env var `IDU_PI_TRIGGER_ENGINE=1` is set, AND when the alert scheduler tick runs. The Windows Task Scheduler runs the tick every 15 min via `scripts/idu-supervisor-tick.ps1`. If you do not see fresh injections, check:

1. The task is installed: `Get-ScheduledTask -TaskName "Idu-pi Supervisor Tick"`.
2. The env var is set in the script or the parent process.
3. The scheduler is actually running, not paused.

### 5. "Project not in project-flows"

If `idu_preflight` warns `bitacora no está confirmado en project-flows` (or similar), the project is registered and active but its flows have not been confirmed. Until flows are confirmed, the supervisor returns `allowedToProceed: false` for delegation. To close this:

1. `idu_project_status({ projectPath })` to inspect.
2. `idu_orchestrator_procedure({ purpose: "create_plan", projectPath, request })` to get the create_plan procedure.
3. Approve the resulting plan + flows.

## Setup checklist (run before slice 2 / auto-learning)

Run this sequence once per project to make the loop live:

```text
1. idu_status                             # confirm project resolution
2. idu_supervisor_context_pack            # learn objective + risks
3. idu_proposal_outbox                    # list any pending proposals
4. idu_pending_injections                 # check trigger pipeline
5. idu_lab_review_plan postflight         # close lab review plan
6. idu-master-plan-redraft latest         # if plan is stale
7. idu-master-plan-approve latest         # re-approve
8. idu_prepare                            # realign
9. idu-postflight                         # leave evidence
```

## Worked example: "add caching to the API"

```
1. idu_status({ projectPath: "<repo>" })
2. idu_supervisor_context_pack({ projectPath: "<repo>", request: "add Redis caching to GET /users" })
3. idu_preflight({ request: "add Redis caching to GET /users" })
   → risk=medium, contracts=[data, agent], stop conditions listed
4. delegate to worker with the context pack and stop conditions
5. idu_postflight({ request: "Redis cache added to GET /users" })
6. report to user
```

## When idu-pi returns `risk: high` or `requiresHuman: true`

**Stop. Do not delegate. Do not commit. Ask the user explicitly.**

## Locations

This skill is available in three locations (must stay byte-identical):

- `C:\Users\elmas\pi-telegram-bridge\.pi\skills\idu-pi-parent-protocol\SKILL.md` — Pi project
- `C:\Users\elmas\.pi\agent\skills\idu-pi-parent-protocol\SKILL.md` — Pi global, shared across projects
- `C:\Users\elmas\pi-telegram-bridge\.agents\skills\idu-pi-parent-protocol\SKILL.md` — OpenCode project

In **Pi CLI**: type `/skills` and pick `idu-pi-parent-protocol`, or it auto-loads on the trigger words above.
In **OpenCode**: the `skill` tool lists this skill; load it via `skill({ name: "idu-pi-parent-protocol" })`.

## See also

- `AGENTS.md` (root — short pointer to this skill)
- `docs/architecture.md`
- `openspec/`

## Version

- **v4, 2026-06-24**: harness-agnostic — tool names are now base names with a prefix rule (Pi CLI uses `mcp__idu-pi__`, OpenCode uses `idu-pi_`); added `idu_project_enroll` + `idu_project_status` to the tool table; added the ⚠️ enroll/stateRoot warning; corrected the paths layout note (blueprint = Layout A, not B; constitution = Layout B only). No more hardcoded `mcp__idu-pi__` in examples.
- v3, 2026-06-08: refined **Escalation rules** — owner is needed only for core/master-plan/spec/security-critical, not every `requiresHuman: true`. Recorded in idu-pi postflight + memory 2274.
- v2, 2026-06-08: added "Common pitfalls" + "Setup checklist" sections, learned from real session with project `bitacora-digital-con-idu-pi`.
- v1, 2026-06-08: initial protocol aligned with idu-pi `idu_orchestrator_procedure` and `mustConsult` list.
