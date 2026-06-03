# Reliable Idu-pi Usage Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count only reliable project-local Idu-pi calls and explicit Pi compaction events, while rendering token/context attribution as `no medido`.

**Architecture:** Extend the existing local JSONL usage model with an explicit `eventType`, preserving legacy records as `idu_call`. Reports count only `idu_call` for event/action/surface metrics and count only `pi_compaction_detected` for compactions. The project panel renders reliable counters plus explicit unavailable token/context labels.

**Tech Stack:** TypeScript, Node.js test runner, local JSONL under `stateRoot/reports/idu-usage-events.jsonl`.

---

## File structure

- Modify `src/usage-events.ts`
  - Add `IduUsageEventType = "idu_call" | "pi_compaction_detected"`.
  - Add optional `sessionId` and `eventType` to usage events.
  - Add report fields: `totalIduCalls`, `compactionsDetected`, `observedSessions`, `tokensMeasured`, `contextPercentMeasured`.
  - Treat legacy events with no `eventType` as `idu_call` during parse/report.
  - Ensure compaction events do not pollute action top lists.
- Modify `src/cli-home.ts`
  - Display `eventos Idu-pi`, `Sesión Pi`, `compactaciones detectadas`, `tokens Idu-pi: no medido`, `% contexto Idu-pi: no medido` through existing `formatIduUsagePanel()` import.
- Modify `test/usage-events.test.ts`
  - Add tests for event type compatibility, compaction counting, no token/context estimation, and safe rendering.
- Modify `test/cli-home.test.ts`
  - Update current project panel assertions to the new reliable labels.

No new file is required.

---

### Task 1: Add event type and reliable report semantics

**Files:**
- Modify: `src/usage-events.ts`
- Test: `test/usage-events.test.ts`

- [ ] **Step 1: Write failing tests for reliable usage attribution**

Add this test after `usage report calculates compact project panel metrics` in `test/usage-events.test.ts`:

```ts
test("usage report separates idu calls from compaction events", () => {
	const now = new Date().toISOString();
	const report = buildIduUsageReport([
		{
			version: 1,
			id: "legacy-call",
			timestamp: now,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
		},
		{
			version: 1,
			id: "typed-call",
			timestamp: now,
			projectId: "idu-pi",
			surface: "cli",
			action: "idu_status",
			eventType: "idu_call",
			sessionId: "pi-session-1",
		},
		{
			version: 1,
			id: "compact-1",
			timestamp: now,
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
			sessionId: "pi-session-1",
		},
	]);

	assert.equal(report.totalEvents, 3);
	assert.equal(report.totalIduCalls, 2);
	assert.equal(report.compactionsDetected, 1);
	assert.equal(report.observedSessions, 1);
	assert.equal(report.surface.cli, 1);
	assert.equal(report.surface.mcp, 1);
	assert.equal(report.topActions.some((entry) => entry.action === "pi_compaction_detected"), false);
	assert.equal(report.tokensMeasured, false);
	assert.equal(report.contextPercentMeasured, false);
});
```

Add this test near the reader/normalization tests:

```ts
test("usage event reader preserves safe event type and session id", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
			sessionId: "session with spaces",
		});
		const events = readIduUsageEvents(root);
		assert.equal(events[0]?.eventType, "pi_compaction_detected");
		assert.equal(events[0]?.sessionId, "session_with_spaces");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm build
```

Expected: FAIL with TypeScript errors that `eventType`, `sessionId`, and new report fields do not exist.

- [ ] **Step 3: Add event types and report fields**

In `src/usage-events.ts`, replace the surface type block with:

```ts
export type IduUsageSurface = "cli" | "mcp" | "tui";

export type IduUsageEventType = "idu_call" | "pi_compaction_detected";
```

Extend `IduUsageEvent`:

