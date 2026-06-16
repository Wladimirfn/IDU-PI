# Audit: Master Plan Auto-Update Mechanism + Freshness Detection

**Commit:** 7ddac2f  
**Date:** 2026-06-15

---

## Files Retrieved

1. `src/master-plan.ts` — the stale detection logic (lines 708-742) and the full plan lifecycle
2. `src/trigger-engine.ts` — all 3 trigger definitions, their match/build functions (lines 1-225)
3. `src/idu-supervisor-cron.ts` — cron planning wrapper (lines 1-84)
4. `src/idu-supervisor-loop.ts` — core supervisor tick: audit, compaction, tasks (lines 1-260)
5. `src/idu-supervisor-hooks.ts` — hooks that call the loop after postflight/task/activation (lines 1-280)
6. `src/postflight-core.ts` — postflight trace builder (lines 1-120)
7. `src/mcp-context-pack-auto-refresh-invocation.ts` — auto-refresh tick (lines 1-95)
8. `src/mcp-context-pack-auto-refresh.ts` — auto-refresh core logic (lines 1-115)
9. `src/master-plan-objective-cache.ts` — objective cache with TTL (lines 1-145)
10. `src/trigger-engine-invocation.ts` — opt-in trigger engine runner (lines 1-28)
11. `src/trigger-engine-config.ts` — config persistence (lines 1-140)
12. `src/cli.ts` — scheduled tick integration (lines 3545-3555)
13. `src/index.ts` — Telegram command handlers for `/idu`, `/postflight` (lines 1700-2530)
14. `src/agentlab-contract.ts` — type definitions only (not relevant)

---

## 1. How "approved → stale" Works Today

The **sole detection path** is `getMasterPlanStatus()` in `src/master-plan.ts:708-742`:

```
if (
    current.status === "approved" &&
    input.currentGitHead &&           // caller must pass current git HEAD
    current.gitHead &&                // plan was generated with a known HEAD
    input.currentGitHead !== current.gitHead
) {
    → writeCurrent(...status:"stale"...)
    → writeMemory(...status:"stale"...)
    → return staleReason: "Git HEAD cambió desde la aprobación"
}
```

This function is called from exactly **two** call sites:

| Caller | Where | When |
|--------|-------|------|
| `ensureMasterPlanForIdu()` | `master-plan.ts:961-1030` | During `/idu` activation (CLI + Telegram) |
| Direct `getMasterPlanStatus()` | `cli.ts:1041`, `index.ts:1772` | Manual status command `/idu_master_plan_status` |

**Result:** Stale detection is **on-read and on-activation only**. If the user makes a git commit while idu-pi is idle, the plan stays `approved` until the next `/idu` invocation or manual status check.

---

## 2. What the Auto-Refresh Mechanisms Actually Do

### 2a. MCP Context Pack Auto-Refresh (`mcp-context-pack-auto-refresh.ts` + `mcp-context-pack-auto-refresh-invocation.ts`)

Runs every scheduled tick (`cli.ts:3547`). Refreshes a telemetry file at `<stateRoot>/events/mcp-context-pack-auto-refresh.json` and emits an event `idu_supervisor_context_pack_auto_refreshed`.

**What it refreshes:** Only the **staleness metadata** (whether the objective cache is >1h old). It calls `generatePack()` which returns `{ staleness, elapsedMs, reason }`.

**What it does NOT do:**
- Check git HEAD against the master plan's `gitHead`
- Update the master plan's status from `approved` → `stale`
- Redraft or regenerate the master plan

**This is the core misconception:** The auto-refresh mechanism sounds like it refreshes the plan, but it only refreshes telemetry about the objective cache.

### 2b. Trigger Engine — `objectiveReminderHourlyDefinition` (`trigger-engine.ts:85-138`)

Checks if `master-plan-objective-cache.json.updatedAt` is >1h old. If stale, injects a decision envelope reminding the user of the objective. Natively ignores the master plan itself.

All 3 triggers are **wired** (none dead):
- `stuck_tasks_1h` — live, detects tasks stuck >1h
- `objective_reminder_hourly` — live, checks objective cache age
- `intention_decision_pending` — live, detects pending human decisions >30min

The trigger engine is **opt-in** via `IDU_PI_TRIGGER_ENGINE=1` or config file.

### 2c. `idu-supervisor-cron.ts`

Calls `runIduSupervisorLoop()` in plan mode (`dryRun: true, mode: "plan"`). Returns advisories. Never writes to master plan.

