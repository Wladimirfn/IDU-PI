# MCP Server Quality + Auto-Execution Wirings — Audit Report

## Files Retrieved

1. `src/mcp-server.ts` (lines 1-7235) — MCP server: 83 tool definitions, `callIduMcpTool`, `handleMcpRequest`, `envelope` factory, `dispatchTool` switch, orchestrator_turn emission
2. `src/trigger-engine.ts` (lines 1-340) — Trigger definitions: `stuckTasks1hDefinition`, `objectiveReminderHourlyDefinition`, `intentionDecisionPendingDefinition`; `runTriggerEngineTick`
3. `src/injection-store.ts` (lines 1-120) — `appendInjection`, `readPendingInjections`, `markInjectionAcked` (with lab.db decision recording)
4. `src/role-events.ts` (lines 1-60) — `emitOrchestratorTurn`, `emitAlertsScheduledTick`
5. `src/objective-reminder.ts` (lines 1-90) — `buildObjectiveReminderText`
6. `src/decision-ledger.ts` (lines 1-135) — `recordDecision`, `listDecisions`, `ensureSchema`
7. `src/cli.ts` (lines 3280-3330) — `runCliAutonomousAlertTick` with `emitAlertsScheduledTick`
8. `src/trigger-engine-invocation.ts` (lines 1-30) — `runTriggerEngineTickOptIn` wrapper
9. `test/wirings-e2e.test.ts` (lines 1-110) — 5 wiring tests
10. `test/mcp-server.test.ts` (lines 1-1566+) — 3000+ lines of MCP server tests
11. `test/role-events.test.ts` (lines 1-80) — Event emission unit tests
12. `test/trigger-engine.test.ts` (lines 1-450) — Trigger engine unit tests
13. `test/injection-store.test.ts` (lines 1-105) — Injection store unit tests
14. `test/objective-reminder.test.ts` (lines 1-90) — Objective reminder unit tests

---

## Key Code

### IduMcpToolResult contract
```
src/mcp-server.ts:6767-6779
type → ok, tool, projectId, projectPath, summary, data (JsonObject), safeNotes (string[]), errors (string[])
No top-level evidenceRefs — evidence refs live inside data.decisionEnvelope.evidenceRefs
```

### orchestrator_turn emission at tool start
```
src/mcp-server.ts:141-153 (inside callIduMcpTool)
```
Best-effort try/catch. Uses `(options as { projectPath?: string }).projectPath` (not the `input` argument). Falls through to normal tool dispatch.

### `markInjectionAcked` lab.db recording
```
src/injection-store.ts:103-118
```
Calls `recordDecision(dbPath, { projectId: "default", ... profileRef: "config/profiles/orchestrator.md" })`. **projectId is hardcoded as "default"**.

### `objective_reminder_hourly.build` event emission
```
src/trigger-engine.ts:89-118
```
1. Calls `buildObjectiveReminderText` **outside** the try/catch block
2. Then tries to `appendEvent` with `master_plan_drift` inside a try/catch
3. Returns injection envelope with evidenceRefs `["master-plan-objective-cache.json"]`

### `runCliAutonomousAlertTick` emit
```
src/cli.ts:3286-3296
```
Best-effort `emitAlertsScheduledTick` with hardcoded `cronExpr: "*/15 * * * *"`.

---

## Architecture

```
MCP tool call (JSON-RPC)
  → handleMcpRequest
    → callIduMcpTool
      → emitOrchestratorTurn (wiring 1)
      → resolve project context
      → dispatchTool

CLI autonomous alert tick
  → runCliAutonomousAlertTick
    → emitAlertsScheduledTick (wiring 2)
    → runTriggerEngineTickOptIn
      → runTriggerEngineTick
        → def.match → def.build → appendInjection (+ event emission in wiring 4/5)

Pending injection ack
  → markInjectionAcked
    → disk: flip acked flag
    → lab.db: recordDecision (wiring 3)
```

