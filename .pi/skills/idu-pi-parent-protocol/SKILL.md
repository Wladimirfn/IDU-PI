# idu-pi Parent Protocol

> **Audience**: parent/orchestrator model (MiniMax, Claude, Qwen, KM5, etc.) running in a Pi session.
> **Goal**: leave evidence in idu-pi's "Proyecto actual" panel and follow the official idu-pi procedure.
> **When to load**: any session in a project with idu-pi enrolled; especially before delegating to subagents or before commit/push.

## What is idu-pi?

**Idu-pi is a normative supervisor/auditor for the Pi orchestrator.** It is exposed exclusively through MCP. It does NOT implement, it does NOT make commits, and it does NOT run code on its own. It informs, audits, and recommends. You (the parent) decide, execute, and communicate.

**Three actors, three boundaries:**

- **idu-pi**: auditor, contracts, Plan Maestro, drift detection, advisory only.
- **AgentLabs**: audit-only reviewers (architecture, code_quality, security). Never implement.
- **Orchestrator (you)**: final decision, communication, worker/scout/reviewer subagents, worktrees, implementation, tests, commits.

## Mandatory protocol

### 1. Session start

Before any work, run:

```
mcp__idu-pi__idu_status
mcp__idu-pi__idu_supervisor_context_pack({ request: "<your intent>" })
```

- `idu_status` confirms: `active`, `configStatus`, `alignmentStatus`, recommended next.
- `idu_supervisor_context_pack` returns: objective, contracts, risks, gates, required reads, autonomy gates.

If `alignmentStatus = "stale"`, run `mcp__idu-pi__idu_prepare` first to realign.

### 2. Before delegating to a subagent

```
mcp__idu-pi__idu_preflight({ request: "<what you intend to do>" })
```

- If `risk: high` OR `requiresHuman: true` → **stop, ask the user**, do not delegate.
- If `risk: medium` → proceed but capture evidence.
- If `risk: low` → proceed.

Pass to the subagent: the context pack, the objective, the affected contracts, and the stop conditions list returned by `idu_preflight`.

### 3. After the subagent finishes

```
mcp__idu-pi__idu_postflight({ request: "<summary of the work>" })
```

idu-pi reports: `risk`, `changedFiles`, `impactedAreas`, `taskTrace`, `physicalGates` (build, test, git).

If `postflight.recommendation = "warn"` or `"needs_human"`, decide whether to fix, delegate a reviewer, or stop.

### 4. Before commit/push

```
mcp__idu-pi__idu_postflight
mcp__idu-pi__idu_proposal_outbox    # if there are pending proposals
```

Only commit if `postflight.okToProceed = true` and no pending proposals require review.

## Required tool surface (copy-paste exact names)

| Tool | When |
|------|------|
| `mcp__idu-pi__idu_status` | session start, before/after any work |
| `mcp__idu-pi__idu_supervisor_context_pack` | before delegating implementation |
| `mcp__idu-pi__idu_preflight` | before risky/structural changes |
| `mcp__idu-pi__idu_postflight` | after a diff, before commit |
| `mcp__idu-pi__idu_advisory` | quick advisory with less ceremony |
| `mcp__idu-pi__idu_task_context` | per-task advisory fallback |
| `mcp__idu-pi__idu_master_plan_status` | check Plan Maestro state |
| `mcp__idu-pi__idu_master_plan_review` | review latest plan |
| `mcp__idu-pi__idu_master_plan_approve` | approve a draft plan |
| `mcp__idu-pi__idu_proposal_outbox` | list pending proposals |
| `mcp__idu-pi__idu_agentlab_request_create` | create an audit-only request |
| `mcp__idu-pi__idu_agentlab_review_run` | run an audit (only by explicit orchestrator call) |
| `mcp__idu-pi__idu_orchestrator_procedure` | get the official procedure for a given purpose |

## Anti-patterns (never do)

- ❌ Calling idu-pi from a worker subagent. The worker does not have the MCP tool surface; only the parent does.
- ❌ Treating `node dist/src/cli.js idu-postflight` as equivalent to `mcp__idu-pi__idu_postflight`. CLI calls do not register in the "Proyecto actual" panel.
- ❌ Inventing tool names like `idu_status_check`, `idu_get_context`, `mcp_idu_status`. Use the exact names above.
- ❌ Treating AgentLabs as workers. AgentLabs are audit-only. They do not implement, edit the repo, or commit.
- ❌ Saying "idu-pi says X" without having actually called the tool. The advisory is only the response from a real MCP call.
- ❌ Skipping `idu_supervisor_context_pack` because "I already know the project". The pack carries the latest objective, contracts, and gates.
- ❌ Proceeding when `requiresHuman: true`. Stop and ask.

## Worked example: "add caching to the API"

```
1. mcp__idu-pi__idu_status                       # confirm active project
2. mcp__idu-pi__idu_supervisor_context_pack({
     request: "add Redis caching to GET /users"
   })
3. mcp__idu-pi__idu_preflight({
     request: "add Redis caching to GET /users"
   })
   → risk=medium, contracts=[data, agent], stop conditions listed
4. delegate to worker (MiniMax, Claude, etc.) with:
   - the context pack
   - the stop conditions
   - the affected contracts
5. worker implements in src/api/users.ts
6. mcp__idu-pi__idu_postflight({
     request: "Redis cache added to GET /users in src/api/users.ts"
   })
   → risk=low, changedFiles=[src/api/users.ts, test/...]
7. report to user: cached GET /users, postflight green, ready to commit
```

## When idu-pi returns `risk: high` or `requiresHuman: true`

**Stop. Do not delegate. Do not commit. Ask the user explicitly.** idu-pi is a normative supervisor; bypassing it is a violation of the project contract.

## See also

- `AGENTS.md` (root) — short pointer to this skill
- `docs/architecture.md` — system architecture
- `openspec/` — SDD artifacts for changes

## Version

- v1, 2026-06-08: initial protocol aligned with idu-pi `idu_orchestrator_procedure` and `mustConsult` list.
