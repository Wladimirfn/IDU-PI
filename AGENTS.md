# AGENTS.md

> Short pointer for any agent (LLM, Pi subagent, Codex, Claude Code, MiniMax, Qwen, KM5) opening a session in this project.

## Load the parent protocol skill

Before starting any work in this project, **load the skill**. It is available at three locations (use whichever you find first). The three copies must stay byte-identical — this is a known manual sync cost.

```
.pi/skills/idu-pi-parent-protocol/SKILL.md                    (project-local, Pi)
~/.pi/agent/skills/idu-pi-parent-protocol/SKILL.md            (global, shared across Pi projects)
.agents/skills/idu-pi-parent-protocol/SKILL.md                (project-local, OpenCode)
```

In a **Pi CLI** session: type `/skills` and pick **idu-pi-parent-protocol** from the list, or the skill auto-loads when you mention idu-pi, Proyecto actual, preflight, postflight, or any idu-pi MCP tool.

In an **OpenCode** session: the `skill` tool lists installed skills. Use `skill({ name: "idu-pi-parent-protocol" })` to load it, or it auto-loads on the same trigger words.

> **Tool name prefix** (important — read this): the idu-pi MCP server is exposed under two prefixes, one per harness:
> - **Pi CLI**: `mcp__idu-pi__<base>` (e.g. `mcp__idu-pi__idu_status`)
> - **OpenCode**: `idu-pi_<base>` (e.g. `idu-pi_idu_status`)
>
> The skill lists **base names only** (`idu_status`, `idu_supervisor_context_pack`, …). Prepend the prefix your harness exposes. **Never invent a base name** — if it isn't in the skill's tool table, it doesn't exist.

It contains the mandatory idu-pi procedure: which tools to call, in which order, and the anti-patterns to avoid (including the ⚠️ enroll/stateRoot warning — read it before calling `idu_project_enroll`).

## TL;DR

- You are the **parent/orchestrator**. idu-pi is your advisor, not a worker.
- Always begin with: `idu_status` and `idu_supervisor_context_pack` (prepend your harness prefix).
- Before any risky or structural change: `idu_preflight`.
- After any code change: `idu_postflight`.
- Before commit/push: postflight + check `idu_proposal_outbox`.
- If idu-pi returns `risk: high` or `requiresHuman: true`: **stop, ask the human**.
- Do not invent tool names. The exact base names are listed in the skill.
- Do not run idu-pi via `node dist/src/cli.js ...` as a substitute for MCP. CLI does not register in "Proyecto actual".

## Why this matters

The "Proyecto actual" panel in the idu-pi TUI records every MCP call the parent makes. Without the protocol, work drifts: the worker improvises, evidence is lost, and audit is impossible. The protocol is a tiny amount of discipline for a much safer, traceable session.

## Learn more

- Full protocol: any of the three SKILL.md locations above (they are byte-identical)
- Architecture: `docs/architecture.md`
- SDD artifacts: `openspec/`
