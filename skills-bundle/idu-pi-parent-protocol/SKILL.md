---
name: idu-pi-parent-protocol
description: |
  Defines the IDU-PI orchestrator protocol: workspace status, preflight/postflight,
  consultative delegation across a role-based agent fleet, quota checks, and the 14
  MCP tools. Use whenever the user mentions idu-pi, supervisor, preflight, postflight,
  worker delegation, or asks the orchestrator (Claude Code, OpenCode, Pi, Codex,
  Antigravity, Command Code) to manage tasks with the IDU Cross-CLI harness.
---

# idu-pi Parent Protocol (v2.3.0)

> **Audience**: Parent / orchestrator model (Claude Code, OpenCode, Pi, Codex, Antigravity).
> **Role**: You are the orchestrator and implementer. Execute code and native SDD workflows locally. IDU-PI is your quality gate, pre/post-flight auditor, decision ledger, and consultative arnés.
>
> **Worker Guard (`IDU_WORKER=true`)**: delegated workers intentionally receive **0** idu-pi MCP tools (One Orchestrator Rule). If `IDU_WORKER=true` is set, or your idu-pi tool list is empty when you were spawned for a bounded sub-task, **stop reading this protocol** and execute your assigned prompt directly. Do not diagnose MCP connectivity.

## Commands

`idu-pi` is a global command. Use it from anywhere; do not spell out a path to the repo.

```bash
idu-pi status                                # IDU home, detected CLIs, profile list
idu-pi quota                                 # remaining quota per CLI (--fresh ignores the 10 min cache)
idu-pi delegate "<task>" --profile <name>    # spawn one worker (defaults to "fast" when --profile is omitted)
idu-pi wait <runId> --timeout 540000         # block until a delegated worker finishes
```

Never use `idu wait`: there is no such binary. Never `node dist/src/cli.js`, which
only resolves inside the repo and fails from anywhere else.

## Tool Name Prefix — Pick by Harness

The IDU-PI MCP server exposes the same tool surface per harness. The table lists
**base names only**; prepend the prefix your harness exposes. **Never invent a base name**
— if it is not in the tool catalog below, it does not exist.

| Harness | Prefix | Example |
|---|---|---|
| Pi CLI | `mcp__idu-pi__` | `mcp__idu-pi__idu_status` |
| Claude Code | `mcp__idu-pi__` | `mcp__idu-pi__idu_status` |
| Codex | `mcp__idu-pi__` | `mcp__idu-pi__idu_status` |
| Command Code | `mcp__idu-pi__` | `mcp__idu-pi__idu_status` |
| OpenCode | `idu-pi_` | `idu-pi_idu_status` |
| Antigravity | `mcp_idu-pi_` (eager) or `call_mcp_tool(server:"idu-pi", tool:"<base>")` (lazy) | `mcp_idu-pi_idu_status` |

## Canonical Tool Catalog (14 Tools)

| Base Tool | Purpose | Required | Key optional |
|---|---|---|---|
| `idu_status` | Workspace `cwd`, git branch, clean/dirty tree, idu home. | none | `project_path` |
| `idu_project_status` | Alias of `idu_status`. | none | `project_path` |
| `idu_preflight` | Change risk, dirty tree, blast radius before modifying code. | `request` | `expected_files`, `change_mode` (`additive\|refactor\|modification\|destructive`), `working_dir` |
| `idu_postflight` | Verifies observed git diffs against expected files. | `task_id`, `expected_files` | `working_dir` |
| `idu_decision_record` | Records a durable decision in the ledger. | `project_id`, `decision`, `decided_by`, `target_kind`, `target_id` | `rationale`, `profile_ref` |
| `idu_decision_list` | Recent ledger decisions. | none | `project_id`, `limit` |
| `idu_delegate` | Spawns one CLI worker with `IDU_WORKER=true`. | `task`, `profile` | `async`, `working_dir`, `context_files`, `session_id`, `parent_session_id`, `fork`, `timeout_ms`, `verbose` |
| `idu_delegate_parallel` | Spawns several workers concurrently (always async). | `tasks` | — |
| `idu_worker_status` | Real-time status, duration, health, recent logs. | `run_id` | — |
| `idu_worker_wait` | Blocks until a worker finishes without killing it. | `run_id` | `timeout_ms`, `verbose` |
| `idu_worker_result` | Full output, summary and log path of a finished worker. | `run_id` | `verbose` |
| `idu_session_list` | Tracked cross-cli sessions (id, parent, timestamps). | none | — |
| `idu_capabilities` | Detected CLIs + effective profiles (built-in defaults merged with `~/.idu/profiles.json`). | none | `only_quota`, `include_quota`, `fresh_quota` |
| `idu_arbitrate` | Decision arbitration: Kev local → Jev cloud (SOM) → deterministic fallback. | `options` | `state_summary`, `threshold`, `offline` |