### 2d. `idu-supervisor-loop.ts`

Runs: session check → semantic audit status → semantic audit run (if threshold) → semantic compaction draft → semantic agent tasks. **Never touches the master plan status.**

---

## 3. Postflight → Master Plan Gap

When the user runs `/postflight` (Telegram) or `idu-pi idu-postflight` (CLI):

```
postflight()
  → buildPostflightReport()      // detects changed files
  → maybeRunSupervisorAfterPostflight()
    → if risk is high/blocker, bypass throttle
    → runIduSupervisorLoop()      // semantic audit, compaction, tasks
    → DOES NOT CHECK git HEAD vs master plan gitHead
```

`project-postflight.ts` internally tags certain files as "orchestration files" at line 369, but it's only used for risk classification — not for master plan staleness.

---

## 4. The 3 Most Impactful Issues

---

### ISSUE 1 (CRITICAL)

**File:** `src/idu-supervisor-hooks.ts:131-145` → `maybeRunSupervisorAfterPostflight()`
**Type:** Missing staleness check after code changes

**Issue:** After every code change detected by postflight, the supervisor loop runs but never checks whether the master plan needs to go stale due to git HEAD divergence.

**Evidence:**
- `getMasterPlanStatus()` is the only function that detects staleness (lines 724-742 of `master-plan.ts`)
- It is never called from the postflight hook chain
- `maybeRunSupervisorAfterPostflight` calls `runIduSupervisorLoop` which does NOT call `getMasterPlanStatus`

**Proposed fix:**
Add a `getMasterPlanStatus({ currentGitHead: ... })` call at the start of `maybeRunSupervisorAfterPostflight()` so that a changed git HEAD after code work automatically marks the plan stale:

```typescript
// In maybeRunSupervisorAfterPostflight, before maybeRunSupervisor:
import { getMasterPlanStatus, readGitHead } from "./master-plan.js";
getMasterPlanStatus({
  stateRoot: input.supervisorActivityStateRoot ?? input.workspaceRoot,
  currentGitHead: readGitHead(input.projectPath),
});
```

This is **zero-risk**: it only writes a `stale` status to `master-plan.current.json` and the memory file. It does NOT redraft or modify the plan content.

---

### ISSUE 2 (HIGH)

**File:** `src/master-plan-objective-cache.ts:43-64` and `src/mcp-context-pack-auto-refresh.ts:75-95`
**Type:** Misleading naming / incomplete coverage

**Issue:** The "auto-refresh" system only refreshes an MCP context pack telemetry file (cache staleness metadata). It does NOT refresh the master plan itself. Both the function names and the event name (`idu_supervisor_context_pack_auto_refreshed`) suggest broader coverage than exists.

**Evidence:**
- `autoRefreshMcpContextPack()` writes only `{ staleness, elapsedMs, reason, refreshedAt }` to `<stateRoot>/events/mcp-context-pack-auto-refresh.json`
- The event `idu_supervisor_context_pack_auto_refreshed` fires but nothing subscribes to it for master plan stale detection
- The trigger engine's `objectiveReminderHourlyDefinition` (trigger-engine.ts:85-138) only checks objective cache age, not plan freshness

**Proposed fix:**

**Option A (cheapest):** Extend `runMcpContextPackAutoRefreshTick` to also check master plan staleness:

```typescript
// In runMcpContextPackAutoRefreshTick, after the existing logic:
import { getMasterPlanStatus, readGitHead } from "./master-plan.js";
const gitHead = readGitHead(projectPath);
getMasterPlanStatus({ stateRoot, currentGitHead: gitHead });
```

**Option B (cleaner):** Rename the mechanism to clarify scope — "objective cache auto-refresh" vs "master plan auto-refresh" — and add a separate standalone staleness tick.

---

### ISSUE 3 (HIGH)

**File:** `src/master-plan.ts:724-742` → `getMasterPlanStatus()`, and `src/master-plan.ts:950-957` → `redraftMasterPlan()`
**Type:** No automatic redraft after stale detection (by design — but risky to change)

**Issue:** Even if the plan goes `stale`, there is no automatic redraft. The stale status is purely advisory: `"Git HEAD cambió desde la aprobación; se recomienda redraft."` The user must manually run `/idu_master_plan_redraft` or `/idu`.

