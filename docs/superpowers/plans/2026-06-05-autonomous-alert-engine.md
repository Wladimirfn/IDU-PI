# Autonomous Alert Engine v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Idu-pi Autonomous Alert Engine v1 so existing supervisor signals can produce bounded routine micro-tasks, human escalations, and raw-honesty reports without waiting for manual prompts.

**Architecture:** Add a focused pure engine module for alert decisions, a small stateRoot-only ledger/control module, and MCP tools for status/tick/control. Reuse existing self-maintenance, usage, supervisor activity, semantic audit, AgentLab effectiveness, and structured task queue surfaces; never implement code changes, run AgentLabs, update dependencies, or mutate rules/skills/contracts from this engine.

**Tech Stack:** TypeScript, Node.js built-ins (`fs`, `path`), existing MCP envelope patterns, existing `StructuredTaskQueue`, Node test runner.

---

## File Structure

- Create: `src/autonomous-alert-engine.ts`
  - Pure alert decision builder.
  - Raw honesty contract.
  - Control state validation and cooldown/dedup helpers.
  - No filesystem writes.

- Create: `src/autonomous-alert-engine-state.ts`
  - StateRoot-only control and ledger persistence.
  - Paths:
    - `reports/autonomous-alert-engine-state.json`
    - `reports/autonomous-alert-decisions.jsonl`
  - No repo writes.

- Modify: `src/mcp-server.ts`
  - Add MCP tools:
    - `idu_autonomous_alerts_status`
    - `idu_autonomous_alerts_tick`
    - `idu_autonomous_alerts_control`
  - Wire read/status, tick with optional capped task creation, and safe control writes.

- Modify: `src/cli.ts`
  - Add runtime methods only if required by MCP dispatch type compatibility.
  - Prefer keeping implementation in MCP helper functions to avoid CLI scope creep.

- Create: `test/autonomous-alert-engine.test.ts`
  - Pure builder tests.

- Create: `test/autonomous-alert-engine-state.test.ts`
  - State path/control/ledger tests.

- Modify: `test/mcp-server.test.ts`
  - MCP status/tick/control tests.

---

## Task 1: Pure alert decision builder

**Files:**
- Create: `src/autonomous-alert-engine.ts`
- Test: `test/autonomous-alert-engine.test.ts`

- [ ] **Step 1: Write failing tests for raw honesty, repeated bug, high-risk escalation, and cooldown suppression**

Create `test/autonomous-alert-engine.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StructuredTask } from "../src/structured-task-queue.js";
import {
	buildAutonomousAlertEngineReport,
	type AutonomousAlertControlState,
} from "../src/autonomous-alert-engine.js";

function task(id: string, text: string, status: StructuredTask["status"] = "pending"): StructuredTask {
	return {
		id,
		text,
		category: "bug",
		priority: 3,
		status,
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		projectId: "idu-pi",
	};
}

const activeControl: AutonomousAlertControlState = {
	version: 1,
	active: true,
	disabledDomains: [],
	updatedAt: "2026-06-05T00:00:00.000Z",
};

test("autonomous alert report includes raw honesty contract", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [],
		selfMaintenanceSignals: [],
		allowTaskCreation: false,
	});

	assert.equal(report.rawHonesty, true);
	assert.equal(report.noImplementation, true);
	assert.equal(report.agentLabsExecuted, false);
	assert.equal(report.rulesApplied, false);
	assert.equal(report.skillsModified, false);
	assert.equal(report.contractsModified, false);
	assert.equal(report.dependenciesUpdated, false);
});

test("repeated bug threshold creates low risk task draft", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "postflight context.md bug repeated"),
			task("bug-2", "postflight context.md bug repeated again"),
			task("bug-3", "postflight local-only bug regression"),
			task("bug-4", "postflight local-only bug keeps returning"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find((item) => item.domain === "repeated_bug");
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "create_task");
	assert.equal(decision.requiresHuman, false);
	assert.equal(decision.taskDraft?.guardRisk, "low");
	assert.match(decision.taskDraft?.text ?? "", /regression test/u);
	assert.ok(decision.uncomfortableTruths.length > 0);
});

test("security and db repeated bugs escalate to human without task draft", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "security db auth bug repeated"),
			task("bug-2", "security db auth bug repeated again"),
			task("bug-3", "security db schema bug returned"),
			task("bug-4", "security db schema bug returned again"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
	});

	const decision = report.decisions.find((item) => item.domain === "repeated_bug");
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "ask_human");
	assert.equal(decision.requiresHuman, true);
	assert.equal(decision.taskDraft, undefined);
});

test("cooldown suppresses duplicate task creation", () => {
	const report = buildAutonomousAlertEngineReport({
		projectId: "idu-pi",
		now: new Date("2026-06-05T00:00:00.000Z"),
		control: activeControl,
		tasks: [
			task("bug-1", "telegram bug repeated"),
			task("bug-2", "telegram bug repeated"),
			task("bug-3", "telegram bug repeated"),
			task("bug-4", "telegram bug repeated"),
		],
		selfMaintenanceSignals: [],
		allowTaskCreation: true,
		cooldowns: {
			"repeated_bug:telegram": "2026-06-06T00:00:00.000Z",
		},
	});

	const decision = report.decisions.find((item) => item.domain === "repeated_bug");
	assert.ok(decision);
	assert.equal(decision.recommendedAction, "snooze");
	assert.equal(report.suppressedByCooldown.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-engine.test.js
```

