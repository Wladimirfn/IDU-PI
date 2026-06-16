# Cron Preflight Research — `idu_postflight` MCP Handler Analysis

**Date:** 2026-01-XX  
**Purpose:** Document existing `idu_postflight` flow to inform `idu-run-cron-preflight` CLI tool design (PR-105a)  
**Scope:** Research only — no code changes

---

## 1. idu_postflight Flow (MCP Handler)

**Entry point:** `src/mcp-server.ts:3090`  
**Handler signature:** `case "idu_postflight":` (lines 3090–3250)

### Step-by-step trace

| Step | File:Line | Function | Purpose |
|------|-----------|----------|---------|
| 1 | `mcp-server.ts:3091` | `runtime.postflight()` | Generate base postflight report (git diff, changed files, risk level) |
| 2 | `mcp-server.ts:3093` | `runSensorImpulses({...})` | Fire AgentLab role impulses for changed files matching sensor patterns |
| 3 | `mcp-server.ts:3115` | `categorizeFindings({...})` | Supervisor-main categorizes AgentLab findings (critical/medium/low) |
| 4 | `mcp-server.ts:3133` | `buildPostflightTaskTrace({...})` | Build task trace from optional args (actionId, taskPackageId, expectedContracts) |
| 5 | `mcp-server.ts:3145` | `buildPhysicalEvidenceGateways(...)` | Extract physical gate evidence from report |
| 6 | `mcp-server.ts:3150` | `buildPostflightEvidenceGateways({...})` | Extract postflight-specific evidence gateways |
| 7 | `mcp-server.ts:3152` | `decisionEnvelopeFromEvidence(...)` | Build decision envelope (recommendation, severity, requiresHuman) |
| 8 | `mcp-server.ts:3170` | `buildSupervisorConsultation({...})` | Build supervisor consultation object (plan, risks, gates, proceed rationale) |
| 9 | `mcp-server.ts:3200` | `envelope({...})` | Wrap in standard MCP envelope with data fields |

### Key dependencies

- **postflight-core.ts:34** — `buildPostflightTaskTrace()` extracts task trace logic
- **decision-envelope.ts:94** — `decisionEnvelopeFromEvidence()` builds decision envelope
- **mcp-server.ts:5668** — `buildSupervisorConsultation()` local helper (not exported)

### Sensor impulse chain detail

**File:** `src/sensor-impulses.ts` (80 lines total)

```
runSensorImpulses(input)
  ├─ matchSensors(changedFiles) → SensorMatch[]
  ├─ For each match:
  │   ├─ readFileCapped(filePath) → string | undefined (4000 char limit)
  │   ├─ Build question: "Audit this change: {file} ({description})"
  │   └─ consultSupervisor({stateRoot, role, question, context}) → ConsultResult
  └─ Return SensorImpulseResult[] (match + consult + fileContent)
```

**Sensor→AgentLab→Supervisor chain:**

1. **Sensor layer** (`sensors.ts`) — pattern matching on changed files
2. **AgentLab layer** (`sensor-impulses.ts`) — fires role-specific impulses via `consultSupervisor()`
3. **Supervisor layer** (`supervisor-categorize.ts`) — supervisor-main categorizes findings

### Supervisor categorization detail

**File:** `src/supervisor-categorize.ts` (160 lines total)

```
categorizeFindings(input)
  ├─ Build summary from findings (role + file + response snippet)
  ├─ Question: "Categorize these N AgentLab findings. Return ONLY 'N critical, M medium, K low'"
  ├─ consultSupervisor({role: "supervisor-main", ...}) → ConsultResult
  ├─ parseCategorizedCounts(response) → {critical, medium, low}
  ├─ Build SupervisorAdvisory {ts, kind, summary, counts, advisoryId}
  └─ writeSupervisorAdvisory(stateRoot, advisory) → append to injections.jsonl
```

**writeSupervisorAdvisory** appends to `{stateRoot}/injections.jsonl`:

```json
{
  "ts": "2026-01-XXT...",
  "kind": "supervisor_advisory",
  "summary": "4 critical, 2 medium, 1 low",
  "counts": {"critical": 4, "medium": 2, "low": 1},
  "advisoryId": "sa-1234567890",
  "acked": false,
  "injectionId": "sa-1234567890",
  "triggerId": "supervisor_categorize",
  "decisionEnvelope": {
    "severity": "critical|warning|info",
    "summary": "...",
    "options": ["review_critical", "review_medium", "acknowledge"],
    "evidenceRefs": ["sensor:agentlab_finding", "supervisor:advisory"],
    "orchestratorDecisionRequired": true
  }
}
```

---

## 2. State Files Involved

### Files read

| File | Module | Purpose |
|------|--------|---------|
| `{stateRoot}/role-engine-config.json` | `role-engine-config.ts` | Master switch per role (enabled/disabled) |
| `{stateRoot}/role-rails.json` | `role-rails.ts` | Per-role token budgets, cooldowns, wake counts |
| `src/roles/profiles/*.yaml` | `roles/profile-loader.ts` | Role profile metadata (nombre, tipo, rolId) |
| Git working directory | `runtime.postflight()` | Changed files, diff, risk assessment |

