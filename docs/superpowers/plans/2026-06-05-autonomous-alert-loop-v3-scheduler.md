# Autonomous Alert Loop v3 Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native cached Master Plan objective alignment and an OS-priority scheduled alert executor with lock/idempotency, while keeping Telegram optional.

**Architecture:** Create small core modules for objective cache and scheduled executor state, then route a new CLI command through a single scheduled executor. The executor consults cached Plan Maestro objective/approval before running alerts, uses a stateRoot lock/lease to avoid duplicate runs, and keeps bridge interval designed but disabled.

**Tech Stack:** TypeScript ESM, Node built-in `fs/path`, `node:test`, existing Idu-pi CLI/MCP/stateRoot patterns.

---

## File Map

- Create `src/master-plan-objective-cache.ts` — bounded Plan Maestro objective snapshot cache under `stateRoot/reports`.
- Create `test/master-plan-objective-cache.test.ts` — cache TTL, bounds, blocked-plan, stateRoot-only tests.
- Create `src/autonomous-alert-scheduler-state.ts` — scheduler lock/lease/idempotency state helpers.
- Create `test/autonomous-alert-scheduler-state.test.ts` — lock acquisition, locked skip, expired lease, task idempotency tests.
- Create `src/autonomous-alert-scheduler.ts` — single scheduled executor for OS/CLI and future bridge interval.
- Create `test/autonomous-alert-scheduler.test.ts` — executor gate, default read-only, objective alignment, duplicate protection tests.
- Modify `src/cli.ts` — add `alerts scheduled-tick` command and formatter using the core executor.
- Modify `test/idu-cli.test.ts` — CLI coverage for scheduled tick.
- Modify `src/command-catalog.ts` — document the new CLI command without making Telegram primary.
- Modify `test/command-catalog.test.ts` — command catalog coverage if needed.
- Optional create `scripts/install-alert-scheduled-task.ps1` only if implementation scope stays small; otherwise document command and defer script.

---

### Task 1: Native Master Plan objective cache

**Files:**
- Create: `src/master-plan-objective-cache.ts`
- Test: `test/master-plan-objective-cache.test.ts`

- [ ] **Step 1: Write failing cache tests**

Create `test/master-plan-objective-cache.test.ts` with tests for path, TTL, bounded snapshot, and blocked plan.

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
	buildMasterPlanObjectiveSnapshot,
	getCachedMasterPlanObjectiveSnapshot,
	resolveMasterPlanObjectiveCachePath,
} from "../src/master-plan-objective-cache.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-objective-cache-"));
}

test("objective cache path stays under stateRoot reports", () => {
	const root = tempRoot();
	assert.equal(
		resolveMasterPlanObjectiveCachePath(root),
		join(root, "reports", "master-plan-objective-cache.json"),
	);
});

test("buildMasterPlanObjectiveSnapshot bounds objective and blocks unapproved plan", () => {
	const snapshot = buildMasterPlanObjectiveSnapshot({
		projectId: "idu-pi",
		projectPath: "C:/repo",
		now: new Date("2026-06-05T00:00:00.000Z"),
		ttlMinutes: 60,
		plan: {
			status: "draft",
			inferredObjective: "x".repeat(1200),
			executiveSummary: "summary",
			criticalRisks: ["risk"],
		},
	});
	assert.equal(snapshot.planApproved, false);
	assert.equal(snapshot.blocked, true);
	assert.match(snapshot.blockReason, /not approved/u);
	assert.ok(snapshot.objective.length <= 500);
	assert.equal(snapshot.advisoryOnly, true);
});