Expected: FAIL because `src/autonomous-alert-engine.ts` does not exist.

- [ ] **Step 3: Implement pure builder**

Create `src/autonomous-alert-engine.ts`:

```ts
import type {
	StructuredTask,
	StructuredTaskInput,
} from "./structured-task-queue.js";
import type { SupervisorSelfMaintenanceSignal } from "./supervisor-self-maintenance-advisory.js";

export type AutonomousAlertDomain =
	| "repeated_bug"
	| "backlog"
	| "stale_work"
	| "neglected_area"
	| "bibliotecario"
	| "security"
	| "db"
	| "optimization"
	| "semantic_audit"
	| "agentlab";

export type AutonomousAlertSeverity = "info" | "warning" | "high";
export type AutonomousAlertRecommendedAction =
	| "create_task"
	| "report_only"
	| "ask_human"
	| "snooze"
	| "blocked_by_pause";

export type RawHonestyTruth = {
	claim: string;
	evidenceRefs: string[];
	impact: string;
	requiredNext: string;
	omittedComfort?: string;
};

export type AutonomousAlertControlState = {
	version: 1;
	active: boolean;
	pausedUntil?: string;
	disabledDomains: string[];
	reason?: string;
	updatedAt: string;
};

export type AutonomousAlertTaskDraft = {
	text: string;
	category: StructuredTaskInput["category"];
	priority: number;
	guardRisk: "low" | "medium" | "high";
	evidenceRefs: string[];
};

export type AutonomousAlertDecision = {
	version: 1;
	id: string;
	generatedAt: string;
	projectId: string;
	authority: "advisory";
	domain: AutonomousAlertDomain;
	severity: AutonomousAlertSeverity;
	confidence: number;
	evidenceRefs: string[];
	rawHonesty: true;
	uncomfortableTruths: RawHonestyTruth[];
	recommendedAction: AutonomousAlertRecommendedAction;
	taskDraft?: AutonomousAlertTaskDraft;
	cooldownKey: string;
	cooldownUntil?: string;
	requiresHuman: boolean;
	forbiddenActions: string[];
};

export type AutonomousAlertEngineReport = {
	version: 1;
	authority: "advisory";
	mode: "autonomous_detection";
	generatedAt: string;
	projectId: string;
	active: boolean;
	paused: boolean;
	noImplementation: true;
	agentLabsExecuted: false;
	rulesApplied: false;
	skillsModified: false;
	contractsModified: false;
	dependenciesUpdated: false;
	rawHonesty: true;
	uncomfortableTruths: RawHonestyTruth[];
	decisions: AutonomousAlertDecision[];
	tasksCreated: Array<{ taskId: string; alertId: string; evidenceRefs: string[] }>;
	humanEscalations: AutonomousAlertDecision[];
	suppressedByCooldown: AutonomousAlertDecision[];
	safeNotes: string[];
};

export type BuildAutonomousAlertEngineReportInput = {
	projectId: string;
	now?: Date;
	control: AutonomousAlertControlState;
	tasks: readonly StructuredTask[];
	selfMaintenanceSignals: readonly SupervisorSelfMaintenanceSignal[];
	allowTaskCreation: boolean;
	cooldowns?: Record<string, string>;
};

const FORBIDDEN_ACTIONS = [
	"no_code_implementation",
	"no_agentlabs_execution",
	"no_dependency_updates",
	"no_rule_changes",
	"no_skill_changes",
	"no_contract_changes",
] as const;

const REPEATED_BUG_KEYWORDS = [
	"postflight",
	"telegram",
	"bibliotecario",
	"agentlab",
	"context",
	"source",
	"skill",
	"security",
	"db",
	"auth",
] as const;

const HIGH_RISK_WORDS = /\b(security|auth|db|database|schema|migration|contract|rule|skill|dependency|npm|core)\b/iu;

export function buildAutonomousAlertEngineReport(
	input: BuildAutonomousAlertEngineReportInput,
): AutonomousAlertEngineReport {
	const now = input.now ?? new Date();
	const generatedAt = now.toISOString();
	const paused = isPaused(input.control, now);
	const decisions: AutonomousAlertDecision[] = [];

	if (!input.control.active || paused) {
		const blocked = blockedDecision(input, generatedAt, paused);
		decisions.push(blocked);
		return baseReport(input, generatedAt, paused, decisions);
	}

	const repeatedBug = repeatedBugDecision(input, generatedAt, now);
	if (repeatedBug) decisions.push(repeatedBug);

	for (const signal of input.selfMaintenanceSignals) {
		const decision = decisionFromSelfMaintenanceSignal(input, signal, generatedAt, now);
		if (decision) decisions.push(decision);
	}

	return baseReport(input, generatedAt, paused, decisions);
}

function baseReport(
	input: BuildAutonomousAlertEngineReportInput,
	generatedAt: string,
	paused: boolean,
	decisions: AutonomousAlertDecision[],
): AutonomousAlertEngineReport {
	const uncomfortableTruths = decisions.flatMap((decision) => decision.uncomfortableTruths);
	return {
		version: 1,
		authority: "advisory",
		mode: "autonomous_detection",
		generatedAt,
		projectId: input.projectId,
		active: input.control.active,
		paused,
		noImplementation: true,
		agentLabsExecuted: false,
		rulesApplied: false,
		skillsModified: false,
		contractsModified: false,
		dependenciesUpdated: false,
		rawHonesty: true,
		uncomfortableTruths,
		decisions,
		tasksCreated: [],
		humanEscalations: decisions.filter((decision) => decision.requiresHuman),
		suppressedByCooldown: decisions.filter((decision) => decision.recommendedAction === "snooze"),
		safeNotes: [
			"Autonomous alerts are detection/task-routing only; no implementation was performed.",
			"AgentLabs, dependencies, rules, skills, and contracts were not modified.",
		],
	};
}

function repeatedBugDecision(
	input: BuildAutonomousAlertEngineReportInput,
	generatedAt: string,
	now: Date,
): AutonomousAlertDecision | undefined {
	const projectTasks = input.tasks.filter((task) => !task.projectId || task.projectId === input.projectId);
	const counts = new Map<string, StructuredTask[]>();
	for (const task of projectTasks) {
		const text = task.text.toLowerCase();
		if (!/\b(bug|fail|failure|error|regression|repeated)\b/u.test(text)) continue;
		for (const keyword of REPEATED_BUG_KEYWORDS) {
			if (text.includes(keyword)) {
				const list = counts.get(keyword) ?? [];
				list.push(task);
				counts.set(keyword, list);
			}
		}
	}
	const match = [...counts.entries()].find(([, tasks]) => tasks.length >= 4);
	if (!match) return undefined;
	const [keyword, tasks] = match;
	const cooldownKey = `repeated_bug:${keyword}`;
	const cooldownUntil = input.cooldowns?.[cooldownKey];
	const evidenceRefs = tasks.slice(0, 6).map((task) => `structured-task:${task.id}`);
	const highRisk = tasks.some((task) => HIGH_RISK_WORDS.test(task.text));
	const inCooldown = cooldownActive(cooldownUntil, now);
	const recommendedAction: AutonomousAlertRecommendedAction = inCooldown
		? "snooze"
		: highRisk
			? "ask_human"
			: input.allowTaskCreation
				? "create_task"
				: "report_only";
	return {
		version: 1,
		id: `alert-${cooldownKey}`,
		generatedAt,
		projectId: input.projectId,
		authority: "advisory",
		domain: "repeated_bug",
		severity: highRisk ? "high" : "warning",
		confidence: 0.85,
		evidenceRefs,
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: `The same ${keyword} bug/failure pattern appeared ${tasks.length} times. Treating these as isolated incidents is process drift.`,
				evidenceRefs,
				impact: "Repeated failures waste review time and hide missing regression coverage.",
				requiredNext: highRisk
					? "Ask the human before changing high-risk areas."
					: "Create a focused investigation task and add or verify a regression test.",
				omittedComfort: "The report will not call this normal backlog noise.",
			},
		],
		recommendedAction,
		...(recommendedAction === "create_task"
			? {
					taskDraft: {
						text: `Investigate repeated ${keyword} bug pattern and add or verify a regression test. Evidence: ${evidenceRefs.join(", ")}`,
						category: "bug",
						priority: 3,
						guardRisk: "low" as const,
						evidenceRefs,
					},
				}
			: {}),
		cooldownKey,
		...(cooldownUntil ? { cooldownUntil } : {}),
		requiresHuman: highRisk,
		forbiddenActions: [...FORBIDDEN_ACTIONS],
	};
}

function decisionFromSelfMaintenanceSignal(
	input: BuildAutonomousAlertEngineReportInput,
	signal: SupervisorSelfMaintenanceSignal,
	generatedAt: string,
	now: Date,
): AutonomousAlertDecision | undefined {
	const domain = mapSignalDomain(signal.category);
	if (!domain || input.control.disabledDomains.includes(domain)) return undefined;
	const cooldownKey = `${domain}:${signal.id}`;
	const cooldownUntil = input.cooldowns?.[cooldownKey];
	const inCooldown = cooldownActive(cooldownUntil, now);
	const highRisk = signal.severity === "high";
	const recommendedAction: AutonomousAlertRecommendedAction = inCooldown
		? "snooze"
		: highRisk
			? "ask_human"
			: input.allowTaskCreation
				? "create_task"
				: "report_only";
	return {
		version: 1,
		id: `alert-${cooldownKey}`,
		generatedAt,
		projectId: input.projectId,
		authority: "advisory",
		domain,
		severity: signal.severity,
		confidence: signal.confidence,
		evidenceRefs: signal.evidenceRefs,
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: signal.summary,
				evidenceRefs: signal.evidenceRefs,
				impact: "Ignoring this signal makes the project less reliable and less centered on the Master Plan.",
				requiredNext: highRisk ? "Ask the human before high-impact action." : signal.recommendedActions[0] ?? "Create a bounded follow-up task.",
			},
		],
		recommendedAction,
		...(recommendedAction === "create_task"
			? {
					taskDraft: {
						text: `${signal.summary}. Evidence: ${signal.evidenceRefs.join(", ")}`,
						category: "maintenance",
						priority: 4,
						guardRisk: "medium" as const,
						evidenceRefs: signal.evidenceRefs,
					},
				}
			: {}),
		cooldownKey,
		...(cooldownUntil ? { cooldownUntil } : {}),
		requiresHuman: highRisk,
		forbiddenActions: [...FORBIDDEN_ACTIONS],
	};
}

function mapSignalDomain(category: SupervisorSelfMaintenanceSignal["category"]): AutonomousAlertDomain | undefined {
	if (category === "backlog_pressure") return "backlog";
	if (category === "stale_tasks") return "stale_work";
	if (category === "neglected_areas") return "neglected_area";
	if (category === "semantic_audit_pressure") return "semantic_audit";
	if (category === "supervisor_activity_pressure") return "agentlab";
	return undefined;
}

function blockedDecision(
	input: BuildAutonomousAlertEngineReportInput,
	generatedAt: string,
	paused: boolean,
): AutonomousAlertDecision {
	const reason = paused ? "Alert engine is paused." : "Alert engine is inactive.";
	return {
		version: 1,
		id: "alert-engine-blocked",
		generatedAt,
		projectId: input.projectId,
		authority: "advisory",
		domain: "backlog",
		severity: "info",
		confidence: 1,
		evidenceRefs: ["alert-engine:control-state"],
		rawHonesty: true,
		uncomfortableTruths: [
			{
				claim: reason,
				evidenceRefs: ["alert-engine:control-state"],
				impact: "No autonomous alert tasks will be created while control state blocks the engine.",
				requiredNext: "Enable or resume alerts if autonomous supervision is desired.",
			},
		],
		recommendedAction: "blocked_by_pause",
		cooldownKey: "alert-engine:blocked",
		requiresHuman: false,
		forbiddenActions: [...FORBIDDEN_ACTIONS],
	};
}

function isPaused(control: AutonomousAlertControlState, now: Date): boolean {
	return Boolean(control.pausedUntil && Date.parse(control.pausedUntil) > now.getTime());
}

function cooldownActive(value: string | undefined, now: Date): boolean {
	return Boolean(value && Date.parse(value) > now.getTime());
}
```

