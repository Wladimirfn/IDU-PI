import assert from "node:assert/strict";
import {
	appendFileSync,
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
	readPendingBlockingInjection,
	resolveObjectiveStatePath,
	resolveTurnCounterPath,
	type BlockingInjection,
} from "../src/objective-injection.js";
import { resolveInjectionsPath } from "../src/injection-store.js";

function makeRoot(): { stateRoot: string; cleanup: () => void } {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-obj-inj-"));
	mkdirSync(stateRoot, { recursive: true });
	return {
		stateRoot,
		cleanup: () => rmSync(stateRoot, { recursive: true, force: true }),
	};
}

function appendInjection(
	stateRoot: string,
	injection: Record<string, unknown>,
): void {
	const path = resolveInjectionsPath(stateRoot);
	if (!existsSync(path)) {
		writeFileSync(path, "", "utf8");
	}
	appendFileSync(path, `${JSON.stringify(injection)}\n`, "utf8");
}

function makeReminder(
	stateRoot: string,
	overrides: Partial<{
		injectionId: string;
		decisionRequired: boolean;
		severity: "info" | "warning" | "critical";
		acked: boolean;
		tsOffsetMs: number;
		kind: string;
	}> = {},
): void {
	const ts = new Date(Date.now() - (overrides.tsOffsetMs ?? 0)).toISOString();
	const injectionId =
		overrides.injectionId ?? `rem-${Date.now()}-${Math.random()}`;
	appendInjection(stateRoot, {
		injectionId,
		kind: overrides.kind ?? "objective_reminder",
		triggerId: "objective_reminder",
		decisionEnvelope: {
			severity: overrides.severity ?? "info",
			summary: "Refresh project objective via idu_supervisor_context_pack",
			options: ["ack", "refresh"],
			evidenceRefs: ["piso:objective_reminder"],
			orchestratorDecisionRequired: overrides.decisionRequired ?? false,
		},
		acked: overrides.acked ?? false,
		ts,
	});
}

test("readPendingBlockingInjection: returns null when injections.jsonl missing", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = readPendingBlockingInjection(stateRoot);
		assert.equal(result, null);
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: returns null when injections.jsonl is empty", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		writeFileSync(resolveInjectionsPath(stateRoot), "", "utf8");
		const result = readPendingBlockingInjection(stateRoot);
		assert.equal(result, null);
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: returns null when all injections are acked", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		makeReminder(stateRoot, { decisionRequired: true, acked: true });
		const result = readPendingBlockingInjection(stateRoot);
		assert.equal(result, null);
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: returns null when no injection is decisionRequired", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		makeReminder(stateRoot, { decisionRequired: false });
		const result = readPendingBlockingInjection(stateRoot);
		assert.equal(result, null);
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: returns null when no objective_reminder kind", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		makeReminder(stateRoot, {
			kind: "supervisor_advisory",
			decisionRequired: true,
		});
		const result = readPendingBlockingInjection(stateRoot);
		assert.equal(result, null);
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: returns blocking shape when present", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const before = Date.now();
		makeReminder(stateRoot, {
			decisionRequired: true,
			severity: "warning",
		});
		const result = readPendingBlockingInjection(stateRoot);
		assert.ok(result);
		const blocking = result as BlockingInjection;
		assert.equal(blocking.decisionRequired, true);
		assert.equal(blocking.severity, "warning");
		assert.equal(blocking.kind, "objective_reminder");
		assert.equal(blocking.acked, false);
		assert.equal(typeof blocking.injectionId, "string");
		assert.equal(typeof blocking.summary, "string");
		assert.equal(typeof blocking.ts, "string");
		assert.ok(blocking.ageMs >= 0);
		assert.ok(blocking.ageMs < Date.now() - before + 5000);
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: returns the most recent when multiple", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// Older reminder
		makeReminder(stateRoot, {
			decisionRequired: true,
			tsOffsetMs: 60_000, // 1 min ago
		});
		// Newer reminder
		makeReminder(stateRoot, {
			decisionRequired: true,
			tsOffsetMs: 0, // now
		});
		const result = readPendingBlockingInjection(stateRoot);
		assert.ok(result);
		assert.ok(result.ageMs < 60_000); // should be the newer one
	} finally {
		cleanup();
	}
});

test("readPendingBlockingInjection: skips malformed lines", () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const path = resolveInjectionsPath(stateRoot);
		writeFileSync(path, "this is not json\n", "utf8");
		makeReminder(stateRoot, { decisionRequired: true });
		const result = readPendingBlockingInjection(stateRoot);
		assert.ok(result); // the valid one is still surfaced
	} finally {
		cleanup();
	}
});

test("resolveObjectiveStatePath: returns stateRoot/objective-reminder.json", () => {
	assert.equal(
		resolveObjectiveStatePath(join("x", "state")),
		join("x", "state", "objective-reminder.json"),
	);
});

test("resolveTurnCounterPath: returns stateRoot/last-orchestrator-turn.json", () => {
	assert.equal(
		resolveTurnCounterPath(join("x", "state")),
		join("x", "state", "last-orchestrator-turn.json"),
	);
});