### Files written

| File | Module | Purpose |
|------|--------|---------|
| `{stateRoot}/role-rails.json` | `role-rails.ts` | Updated after each consult (wakeCount++, lastWakeAt, successStreak/failureStreak, tokenBudget auto-tune) |
| `{stateRoot}/injections.jsonl` | `supervisor-categorize.ts` | Appended with `supervisor_advisory` entries (one per postflight with findings) |

### State flow

```
role-engine-config.json (read) → check if role enabled
role-rails.json (read/write) → check cooldown, auto-tune budget
injections.jsonl (append) → write supervisor advisory for orchestrator
```

---

## 3. Return Envelope Shape

### Standard MCP envelope

**Function:** `mcp-server.ts:6902` `envelope(input)`

```typescript
{
  ok: boolean;
  tool: IduMcpToolName;  // "idu_postflight"
  projectId: string | null;
  projectPath: string | null;
  summary: string;  // redacted (secrets removed)
  data: JsonObject;  // redacted
  safeNotes: string[];  // deduped with SAFE_BASE_NOTES
  errors: string[];
}
```

### idu_postflight data fields

**Lines 3200–3250** — the `data` object contains:

| Field | Type | Source |
|-------|------|--------|
| `decisionEnvelope` | object | `decisionEnvelopeFromEvidence()` |
| `supervisorConsultation` | object | `buildSupervisorConsultation()` |
| `governanceConfig` | object | `governanceConfigData()` |
| `workerBoundary` | object | `workerBoundaryData()` |
| `changedFiles` | string[] | `report.changedFiles` |
| `ignoredFiles` | string[] | `report.ignoredFiles ?? []` |
| `observedChangeMode` | string | `report.observedChangeMode ?? "code"` |
| `risk` | string | `report.risk` (low/medium/high/blocker) |
| `gates` | object \| null | `report.constitutionGate` |
| `physicalGates` | array | `report.physicalGates ?? []` |
| `physicalGateways` | array | `buildPhysicalEvidenceGateways()` |
| `evidenceGateways` | array | `buildPostflightEvidenceGateways()` + physical |
| `suggestedAgentLabs` | array | `report.suggestedAgentLabs` |
| `requiresHumanConfirmation` | boolean | `report.requiresHumanConfirmation` |
| `sensorImpulses` | array | `sensorImpulses.map(...)` — see below |
| `supervisorAdvisory` | object \| null | `supervisorAdvisory` result |
| `taskTrace` | object | `buildPostflightTaskTrace()` |
| `report` | object | `runtime.postflight()` full report |

### sensorImpulses array item shape

```typescript
{
  match: {
    file: string;
    role: IduModelRoleId;
    description: string;
  };
  ok: boolean;
  response: string;
  model: string;
  reason?: ConsultReason;
  rail: {
    wakeCount: number;
    tokenBudget: number;
    cooldownRemainingMs: number;
  };
  fileContentTruncated: boolean;
}
```

### supervisorAdvisory shape (when present)

```typescript
{
  ok: boolean;
  counts: { critical: number; medium: number; low: number };
  summary: string | null;
  advisoryId: string | null;
  reason?: string | null;
}
```

---

## 4. Reuse Plan for `idu-run-cron-preflight`

### What can be extracted

The core logic that both MCP `idu_postflight` and CLI `idu-run-cron-preflight` need:

1. **Postflight report generation** — already in `runtime.postflight()` (shared)
2. **Sensor impulse firing** — `runSensorImpulses()` from `sensor-impulses.ts` (already shared)
3. **Supervisor categorization** — `categorizeFindings()` from `supervisor-categorize.ts` (already shared)

### What is MCP-only (not needed for cron)

- `buildPostflightTaskTrace()` — requires actionId/taskPackageId/expectedContracts (MCP-specific args)
- `buildSupervisorConsultation()` — requires planObjective, supervisorRecommendation (MCP-specific orchestration)
- `decisionEnvelopeFromEvidence()` — builds MCP-specific decision envelope
- `buildPhysicalEvidenceGateways()` / `buildPostflightEvidenceGateways()` — MCP-specific evidence extraction

### Proposed shared function

**File:** `src/cron-preflight.ts` (new file, ~100 lines)

```typescript
export async function runCronPreflight(input: {
  projectPath: string;
  stateRoot: string;
  promptForRole: PromptForRoleFn;
}): Promise<CronPreflightResult>
```

**Returns:**

```typescript
{
  report: PostflightReport;
  sensorImpulses: SensorImpulseResult[];
  supervisorAdvisory: CategorizeResult | null;
}
```

This function would:
1. Call `runtime.postflight()` to get the report
2. Call `runSensorImpulses({stateRoot, projectRoot, changedFiles, promptForRole})`
3. Call `categorizeFindings({stateRoot, findings, promptForRole})`
4. Return the combined result

### CLI handler

**File:** `src/cli.ts` — add new command handler `idu-run-cron-preflight`

The CLI handler would:
1. Parse args (projectPath, stateRoot)
2. Build `promptForRole` function (same as `idu-postflight` does)
3. Call `runCronPreflight({...})`
4. Format and print the result