- [ ] **Step 4: Run pure tests**

Run:

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-engine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous-alert-engine.ts test/autonomous-alert-engine.test.ts
git commit -m "feat(idu): add autonomous alert decisions"
```

---

## Task 2: StateRoot control and ledger

**Files:**
- Create: `src/autonomous-alert-engine-state.ts`
- Test: `test/autonomous-alert-engine-state.test.ts`

- [ ] **Step 1: Write failing state tests**

Create `test/autonomous-alert-engine-state.test.ts`:

```ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	appendAutonomousAlertDecision,
	defaultAutonomousAlertControlState,
	readAutonomousAlertEngineState,
	resolveAutonomousAlertDecisionLogPath,
	resolveAutonomousAlertEngineStatePath,
	updateAutonomousAlertControlState,
} from "../src/autonomous-alert-engine-state.js";
import type { AutonomousAlertDecision } from "../src/autonomous-alert-engine.js";

test("alert engine state paths stay under stateRoot reports", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		assert.equal(resolveAutonomousAlertEngineStatePath(root), join(root, "reports", "autonomous-alert-engine-state.json"));
		assert.equal(resolveAutonomousAlertDecisionLogPath(root), join(root, "reports", "autonomous-alert-decisions.jsonl"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("default state is active with no disabled domains", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		const state = readAutonomousAlertEngineState(root, new Date("2026-06-05T00:00:00.000Z"));
		assert.deepEqual(state.control, defaultAutonomousAlertControlState(new Date("2026-06-05T00:00:00.000Z")));
		assert.deepEqual(state.cooldowns, {});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("control updates write only alert state", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		const state = updateAutonomousAlertControlState(root, { active: false, reason: "user stop" }, new Date("2026-06-05T00:00:00.000Z"));
		assert.equal(state.control.active, false);
		assert.equal(state.control.reason, "user stop");
		assert.equal(existsSync(resolveAutonomousAlertEngineStatePath(root)), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("append decision records jsonl and cooldown", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-state-"));
	try {
		const decision: AutonomousAlertDecision = {
			version: 1,
			id: "alert-repeated_bug:telegram",
			generatedAt: "2026-06-05T00:00:00.000Z",
			projectId: "idu-pi",
			authority: "advisory",
			domain: "repeated_bug",
			severity: "warning",
			confidence: 0.9,
			evidenceRefs: ["structured-task:1"],
			rawHonesty: true,
			uncomfortableTruths: [],
			recommendedAction: "create_task",
			cooldownKey: "repeated_bug:telegram",
			requiresHuman: false,
			forbiddenActions: [],
		};
		const state = appendAutonomousAlertDecision(root, decision, new Date("2026-06-05T00:00:00.000Z"));
		assert.equal(state.cooldowns["repeated_bug:telegram"], "2026-06-06T00:00:00.000Z");
		const log = readFileSync(resolveAutonomousAlertDecisionLogPath(root), "utf8");
		assert.match(log, /alert-repeated_bug:telegram/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-engine-state.test.js
```

Expected: FAIL because state module does not exist.

- [ ] **Step 3: Implement state module**

Create `src/autonomous-alert-engine-state.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	AutonomousAlertControlState,
	AutonomousAlertDecision,
} from "./autonomous-alert-engine.js";

export type AutonomousAlertEngineState = {
	version: 1;
	control: AutonomousAlertControlState;
	cooldowns: Record<string, string>;
	createdTaskIds: Record<string, string>;
	updatedAt: string;
};

export function resolveAutonomousAlertEngineStatePath(stateRoot: string): string {
	return join(stateRoot, "reports", "autonomous-alert-engine-state.json");
}

export function resolveAutonomousAlertDecisionLogPath(stateRoot: string): string {
	return join(stateRoot, "reports", "autonomous-alert-decisions.jsonl");
}

export function defaultAutonomousAlertControlState(now: Date): AutonomousAlertControlState {
	return {
		version: 1,
		active: true,
		disabledDomains: [],
		updatedAt: now.toISOString(),
	};
}

export function readAutonomousAlertEngineState(stateRoot: string, now = new Date()): AutonomousAlertEngineState {
	const filePath = resolveAutonomousAlertEngineStatePath(stateRoot);
	if (!existsSync(filePath)) return emptyState(now);
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		if (!isState(parsed)) return emptyState(now);
		return parsed;
	} catch {
		return emptyState(now);
	}
}

export function updateAutonomousAlertControlState(
	stateRoot: string,
	patch: Partial<Pick<AutonomousAlertControlState, "active" | "pausedUntil" | "disabledDomains" | "reason">>,
	now = new Date(),
): AutonomousAlertEngineState {
	const state = readAutonomousAlertEngineState(stateRoot, now);
	state.control = {
		...state.control,
		...(typeof patch.active === "boolean" ? { active: patch.active } : {}),
		...(patch.pausedUntil ? { pausedUntil: patch.pausedUntil } : {}),
		...(patch.disabledDomains ? { disabledDomains: [...new Set(patch.disabledDomains)] } : {}),
		...(patch.reason ? { reason: patch.reason } : {}),
		updatedAt: now.toISOString(),
	};
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return state;
}

export function appendAutonomousAlertDecision(
	stateRoot: string,
	decision: AutonomousAlertDecision,
	now = new Date(),
): AutonomousAlertEngineState {
	const state = readAutonomousAlertEngineState(stateRoot, now);
	state.cooldowns[decision.cooldownKey] = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	const logPath = resolveAutonomousAlertDecisionLogPath(stateRoot);
	mkdirSync(dirname(logPath), { recursive: true });
	appendFileSync(logPath, `${JSON.stringify(decision)}\n`, "utf8");
	return state;
}

function writeState(stateRoot: string, state: AutonomousAlertEngineState): void {
	const filePath = resolveAutonomousAlertEngineStatePath(stateRoot);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
}

function emptyState(now: Date): AutonomousAlertEngineState {
	return {
		version: 1,
		control: defaultAutonomousAlertControlState(now),
		cooldowns: {},
		createdTaskIds: {},
		updatedAt: now.toISOString(),
	};
}

function isState(value: unknown): value is AutonomousAlertEngineState {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.version === 1 && isControl(record.control) && isStringRecord(record.cooldowns) && isStringRecord(record.createdTaskIds) && typeof record.updatedAt === "string";
}

function isControl(value: unknown): value is AutonomousAlertControlState {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.version === 1 && typeof record.active === "boolean" && Array.isArray(record.disabledDomains) && record.disabledDomains.every((item) => typeof item === "string") && typeof record.updatedAt === "string";
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}
```

- [ ] **Step 4: Run state tests**

```bash
corepack pnpm build && node --test dist/test/autonomous-alert-engine-state.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous-alert-engine-state.ts test/autonomous-alert-engine-state.test.ts
git commit -m "feat(idu): persist alert control state"
```

---

## Task 3: MCP status and control tools

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP tests for tool list, status read-only, and control state write**

Append to `test/mcp-server.test.ts` near other MCP tool tests:

```ts
test("autonomous alert MCP tools are listed", () => {
	const tools = listIduMcpTools().map((tool) => tool.name);
	assert.ok(tools.includes("idu_autonomous_alerts_status"));
	assert.ok(tools.includes("idu_autonomous_alerts_tick"));
	assert.ok(tools.includes("idu_autonomous_alerts_control"));
});

test("idu_autonomous_alerts_status is read-only and raw honest", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-status-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		const result = await callIduMcpTool("idu_autonomous_alerts_status", {}, {
			runtimeFactory: () => runtime,
			projectResolver: () => ({ ...registered(), stateRoot }),
		});
		assert.equal(result.ok, true);
		assert.equal(result.data.report.rawHonesty, true);
		assert.equal(result.data.report.noImplementation, true);
		assert.equal(existsSync(stateRoot), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_autonomous_alerts_control writes only alert control state", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-control-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		const result = await callIduMcpTool("idu_autonomous_alerts_control", { action: "disable", reason: "user stop" }, {
			runtimeFactory: () => runtime,
			projectResolver: () => ({ ...registered(), stateRoot }),
		});
		assert.equal(result.ok, true);
		assert.equal(result.data.state.control.active, false);
		assert.equal(existsSync(join(stateRoot, "reports", "autonomous-alert-engine-state.json")), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm build && node --test --test-name-pattern "autonomous alert" dist/test/mcp-server.test.js
```

Expected: FAIL because MCP tools are missing.

- [ ] **Step 3: Add tool names, schemas, and handlers**

In `src/mcp-server.ts`:

1. Add imports:

```ts
import { buildAutonomousAlertEngineReport } from "./autonomous-alert-engine.js";
import {
	readAutonomousAlertEngineState,
	updateAutonomousAlertControlState,
} from "./autonomous-alert-engine-state.js";
```

2. Add tool names to the `IduMcpToolName` union:

```ts
| "idu_autonomous_alerts_status"
| "idu_autonomous_alerts_tick"
| "idu_autonomous_alerts_control"
```

3. Add tool definitions in `listIduMcpTools()` using the existing definition style:

```ts
{
	name: "idu_autonomous_alerts_status",
	description: "Read autonomous alert engine status and raw-honesty report; advisory-only, no writes.",
	inputSchema: projectPathOnlySchema(),
},
{
	name: "idu_autonomous_alerts_tick",
	description: "Evaluate autonomous alerts and optionally create capped low/medium-risk tasks; no implementation or AgentLabs.",
	inputSchema: {
		type: "object",
		properties: {
			projectPath: { type: "string" },
			allowTaskCreation: { type: "boolean" },
		},
		additionalProperties: false,
	},
},
{
	name: "idu_autonomous_alerts_control",
	description: "Enable, disable, pause, resume, or domain-control autonomous alerts using stateRoot-only control state.",
	inputSchema: {
		type: "object",
		properties: {
			projectPath: { type: "string" },
			action: { type: "string", enum: ["enable", "disable", "pause", "resume", "disable_domain", "enable_domain"] },
			domain: { type: "string" },
			pauseMinutes: { type: "number" },
			reason: { type: "string" },
		},
		required: ["action"],
		additionalProperties: false,
	},
},
```

4. Add handlers before self-maintenance or near supervisor tools:

```ts
case "idu_autonomous_alerts_status": {
	const stateRoot = requireRegisteredStateRoot(resolution, runtime);
	const state = readAutonomousAlertEngineState(stateRoot);
	const taskRead = readRuntimeStructuredTasks(runtime);
	const report = buildAutonomousAlertEngineReport({
		projectId: runtime.projectId,
		control: state.control,
		tasks: taskRead.tasks,
		selfMaintenanceSignals: [],
		allowTaskCreation: false,
		cooldowns: state.cooldowns,
	});
	return envelope({
		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Autonomous alert status: ${report.decisions.length} decision(s).`,
		data: { report, state },
		safeNotes: [...resolution.safeNotes, ...report.safeNotes, "Status read-only: no alert state, tasks, AgentLabs, rules, skills, contracts, or dependencies were changed."],
	});
}
case "idu_autonomous_alerts_control": {
	const stateRoot = requireRegisteredStateRoot(resolution, runtime);
	const action = requiredText(args, "action");
	const current = readAutonomousAlertEngineState(stateRoot);
	const now = new Date();
	let disabledDomains = current.control.disabledDomains;
	if (action === "disable_domain") disabledDomains = [...new Set([...disabledDomains, requiredText(args, "domain")])];
	if (action === "enable_domain") disabledDomains = disabledDomains.filter((domain) => domain !== requiredText(args, "domain"));
	const state = updateAutonomousAlertControlState(stateRoot, {
		active: action === "enable" ? true : action === "disable" ? false : current.control.active,
		pausedUntil: action === "pause" ? new Date(now.getTime() + positiveIntegerArg(args, "pauseMinutes", 60) * 60 * 1000).toISOString() : action === "resume" ? "1970-01-01T00:00:00.000Z" : current.control.pausedUntil,
		disabledDomains,
		reason: stringArg(args, "reason") ?? action,
	}, now);
	return envelope({
		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Autonomous alerts control updated: ${action}`,
		data: { state },
		safeNotes: [...resolution.safeNotes, "Control write is stateRoot-only; no repo files, tasks, AgentLabs, rules, skills, contracts, or dependencies were changed."],
	});
}
```

If `requireRegisteredStateRoot` or `positiveIntegerArg` signatures differ, adapt using existing helper patterns in `idu_external_intelligence_report` and `idu_bibliotecario_proactive_advisory`.

- [ ] **Step 4: Run MCP focused tests**

```bash
corepack pnpm build && node --test --test-name-pattern "autonomous alert" dist/test/mcp-server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "feat(idu): expose autonomous alert controls"
```

---

## Task 4: MCP tick creates capped routine tasks and escalates high-risk alerts

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `src/autonomous-alert-engine-state.ts`
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP tick tests**

Append tests:

```ts
test("idu_autonomous_alerts_tick creates one routine repeated bug task", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-tick-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `telegram bug repeated ${index}`);
		}
		const result = await callIduMcpTool("idu_autonomous_alerts_tick", { allowTaskCreation: true }, {
			runtimeFactory: () => runtime,
			projectResolver: () => ({ ...registered(), stateRoot }),
		});
		assert.equal(result.ok, true);
		assert.equal(result.data.report.tasksCreated.length, 1);
		assert.equal(runtime.listTasks().some((task) => /regression test/u.test(task.text)), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("idu_autonomous_alerts_tick escalates high-risk repeated bug without task", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-tick-high-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		for (let index = 0; index < 4; index += 1) {
			runtime.createTask("bug", `security db auth bug repeated ${index}`);
		}
		const before = runtime.listTasks().length;
		const result = await callIduMcpTool("idu_autonomous_alerts_tick", { allowTaskCreation: true }, {
			runtimeFactory: () => runtime,
			projectResolver: () => ({ ...registered(), stateRoot }),
		});
		assert.equal(result.ok, true);
		assert.equal(result.data.report.humanEscalations.length, 1);
		assert.equal(runtime.listTasks().length, before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
corepack pnpm build && node --test --test-name-pattern "idu_autonomous_alerts_tick" dist/test/mcp-server.test.js
```

Expected: FAIL because tick does not create tasks yet.

- [ ] **Step 3: Add task creation helper in MCP handler**

In `idu_autonomous_alerts_tick` handler:

```ts
case "idu_autonomous_alerts_tick": {
	const stateRoot = requireRegisteredStateRoot(resolution, runtime);
	const state = readAutonomousAlertEngineState(stateRoot);
	const taskRead = readRuntimeStructuredTasks(runtime);
	const allowTaskCreation = booleanArg(args, "allowTaskCreation") === true;
	const report = buildAutonomousAlertEngineReport({
		projectId: runtime.projectId,
		control: state.control,
		tasks: taskRead.tasks,
		selfMaintenanceSignals: [],
		allowTaskCreation,
		cooldowns: state.cooldowns,
	});
	const created: Array<{ taskId: string; alertId: string; evidenceRefs: string[] }> = [];
	if (allowTaskCreation) {
		for (const decision of report.decisions.filter((item) => item.recommendedAction === "create_task" && item.taskDraft).slice(0, 3)) {
			const task = runtime.createTask(decision.taskDraft!.category, decision.taskDraft!.text);
			created.push({ taskId: task.id, alertId: decision.id, evidenceRefs: decision.evidenceRefs });
			appendAutonomousAlertDecision(stateRoot, decision);
		}
	}
	const finalReport = { ...report, tasksCreated: created };
	return envelope({
		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `Autonomous alert tick: ${created.length} task(s) created, ${finalReport.humanEscalations.length} escalation(s).`,
		data: { report: finalReport },
		safeNotes: [...resolution.safeNotes, ...finalReport.safeNotes, "Tick may create capped routine tasks only; it did not implement code, run AgentLabs, update dependencies, or mutate rules/skills/contracts."],
	});
}
```

If `runtime.createTask` signature requires `(category, text)`, use exactly that existing pattern from tests. If it returns a plain task, use `task.id`.

- [ ] **Step 4: Run tick tests**

```bash
corepack pnpm build && node --test --test-name-pattern "idu_autonomous_alerts_tick" dist/test/mcp-server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts src/autonomous-alert-engine-state.ts test/mcp-server.test.ts
git commit -m "feat(idu): create capped alert tasks"
```

---

## Task 5: Integrate self-maintenance signals into alert tick/status

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing test for self-maintenance backlog signal becoming task draft**

Append test:

```ts
test("idu_autonomous_alerts_tick converts self-maintenance backlog into maintenance task", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alert-self-maintenance-mcp-"));
	try {
		const stateRoot = join(root, "state", "projects", "idu-pi");
		const runtime = fakeRuntime();
		for (let index = 0; index < 10; index += 1) {
			runtime.createTask("feature", `routine backlog item ${index}`);
		}
		const result = await callIduMcpTool("idu_autonomous_alerts_tick", { allowTaskCreation: true }, {
			runtimeFactory: () => runtime,
			projectResolver: () => ({ ...registered(), stateRoot }),
		});
		assert.equal(result.ok, true);
		assert.ok(result.data.report.decisions.some((decision: { domain: string }) => decision.domain === "backlog"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
corepack pnpm build && node --test --test-name-pattern "self-maintenance backlog" dist/test/mcp-server.test.js
```

Expected: FAIL until tick passes self-maintenance signals.

- [ ] **Step 3: Extract helper to build self-maintenance report in MCP**

Create an internal helper in `src/mcp-server.ts` near `readRuntimeStructuredTasks` or near dispatch helpers:

```ts
function buildRuntimeSelfMaintenanceReport(runtime: CliRuntime, stateRoot: string) {
	const taskRead = readRuntimeStructuredTasks(runtime);
	const supervisorActivity = summarizeSupervisorActivityEvents(readSupervisorActivityEvents(stateRoot));
	const usageReport = buildIduUsageReport(readIduUsageEvents(stateRoot));
	const agentLabEffectiveness = buildAgentLabEffectivenessReport(readAgentLabEffectivenessEvents(stateRoot));
	let semanticNewEvents = 0;
	try {
		const semanticDelta = runtime.semanticAuditStatus().newEvents;
		semanticNewEvents = semanticDelta.labRuns + semanticDelta.findings + semanticDelta.proposals + semanticDelta.tasks + semanticDelta.userSignals + semanticDelta.memoryItems;
	} catch {
		semanticNewEvents = 0;
	}
	return {
		taskRead,
		report: buildSupervisorSelfMaintenanceAdvisory({
			projectId: runtime.projectId,
			now: new Date(),
			tasks: taskRead.tasks,
			supervisorEvents: supervisorActivity.totalEvents,
			supervisorActivitySkipped: (supervisorActivity.byReason.throttled ?? 0) + (supervisorActivity.byReason.idu_inactive ?? 0) + (supervisorActivity.byReason.no_new_events ?? 0) + (supervisorActivity.byReason.not_enough_data ?? 0),
			supervisorActivityThrottled: supervisorActivity.byReason.throttled ?? 0,
			usageFailures: usageReport.failed + usageReport.notAllowed + usageReport.requiresHuman,
			agentLabStaleRequests: agentLabEffectiveness.staleRequests,
			semanticNewEvents,
		}),
	};
}
```

Use this helper in:

- `idu_supervisor_self_maintenance_advisory` existing handler;
- `idu_autonomous_alerts_status`;
- `idu_autonomous_alerts_tick`.

Pass `selfMaintenance.report.signals` to `buildAutonomousAlertEngineReport`.

- [ ] **Step 4: Run focused tests**

```bash
corepack pnpm build && node --test --test-name-pattern "autonomous alert|self-maintenance" dist/test/mcp-server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "feat(idu): feed self-maintenance alerts"
```

---

## Task 6: Verification, postflight, reviewer, push

**Files:**
- No planned code changes unless verification finds concrete defects.

- [ ] **Step 1: Run LSP diagnostics on touched files**

```bash
# Use pi lsp_diagnostics tool for:
# src/autonomous-alert-engine.ts
# src/autonomous-alert-engine-state.ts
# src/mcp-server.ts
# test/autonomous-alert-engine.test.ts
# test/autonomous-alert-engine-state.test.ts
# test/mcp-server.test.ts
```

Expected: 0 diagnostics.

- [ ] **Step 2: Run full gate**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: all tests pass, 0 failures, diff check clean.

- [ ] **Step 3: Run Idu postflight with local-only ignore**

Use MCP/tool postflight with:

```json
{
  "projectPath": "C:/Users/elmas/pi-telegram-bridge",
  "expectedChangeMode": "code",
  "expectedFiles": [
    "src/autonomous-alert-engine.ts",
    "src/autonomous-alert-engine-state.ts",
    "src/mcp-server.ts",
    "test/autonomous-alert-engine.test.ts",
    "test/autonomous-alert-engine-state.test.ts",
    "test/mcp-server.test.ts",
    "docs/superpowers/plans/2026-06-05-autonomous-alert-engine.md"
  ],
  "ignoredFiles": ["context.md"]
}
```

Expected: no unexpected functional files besides declared scope; `context.md` ignored as call-scoped local-only.

- [ ] **Step 4: Fresh reviewer**

Dispatch fresh reviewer with scope:

```text
Review Autonomous Alert Engine v1 implementation. Confirm raw honesty contract, advisory/no-remediation safety flags, stateRoot-only control writes, capped task creation, high-risk escalation, cooldown/dedup, no AgentLabs/rules/skills/contracts/dependency mutation, context.md uncommitted.
```

Expected: PASS or concrete blockers only.

- [ ] **Step 5: Fix only concrete blockers**

If reviewer fails, create a small fix commit, rerun focal tests and full gate, then request fresh review again.

- [ ] **Step 6: Push only after PASS**

```bash
git status --short
git push origin feat/idu-context-pressure
```

Expected: branch pushed; only `context.md` may remain local-only.

---

## Self-Review

### Spec coverage
- Raw honesty contract: Task 1 pure builder and report fields.
- Alert lifecycle/control: Task 2 state module and Task 3 control tool.
- Thresholds/cooldowns: Task 1 repeated bug threshold and cooldown; Task 2 ledger cooldown persistence.
- Stop/pause: Task 2 control state and Task 3 control MCP.
- Low/medium task creation: Task 4 capped task creation.
- High-risk human escalation: Task 1 and Task 4 tests.
- Self-maintenance integration: Task 5.
- Safety flags/no remediation: Tasks 1, 3, 4, 6.

### Scope limits
This v1 intentionally does not add a daemon scheduler, Telegram UI, broad web search, dependency updates, AgentLab execution, or rule/skill/contract mutation. Those are later slices.

### Risk note
The plan introduces automatic task creation, which is a state write. That is allowed only for capped low/medium-risk routine tasks and must remain stopped by Idu inactive/alert pause/domain disable in implementation.