```ts
export type IduUsageEvent = {
	version: 1;
	id: string;
	timestamp: string;
	projectId: string;
	surface: IduUsageSurface;
	action: string;
	eventType?: IduUsageEventType;
	sessionId?: string;
	active?: boolean;
	risk?: string;
	recommendation?: string;
	allowedToProceed?: boolean;
	requiresHuman?: boolean;
	durationMs?: number;
	ok?: boolean;
};
```

Extend `IduUsageReport`:

```ts
export type IduUsageReport = {
	version: 1;
	totalEvents: number;
	totalIduCalls: number;
	compactionsDetected: number;
	observedSessions: number;
	tokensMeasured: false;
	contextPercentMeasured: false;
	lastActivity?: string;
	surface: { cli: number; mcp: number; tui: number; other: number };
	active: { true: number; false: number; unknown: number };
	requiresHuman: number;
	notAllowed: number;
	failed: number;
	topActions: { action: string; count: number }[];
	topRecommendations: { recommendation: string; count: number }[];
	recent: IduUsageEvent[];
};
```

Add helper functions before `normalizeUsageEvent()`:

```ts
function normalizeEventType(value: unknown): IduUsageEventType | undefined {
	if (value === "idu_call" || value === "pi_compaction_detected") return value;
	return undefined;
}

function effectiveEventType(event: IduUsageEvent): IduUsageEventType {
	return event.eventType ?? "idu_call";
}
```

Update `normalizeUsageEvent()` to include safe optional fields:

```ts
		...(normalizeEventType(input.eventType)
			? { eventType: normalizeEventType(input.eventType) }
			: { eventType: "idu_call" as const }),
		...(input.sessionId ? { sessionId: sanitizeLabel(input.sessionId) } : {}),
```

Place those lines after `action: sanitizeLabel(input.action),`.

Update `parseUsageEvent()` to allow `tui` and preserve optional fields:

```ts
	if (value.surface !== "cli" && value.surface !== "mcp" && value.surface !== "tui") return undefined;
```

Add these returned fields after `action: sanitizeLabel(value.action),`:

```ts
		...(normalizeEventType(value.eventType)
			? { eventType: normalizeEventType(value.eventType) }
			: {}),
		...(typeof value.sessionId === "string" && value.sessionId.trim()
			? { sessionId: sanitizeLabel(value.sessionId) }
			: {}),
```

Update `buildIduUsageReport()`:

```ts
	const surface = { cli: 0, mcp: 0, tui: 0, other: 0 };
	const sessions = new Set<string>();
	let totalIduCalls = 0;
	let compactionsDetected = 0;
```

Inside the loop, after timestamp handling:

```ts
		if (event.sessionId) sessions.add(event.sessionId);
		const eventType = effectiveEventType(event);
		if (eventType === "pi_compaction_detected") {
			compactionsDetected += 1;
			continue;
		}
		totalIduCalls += 1;
```

Then keep the existing surface/action/recommendation counting below that block, but add `tui` handling:

```ts
		if (event.surface === "cli") surface.cli += 1;
		else if (event.surface === "mcp") surface.mcp += 1;
		else if (event.surface === "tui") surface.tui += 1;
		else surface.other += 1;
```

Add new fields to the return object:

```ts
		totalIduCalls,
		compactionsDetected,
		observedSessions: sessions.size,
		tokensMeasured: false,
		contextPercentMeasured: false,
```

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js --test-name-pattern "usage report separates|usage event reader preserves"
```

Expected: PASS for the new tests.

---

### Task 2: Render reliable panel labels

**Files:**
- Modify: `src/usage-events.ts`
- Test: `test/usage-events.test.ts`, `test/cli-home.test.ts`

- [ ] **Step 1: Write failing render assertions**

Update `test("usage report calculates compact project panel metrics", ...)` assertions from old `eventos` text to include:

```ts
		const panel = formatIduUsagePanel(report);
		assert.match(panel, /eventos Idu-pi: 3/u);
		assert.match(panel, /superficie: cli 2 · mcp 1 · tui 0/u);
		assert.match(panel, /compactaciones detectadas: 0/u);
		assert.match(panel, /tokens Idu-pi: no medido/u);
		assert.match(panel, /% contexto Idu-pi: no medido/u);