test("getCachedMasterPlanObjectiveSnapshot refreshes stale cache and writes stateRoot-only", () => {
	const stateRoot = tempRoot();
	let calls = 0;
	const first = getCachedMasterPlanObjectiveSnapshot({
		stateRoot,
		projectId: "idu-pi",
		projectPath: "C:/repo",
		now: new Date("2026-06-05T00:00:00.000Z"),
		ttlMinutes: 60,
		loadPlan: () => {
			calls += 1;
			return {
				status: "approved",
				inferredObjective: "Idu-pi objective",
				executiveSummary: "summary",
				criticalRisks: [],
			};
		},
	});
	const second = getCachedMasterPlanObjectiveSnapshot({
		stateRoot,
		projectId: "idu-pi",
		projectPath: "C:/repo",
		now: new Date("2026-06-05T00:30:00.000Z"),
		ttlMinutes: 60,
		loadPlan: () => {
			calls += 1;
			return { status: "approved", inferredObjective: "new", criticalRisks: [] };
		},
	});
	assert.equal(calls, 1);
	assert.equal(second.objective, first.objective);
	const raw = readFileSync(resolveMasterPlanObjectiveCachePath(stateRoot), "utf8");
	assert.match(raw, /Idu-pi objective/u);
});
```

- [ ] **Step 2: Run failing cache tests**

Run:

```bash
corepack pnpm build && node --test dist/test/master-plan-objective-cache.test.js
```

Expected: build fails or tests fail because `src/master-plan-objective-cache.ts` does not exist.

- [ ] **Step 3: Implement objective cache module**

Create `src/master-plan-objective-cache.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type MasterPlanObjectiveSnapshot = {
	version: 1;
	projectId: string;
	projectPath: string;
	planStatus: string;
	planApproved: boolean;
	blocked: boolean;
	blockReason?: string;
	objective: string;
	summary: string;
	risks: string[];
	generatedAt: string;
	expiresAt: string;
	advisoryOnly: true;
};

type PlanLike = Record<string, unknown>;

export function resolveMasterPlanObjectiveCachePath(stateRoot: string): string {
	return join(stateRoot, "reports", "master-plan-objective-cache.json");
}

export function buildMasterPlanObjectiveSnapshot(input: {
	projectId: string;
	projectPath: string;
	plan: PlanLike;
	now?: Date;
	ttlMinutes?: number;
}): MasterPlanObjectiveSnapshot {
	const now = input.now ?? new Date();
	const ttlMinutes = input.ttlMinutes ?? 60;
	const status = String(input.plan.status ?? "unknown");
	const objective = boundText(
		String(input.plan.inferredObjective ?? input.plan.executiveSummary ?? "Objective unavailable."),
		500,
	);
	const summary = boundText(String(input.plan.executiveSummary ?? ""), 500);
	const risks = stringArray(input.plan.criticalRisks).slice(0, 8).map((item) => boundText(item, 180));
	const planApproved = status === "approved";
	const blocked = !planApproved || !objective.trim();
	return {
		version: 1,
		projectId: input.projectId,
		projectPath: input.projectPath,
		planStatus: status,
		planApproved,
		blocked,
		...(blocked ? { blockReason: planApproved ? "objective missing" : "plan not approved" } : {}),
		objective,
		summary,
		risks,
		generatedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString(),
		advisoryOnly: true,
	};
}

export function getCachedMasterPlanObjectiveSnapshot(input: {
	stateRoot: string;
	projectId: string;
	projectPath: string;
	loadPlan: () => PlanLike;
	now?: Date;
	ttlMinutes?: number;
}): MasterPlanObjectiveSnapshot {
	const now = input.now ?? new Date();
	const cached = readSnapshot(input.stateRoot);
	if (cached && Date.parse(cached.expiresAt) > now.getTime()) return cached;
	const snapshot = buildMasterPlanObjectiveSnapshot({
		projectId: input.projectId,
		projectPath: input.projectPath,
		plan: input.loadPlan(),
		now,
		ttlMinutes: input.ttlMinutes,
	});
	writeSnapshot(input.stateRoot, snapshot);
	return snapshot;
}

