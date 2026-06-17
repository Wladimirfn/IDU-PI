import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	enqueueObjectiveReminder,
	readRecentSupervisorAdvisoriesForTest,
	resolveObjectiveStatePath,
	resolveTurnCounterPath,
	noteOrchestratorTurn,
	OBJECTIVE_REMINDER_TIME_MS,
	OBJECTIVE_REMINDER_ESCALATE_AFTER_MS,
	OBJECTIVE_REMINDER_DEDUP_WINDOW_MS,
	OBJECTIVE_REMINDER_TASK_COUNT,
} from "../src/objective-injection.js";
import { resolveInjectionsPath } from "../src/injection-store.js";

function makeRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-obj-cad-"));
	mkdirSync(stateRoot, { recursive: true });
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

function writeReminderState(
	stateRoot: string,
	state: {
		lastReminderAt?: string;
		lastEscalationAt?: string | null;
		turnsSinceLastReminder?: number;
		lastInjectionId?: string;
	},
): void {
	const path = resolveObjectiveStatePath(stateRoot);
	writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

function writeTurnCount(stateRoot: string, turnCount: number): void {
	const path = resolveTurnCounterPath(stateRoot);
	writeFileSync(
		path,
		JSON.stringify(
			{ turnCount, lastTurnAt: new Date().toISOString() },
			null,
			2,
		),
		"utf8",
	);
}

test("enqueueObjectiveReminder: enqueues when no recent reminder", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test objective",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.escalated, false);
		assert.equal(result.reason, "fresh");
		assert.ok(result.injectionId);
		// state file is created
		assert.ok(existsSync(resolveObjectiveStatePath(stateRoot)));
		// injection is appended to injections.jsonl
		assert.ok(existsSync(resolveInjectionsPath(stateRoot)));
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: does NOT enqueue when recent un-acked reminder exists (dedup)", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// First enqueue
		const first = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(first.enqueued, true);
		// Try to enqueue again immediately
		const second = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(second.enqueued, false);
		assert.equal(second.reason, "dedup");
		assert.equal(second.injectionId, null);
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: enqueues when last reminder is older than dedup window", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Write a state with lastReminderAt 5h ago (dedup window is 4h)
		const fiveHoursAgo = new Date(
			Date.now() - 5 * 60 * 60 * 1000,
		).toISOString();
		writeReminderState(stateRoot, {
			lastReminderAt: fiveHoursAgo,
			lastInjectionId: "old-rem-123",
		});
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.reason, "fresh");
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: escalates an existing un-acked reminder after 1h", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Write a state with lastReminderAt 90min ago
		const ninetyMinAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
		writeReminderState(stateRoot, {
			lastReminderAt: ninetyMinAgo,
			lastInjectionId: "stale-rem-456",
		});
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
		assert.equal(result.escalated, true);
		assert.equal(result.reason, "escalated");
		assert.equal(result.injectionId, "stale-rem-456");
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: writes objective-reminder.json state file", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enqueueObjectiveReminder({ stateRoot, planObjective: "Test objective" });
		const statePath = resolveObjectiveStatePath(stateRoot);
		assert.ok(existsSync(statePath));
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		assert.equal(typeof state.lastReminderAt, "string");
		assert.equal(typeof state.lastInjectionId, "string");
	} finally {
		cleanup();
	}
});

test("enqueueObjectiveReminder: returns the canonical injection in injections.jsonl", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enqueueObjectiveReminder({ stateRoot, planObjective: "Test objective" });
		const content = readFileSync(resolveInjectionsPath(stateRoot), "utf8");
		const line = content.split("\n").find((l) => l.trim());
		assert.ok(line);
		const parsed = JSON.parse(line) as Record<string, unknown>;
		assert.equal(parsed.kind, "objective_reminder");
		assert.equal(parsed.acked, false);
		assert.equal(
			(parsed.decisionEnvelope as Record<string, unknown>)
				.orchestratorDecisionRequired,
			false,
		);
	} finally {
		cleanup();
	}
});

test("noteOrchestratorTurn: increments the turn counter", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const first = noteOrchestratorTurn({ stateRoot });
		assert.equal(first.turnCount, 1);
		const second = noteOrchestratorTurn({ stateRoot });
		assert.equal(second.turnCount, 2);
		const third = noteOrchestratorTurn({ stateRoot });
		assert.equal(third.turnCount, 3);
	} finally {
		cleanup();
	}
});

test("noteOrchestratorTurn: missing state file initializes to 1", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = noteOrchestratorTurn({ stateRoot });
		assert.equal(result.turnCount, 1);
	} finally {
		cleanup();
	}
});

test("resolveObjectiveStatePath: returns canonical path", () => {
	assert.equal(
		resolveObjectiveStatePath("/x/y"),
		join("/x/y", "objective-reminder.json"),
	);
});

test("resolveTurnCounterPath: returns canonical path", () => {
	assert.equal(
		resolveTurnCounterPath("/x/y"),
		join("/x/y", "last-orchestrator-turn.json"),
	);
});

test("readRecentSupervisorAdvisoriesForTest: returns empty when no file", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = readRecentSupervisorAdvisoriesForTest(stateRoot);
		assert.deepEqual(result, []);
	} finally {
		cleanup();
	}
});

test("OBJECTIVE_REMINDER_TIME_MS: is 1 hour (3_600_000)", () => {
	assert.equal(OBJECTIVE_REMINDER_TIME_MS, 3_600_000);
});

test("OBJECTIVE_REMINDER_ESCALATE_AFTER_MS: is 1 hour (3_600_000)", () => {
	assert.equal(OBJECTIVE_REMINDER_ESCALATE_AFTER_MS, 3_600_000);
});

test("OBJECTIVE_REMINDER_DEDUP_WINDOW_MS: is 4 hours", () => {
	assert.equal(OBJECTIVE_REMINDER_DEDUP_WINDOW_MS, 4 * 3_600_000);
});

test("OBJECTIVE_REMINDER_TASK_COUNT: is 10", () => {
	assert.equal(OBJECTIVE_REMINDER_TASK_COUNT, 10);
});

test("enqueueObjectiveReminder: does NOT crash when state file is corrupt", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const statePath = resolveObjectiveStatePath(stateRoot);
		writeFileSync(statePath, "this is not json", "utf8");
		// Should treat as "no recent reminder" and enqueue fresh
		const result = enqueueObjectiveReminder({
			stateRoot,
			planObjective: "Test",
		});
		assert.equal(result.enqueued, true);
	} finally {
		cleanup();
	}
});

test("writeTurnCount helper: persists turn count", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		writeTurnCount(stateRoot, 42);
		assert.ok(existsSync(resolveTurnCounterPath(stateRoot)));
		const parsed = JSON.parse(
			readFileSync(resolveTurnCounterPath(stateRoot), "utf8"),
		);
		assert.equal(parsed.turnCount, 42);
	} finally {
		cleanup();
	}
});