```

Update `test("usage panel formats empty report without errors", ...)`:

```ts
	assert.match(panel, /eventos Idu-pi: 0/u);
	assert.match(panel, /compactaciones detectadas: 0/u);
	assert.match(panel, /tokens Idu-pi: no medido/u);
	assert.match(panel, /% contexto Idu-pi: no medido/u);
```

Update `test("current project panel shows local usage metrics from stateRoot", ...)` in `test/cli-home.test.ts`:

```ts
		assert.match(output, /eventos Idu-pi: 1/u);
		assert.match(output, /superficie: cli 1 · mcp 0 · tui 0/u);
		assert.match(output, /tokens Idu-pi: no medido/u);
```

Update `test("current project panel shows empty usage metrics without state writes", ...)`:

```ts
		assert.match(output, /eventos Idu-pi: 0/u);
		assert.match(output, /compactaciones detectadas: 0/u);
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js dist/test/cli-home.test.js --test-name-pattern "usage report calculates|usage panel formats empty|current project panel shows local usage|current project panel shows empty"
```

Expected: FAIL because the formatter still prints `eventos:` and does not print session/token lines.

- [ ] **Step 3: Update formatter**

Replace `formatIduUsagePanel()` in `src/usage-events.ts` with:

```ts
export function formatIduUsagePanel(report: IduUsageReport): string {
	const base = [
		"Uso local",
		"actualizado: recién",
		`último evento: ${report.totalIduCalls ? formatRelativeUsageTime(report.lastActivity) : "sin eventos"}`,
		`eventos Idu-pi: ${report.totalIduCalls}`,
		`superficie: cli ${report.surface.cli} · mcp ${report.surface.mcp} · tui ${report.surface.tui}`,
		`activo/inactivo: ${report.active.true} / ${report.active.false}`,
		`requiere humano: ${report.requiresHuman}`,
		`bloqueados/no permitido: ${report.notAllowed}`,
		`errores: ${report.failed}`,
		"acciones top:",
		...(report.topActions.length
			? report.topActions.map((entry) => `- ${entry.action} ${entry.count}`)
			: ["- sin acciones"]),
		"",
		"Sesión Pi",
		`compactaciones detectadas: ${report.compactionsDetected}`,
		"tokens Idu-pi: no medido",
		"% contexto Idu-pi: no medido",
	];
	return base.join("\n");
}
```

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js dist/test/cli-home.test.js --test-name-pattern "usage report calculates|usage panel formats empty|current project panel shows local usage|current project panel shows empty"
```

Expected: PASS.

---

### Task 3: Preserve summary compatibility and guard sensitive fields

**Files:**
- Modify: `src/usage-events.ts`
- Test: `test/usage-events.test.ts`

- [ ] **Step 1: Write compatibility assertions**

Add this test after `usage summary counts surfaces actions recommendations and tri-state fields`:

```ts
test("usage summary counts only idu calls for action metrics", () => {
	const now = new Date().toISOString();
	const summary = summarizeIduUsageEvents([
		{
			version: 1,
			id: "call",
			timestamp: now,
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
			eventType: "idu_call",
		},
		{
			version: 1,
			id: "compact",
			timestamp: now,
			projectId: "idu-pi",
			surface: "cli",
			action: "pi_compaction_detected",
			eventType: "pi_compaction_detected",
		},
	]);

	assert.equal(summary.totalEvents, 2);
	assert.equal(summary.totalIduCalls, 1);
	assert.equal(summary.compactionsDetected, 1);
	assert.equal(summary.byAction.idu_postflight, 1);
	assert.equal(summary.byAction.pi_compaction_detected, undefined);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm build
```