All 5 wirings are implemented. Wirings 1-4 have end-to-end test coverage in `test/wirings-e2e.test.ts`. Wiring 5 does **not** have end-to-end coverage — the existing "Wiring 5" test is misnamed.

---

## 3 Most Impactful Issues

---

### 1. [severity: high] `buildObjectiveReminderText` not guarded in `objective_reminder_hourly.build` — can crash trigger engine tick

**File:line**: `src/trigger-engine.ts:89-91`

**Issue**: The `build` function for `objective_reminder_hourly` calls `buildObjectiveReminderText` **outside** the try/catch block. If `loadRoleProfile("orchestrator")` inside `buildObjectiveReminderText` throws (profile missing, corrupt, or filesystem error), the entire `build` function throws. Since `runTriggerEngineTick` does not catch per-trigger errors, the entire tick crashes, no other triggers are evaluated, and the error propagates to the caller.

**Evidence**:
- `src/trigger-engine.ts:89-91` — `const summary = buildObjectiveReminderText(...)` is outside try/catch
- `src/objective-reminder.ts:39-53` — `loadRoleProfile("orchestrator")` is called without a guard
- `src/trigger-engine.ts:185-196` — `runTriggerEngineTick` calls `def.build(result, context)` without a per-trigger try/catch
- `src/trigger-engine-invocation.ts:26-31` — `runTriggerEngineTickOptIn` also has no try/catch

**Proposed fix**:
```typescript
// In objective_reminder_hourly.build (trigger-engine.ts ~line 89)
build: (_matches, context) => {
    let summary: string;
    try {
        summary = buildObjectiveReminderText({
            stateRoot: context.stateRoot,
            now: context.now,
        });
    } catch {
        summary = "(objetivo no disponible — error al cargar perfil del orquestador)";
    }
    try {
        appendEvent(...);
    } catch {
        // best-effort
    }
    return { ... };
}
```

This is [severity: high] because it can crash the trigger engine tick in production, silently disabling all triggers (not just `objective_reminder_hourly`) when the orchestrator profile is unavailable.

---

### 2. [severity: medium] `markInjectionAcked` hardcodes `projectId: "default"` in lab.db decision recording

**File:line**: `src/injection-store.ts:110-117`

**Issue**: The `recordDecision` call in `markInjectionAcked` uses `projectId: "default"` regardless of which project the injection belongs to. This means all ack decisions are recorded with the wrong project ID. Project-scoped queries to the decision ledger (`listDecisions({ projectId: "sistema_de_mantencion" })`) will miss these decisions. The function signature only receives `stateRoot` and `injectionId`, so it doesn't have access to the actual project ID.

**Evidence**:
- `src/injection-store.ts:110` — `projectId: "default"` is hardcoded
- `src/decision-ledger.ts:89-99` — `listDecisions` filters by `projectId` column
- All 3 callers have access to the project ID: `src/mcp-server.ts:4108` (has `runtime.projectId`), `src/cli.ts:2735` (has `runtime.projectId`), `test/wirings-e2e.test.ts:102`
- The wirings-e2e test confirms the behavior by querying with `projectId: "default"` — it's a known but unfixed data quality bug

**Proposed fix**:
```typescript
// injection-store.ts
export function markInjectionAcked(
    stateRoot: string,
    injectionId: string,
    projectId?: string,  // new optional parameter
): void {
    // ... disk logic unchanged ...
    recordDecision(dbPath, {
        projectId: projectId ?? "default",  // fallback only
        decidedAt: new Date().toISOString(),
        decidedBy: "orchestrator",
        decision: "ack",
        targetKind: decidedKind,
        targetId: injectionId,
        profileRef: "config/profiles/orchestrator.md",
    });
}
```
Then update all 3 callers to pass the actual project ID.

---

### 3. [severity: medium] Wiring 5 (`master_plan_drift` event emission in `objective_reminder_hourly.build`) has zero test coverage — the wirings-e2e test for "Wiring 5" is misnamed

