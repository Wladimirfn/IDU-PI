---
name: idu-pi-parent-protocol
description: |
  Use this skill whenever the user mentions idu-pi, supervisor, preflight,
  postflight, worker delegation, or asks the orchestrator (Claude, OpenCode, Pi,
  Codex, Antigravity) to manage tasks with the IDU Cross-CLI harness.
---

# idu-pi Parent Protocol (v2.1.0)

> **Audience**: Parent / orchestrator model (Claude Code, OpenCode, Pi, Codex, Antigravity).
> **Role**: You are the orchestrator and implementer. Execute code and native SDD workflows locally. IDU-PI is your quality gate, pre/post-flight auditor, decision ledger, and consultative arnés.

## Tool Name Prefix — Pick by Harness

The IDU-PI MCP server exposes the same tool surface under two prefixes, one per harness:

- **Pi CLI** uses `mcp__idu-pi__<base>` → e.g. `mcp__idu-pi__idu_status`
- **OpenCode** uses `idu-pi_<base>` → e.g. `idu-pi_idu_status`
- **Antigravity / Generic**: `<serverName>_<base>` or native call.

The table below lists **base names only**. Prepend the prefix your harness exposes. **Never invent a base name** — if it is not in this table, it does not exist.

## Canonical Tool Catalog (13 Tools)

| Base Tool | Purpose | When to Call |
|---|---|---|
| `idu_status` | Returns workspace status, active Git branch, dirty tree files, and system health. | At the beginning and end of sessions or to check tree state. |
| `idu_project_status` | Alias for `idu_status`. | Compatibility alias for inspecting project path and health. |
| `idu_preflight` | Evaluates change risk, dirty tree, and potential blast radius before modifying code. | Mandatory before any non-trivial code modification or refactor. |
| `idu_postflight` | Verifies observed Git diffs against expected files and enforces clean blast radius. | Mandatory after code edits before committing or completing turn. |
| `idu_decision_record` | Records technical, architecture, or operational decisions in the durable ledger. | Whenever an architectural trade-off or boundary decision is made. |
| `idu_decision_list` | Retrieves recent decisions from the durable ledger. | To review previous context, architectural choices, and constraints. |
| `idu_delegate` | Spawns a real CLI terminal worker (Claude, OpenCode, Codex, Pi) with `IDU_WORKER=true`. | For external audit, second opinion, or architectural debate. NEVER delegate primary coding away. |
| `idu_delegate_parallel` | Spawns multiple terminal CLI workers concurrently in parallel. | When independent advisory or auditing sub-tasks run simultaneously. |
| `idu_worker_status` | Reports real-time status, duration, telemetry (`health`, `elapsedMs`), and recent logs. | To check the progress of a running delegated worker. |
| `idu_worker_wait` | Reactively blocks until a delegated worker completes (without killing worker on timeout). | When waiting for a background worker to complete its task. |
| `idu_worker_result` | Retrieves full execution output, summary, and log paths of a finished worker. | Once a worker has finished execution to inspect its output. |
| `idu_session_list` | Lists all active and tracked cross-cli sessions with hierarchy and locks. | To inspect session history or prepare for session resumption (`--session`). |
| `idu_capabilities` | Reports available profiles from `~/.idu/profiles.json` and detected local CLIs. | To inspect available models, cost tiers, and CLI executables. |

## 5-Step Operational Protocol

1. **Session Start**: Run `idu_status` (pass `project_path` if working on an external directory).
2. **Preflight**: Run `idu_preflight` with your task and `expected_files`. If `risk: high`, verify with the user before proceeding.
3. **Local Implementation**: Implement code and execute changes directly in the active orchestrator session (Pi, OpenCode, Claude Code, Codex, Antigravity) using local edit tools and native SDD phases (`sdd-apply`, `sdd-verify`). NEVER abdicate coding or delegate the primary implementation to another CLI.
4. **Consultative Delegation (Advisory Only)**: Use `idu_delegate` ONLY for external second opinions, deep architectural debates, or adversarial audits (e.g. `--profile architecture` for Opus). The external worker acts strictly as an advisor or reviewer; the active orchestrator retains full implementation ownership.
   - *Wait & Monitor*: If `idu_delegate` is called with `async: true`, the worker runs in a detached daemon. Stay blocked without token bloat by running terminal command: `idu wait <run_id> --timeout 540000` (or `node dist/src/cli.js wait <run_id> --timeout 540000`). DO NOT use `--follow` (it injects raw NDJSON logs into prompt context). If the command exits with code 124 (timeout) while the worker is healthy, re-invoke it. NEVER end your turn saying "I'll wait" or "checking later". You can also use `idu_worker_wait` or `idu_worker_status`.
5. **Postflight & Ledger**: Run `idu_postflight` with `expected_files` and document major decisions with `idu_decision_record`.
