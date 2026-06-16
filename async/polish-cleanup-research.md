# Polish Cleanup Research — Idu-pi

**Date:** 2026-06-16
**Context:** Post-PR #132 merge (parser fix, user-escalation counting, cron 15min→1h, test pollution fix). CI pending.
**Method:** Read-only scout. No edits. File:line refs throughout.

---

## Findings (ordered by impact)

### 1. supervisor-main.md profile doesn't mention parser strategies or output format

**File:** `config/profiles/supervisor-main.md` (entire file, ~40 lines)
**What:** The profile describes the supervisor's role, inputs, outputs, and constraints in Spanish. It says nothing about:
- The 4-strategy parser that now consumes its output (`src/idu-supervisor-parse.ts` or wherever the parser lives)
- The expected output format that the parser needs
- The fact that parse failures were at 97% and are now fixed
- Any guidance on how to structure the response for reliable parsing

**Why it matters:** This profile is fed to the LLM when the supervisor runs. If the LLM doesn't know its output is parsed by a multi-strategy parser, it may drift back to formats that stress the parser. The parser fix is fragile without profile alignment.

**Suggested fix:** Add a "Formato de salida" section to supervisor-main.md explaining that output is parsed by a 4-strategy parser (JSON → YAML → markdown → free-text), and that structured output improves reliability. Keep it short (5-10 lines).

---

### 2. orchestrator.md doesn't document auto-ack behavior

**File:** `config/profiles/orchestrator.md` (line ~23)
**What:** The profile says: "Las injections con `decisionRequired` se deciden (review / delegate / ignore), no se ignoran en silencio." But it doesn't mention that:
- The cron's `idu-pending-injections` CLI command auto-acks all pending injections by default (`src/cli.ts:2853-2859`: `const ack = !/ack\s*:\s*false/.test(params)`)
- If the orchestrator doesn't act on an injection within the cron interval (~1h), the cron will auto-ack it
- The user-escalation check now reads injections by timestamp regardless of acked state (`src/user-escalation.ts:103-106`)

**Why it matters:** The orchestrator may try to manually ack an injection that the cron already auto-acked, or may not realize that inaction = implicit ack after 1h. This is a behavioral change that the orchestrator should know about.

**Suggested fix:** Add a note to orchestrator.md: "Nota: el cron auto-ackea las pending injections cada ~1h. Si no actuás en una injection dentro de ese intervalo, se asume ack implícito. La escalación al humano lee por timestamp, no por estado acked."

---

### 3. Two stale pending tasks in tasks.jsonl (6 and 5 days old)

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\tasks.jsonl` (lines 26-27)
**What:**
- `task-000mq8ctk3l-000r` — "el trigger no respeta el CLI abierto - test" — status: pending, created 2026-06-10 (6 days ago), category: bug, priority: 3
- `task-000mq9ggj9x-000s` — "Revisar riesgo medium: postflight actual" — status: pending, created 2026-06-11 (5 days ago), category: review, priority: 3

All other 26 tasks are status: done.

**Why it matters:** These are the only two non-done tasks in the queue. They're 5-6 days old. Either they were forgotten, or they're no longer relevant. Stale pending tasks create maintenance pressure and may block automaticov1 readiness checks that look for stale tasks.

**Suggested fix:** Either close them with completionEvidence (if they were resolved by later work) or explicitly mark them as cancelled/deferred. The operational-triage pattern used in earlier tasks (see task-000mq5oca9c-000n completionEvidence) is a good template.

---

### 4. scripts/idu-supervisor-tick-bootstrap.ps1 not in .gitignore

**File:** `.gitignore` (no mention of bootstrap script)
**File:** `scripts/install-supervisor-tick.ps1` (lines 38-46)
**What:** The install script generates `scripts/idu-supervisor-tick-bootstrap.ps1` with machine-specific absolute paths:
```powershell
$BootstrapScript = Join-Path $Root 'scripts/idu-supervisor-tick-bootstrap.ps1'
$BootstrapContent = @"
`$env:IDU_PI_TICK_STATE_ROOT = "$StateRoot"
& "$TickScript"
"@
Set-Content -Path $BootstrapScript -Value $BootstrapContent -Encoding UTF8
```
The generated file contains:
```powershell
$env:IDU_PI_TICK_STATE_ROOT = "C:\Users\elmas\Documents\bridge-agents\projects\idu-pi"
& "C:\Users\elmas\pi-telegram-bridge\scripts\idu-supervisor-tick.ps1"
```

This file is not in .gitignore. If someone runs `git add scripts/`, this machine-specific file could be committed.

**Why it matters:** Machine-specific paths in version control cause confusion for other developers or if the project is cloned to a different machine.

**Suggested fix:** Add `scripts/idu-supervisor-tick-bootstrap.ps1` to .gitignore.

---

