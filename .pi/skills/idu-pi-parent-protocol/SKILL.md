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
  mcp__idu-pi__* tool surface.
---

# idu-pi Parent Protocol (v2)

> **Audience**: parent/orchestrator model (MiniMax, Claude, Qwen, KM5) in a Pi session.
> **Path**: this file lives at `C:\Users\elmas\pi-telegram-bridge\.pi\skills\idu-pi-parent-protocol\SKILL.md` and at `C:\Users\elmas\.pi\agent\skills\idu-pi-parent-protocol\SKILL.md` (global).
> **Triggers**: any mention of idu-pi, supervisor, Proyecto actual, preflight, postflight, AgentLab, master plan, or MCP audit on the idu-pi project.

## TL;DR — 5-step protocol

1. **Session start**: `mcp__idu-pi__idu_status` then `mcp__idu-pi__idu_supervisor_context_pack`. Always pass `projectPath` if the user mentions a different project.
2. **Before delegating**: `mcp__idu-pi__idu_preflight`. If `risk: high` or `requiresHuman: true`, **stop and ask the user**.
3. **Delegate** to the worker with the context pack and stop conditions.
4. **After the diff**: `mcp__idu-pi__idu_postflight`.
5. **Before commit/push**: postflight + `mcp__idu-pi__idu_proposal_outbox`.

## What is idu-pi?

Idu-pi is a **normative supervisor/auditor** exposed through MCP. It does NOT implement, does NOT commit, does NOT run code. It informs, audits, recommends. You (the parent) decide, execute, communicate.

**Three actors, three boundaries:**

- **idu-pi** — auditor, contracts, Plan Maestro, drift detection, advisory only.
- **AgentLabs** — audit-only reviewers (architecture, code_quality, security). Never implement.
- **Orchestrator (you)** — final decision, communication, worker/scout/reviewer subagents, worktrees, implementation, tests, commits.

## Tool surface (copy-paste exact names)

| Tool | When |
|---|---|
| `mcp__idu-pi__idu_status` | session start, before/after any work. Pass `projectPath` if the active project is not the default. |
| `mcp__idu-pi__idu_supervisor_context_pack` | before delegating implementation. Pass `projectPath` if needed. |
| `mcp__idu-pi__idu_preflight` | before risky/structural changes |
| `mcp__idu-pi__idu_postflight` | after a diff, before commit |
| `mcp__idu-pi__idu_advisory` | quick advisory |
| `mcp__idu-pi__idu_task_context` | per-task advisory fallback |
| `mcp__idu-pi__idu_task_package_create` | create a task package for the orchestrator to govern |
| `mcp__idu-pi__idu_master_plan_status` | check Plan Maestro state |
| `mcp__idu-pi__idu_master_plan_review` | review latest plan |
| `mcp__idu-pi__idu_master_plan_approve` | approve a draft plan |
| `mcp__idu-pi__idu_proposal_outbox` | list pending proposals |
| `mcp__idu-pi__idu_bibliotecario_proactive_advisory` | coordinated evidence from local sources + external registry |
| `mcp__idu-pi__idu_autonomous_alerts_status` | check the autonomous alert engine |
| `mcp__idu-pi__idu_autonomous_alerts_tick` | run an advisory tick |
| `mcp__idu-pi__idu_pending_injections` | list pending trigger injections |
| `mcp__idu-pi__idu_subscribe_triggers` | subscribe to trigger emissions |
| `mcp__idu-pi__idu_orchestrator_procedure` | official procedure for a given purpose |
| `mcp__idu-pi__idu_agentlab_request_create` | create an audit-only request |
| `mcp__idu-pi__idu_agentlab_review_run` | run an audit (orchestrator explicit) |

## Anti-patterns (never do)