A naive "auto-update" approach that calls `redraftMasterPlan()` when stale is detected would be **destructive**: `generateMasterPlanDraft()` creates a completely new plan from scratch. It does NOT preserve the previous plan's:
- Approved status
- User-approved operational contracts (lines 758-815 of master-plan.ts)
- Work milestones (lines 612-620 of master-plan.ts)
- Scope definitions
- Contract violations and resolutions
- Approved canonical claims

The new draft always starts at `status: "draft"` (master-plan.ts:373). An automatic silent redraft would drop the user's approved configuration and require re-approval.

**Proposed fix:**
Do NOT auto-redraft. Instead, auto-mark-stale (Issue 1's fix) plus notify the user through an injection or a telegram message that the plan needs re-approval. The "1:1 with the project" requirement should be interpreted as freshness detection + notification, not silent regeneration.

If the user truly wants auto-redraft, a middle-ground approach:
1. Auto-mark-stale on postflight + scheduled tick
2. In `ensureMasterPlanForIdu()` when status is "stale" and the caller is an automated context (not user-facing), optionally call `redraftMasterPlan()` with `reason: "auto-redraft after git HEAD change"`
3. Preserve the previous plan's approved metadata by injecting it into the new draft's assumptions/evidence arrays rather than overwriting blindly

---

## 5. Wiring Summary

```
[git commit]
     │
     ▼
[user runs /idu or idu-pi idu]  ←─ only stale detection path
     │
     ├─ ensureMasterPlanForIdu()
     │   └─ getMasterPlanStatus()  ←─ detects git HEAD divergence → marks stale
     │
[user runs /postflight]
     │
     └─ maybeRunSupervisorAfterPostflight()
         └─ runIduSupervisorLoop()  ←─ does NOT check git HEAD → plan stays approved

[scheduled tick every ~10-60 min]
     │
     ├─ runMcpContextPackAutoRefreshTick()  ←─ only refreshes objective cache telemetry
     ├─ runTriggerEngineTickOptIn()
     │   └─ objectiveReminderHourlyDefinition  ←─ only checks cache age, not plan HEAD
     └─ planIduSupervisorCron()  ←─ advisory-only, never writes to master plan
```

---

## 6. Cheapest Safer Approach

1. **Add `getMasterPlanStatus()` call in `maybeRunSupervisorAfterPostflight()`** (fix Issue 1). This auto-marks-stale after any code changes detected by postflight.
2. **Add `getMasterPlanStatus()` call in `runMcpContextPackAutoRefreshTick()`**. This adds periodic stale detection even without postflight (e.g. when git pulls happen outside idu-pi).
3. **Do NOT auto-redraft**. Instead, when the plan goes stale, the next `/idu` activation (or a new Telegram notification) lets the user decide whether to redraft. Auto-redraft is destructive and would break the user's approved contracts.

**Total new code:** ~5 lines. No dependency changes. No risk to existing plan data.

---

## 7. Risks of Auto-Updating the Master Plan

| Risk | Severity | Mitigation |
|------|----------|------------|
| Auto-redraft destroys approved contracts | **Critical** | Never auto-redraft; only auto-mark-stale |
| Auto-redraft overwrites work milestones | **Critical** | Notify user; let them decide |
| Redraft during active work session | **High** | Redraft is a heavy scan + inference operation; could conflict with running agent tasks |
| Plan goes stale incorrectly (e.g. git detached HEAD) | **Low** | Use `getMasterPlanStatus()` which already handles edge cases gracefully — it only compares gitHead if both exist |
| Scheduled tick redraft races with user approval | **Medium** | Redraft replaces the plan file; the user's approval would target a now-replaced file |

**Recommendation:** Ship auto-mark-stale only. The user experience improvement is the gap being closed (plan silently stale vs. plan freshly detected as stale on next `/idu`) without the danger of overwriting human-approved configuration.

---

## 8. Dead / Unwired Code Check

| Component | Status |
|-----------|--------|
| `stuck_tasks_1h` trigger | Live, wired in `TRIGGER_DEFINITIONS` |
| `objective_reminder_hourly` trigger | Live, wired |
| `intention_decision_pending` trigger | Live, wired |
| `runMcpContextPackAutoRefreshTick` | Live, called in scheduled tick (`cli.ts:3547`) |
| `planIduSupervisorCron` | Live, but never called from a cron scheduler; only via manual CLI invocation |
| Trigger engine opt-in guard | Live, respects `IDU_PI_TRIGGER_ENGINE=1` or config file |

Nothing is truly dead, but `planIduSupervisorCron` has no scheduled execution path — it is manually invoked only.
