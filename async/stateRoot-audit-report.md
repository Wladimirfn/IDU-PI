# StateRoot Hygiene + lab.db Lifecycle + Decision Ledger Reality — Audit Report

## Files Examined

| File | Lines | Purpose |
|------|-------|---------|
| `src/lab-db.ts` | 1–500 | Core lab.db SCHEMA constant, `initLabDb()`, record functions |
| `src/lab-db-repository.ts` | 1–540 | Repository wrapper, bibliotecario CRUD, event emission |
| `src/lab-db/migrations/0001_model_invocation_log.sql` | 1–40 | Creates `model_invocation_log` table |
| `src/lab-db/migrations/0002_bibliotecario.sql` | 1–70 | Creates `skills`, `sources`, `digests`, `ratings`, `bibliotecario_proposals` |
| `src/lab-db/migrations/0003_skill_rating.sql` | 1–5 | Adds `score` column to `bibliotecario_proposals` |
| `src/lab-db/migrations/0005_decision_ledger.sql` | 1–20 | Creates `decision_ledger` table |
| `src/lab-db/migrations/runner.ts` | 1–80 | Migration runner with `lab-migrations-applied` tracking table |
| `src/lab-db/migrations/index.ts` | 1–45 | Migration file discovery from `import.meta.url` |
| `src/decision-ledger.ts` | 1–120 | `recordDecision()`, `listDecisions()`, `ensureSchema()` |
| `src/injection-store.ts` | 1–130 | `markInjectionAcked()` → `recordDecision()` wiring |
| `src/digest.ts` | 1–200 | `digest-queue.jsonl` append/flush lifecycle |
| `src/event-bus.ts` | 1–260 | `events.jsonl` append, cap enforcement, listener dispatch |
| `src/idu-bootstrap.ts` | 1–200 | Boot sequence: state dirs, session activation, config init |
| `src/project-state.ts` | 1–180 | `resolveProjectStatePaths()` — defines stateRoot location |
| `src/idu-supervisor-cron.ts` | 1–50 | Supervisor cron plan — no stateRoot writes |
| `src/idu-supervisor-loop.ts` | 1–200 | Supervisor loop — semantic audit + compaction draft |
| `src/autonomous-alert-engine.ts` | 1–250 | Alert engine — read-only detection, no stateRoot cleanup |
| `src/proposal-outbox.ts` | 1–120 | `proposal-outbox` in `reports/proposals.jsonl` |
| `src/idu-outbox-prune.ts` | 1–160 | Opt-in prune CLI for proposals + injections |

---

## Issue 1: `decision_ledger` Empty Despite PR-92 Wiring — High Severity

### File & Line
- `src/injection-store.ts:86-130` — `markInjectionAcked` calls `recordDecision` (lines 114-126)
- `src/decision-ledger.ts:58-95` — `recordDecision` writes to `decision_ledger`

### Issue
The `decision_ledger` table has **0 rows** even though `markInjectionAcked` → `recordDecision` wiring is present in code. The table itself exists (created by migration `0005_decision_ledger.sql` which runs during `initLabDb()`), but no rows have ever been inserted.

**Why:** The wiring is gated behind an explicit user ack action:
- `markInjectionAcked` is only called from CLI (`cli.ts:2735`) and MCP (`mcp-server.ts:4108`) when `ack=true` — i.e., only when a human or orchestrator explicitly acknowledges a pending injection.
- If no injection has ever been acknowledged through this path, `recordDecision` is never reached.
- Additionally, the `try/catch` at `injection-store.ts:113-126` silently swallows any failure in `recordDecision`, so even if `recordDecision` errors (e.g., DB locked, path wrong), the ack proceeds but the decision disappears silently.

**Secondary latent bug** in `recordDecision` (`decision-ledger.ts:80-91`):
```typescript
// last_insert_rowid is per-connection; since runSql spawns a
// fresh sqlite3 process for each call, the rowid does not
// survive between calls.
```
The fallback `SELECT COUNT(*) AS n FROM decision_ledger` returns the **total row count**, not `MAX(id)`. If rows have ever been deleted, `COUNT(*)` diverges from the actual new `id`. This means the returned `id` field in `DecisionRow` is unreliable in production.

### Proposed Fix
1. **Remove the silent try/catch** around `recordDecision` in `markInjectionAcked`, or at minimum log the error. Silent failures defeat the purpose of the decision ledger — the orchestrator has no way to detect that recording failed.
2. **Fix the row ID fallback:** Replace `COUNT(*)` with `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM decision_ledger` for a correct estimate, or better yet, have `runSql` support returning the row ID via `sqlite3` call that uses `last_insert_rowid()` in the same connection.
3. **Auto-record the decision at injection creation time** in `appendInjection` (as `decision: "pending"`), so the table always tracks what decisions are expected, not just decisions that happened to go through the ack path.