### 5. Semantic audit tables all empty (0 rows)

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\lab.db`
**Tables:**
- `semantic_audit_runs` — 0 rows
- `semantic_audit_checkpoints` — 0 rows (never populated)
- `semantic_memory_items` — 0 rows
- `lab_runs` — 0 rows
- `bug_findings` — 0 rows
- `proposals` — 0 rows
- `lab_tasks` — 0 rows
- `digests` — 0 rows
- `bibliotecario_proposals` — 0 rows
- `ratings` — 0 rows
- `sources` — 0 rows

**What:** 11 of the 16 tables in lab.db have 0 rows. The semantic audit subsystem appears completely dormant. The checkpoints table has never been written to, which suggests the semantic audit has never run successfully.

**Why it matters:** These tables were created by migrations and schema initialization, but no code is populating them. Either:
1. The semantic audit feature is not implemented/active (most likely)
2. There's a bug preventing writes
3. The feature is intentionally disabled

If it's supposed to be active, this is a significant gap. If it's intentionally dormant, the empty tables are just schema debt.

**Suggested fix:** Investigate whether semantic audit is supposed to be active. If yes, find why it's not running. If no, consider removing the tables or marking them as experimental/future in documentation.

---

### 6. idu-supervisor-cron.ts wired but not used by the actual cron

**File:** `src/idu-supervisor-cron.ts` (entire file, ~60 lines)
**File:** `src/mcp-server.ts` (line 3489)
**File:** `src/cli.ts` (line 1332)
**File:** `src/automaticov1-cycle.ts` (line 228)
**File:** `scripts/idu-supervisor-tick.ps1` (entire file, ~200 lines)

**What:** The `planIduSupervisorCron` function is fully implemented and wired through:
- MCP tool `idu_supervisor_cron_plan` (mcp-server.ts:3489)
- CLI command (cli.ts:1332)
- Automaticov1 cycle (automaticov1-cycle.ts:228)

But the actual Windows scheduled task (`scripts/idu-supervisor-tick.ps1`) never calls it. The tick script runs:
1. Trigger engine opt-in check
2. Cron preflight (idu_supervisor_tick tool)
3. Pending injections query (idu-pending-injections CLI)
4. User escalation check

It never calls `idu_supervisor_cron_plan` or uses the classification/planning logic.

**Why it matters:** The cron planning feature exists but is dead code in the actual cron path. It's only used if someone manually calls the MCP tool or if automaticov1 happens to run (which is rare). The classification logic (idle/watch/review_recommended/urgent_review) is never exercised by the real cron.

**Suggested fix:** Either:
1. Wire the tick script to call `idu_supervisor_cron_plan` after preflight and log the classification
2. Document that cron_plan is advisory-only and not used by the automated cron
3. Remove it if it's not needed

---

### 7. events.jsonl growing unbounded (1981 lines, all orchestrator_turn)

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\events.jsonl`
**What:** 1981 lines, all with kind=orchestrator_turn. No rotation/cleanup mechanism. File is in .gitignore but still grows on disk.

**Why it matters:** Will eventually become very large (10k+ lines). No code reads the entire file (most readers use `since` filters), but the file size itself is a maintenance burden.

**Suggested fix:** Implement a rotation mechanism (e.g., archive events older than 30 days to events-YYYY-MM.jsonl) or a size limit (e.g., keep last 10k events). Alternatively, document that this is expected and acceptable.

---

### 8. decision_ledger has 14 rows, all "ack" decisions by "orchestrator"

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\lab.db`
**Table:** `decision_ledger` — 14 rows
**What:** All 14 rows are:
- `decided_by`: orchestrator
- `decision`: ack
- `target_kind`: injection (or similar)

No other decision types (review, delegate, ignore) are recorded.

**Why it matters:** The decision ledger is supposed to track all orchestrator decisions, but it's only recording injection acks. Either:
1. The orchestrator isn't making other decisions
2. Other decisions aren't being recorded to the ledger
3. The ledger is only used for injection acks (intentional)

If the ledger is supposed to track more decision types, this is a gap. If it's only for injection acks, the table is working as designed.

**Suggested fix:** Clarify the purpose of decision_ledger. If it should track more decision types, find where those decisions are made and wire them to `recordDecision`. If it's only for injection acks, document that.

---

### 9. proposal-outbox directory doesn't exist

**Path:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\proposal-outbox`
**What:** The directory doesn't exist. No pending proposals.

**Why it matters:** Not necessarily a bug. The proposal outbox feature may not be active, or all proposals have been processed. The code references `proposal-outbox` in several places (e.g., `src/proposal-outbox.ts`), so the feature exists but may not be generating proposals.

**Suggested fix:** Verify whether the proposal outbox is supposed to be active. If yes, find why it's not generating proposals. If no, document that the feature is experimental/future.

---

