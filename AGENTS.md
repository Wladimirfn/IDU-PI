# AGENTS.md

> Short pointer for any agent (LLM, Pi subagent, Codex, Claude Code, MiniMax, Qwen, KM5) opening a session in this project.

## Load the parent protocol skill

Before starting any work in this project, **load the skill**:

```
.pi/skills/idu-pi-parent-protocol/SKILL.md
```

It contains the mandatory `mcp__idu-pi__*` procedure: which tools to call, in which order, and the anti-patterns to avoid.

## TL;DR

- You are the **parent/orchestrator**. idu-pi is your advisor, not a worker.
- Always begin with: `mcp__idu-pi__idu_status` and `mcp__idu-pi__idu_supervisor_context_pack`.
- Before any risky or structural change: `mcp__idu-pi__idu_preflight`.
- After any code change: `mcp__idu-pi__idu_postflight`.
- Before commit/push: postflight + check `mcp__idu-pi__idu_proposal_outbox`.
- If idu-pi returns `risk: high` or `requiresHuman: true`: **stop, ask the human**.
- Do not invent tool names. The exact names are listed in the skill.
- Do not run idu-pi via `node dist/src/cli.js ...` as a substitute for MCP. CLI does not register in "Proyecto actual".

## Why this matters

The "Proyecto actual" panel in the idu-pi TUI records every MCP call the parent makes. Without the protocol, work drifts: the worker improvises, evidence is lost, and audit is impossible. The protocol is a tiny amount of discipline for a much safer, traceable session.

## Learn more

- Full protocol: `.pi/skills/idu-pi-parent-protocol/SKILL.md`
- Architecture: `docs/architecture.md`
- SDD artifacts: `openspec/`
