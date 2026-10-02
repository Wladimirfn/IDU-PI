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

## Commands

`idu-pi` is a global command. Use it from anywhere; do not spell out a path to the repo.

```bash
idu-pi status          # workspace, branch, dirty tree, system health
idu-pi quota           # remaining quota per CLI (--fresh to ignore the 10 min cache)
idu-pi wait <runId>    # block until a delegated worker finishes
```

Never use `idu wait`: there is no such binary. Never `node dist/src/cli.js`, which
only resolves inside the repo and fails from anywhere else.

## Tool Name Prefix — Pick by Harness

The IDU-PI MCP server exposes the same tool surface under two prefixes, one per harness:

- **Pi CLI** uses `mcp__idu-pi__<base>` → e.g. `mcp__idu-pi__idu_status`
- **OpenCode** uses `idu-pi_<base>` → e.g. `idu-pi_idu_status`
- **Antigravity / Generic**: `<serverName>_<base>` or native call.

The table below lists **base names only**. Prepend the prefix your harness exposes. **Never invent a base name** — if it is not in this table, it does not exist.

## Canonical Tool Catalog (13 Tools)

| Base Tool | Purpose | Required Parameters |
|---|---|---|
| `idu_status` | Workspace status, active Git branch, dirty tree files, system health. | none |
| `idu_project_status` | Alias for `idu_status`. | none |
| `idu_preflight` | Change risk, dirty tree, and potential blast radius before modifying code. | `request` |
| `idu_postflight` | Verifies observed Git diffs against expected files and enforces clean blast radius. | `task_id`, `expected_files` |
| `idu_decision_record` | Records technical, architecture, or operational decisions in the durable ledger. | `project_id`, `decision`, `decided_by`, `target_kind`, `target_id` |
| `idu_decision_list` | Retrieves recent decisions from the durable ledger. | none |
| `idu_delegate` | Spawns a real CLI terminal worker (Claude, OpenCode, Codex, Pi) with `IDU_WORKER=true`. | `task`, `profile` |
| `idu_delegate_parallel` | Spawns multiple terminal CLI workers concurrently in parallel. | `tasks` |
| `idu_worker_status` | Real-time status, duration, telemetry (`health`, `elapsedMs`), recent logs. | `run_id` |
| `idu_worker_wait` | Reactively blocks until a delegated worker completes, without killing it on timeout. | `run_id` |
| `idu_worker_result` | Full execution output, summary, and log paths of a finished worker. | `run_id` |
| `idu_session_list` | All active and tracked cross-cli sessions with hierarchy and locks. | none |
| `idu_capabilities` | Available profiles from `~/.idu/profiles.json` and detected local CLIs. `include_quota: true` also reads each CLI's own account quota. | none |

Parameter names are exact and the schema rejects unknown ones. `request` is not `task`; `profile` is not `--profile`. The `--profile` flag belongs to the CLI (`idu-pi delegate "task" --profile coding`), while the MCP tool takes `profile` with no dashes.

## 5-Step Operational Protocol

1. **Session Start**: Run `idu_status` (pass `project_path` if working on an external directory).
   - *If the tool is missing or errors*: the MCP server is not connected, and every rule below is unfollowable. Check before doing anything else:
     ```bash
     idu-pi status     # the CLI works; if this fails the install itself is broken
     ```
     For OpenCode specifically, `opencode mcp list` is **not** authoritative: it can report "No MCP servers configured" while all servers are connected. The truth is in `~/.local/share/opencode/log/opencode.log`, lines `mcp connected server=<name> tools=<n>` and `mcp connect failed`. For another harness, read its own MCP log. Until the 13 tools are connected, none of this protocol applies.

2. **Preflight**: Run `idu_preflight` with `request` (a plain-language description of the task) and `expected_files`. If `risk: high`, verify with the user before proceeding.
3. **Local Implementation**: Implement code and execute changes directly in the active orchestrator session (Pi, OpenCode, Claude Code, Codex, Antigravity) using local edit tools and native SDD phases (`sdd-apply`, `sdd-verify`). NEVER abdicate coding or delegate the primary implementation to another CLI.
4. **Consultative Delegation (Advisory Only)**: Use `idu_delegate` ONLY for external second opinions, deep architectural debates, or adversarial audits (e.g. `profile: architecture` for Opus). The external worker acts strictly as an advisor or reviewer; the active orchestrator retains full implementation ownership.
   - *Quota Check First*: Before dispatching a heavy or repeated job, call `idu_capabilities` with `include_quota: true` and read **only** the `quota` array out of the response. The rest of the payload is the profile list and CLI paths you did not ask for and does not need to reach your context.
     - Every figure is **REMAINING**, never used. A `billingModel` of `plan` means a rate limit that refills on its own, not money being spent.
     - A `null` percentage or an `unknownReason` means that CLI could not answer. It does **NOT** mean zero. Never read an absent figure as an exhausted account.
     - `stale: true` means the reading came from the 10 minute cache and is **not** expired. `capturedAt` is the real clock.
     - If the chosen profile's headroom is thin, say so and propose a profile that has room instead of dispatching into a wall.
     - Do NOT pass `fresh_quota` reflexively. Codex and commandcode answer over HTTP for free; claude and antigravity each spend one model call to answer. Only pay for a live read when the cached one is too old to reason with.
   - *Wait & Monitor*: If you delegate with `async: true`, the worker runs detached. `idu_delegate` answers with a `runId`; pass that same string to `idu-pi wait <runId> --timeout 540000` in the terminal, or use `idu_worker_wait` / `idu_worker_status`. DO NOT use `--follow` (it injects raw NDJSON logs into your context). If the wait exits with code 124 while the worker is healthy, run it again. NEVER end your turn saying "I'll wait" or "checking later".
5. **Postflight & Ledger**: Run `idu_postflight` with BOTH `task_id` (a short identifier for the work) and `expected_files`, then document major decisions with `idu_decision_record`.