Expected: FAIL because `IduUsageSummary` does not yet expose `totalIduCalls` and `compactionsDetected`.

- [ ] **Step 3: Update summary model**

Extend `IduUsageSummary` in `src/usage-events.ts`:

```ts
	totalIduCalls: number;
	compactionsDetected: number;
	observedSessions: number;
```

Update `summarizeIduUsageEvents()` to initialize:

```ts
	const sessions = new Set<string>();
	let totalIduCalls = 0;
	let compactionsDetected = 0;
```

Inside the loop, before incrementing action/surface fields:

```ts
		if (event.sessionId) sessions.add(event.sessionId);
		const eventType = effectiveEventType(event);
		if (eventType === "pi_compaction_detected") {
			compactionsDetected += 1;
			continue;
		}
		totalIduCalls += 1;
```

Add these fields to the returned summary:

```ts
		totalIduCalls,
		compactionsDetected,
		observedSessions: sessions.size,
```

Update `formatIduUsageSummary()` near the top:

```ts
		`eventos Idu-pi: ${summary.totalIduCalls}`,
		`compactaciones detectadas: ${summary.compactionsDetected}`,
		`sesiones observadas: ${summary.observedSessions}`,
		"tokens Idu-pi: no medido",
		"% contexto Idu-pi: no medido",
```

Keep `eventos totales JSONL: ${summary.totalEvents}` if desired for detailed/debug clarity.

- [ ] **Step 4: Run focused compatibility tests**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js
```

Expected: PASS.

---

### Task 4: Final verification, postflight, and commit

**Files:**
- Verify: `src/usage-events.ts`, `src/cli-home.ts`, `test/usage-events.test.ts`, `test/cli-home.test.ts`

- [ ] **Step 1: Run LSP diagnostics**

Run:

```bash
# via pi-lens LSP diagnostics for:
# src/usage-events.ts
# src/cli-home.ts
# test/usage-events.test.ts
# test/cli-home.test.ts
```

Expected: 0 diagnostics.

- [ ] **Step 2: Run focused validation**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js dist/test/cli-home.test.js && git diff --check
```

Expected: build succeeds, tests pass, diff check passes with no whitespace errors.

- [ ] **Step 3: Run full validation**

Run:

```bash
corepack pnpm test && git diff --check
```

Expected: full suite passes with 0 failures.

- [ ] **Step 4: Run advisory postflight**

Run Idu-pi postflight with:

```json
{
  "projectPath": "C:/Users/elmas/pi-telegram-bridge",
  "expectedChangeMode": "code",
  "expectedFiles": [
    "src/usage-events.ts",
    "src/cli-home.ts",
    "test/usage-events.test.ts",
    "test/cli-home.test.ts"
  ],
  "expectedContracts": ["tests", "agent"]
}
```

Expected: `allowedToProceed: true`.

- [ ] **Step 5: Save memory**

Save a project memory noting that reliable usage attribution intentionally does not estimate tokens/context percentages.

- [ ] **Step 6: Commit and push explicit paths only**

Run:

```bash
git add src/usage-events.ts src/cli-home.ts test/usage-events.test.ts test/cli-home.test.ts docs/superpowers/plans/2026-06-03-reliable-idu-usage-attribution.md
git commit -m "feat(idu): add reliable usage attribution"
git push
```

Expected: branch clean and pushed.

---

## Self-review

- Spec coverage: The plan covers reliable project counters, explicit compaction events, session IDs, legacy event compatibility, `no medido` token/context labels, and local-only JSONL storage.
- Placeholder scan: No unfinished placeholder markers remain.
- Type consistency: `eventType`, `sessionId`, `totalIduCalls`, `compactionsDetected`, `observedSessions`, `tokensMeasured`, and `contextPercentMeasured` are consistently introduced before use.
- Scope check: Bibliotecario, skill efficacy, and model/token attribution remain out of scope for this slice.