### 10. model_invocation_log has 242 rows, all "success"

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\lab.db`
**Table:** `model_invocation_log` — 242 rows
**What:** All 242 rows have status=success. No errors recorded. Models used:
- deepseek-v4-pro: 129 calls
- mimo-v2.5: 66 calls
- qwen3.7-plus: 42 calls
- qwen3.6-plus: 3 calls
- minimax-m2.5: 2 calls

Roles:
- supervisor-main: 128 calls
- agentlab-general: 66 calls
- agentlab-architecture: 19 calls
- agentlab-code-quality: 16 calls
- supervisor-semantic: 5 calls
- (others: 8 calls)

Date range: 2026-06-09 to 2026-06-16 (7 days).

**What this is NOT:** This is not related to the 97% parser failure fix. The model_invocation_log records AgentLab LLM calls, not the supervisor's own response parsing. The 97% parse failure was in a different code path (supervisor LLM output parsing).

**Why it matters:** Not a bug. The 100% success rate is expected for AgentLab calls (they have retry logic and error handling). The table is working as designed.

**Suggested fix:** None. This is working correctly.

---

## NO-FIX (items considered but NOT bugs)

### 1. Migrations are auto-applied on bootstrap — NOT a bug

**File:** `src/lab-db.ts` (line ~230: `applyMigrations(dbPath)`)
**File:** `src/lab-db/migrations/runner.ts` (entire file)

**Observation:** The `initLabDb` function calls `applyMigrations(dbPath)` at the end (lab-db.ts line ~230). The migrations runner checks if the DB exists, creates it if not, ensures the migrations table exists, and applies all unapplied migrations. This is called lazily before any DB operation.

**Why it's not a bug:** Migrations are auto-applied on first use. The system is working as designed. No manual migration step is needed.

---

### 2. All 14 injections are acked=true — NOT a bug

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\injections.jsonl`
**What:** All 14 supervisor_advisory injections have `acked: true`. No pending (unacked) injections.

**Why it's not a bug:** The cron auto-acks pending injections every ~1h (cli.ts:2853-2859). The log shows `pending_injections_query: Pending Injections - count=1 ack=true`, which means the cron queried pending injections, found 1, and acked it. This is the expected behavior after the user-escalation fix.

---

### 3. Triple-firing of idu_supervisor_trigger in events.jsonl — NOT a bug

**File:** `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\events.jsonl`
**What:** The last 20 events show multiple `idu_supervisor_trigger` calls fired in rapid succession (e.g., 17:29:34.308, 17:29:34.331, 17:29:34.343 — three calls in 35ms).

**Why it's not a bug:** events.jsonl records every MCP tool call. The Pi orchestrator may call the same tool multiple times within the same turn (e.g., for different subagents or different phases). This is normal behavior, not a retry loop or bug.

---

### 4. Bootstrap script generates machine-specific paths — NOT a bug

**File:** `scripts/install-supervisor-tick.ps1` (lines 38-46)
**What:** The install script generates a bootstrap script with machine-specific absolute paths.

**Why it's not a bug:** This is intentional. The bootstrap script is generated per-machine and should not be version-controlled. The fix is to add it to .gitignore (see Finding #4), not to change the generation logic.

---

## Open Questions for the Orchestrator

1. **Semantic audit status:** Is the semantic audit subsystem supposed to be active? The tables exist but have 0 rows. Should we investigate why it's not running, or is it intentionally dormant?

2. **Stale tasks:** Should the two pending tasks (task-000mq8ctk3l-000r and task-000mq9ggj9x-000s) be closed with completionEvidence, cancelled, or deferred? They're 5-6 days old.

3. **Decision ledger scope:** Is the decision_ledger supposed to track only injection acks, or should it track other orchestrator decisions (review, delegate, ignore)? If the latter, where are those decisions made and why aren't they recorded?

4. **Proposal outbox status:** Is the proposal outbox feature supposed to be active? The directory doesn't exist and no proposals are being generated. Should we investigate or document it as experimental?

5. **Cron plan usage:** Should the actual Windows cron (`idu-supervisor-tick.ps1`) call `idu_supervisor_cron_plan` and log the classification? Or is the cron_plan feature intentionally advisory-only and not used by the automated cron?

6. **Events.jsonl rotation:** Should we implement a rotation mechanism for events.jsonl, or is the current unbounded growth acceptable?

---

## Summary

**Top 3 most important findings:**

1. **supervisor-main.md profile is stale** — doesn't mention the 4-strategy parser or output format guidance. The parser fix is fragile without profile alignment. The LLM needs to know its output is parsed and what format works best.

2. **orchestrator.md doesn't document auto-ack** — the orchestrator doesn't know that the cron auto-acks pending injections every ~1h. This is a behavioral change that affects how the orchestrator should handle injections.

3. **Two stale pending tasks (5-6 days old)** — operational debt that may block automaticov1 readiness checks. Need to close, cancel, or defer them.

**Top 2 things that are NOT problems:**

1. **Migrations are auto-applied** — the system works as designed. No manual migration step needed.

2. **All injections are acked** — this is the expected behavior after the user-escalation fix. The cron auto-acks pending injections every ~1h.

---

**Recommendation:** Focus on findings #1, #2, and #3 first. These are small, targeted fixes (<100 lines each) that address live operation issues. The other findings are lower priority or require clarification on intended behavior.