**File:line**: `test/wirings-e2e.test.ts:100-110` (Wiring 5 test misnamed), `test/trigger-engine.test.ts:418-450` (hermetic envelope test doesn't verify event emission)

**Issue**: The `build` function of `objective_reminder_hourly` appends a `master_plan_drift` event to the event bus. This is the 5th wiring listed in the PR-92 contract. However:

1. The test labeled "Wiring 5" in `wirings-e2e.test.ts` actually tests `orchestrator_turn` + `alerts_scheduled_tick` coexistence — it does **not** test the `master_plan_drift` emission from the trigger engine.
2. The hermetic envelope test in `trigger-engine.test.ts` (line 418) tests the injection envelope structure but never reads `events.jsonl` to verify the event was emitted.
3. No test anywhere calls `runTriggerEngineTick` with a stale cache and then reads `events.jsonl` to assert a `master_plan_drift` event with `reason: "objective_reminder_fired"`.

If `appendEvent` fails silently (its try/catch swallows all errors) or the event structure changes, no test would catch it. The role engine subscriptions that depend on this stimulus would silently stop receiving the event.

**Evidence**:
- `test/wirings-e2e.test.ts:100-110` — "Wiring 5" test only verifies `emitOrchestratorTurn + emitAlertsScheduledTick` coexistence
- `test/trigger-engine.test.ts:418-450` — hermetic test checks envelope structure, not events.jsonl
- `src/trigger-engine.ts:98-108` — the `appendEvent` call for `master_plan_drift` that needs testing

**Proposed fix**:
1. **Rename** the current Wiring 5 test to "Wiring 1+2: orchestrator_turn and alerts_scheduled_tick coexist in events.jsonl"
2. **Add** a proper Wiring 5 test:
```typescript
test("Wiring 5: objective_reminder_hourly.build emits master_plan_drift event", () => {
    const { stateRoot, cleanup } = makeStateRoot();
    try {
        const cachePath = join(stateRoot, "master-plan-objective-cache.json");
        const now = new Date("2026-06-15T10:00:00Z");
        writeFileSync(cachePath, JSON.stringify({
            version: 1,
            projectId: "demo",
            objective: "test",
            updatedAt: "2026-06-15T08:00:00Z",  // >1h old
        }), "utf8");
        runTriggerEngineTick({
            stateRoot,
            projectId: "demo",
            now,
            isProjectActive: () => true,
        });
        const events = readEventsJsonl(stateRoot);
        const driftEvents = events.filter(e => e.kind === "master_plan_drift");
        assert.ok(driftEvents.length >= 1);
        assert.match(driftEvents[0]?.payload?.reason ?? "", /objective_reminder_fired/);
    } finally {
        cleanup();
    }
});
```

---

## Additional Findings (lower severity)

- **[note] `evidenceRefs` contract consistency**: All decision envelopes in `dispatchTool` include `evidenceRefs` consistently. However, the `objective_reminder_hourly` evidence ref (`["master-plan-objective-cache.json"]`) uses a short relative filename, while other triggers use `events.jsonl:${timestamp}` or compound refs. This is inconsistent in precision but not a bug — the cache file path is unambiguous within a stateRoot.

- **[note] Tool count**: The `IduMcpToolName` union type lists 83 tools. The test at `test/mcp-server.test.ts:252` asserts `tools.length === 83`. If the task stated 78 tools, that was outdated; the current tool count is 83.

- **[note] Hardcoded cron expression**: `runCliAutonomousAlertTick` at `src/cli.ts:3294` hardcodes `cronExpr: "*/15 * * * *"` instead of reading from config. This is a minor data quality issue in the event payload if the actual cron schedule differs.

---

## Start Here

Open `src/trigger-engine.ts` lines 85–118 first — it's the most critical file because the `build` function in `objective_reminder_hourlyDefinition` has the unguarded `buildObjectiveReminderText` call (Issue 1). Then open `src/injection-store.ts` lines 86–118 for the hardcoded projectId (Issue 2). Finally open `test/wirings-e2e.test.ts` to understand the test gap (Issue 3).