function readSnapshot(stateRoot: string): MasterPlanObjectiveSnapshot | undefined {
	const path = resolveMasterPlanObjectiveCachePath(stateRoot);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isSnapshot(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function writeSnapshot(stateRoot: string, snapshot: MasterPlanObjectiveSnapshot): void {
	const path = resolveMasterPlanObjectiveCachePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(snapshot, null, "\t")}\n`, "utf8");
}

function isSnapshot(value: unknown): value is MasterPlanObjectiveSnapshot {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.version === 1 && typeof record.expiresAt === "string" && typeof record.objective === "string";
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function boundText(value: string, maxChars: number): string {
	const normalized = value.replace(/\s+/gu, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 18)).trimEnd()}… [truncated]`;
}
```

- [ ] **Step 4: Verify cache tests pass**

Run:

```bash
corepack pnpm build && node --test dist/test/master-plan-objective-cache.test.js
```

Expected: all objective cache tests pass.

- [ ] **Step 5: Commit cache module**

```bash
git add src/master-plan-objective-cache.ts test/master-plan-objective-cache.test.ts
git commit -m "feat(idu): cache master plan objective"
```

---

### Task 2: Scheduler state lock and idempotency

**Files:**
- Create: `src/autonomous-alert-scheduler-state.ts`
- Test: `test/autonomous-alert-scheduler-state.test.ts`

- [ ] **Step 1: Write failing scheduler state tests**

Create tests covering lease and task idempotency.

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
	acquireAutonomousAlertSchedulerLock,
	markAutonomousAlertDecisionTaskCreated,
	readAutonomousAlertSchedulerState,
	resolveAutonomousAlertSchedulerStatePath,
} from "../src/autonomous-alert-scheduler-state.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-alert-scheduler-"));
}

test("scheduler state path stays under reports", () => {
	const root = tempRoot();
	assert.equal(
		resolveAutonomousAlertSchedulerStatePath(root),
		join(root, "reports", "autonomous-alert-scheduler-state.json"),
	);
});

test("scheduler lock skips second owner until lease expires", () => {
	const root = tempRoot();
	const first = acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "one",
		now: new Date("2026-06-05T00:00:00.000Z"),
		leaseMs: 60_000,
	});
	assert.equal(first.acquired, true);
	const second = acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "two",
		now: new Date("2026-06-05T00:00:30.000Z"),
		leaseMs: 60_000,
	});
	assert.equal(second.acquired, false);
	const third = acquireAutonomousAlertSchedulerLock(root, {
		ownerId: "three",
		now: new Date("2026-06-05T00:02:00.000Z"),
		leaseMs: 60_000,
	});
	assert.equal(third.acquired, true);
});

test("scheduler records decision to task idempotency", () => {
	const root = tempRoot();
	markAutonomousAlertDecisionTaskCreated(root, "decision-1", "task-1", new Date("2026-06-05T00:00:00.000Z"));
	const state = readAutonomousAlertSchedulerState(root);
	assert.equal(state.createdTaskIds["decision-1"], "task-1");
});
```

- [ ] **Step 2: Run failing scheduler state tests**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-scheduler-state.test.js
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement scheduler state**

Create `src/autonomous-alert-scheduler-state.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AutonomousAlertSchedulerState = {
	version: 1;
	lock?: { ownerId: string; acquiredAt: string; expiresAt: string };
	lastRunAt?: string;
	lastStatus?: string;
	createdTaskIds: Record<string, string>;
	updatedAt: string;
};

export function resolveAutonomousAlertSchedulerStatePath(stateRoot: string): string {
	return join(stateRoot, "reports", "autonomous-alert-scheduler-state.json");
}

export function readAutonomousAlertSchedulerState(stateRoot: string, now = new Date()): AutonomousAlertSchedulerState {
	const path = resolveAutonomousAlertSchedulerStatePath(stateRoot);
	if (!existsSync(path)) return emptyState(now);
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isState(parsed) ? parsed : emptyState(now);
	} catch {
		return emptyState(now);
	}
}

export function acquireAutonomousAlertSchedulerLock(
	stateRoot: string,
	input: { ownerId: string; now?: Date; leaseMs?: number },
): { acquired: boolean; state: AutonomousAlertSchedulerState; reason: "acquired" | "locked" } {
	const now = input.now ?? new Date();
	const leaseMs = input.leaseMs ?? 5 * 60 * 1000;
	const state = readAutonomousAlertSchedulerState(stateRoot, now);
	if (state.lock && Date.parse(state.lock.expiresAt) > now.getTime() && state.lock.ownerId !== input.ownerId) {
		return { acquired: false, state, reason: "locked" };
	}
	state.lock = {
		ownerId: input.ownerId,
		acquiredAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
	};
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return { acquired: true, state, reason: "acquired" };
}

export function markAutonomousAlertDecisionTaskCreated(
	stateRoot: string,
	decisionId: string,
	taskId: string,
	now = new Date(),
): AutonomousAlertSchedulerState {
	const state = readAutonomousAlertSchedulerState(stateRoot, now);
	state.createdTaskIds[decisionId] = taskId;
	state.lastRunAt = now.toISOString();
	state.lastStatus = "task_created";
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return state;
}

export function finishAutonomousAlertSchedulerRun(
	stateRoot: string,
	input: { ownerId: string; status: string; now?: Date },
): AutonomousAlertSchedulerState {
	const now = input.now ?? new Date();
	const state = readAutonomousAlertSchedulerState(stateRoot, now);
	if (state.lock?.ownerId === input.ownerId) delete state.lock;
	state.lastRunAt = now.toISOString();
	state.lastStatus = input.status;
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return state;
}

function writeState(stateRoot: string, state: AutonomousAlertSchedulerState): void {
	const path = resolveAutonomousAlertSchedulerStatePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
}

function emptyState(now: Date): AutonomousAlertSchedulerState {
	return { version: 1, createdTaskIds: {}, updatedAt: now.toISOString() };
}

function isState(value: unknown): value is AutonomousAlertSchedulerState {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.version === 1 && isStringRecord(record.createdTaskIds) && typeof record.updatedAt === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
		Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}
```

- [ ] **Step 4: Verify scheduler state tests pass**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-scheduler-state.test.js
```

Expected: all scheduler state tests pass.

- [ ] **Step 5: Commit scheduler state**

```bash
git add src/autonomous-alert-scheduler-state.ts test/autonomous-alert-scheduler-state.test.ts
git commit -m "feat(idu): add alert scheduler state"
```

---

### Task 3: Single scheduled executor

**Files:**
- Create: `src/autonomous-alert-scheduler.ts`
- Test: `test/autonomous-alert-scheduler.test.ts`

- [ ] **Step 1: Write executor tests**

Create tests with dependency injection to avoid heavy runtime coupling.

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { runAutonomousAlertScheduledTick } from "../src/autonomous-alert-scheduler.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-alert-executor-"));
}

test("scheduled executor skips when objective cache blocks", () => {
	const result = runAutonomousAlertScheduledTick({
		projectId: "idu-pi",
		projectPath: "C:/repo",
		stateRoot: tempRoot(),
		now: new Date("2026-06-05T00:00:00.000Z"),
		iduActive: true,
		loadPlan: () => ({ status: "draft", inferredObjective: "draft" }),
		loadTasks: () => [],
		loadSelfMaintenanceSignals: () => [],
		createTask: () => { throw new Error("must not create task"); },
	});
	assert.equal(result.status, "blocked_objective");
	assert.equal(result.tasksCreated.length, 0);
});

test("scheduled executor is read-only by default", () => {
	let created = 0;
	const result = runAutonomousAlertScheduledTick({
		projectId: "idu-pi",
		projectPath: "C:/repo",
		stateRoot: tempRoot(),
		now: new Date("2026-06-05T00:00:00.000Z"),
		iduActive: true,
		loadPlan: () => ({ status: "approved", inferredObjective: "Idu-pi supervisor" }),
		loadTasks: () => [
			{ id: "t1", text: "bug auth fails", status: "pending", priority: 3, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" },
		],
		loadSelfMaintenanceSignals: () => [],
		createTask: () => { created += 1; return { id: "new-task" }; },
	});
	assert.equal(result.allowTaskCreation, false);
	assert.equal(created, 0);
});
```

- [ ] **Step 2: Run failing executor tests**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-scheduler.test.js
```

Expected: fail because executor does not exist.

- [ ] **Step 3: Implement executor with dependency injection**

Create `src/autonomous-alert-scheduler.ts`. Reuse `buildAutonomousAlertEngineReport`, `readAutonomousAlertEngineState`, objective cache, and scheduler state.

Key implementation requirements:

```ts
export type AutonomousAlertScheduledTickStatus =
	| "ran"
	| "skipped_inactive"
	| "skipped_paused"
	| "skipped_locked"
	| "blocked_objective";
```

The implementation must:

- call `acquireAutonomousAlertSchedulerLock` before running decisions;
- call `getCachedMasterPlanObjectiveSnapshot` before creating tasks;
- return `blocked_objective` if `objective.blocked` is true;
- pass `allowTaskCreation === true` into the engine;
- create at most 3 tasks;
- skip task creation when a decision id already exists in scheduler state;
- call `markAutonomousAlertDecisionTaskCreated` after task creation;
- call `finishAutonomousAlertSchedulerRun` before returning.

- [ ] **Step 4: Verify executor tests pass**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-scheduler.test.js
```

Expected: executor tests pass.

- [ ] **Step 5: Commit executor**

```bash
git add src/autonomous-alert-scheduler.ts test/autonomous-alert-scheduler.test.ts
git commit -m "feat(idu): add alert scheduled executor"
```

---

### Task 4: CLI OS-priority command

**Files:**
- Modify: `src/cli.ts`
- Modify: `test/idu-cli.test.ts`
- Modify: `src/command-catalog.ts`
- Test: `test/idu-cli.test.ts`, `test/command-catalog.test.ts`

- [ ] **Step 1: Write CLI tests**

Add tests asserting:

- `alerts scheduled-tick` exists;
- default output says `allowTaskCreation: false`;
- command does not require Telegram;
- `alerts scheduled-tick --allow-task-creation` enables task creation mode but still uses caps/protected-domain gates.

- [ ] **Step 2: Run failing CLI tests**

```bash
corepack pnpm build && node --test --test-name-pattern "scheduled-tick|alert" dist/test/idu-cli.test.js dist/test/command-catalog.test.js
```

Expected: fail until command is wired.

- [ ] **Step 3: Wire CLI command**

In `src/cli.ts`, extend `handleCliAlertCommand`:

```ts
if (subcommand === "scheduled-tick") {
	return ok(
		formatCliAutonomousAlertScheduledTick(
			runCliAutonomousAlertScheduledTick(runtime, {
				allowTaskCreation: rest.includes("--allow-task-creation"),
			}),
		),
	);
}
```

Add a small wrapper that adapts existing CLI runtime to `runAutonomousAlertScheduledTick`. Keep Telegram out of this function.

- [ ] **Step 4: Update command catalog**

Add `alerts scheduled-tick` as a CLI/core scheduler command. Do not describe it as Telegram-based. Mention Telegram only as optional remote controls elsewhere.

- [ ] **Step 5: Verify CLI tests pass**

```bash
corepack pnpm build && node --test --test-name-pattern "scheduled-tick|alert" dist/test/idu-cli.test.js dist/test/command-catalog.test.js
```

Expected: scheduled CLI tests pass.

- [ ] **Step 6: Commit CLI command**

```bash
git add src/cli.ts test/idu-cli.test.ts src/command-catalog.ts test/command-catalog.test.ts
git commit -m "feat(idu): expose alert scheduled tick cli"
```

---

### Task 5: Telegram optionality audit tests

**Files:**
- Modify/Create: `test/autonomous-alert-scheduler.test.ts`
- Modify/Create: `test/mcp-server.test.ts` only if needed

- [ ] **Step 1: Add import-boundary audit test**

Add a test that reads scheduler/core files and asserts they do not import `index.ts` or Telegram-specific APIs.

```ts
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("scheduled alert core does not depend on Telegram entrypoint", () => {
	const scheduler = readFileSync("src/autonomous-alert-scheduler.ts", "utf8");
	assert.doesNotMatch(scheduler, /\.\/index\.js/u);
	assert.doesNotMatch(scheduler, /Telegraf|telegram/iu);
});
```

- [ ] **Step 2: Run audit test**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-scheduler.test.js
```

Expected: pass.

- [ ] **Step 3: Commit audit test**

```bash
git add test/autonomous-alert-scheduler.test.ts
git commit -m "test(idu): prove alert scheduler is telegram independent"
```

---

### Task 6: Full verification and fresh review

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run LSP diagnostics**

Run LSP diagnostics on touched files. Expected: 0 diagnostics.

- [ ] **Step 2: Run full gate**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: all tests pass, zero diff-check errors.

- [ ] **Step 3: Run Idu postflight with local-only ignore**

Use `ignoredFiles:["context.md"]`. Expected: no unexpected functional changes beyond planned files.

- [ ] **Step 4: Fresh reviewer**

Ask reviewer to verify:

- objective cache is native and bounded;
- scheduled executor uses cache before decisions;
- OS/CLI path works without Telegram;
- lock/lease/idempotency prevents duplicate task creation;
- bridge interval is not enabled;
- default scheduled tick is read-only;
- protected domains escalate to human;
- no AgentLabs/dependencies/rules/skills/contracts mutation.

- [ ] **Step 5: Push only after PASS**

```bash
git status --short
git push origin feat/idu-context-pressure
```

Expected: `context.md` remains local-only and uncommitted.