Parameter names are exact and the schema rejects unknown ones. `request` is not `task`;
`profile` is not `--profile`. The worker id is `runId` (camelCase) from `idu_delegate` but
`run_id` (snake_case) in the worker tools.

## Agent Fleet Matrix (roles, not CLIs)

Profiles are organized by **role**. Every role has 2–5 alternative CLI/model agents. Pick
freely among them by task fit, parallelism (cross-audits, parallel exploration) or
remaining quota. The matrix is a menu, not a fixed assignment. `audit-minimax` is an
optional comparative extra, not a required fifth auditor.

`idu_capabilities` returns the **effective** set: built-in defaults merged with
`~/.idu/profiles.json`. A fleet can opt out of that padding with `"replaceDefaults": true`
at the root of `~/.idu/profiles.json`, which makes the file the complete list. Always treat
the effective list as authoritative — if a profile is not there, it is not delegable.

| Role | Profiles (CLI · model) |
|---|---|
| Exploración (read-only, parallel) | `explore-deepseek` (mcode · DeepSeek V4 Flash nan) · `explore-glm` (cmdc · GLM 5.3 Flash nan) · `explore-mimo` (opencode · MiMo 2.6 Flash nan) |
| Consultas (read-only) | `consult-openai` (cmdc · GPT-6.1 Terra high) · `consult-mimo` (cmdc · MiMo 2.6 Pro max) · `consult-claude` (claude · Opus 5.5 high) · `consult-gemini38` (agy · Gemini 3.8 Flash high) |
| Arquitectura (read-only) | `arch-claude` (claude · Opus 5.5 high) · `arch-sol` (cmdc · GPT-6.1 Sol high) · `arch-gemini` (agy · Gemini 4 Argon high) · `arch-deepseek` (mcode · DeepSeek V4 Flash max) |
| Diseño (workspace assets) | `design-opencode` (opencode · DeepSeek V4 Flash nan) · `design-gentle` (gentle-shell · DeepSeek V4 Flash nan) |
| Iconografía (workspace assets, parallel) | `iconographer` (mcode · GLM 5.3 Flash nan) · `iconographer-mimo` (opencode · MiMo 2.6 Flash max) |
| Auditoría (read-only, cross) | `audit-claude` (claude · Opus 5.5 high) · `audit-gemini` (agy · Gemini 4 Argon) · `audit-deepseek` (cmdc · DeepSeek V4.1 Flash max) · `audit-mimo` (cmdc · MiMo 2.6 Pro max) · `audit-minimax` (cmdc · MiniMax M3.1 Flash high) |

**Arbitration is a tool, not a role.** Call `idu_arbitrate` to choose among options you
already formulated, without spawning a CLI:
`options: ["a: description", "b: description"]` plus optional `state_summary`. When it
returns `requiresHumanReview: false`, proceed without asking the user. Never use it for
product decisions.

Role boundaries:
- **Exploración** maps and explains code. No edits.
- **Consultas** answers a specific technical question. No edits, no artifact.
- **Arquitectura** reviews design, interfaces and blast radius. No edits.
- **Auditoría** produces an adversarial review of existing work. No edits.
- **Diseño / Iconografía** produce bounded visual or SVG artifacts (workspace). These are
  the only roles allowed to write, and only inside their asset scope. Core code is never
  delegated.

### Usage rules

- **MODIFY allowed**: updating an existing profile's `model`, `provider` or `description`
  needs no approval. Record the change with `idu_decision_record`.
- **CREATE requires approval**: never add a new role or a new profile key without explicit
  user approval. To go faster inside a role, ask first, then add another CLI/model
  alternative *within that role* — that still counts as creating a profile.
- `~/.idu/profiles.json` is global and shared by every project, so any modification
  affects all of them.
- `effort` is **not** a profile field. It lives in each CLI's own config:
  `reasoningEffort[<model>]` in `~/.commandcode/config.json` (cmdc), the model slug suffix
  (`deepseek-v4-flash:high`) for gentle-shell, the `-high` slug for agy, and
  `~/.minimax/config.yaml` for mcode. Editing "effort" in a profile does nothing.

### Profile routing quirks

- **mcode** needs the full id `custom_provider:nan/<model>` in `model` and **no** `provider`
  field (idu-pi prepends `provider/` and breaks the route).
- **mcode** cannot serve `minimax-m3.1-flash` (route restriction); run it on cmdc.
- **opencode** has `nan/deepseek-v4-flash`, not `nan/deepseek-v4.1-flash`.
- **cmdc** ignores `provider` (it only passes `-m <model>`); do not copy the
  `provider` + bare `model` pattern into opencode or mcode.
