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

# idu-pi Parent Protocol (v1)

> **Audience**: parent/orchestrator model (MiniMax, Claude, Qwen, KM5) in a Pi session.
> **Path**: this file lives at `C:\Users\elmas\pi-telegram-bridge\.pi\skills\idu-pi-parent-protocol\SKILL.md` and at `C:\Users\elmas\.pi\agent\skills\idu-pi-parent-protocol\SKILL.md` (global).
> **Triggers**: any mention of idu-pi, supervisor, Proyecto actual, preflight, postflight, AgentLab, master plan, or MCP audit on the idu-pi project.

## TL;DR — 5-step protocol

1. **Session start**: `mcp__idu-pi__idu_status` then `mcp__idu-pi__idu_supervisor_context_pack`.
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
| `mcp__idu-pi__idu_status` | session start, before/after any work |
| `mcp__idu-pi__idu_supervisor_context_pack` | before delegating implementation |
| `mcp__idu-pi__idu_preflight` | before risky/structural changes |
| `mcp__idu-pi__idu_postflight` | after a diff, before commit |
| `mcp__idu-pi__idu_advisory` | quick advisory |
| `mcp__idu-pi__idu_task_context` | per-task advisory fallback |
| `mcp__idu-pi__idu_master_plan_status` | check Plan Maestro state |
| `mcp__idu-pi__idu_master_plan_review` | review latest plan |
| `mcp__idu-pi__idu_master_plan_approve` | approve a draft plan |
| `mcp__idu-pi__idu_proposal_outbox` | list pending proposals |
| `mcp__idu-pi__idu_agentlab_request_create` | create an audit-only request |
| `mcp__idu-pi__idu_agentlab_review_run` | run an audit (orchestrator explicit) |
| `mcp__idu-pi__idu_orchestrator_procedure` | official procedure for a given purpose |

## Anti-patterns (never do)

- ❌ Calling idu-pi from a worker subagent. The worker does not have the MCP tool surface.
- ❌ Treating `node dist/src/cli.js idu-postflight` as equivalent to `mcp__idu-pi__idu_postflight`. CLI does not register in "Proyecto actual".
- ❌ Inventing tool names like `idu_status_check`, `idu_get_context`, `mcp_idu_status`. Use exact names.
- ❌ Treating AgentLabs as workers. AgentLabs are audit-only.
- ❌ Saying "idu-pi says X" without having actually called the tool.
- ❌ Skipping `idu_supervisor_context_pack` because you "already know the project".
- ❌ Proceeding when `requiresHuman: true`. Stop and ask.

## Worked example: "add caching to the API"

```
1. mcp__idu-pi__idu_status
2. mcp__idu-pi__idu_supervisor_context_pack({ request: "add Redis caching to GET /users" })
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