### PowerShell wrapper

**File:** `scripts/idu-run-cron-preflight.ps1`

Similar to `scripts/idu-postflight.ps1` but calls `npx tsx src/cli.ts idu-run-cron-preflight ...`

---

## 5. Files to Modify for PR-105a

| File | Action | Lines | Purpose |
|------|--------|-------|---------|
| `src/cron-preflight.ts` | **CREATE** | ~100 | Shared function `runCronPreflight()` |
| `src/cli.ts` | MODIFY | ~60 | Add `idu-run-cron-preflight` command handler |
| `src/index.ts` | MODIFY | ~5 | Export `runCronPreflight` |
| `scripts/idu-run-cron-preflight.ps1` | **CREATE** | ~25 | PowerShell wrapper for cron |

**Total:** 1 new file (~100 lines), 2 modified files (~65 lines), 1 new script (~25 lines)  
**Estimated total:** ~190 lines

### No changes needed

- `src/mcp-server.ts` — keep MCP handler as-is (it has additional orchestration logic)
- `src/sensor-impulses.ts` — already shared, no changes
- `src/supervisor-categorize.ts` — already shared, no changes
- `src/role-rails.ts` — already shared, no changes
- `src/supervisor-consult.ts` — already shared, no changes

---

## 6. Open Questions for Orchestrator

### Q1: Should cron preflight run `maybeRunSupervisorAfterPostflight`?

**Context:** The CLI `idu-postflight` command (cli.ts:1031) calls `maybeRunSupervisorAfterPostflight()` which runs the full supervisor loop (creates tasks, runs semantic audit, etc.). The MCP `idu_postflight` handler does NOT call this function.

**Question:** Should the new `idu-run-cron-preflight` tool also run the full supervisor loop, or only the sensor impulses + categorization (like MCP)?

**Tradeoffs:**
- **Full loop (like CLI):** More comprehensive, but creates tasks and has side effects. May be too heavy for cron.
- **Sensors only (like MCP):** Lighter, just writes `supervisor_advisory` to injections.jsonl. Orchestrator can decide what to do next.

**Recommendation:** Start with sensors-only (like MCP). If cron needs to create tasks, add a `--run-supervisor-loop` flag later.

### Q2: Should cron preflight build taskTrace and decisionEnvelope?

**Context:** The MCP handler builds `taskTrace` (from actionId/taskPackageId/expectedContracts) and `decisionEnvelope` (from evidence gateways). These are MCP-specific orchestration artifacts.

**Question:** Should `idu-run-cron-preflight` also build these artifacts, or return a simpler shape?

**Tradeoffs:**
- **Full artifacts (like MCP):** Consistent with MCP output, but requires cron to accept actionId/taskPackageId args (which may not make sense for cron).
- **Simpler shape:** Easier to use from cron, but inconsistent with MCP. Orchestrator would need to build these artifacts separately if needed.

**Recommendation:** Return simpler shape (report + sensorImpulses + supervisorAdvisory). If orchestrator needs taskTrace/decisionEnvelope, it can build them from the cron output.

### Q3: Should cron preflight write to `role-rails.json`?

**Context:** The sensor impulse chain writes to `role-rails.json` (updates wakeCount, lastWakeAt, auto-tunes tokenBudget). This is the same state file used by the MCP path.

**Question:** Is it safe for cron to write to the same `role-rails.json` file, or should cron use a separate state root?

**Tradeoffs:**
- **Same state root:** Cron impulses count toward role cooldowns and token budgets. May interfere with interactive MCP usage.
- **Separate state root:** Cron and MCP are isolated, but roles may be invoked more often than intended.

**Recommendation:** Use the same state root (same as MCP). The role-rails system is designed to handle concurrent access (atomic writes, cooldowns). If cron causes issues, add a `--separate-rails` flag later.

---

## Summary

The `idu_postflight` MCP handler orchestrates a three-stage chain:
1. **Postflight report** (git diff, risk assessment)
2. **Sensor impulses** (AgentLab role calls for changed files)
3. **Supervisor categorization** (supervisor-main categorizes findings)

The core logic (stages 2–3) is already in shared modules (`sensor-impulses.ts`, `supervisor-categorize.ts`). PR-105a can extract a thin wrapper `runCronPreflight()` that calls these modules and returns a combined result. The MCP handler has additional orchestration logic (taskTrace, decisionEnvelope, supervisorConsultation) that is MCP-specific and should NOT be extracted.

**Key files to create/modify:**
- `src/cron-preflight.ts` (new, ~100 lines)
- `src/cli.ts` (modify, ~60 lines)
- `src/index.ts` (modify, ~5 lines)
- `scripts/idu-run-cron-preflight.ps1` (new, ~25 lines)

**State files:**
- Read: `role-engine-config.json`, `role-rails.json`, role profiles
- Write: `role-rails.json` (auto-tune), `injections.jsonl` (supervisor advisory)

**Decision needed:** Should cron run the full supervisor loop (like CLI) or only sensors+categorization (like MCP)? Recommendation: start with sensors-only.