### Evidence
- `decision_ledger=0` in the audit context matches code analysis: no caller invokes `markInjectionAcked` automatically; it's only on explicit user ack.
- `injection-store.ts:113`: `try { ... recordDecision(...) } catch { // best-effort; do not block the ack }` — error is silently eaten.
- `decision-ledger.ts:80-91`: The fallback `SELECT COUNT(*)` is documented as unreliable.

---

## Issue 2: Unbounded File Growth — No Data Lifecycle — Medium Severity

### Files
- `src/injection-store.ts:41-54` — `appendInjection` writes to `injections.jsonl`
- `src/digest.ts:87-94` — `appendDigestQueueEntry` writes to `digest-queue.jsonl`
- `src/proposal-outbox.ts:80-100` — `ProposalOutboxStore` persists to `reports/proposals.jsonl`
- `src/lab-db.ts` — all lab.db tables have no retention/cleanup mechanism
- `src/event-bus.ts:166` — ONLY file with a cap (`enforceCap` at 10K lines)

### Issue
Six JSONL files + one SQLite DB accumulate data with no automatic retention:

| File | Lifecycle |
|------|-----------|
| `events.jsonl` | ✅ Capped at 10,000 lines via `enforceCap` |
| `digest-queue.jsonl` | ⚠️ Cleared only on scheduled flush (3x/day) via `clearDigestQueue` |
| `injections.jsonl` | ❌ Lines marked `acked: true` but never removed |
| `reports/proposals.jsonl` | ❌ Opt-in CLI prune (`idu-outbox-prune`) only |
| `reports/agentlab-effectiveness-events.jsonl` | ❌ No cap |
| `reports/idu-supervisor-activity-events.jsonl` | ❌ No cap |
| `reports/idu-usage-events.jsonl` | ❌ No cap |
| `lab.db` tables | ❌ Zero cleanup — `lab_runs`, `bug_findings`, `semantic_memory_items`, `model_invocation_log`, etc. all grow unbounded |

`digest-queue.jsonl` has best-effort cleanup: `maybeFlushDigest` clears it, but only when a scheduled time slot (09:00/14:00/19:00) is due and there are signals. If no flush slot is due, the queue grows without limit until the next slot.

`injections.jsonl` has a **critical accumulation problem**: the `acked` flag is written inline, but lines are never removed. A project with 1000 injections over months will have a 1 MB+ file that is fully read and parsed on every `readPendingInjections` call, even though 990 of those lines are irrelevant.

`lab.db` has `ON DELETE CASCADE` foreign keys, but no scheduled cleanup job ever runs `DELETE FROM` on old data. `lab_runs`, `model_invocation_log`, `bug_findings`, and `proposals` will grow indefinitely without a data retention policy.

### Proposed Fix
1. **Add automatic pruning to `injections.jsonl`** at bootstrap startup (`idu-bootstrap.ts`): keep only last N unacked + last M acked, or delete lines older than 90 days. The mechanism already exists in `idu-outbox-prune.ts` — it's just not wired to run automatically.
2. **Add a `VACUUM` or `DELETE` lifecycle for `lab.db`** tables: run a lightweight cleanup during `initLabDb()` for rows older than a configurable retention window (e.g., 90 days). Focus on `model_invocation_log` (the fastest-growing table — one row per LLM call) and `lab_runs`.
3. **Add a maximum age to `digest-queue.jsonl`**: when reading the queue, skip signals older than N hours to prevent stale accumulation. Optionally, add a fallback flush trigger when the queue exceeds 500 lines regardless of scheduled slot.

### Evidence
- `injection-store.ts:67-70`: `appendFileSync` with no retention check.
- `digest.ts:93`: `appendFileSync` with no cap.
- `digest.ts:188-196`: `maybeFlushDigest` only clears on scheduled slot match; otherwise the queue is untouched.
- `event-bus.ts:230-236`: `enforceCap` only applies to `events.jsonl`. All other JSONL files have no equivalent.
- `lab-db.ts` SCHEMA: `CREATE TABLE IF NOT EXISTS` only — no `DELETE FROM` or retention logic anywhere.
- `lab-db-repository.ts:98-101`: `recordLabRun` emits no `lab_write` event (compare with `appendInvocation` at line 141 which does). This is a separate minor finding: the event audit trail is missing lab_run writes.

---

## Issue 3: No Single "Startup / Ready" Signal in stateRoot — Medium Severity