- ❌ Calling idu-pi from a worker subagent. The worker does not have the MCP tool surface.
- ❌ Treating `node dist/src/cli.js idu-postflight` as equivalent to `mcp__idu-pi__idu_postflight`. CLI does not register in "Proyecto actual".
- ❌ Inventing tool names like `idu_status_check`, `idu_get_context`, `mcp_idu_status`. Use exact names.
- ❌ Treating AgentLabs as workers. AgentLabs are audit-only.
- ❌ Saying "idu-pi says X" without having actually called the tool.
- ❌ Skipping `idu_supervisor_context_pack` because you "already know the project".
- ❌ Proceeding when `requiresHuman: true`. Stop and ask.
- ❌ **Calling `idu_status` without `projectPath` after switching projects**: it will silently fall back to the default project (idu-pi) even if the active project is different. Always pass `projectPath` when not working on the default.

## Common pitfalls (learned from real sessions)

### 1. "Stuck to the wrong project"

`idu_status` and `idu_supervisor_context_pack` without a `projectPath` argument fall back to the **default** active project, which is `idu-pi` in this repo. If you switched to a new project (e.g. via `idu_project_enroll` + `idu_start`), the calls may return `idu-pi` data instead of the new project's data.

**Fix**: always pass `projectPath` explicitly when the active project is not `idu-pi`:

```js
mcp__idu-pi__idu_status({ projectPath: "C:\\path\\to\\other\\project" })
mcp__idu-pi__idu_supervisor_context_pack({
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

1. `mcp__idu-pi__idu_project_status({ projectPath })` to inspect.
2. `mcp__idu-pi__idu_orchestrator_procedure({ purpose: "create_plan", projectPath, request })` to get the create_plan procedure.
3. Approve the resulting plan + flows.

## Setup checklist (run before slice 2 / auto-learning)

Run this sequence once per project to make the loop live:

```text
1. mcp__idu-pi__idu_status                          # confirm project resolution
2. mcp__idu-pi__idu_supervisor_context_pack         # learn objective + risks
3. mcp__idu-pi__idu_proposal_outbox                 # list any pending proposals
4. mcp__idu-pi__idu_pending_injections              # check trigger pipeline
5. mcp__idu-pi__idu_lab_review_plan postflight      # close lab review plan
6. mcp__idu-pi__idu-master-plan-redraft latest      # if plan is stale
7. mcp__idu-pi__idu-master-plan-approve latest      # re-approve
8. mcp__idu-pi__idu_prepare                         # realign
9. mcp__idu-pi__idu-postflight                      # leave evidence
```

## Worked example: "add caching to the API"

```
1. mcp__idu-pi__idu_status({ projectPath: "<repo>" })
2. mcp__idu-pi__idu_supervisor_context_pack({ projectPath: "<repo>", request: "add Redis caching to GET /users" })
3. mcp__idu-pi__idu_preflight({ request: "add Redis caching to GET /users" })
   → risk=medium, contracts=[data, agent], stop conditions listed
4. delegate to worker with the context pack and stop conditions
5. mcp__idu-pi__idu_postflight({ request: "Redis cache added to GET /users" })
6. report to user
```

## When idu-pi returns `risk: high` or `requiresHuman: true`

**Stop. Do not delegate. Do not commit. Ask the user explicitly.**

## Locations

This skill is available at:

- `C:\Users\elmas\pi-telegram-bridge\.pi\skills\idu-pi-parent-protocol\SKILL.md` (project)
- `C:\Users\elmas\.pi\agent\skills\idu-pi-parent-protocol\SKILL.md` (global, shared across projects)
- `C:\Users\elmas\pi-telegram-bridge\AGENTS.md` (short pointer at the repo root)

## See also

- `AGENTS.md` (root)
- `docs/architecture.md`
- `openspec/`

## Version

- v2, 2026-06-08: added "Common pitfalls" + "Setup checklist" sections, learned from real session with project `bitacora-digital-con-idu-pi`.
- v1, 2026-06-08: initial protocol aligned with idu-pi `idu_orchestrator_procedure` and `mustConsult` list.
