# Supervisor Self-Maintenance Advisory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native advisory-only Idu-pi report that detects backlog pressure, stale tasks, repeated failure patterns, neglected areas, and learning-loop pressure.

**Architecture:** Implement a pure report builder first, then expose it through MCP. V1 reads existing bounded state signals and emits JSON-first recommendations only; it performs no writes, no AgentLabs, no skills/rules/contracts changes.

**Tech Stack:** TypeScript, Node test runner, existing `StructuredTask` model, MCP envelope in `src/mcp-server.ts`.

---

## Task 1: Pure self-maintenance advisory builder

**Files:**
- Create: `src/supervisor-self-maintenance-advisory.ts`
- Create: `test/supervisor-self-maintenance-advisory.test.ts`

- [ ] **Step 1: Write RED tests**

Create tests that call `buildSupervisorSelfMaintenanceAdvisory()` with in-memory data:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSupervisorSelfMaintenanceAdvisory } from "../src/supervisor-self-maintenance-advisory.js";

const baseTask = {
	id: "task-1",
	text: "Bug task. postflight context.md repeated failure",
	category: "bug" as const,
	priority: 3,
	status: "pending" as const,
	createdAt: "2026-06-01T00:00:00.000Z",
	updatedAt: "2026-06-01T00:00:00.000Z",
};

test("self-maintenance advisory detects backlog and stale pressure", () => {
	const tasks = Array.from({ length: 21 }, (_, index) => ({
		...baseTask,
		id: `task-${index}`,
		status: index < 6 ? "running" as const : "pending" as const,
	}));
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks,
	});

	assert.equal(report.noWrites, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.equal(report.totals.pendingTasks, 15);
	assert.equal(report.totals.runningTasks, 6);
	assert.ok(report.signals.some((signal) => signal.category === "backlog_pressure"));
	assert.ok(report.signals.some((signal) => signal.category === "stale_tasks"));
});

test("self-maintenance advisory detects repeated failure without hiding safety", () => {
	const tasks = [
		{ ...baseTask, id: "bug-1", text: "Bug: postflight context.md unexpected delta", status: "done" as const },
		{ ...baseTask, id: "bug-2", text: "Bug: postflight context.md needs_evidence repeated", status: "done" as const },
		{ ...baseTask, id: "bug-3", text: "Bug: postflight local-only context.md", status: "pending" as const },
	];
	const report = buildSupervisorSelfMaintenanceAdvisory({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		tasks,
	});

	const repeated = report.signals.find((signal) => signal.category === "repeated_failure_patterns");
	assert.ok(repeated);
	assert.ok(repeated.skillLearningInputs?.length);
	assert.ok(repeated.recommendedActions.some((action) => /regression test/u.test(action)));
});
```

Run:

```bash
corepack pnpm build && node --test dist/test/supervisor-self-maintenance-advisory.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement GREEN builder**

Create `src/supervisor-self-maintenance-advisory.ts` with:
- report types;
- `buildSupervisorSelfMaintenanceAdvisory(input)`;
- thresholds: open >= 10 warning, open >= 20 high, running >= 5 high;
- stale: pending older than 3 days, running older than 2 hours;
- repeated bug/failure keywords: conservative grouping by `postflight`, `context`, `telegram`, `bibliotecario`, `agentlab`, `skill`, `source`.

- [ ] **Step 3: Verify GREEN**

```bash
corepack pnpm build && node --test dist/test/supervisor-self-maintenance-advisory.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/supervisor-self-maintenance-advisory.ts test/supervisor-self-maintenance-advisory.test.ts
git commit -m "feat(idu): add self-maintenance advisory"
```

## Task 2: MCP read-only tool

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Write RED MCP test**

Add a test that calls `idu_supervisor_self_maintenance_advisory` and asserts:
- `ok === true`;
- `data.report.authority === "advisory"`;
- no-write safety flags are false/true as expected;
- safeNotes say no AgentLabs/no writes.

Run focused MCP test. Expected: FAIL because tool is not registered.

- [ ] **Step 2: Implement tool**

In `src/mcp-server.ts`:
- add tool name to union;
- add `TOOLS` definition;
- dispatch by reading runtime structured tasks where available, or safe empty fallback for v1;
- return envelope with `report`, `decisionEnvelope`, and safeNotes;
- do not write files or create tasks.

- [ ] **Step 3: Verify MCP GREEN**

```bash
corepack pnpm build && node --test --test-name-pattern "self-maintenance" dist/test/mcp-server.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "feat(idu): expose self-maintenance advisory"
```

## Task 3: Verification and review

- [ ] **Step 1: LSP diagnostics**

Check changed files. Expected: 0 diagnostics.

- [ ] **Step 2: Full gate**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: all pass.

- [ ] **Step 3: Fresh reviewer**

Ask reviewer to verify:
- advisory-only;
- no writes/AgentLabs/skills/rules;
- detects backlog/stale/repeated patterns;
- does not overclaim neglected areas with weak evidence;
- context.md remains uncommitted.

- [ ] **Step 4: Push after PASS**

```bash
git status --short
git push
```

---

## Self-Review

Spec coverage:
- Backlog pressure: Task 1.
- Stale tasks: Task 1.
- Repeated failures and learning-loop inputs: Task 1.
- MCP read-only JSON report: Task 2.
- No writes/AgentLabs/skills/rules: Tasks 1-3.

No placeholders remain. V1 intentionally does not create tasks/proposals automatically; it reports recommendations first.