- **GPT-6.1 Terra / Sol in cmdc** depend on the global `provider` in
  `~/.commandcode/config.json`. With `provider: "command-code"` use the bare catalog ids
  (`gpt-6.1-terra`) or the `commandcode/...` prefix. The `openai/...` route needs
  `provider: "codex"`, and that switch breaks `xiaomi/...`, `deepseek/...` and `nan/...` in
  the same session — never mix both routes at once.
- **cmdc read-only workers still get `--yolo`** (idu-pi always passes it), because print
  mode blocks `shell_command` otherwise and a blocked tool aborts the whole run. The
  read-only guarantee comes from the worker prompt, not the flag.

## 5-Step Operational Protocol

1. **Session Start**: Run `idu_status` (pass `project_path` if working on an external directory).
   - *If the tool is missing or errors*: check `IDU_WORKER` first (see Worker Guard). Otherwise the MCP server is not connected:
     ```bash
     idu-pi status     # the CLI works; if this fails the install itself is broken
     ```
     For OpenCode specifically, `opencode mcp list` is **not** authoritative: it can report "No MCP servers configured" while all servers are connected. The truth is in `~/.local/share/opencode/log/opencode.log`, lines `mcp connected server=<name> tools=<n>` and `mcp connect failed`. For another harness, read its own MCP log. Until the 14 tools are connected, none of this protocol applies: tell the user, stop any write, and use `idu-pi status` as the only verification.

2. **Preflight**: Run `idu_preflight` with `request` and `expected_files` (repo-relative
   paths; add `change_mode: "destructive"` when deleting or replacing behavior).
   `expected_files` is optional in the schema but recommended here and required in postflight.
   - `risk: high` → verify with the user before proceeding. If the session is
     non-interactive and risk is high, abort instead of guessing.
   - `risk: medium` → proceed, but state the blast radius in your next message.

3. **Local Implementation**: Implement code and run changes directly in the active
   orchestrator session using local edit tools and, **if your harness provides them**,
   native SDD phases (`sdd-apply`, `sdd-verify`). NEVER abdicate core coding or delegate
   the primary implementation to another CLI.

4. **Delegation**: use `idu_delegate` / `idu_delegate_parallel` for exploration,
   consultation, architecture review, cross-audits and bounded design/icon artifacts.
   - Always pass `async: true` for anything longer than ~15 s. `idu_delegate_parallel` is
     always async and its items are `{ task, profile, working_dir? }` — it does **not**
     accept `context_files`; inline the file paths in the `task` text instead.
   - Both return `runId` (camelCase). Block with `idu_worker_wait({ run_id: runId })`
     (snake_case) or `idu-pi wait <runId> --timeout 540000` in a terminal. Never `--follow`.
   - On timeout or exit 124, re-check `idu_worker_status`; if `health: "healthy"`, re-invoke
     the wait up to the profile's `hardCapMs`, then report.
   - When the wait completes, read the final answer from its return value or from
     `idu_worker_result({ run_id: runId })` before continuing.
   - NEVER end your turn saying "I'll wait" or "checking later".

   *Quota check first*: before a heavy or repeated dispatch, call `idu_capabilities` with
   `only_quota: true`. It returns `{ quota: [...] }`; do not pass `include_quota`.
   - Every figure is **REMAINING**, never used. `billingModel: "plan"` is a self-refilling
     rate limit, not money.
   - A `null` percentage or an `unknownReason` means the CLI could not answer — never read
     it as zero.
   - `stale: true` means the reading came from the 10-minute cache and is still valid;
     `capturedAt` is the real clock.
   - Only `claude`, `antigravity`, `commandcode` and `codex` expose a quota probe, and one
     harness may meter model families separately (e.g. Gemini vs Claude inside
     antigravity). `mcode`, `opencode` and `gentle-shell` have no headless probe and always
     report `unknownReason` — treat them as off-plan alternatives.
   - Do NOT pass `fresh_quota` reflexively: codex and commandcode answer over HTTP for
     free, while claude and antigravity each spend one model call.

5. **Postflight & Ledger**: Run `idu_postflight` with `task_id` and `expected_files`.
   - `task_id` is free text with no upstream source. Choose a stable slug once
     (e.g. `<area>-<short-goal>`) and reuse it in `idu_decision_record`.
   - If `matchesIntent: false`, compare `unexpectedFiles` against the `dirtyFiles` captured
     in step 1 and **never revert the user's pre-existing changes**; report them instead.
   - Record decisions with `idu_decision_record` using fixed conventions:
     `project_id` = repo name, `decided_by` = `<harness>/<model>`,
     `target_kind` ∈ `architecture | delegation | refactor | profile | skill | docs`,
     `target_id` = file path or feature slug.