### Files
- `src/idu-bootstrap.ts:41-150` — boot sequence, no ready marker written
- `src/birth-runtime.ts:1-100` — `buildBirthStatus` checks multiple signals
- `src/automaticov1-cycle.ts:114-119` — fragmentary readiness checks
- `src/idu-session.ts:1-150` — session state tracks active/inactive only
- `src/birth-artifacts.ts:1-60` — `stateRoot/birth/status.json` tracks birth pipeline, not runtime

### Issue
There is **no single file or signal** in `stateRoot` that marks "idu-pi has completed boot and is ready for operation." The runtime scatters readiness across multiple sources:

- `idu-session-state.json` → `active: true/false` (but doesn't prove boot completed)
- `birth/status.json` → `implementation_ready` / `repo_ready` (but these are birth pipeline states, not runtime boot health)
- `automaticov1-cycle.ts:116` → `taskTree.status !== "ready"` (plan task tree, not runtime)
- `automaticov1-cycle.ts:119` → `executionReadiness.status !== "execution_ready"` (closest concept, but only checked inside the cycle)

During `idu-bootstrap`, the system:
1. Creates state directories
2. Activates session (writes `active: true` to `idu-session-state.json`)
3. Inits lab.db (runs `initLabDb` + migrations)
4. Seeds bootstrap skill
5. Writes `idu-bootstrap-state.json`

But none of these steps writes a "ready" marker. If step 2 succeeds but step 4 fails, the session is `active` but the runtime is not fully ready — nothing checks.

**Impact:** Tools cannot robustly check if the runtime is booted and healthy. Components that need to know readiness must re-derive it from a combination of:
- `existsSync(stateRoot/birth/status.json)`
- `session.active === true`
- `existsSync(stateRoot/lab.db)`

This is fragile and leads to race conditions in startup scripts or supervisor ticks.

### Proposed Fix
1. **Write `stateRoot/idu-ready.json`** at the end of `idu-bootstrap.ts` after all init steps succeed, containing:
   ```json
   { "version": 1, "readyAt": "<ISO timestamp>", "bootSequence": "bootstrap", "projectId": "..." }
   ```
2. **Check the ready file** at the start of `idu-supervisor-loop.ts`, `automaticov1-cycle.ts`, and `mcp-server.ts` instead of fragmentary checks.
3. **Delete the ready file** on explicit `idu deactivate` / `idu-off` so the system reliably re-checks readiness on next boot.

### Evidence
- `idu-bootstrap.ts:38-150` shows the full boot sequence — no ready marker is written at the end.
- `birth-runtime.ts:37-93`: `BirthStatusEnvelope` has `kind: "birth_status"` not "runtime_ready".
- `idu-session.ts:42-49`: `IduSessionStatus` only tracks `active: boolean`, not boot completion.
- `automaticov1-cycle.ts:114-119`: Three independent checks (`systemicBlock`, `taskTreeBlock`, `readinessBlock`) that are derived on every cycle rather than cached from a boot-time signal.
- `mcp-server.ts`: When handling `idu_status`, re-derives readiness rather than reading a boot-time file.

---

## Summary Table

| # | Severity | File:Line | Issue | Impact |
|---|----------|-----------|-------|--------|
| 1 | **High** | `injection-store.ts:113-126`, `decision-ledger.ts:80-91` | `decision_ledger` empty; try/catch swallows errors; rowid fallback is `COUNT(*)` not `MAX(id)` | Decision provenance is broken; orchestrator decisions vanish silently; returned row IDs are unreliable |
| 2 | **Medium** | `injection-store.ts:67`, `digest.ts:93`, `proposal-outbox.ts:100` | 6+ JSONL files + lab.db have no automatic data retention | Unbounded disk growth; `readPendingInjections` parses every line including irrelevant acked ones; `model_invocation_log` grows per-LLM-call with no clean |
| 3 | **Medium** | `idu-bootstrap.ts:38-150`, `idu-session.ts:42-49` | No single "ready" signal in `stateRoot` | Boot health is fragmented across 3+ files; components cannot reliably detect incomplete boot |

## Minor Findings
- **Migration gap:** `0003_skill_rating.sql` → `0005_decision_ledger.sql` skips 0004. No evidence of a deleted 0004 in git history. Gaps confuse maintainers.
- **Missing `lab_write` events:** `recordLabRun` (lab-db.ts:300) does not emit a `lab_write` event to `events.jsonl`. Only `appendInvocation` and bibliotecario methods do. The audit trail will miss lab run writes.
- **`skill_index` ≠ `skills`:** The inline SCHEMA in `lab-db.ts` creates `skill_index` (used by `appendSkillIndex`/`listSkillIndex`), while migration 0002 creates `skills` (used by `appendSkill`/`listSkills`). These are two separate tables with different schemas and purposes. This is intentional but undocumented — a future maintainer may be confused.
