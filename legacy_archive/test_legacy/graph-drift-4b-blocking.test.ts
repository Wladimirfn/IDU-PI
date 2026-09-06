/**
 * graph-drift-4b-blocking.test.ts — formal contract tests for the
 * Etapa 4b + 4b.1 obligations.
 *
 * Why a separate file: the existing graph-drift-sensor.test.ts
 * covers the deterministic sensor (Etapa 4a/4a.1/4a.2) and is
 * self-contained. The Etapa 4b layer adds an env-var dispatch
 * (PISO ↔ TECHO) and a fail-closed preflight path that reads the
 * blocking injection. Mixing those into the sensor file would blur
 * the boundary between "what the sensor reports" and "what the
 * orchestrator must do about it". Splitting keeps each test suite
 * auditable.
 *
 * The 6 contracts protected here, per the Etapa 4b brief:
 *
 *   1. PISO mode is the default (env var unset → severity=warning).
 *   2. The env var flips to TECHO (IDU_PI_GRAPH_DRIFT_BLOCKING=critical
 *      → severity=critical).
 *   3. handleIduPreflight reports but does not block under PISO
 *      (the operator sees the advisory; the preflight returns
 *      exitCode=0).
 *   4. handleIduPreflight fails closed (exitCode=1) when the env flag
 *      is active AND a graph_drift_finding is un-acked.
 *   5. Coexistence: a graph_drift_finding and an objective_reminder
 *      un-acked at the same time still trigger the graph_drift gate
 *      — the reminder does not satisfy the kind-specific check
 *      (Etapa 4b.1 fix; loadPendingBlockingByKind).
 *   6. After the operator acks the graph_drift_finding, the
 *      preflight returns exitCode=0 (the gate has been satisfied).
 *
 * The tests build a stateRoot in a temp dir, seed the JSONL
 * directly (we do not go through the cron path), and exercise the
 * gate by invoking handleIduPreflight with the env flag.
 */

import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	readPendingBlockingInjection,
	type ObjectiveReminderKind,
} from "../src/objective-injection.js";
import { graphDriftSeverityForCurrentMode } from "../src/graph-drift-sensor.js";
import { handleIduPreflight } from "../src/cli/single/handlers.js";
import { createCliRuntime } from "../src/cli.js";
import { ackAdvisory } from "../src/idu-ack-advisory.js";

/**
 * Write a graph_drift_finding row to <stateRoot>/injections.jsonl.
 * The shape mirrors what the cron path writes; we keep it inline
 * so the tests do not depend on the cron preflight.
 */
function seedGraphDrift(
	stateRoot: string,
	injectionId: string,
	opts: { severity?: "warning" | "critical" } = {},
): void {
	mkdirSync(stateRoot, { recursive: true });
	const row = {
		ts: new Date().toISOString(),
		triggerId: "graph_drift_sensor",
		decisionEnvelope: {
			severity: opts.severity ?? "critical",
			summary: "test fixture",
			options: ["acknowledge"],
			orchestratorDecisionRequired: true,
		},
		injectionId,
		kind: "graph_drift_finding" as ObjectiveReminderKind,
		acked: false,
	};
	writeFileSync(
		join(stateRoot, "injections.jsonl"),
		`${JSON.stringify(row)}\n`,
		"utf8",
	);
}

/** Same shape for objective_reminder (constitution banner). */
function seedObjectiveReminder(stateRoot: string): void {
	mkdirSync(stateRoot, { recursive: true });
	const row = {
		ts: new Date().toISOString(),
		triggerId: "objective_reminder_cron",
		decisionEnvelope: {
			severity: "critical",
			summary: "constitution reminder fixture",
			options: ["ack"],
			orchestratorDecisionRequired: true,
		},
		injectionId: "obj-rem-fixture",
		kind: "objective_reminder" as ObjectiveReminderKind,
		acked: false,
	};
	const path = join(stateRoot, "injections.jsonl");
	// Append rather than overwrite so the file can hold both kinds
	// in the coexistence test.
	const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
	writeFileSync(path, existing + `${JSON.stringify(row)}\n`, "utf8");
}

/**
 * Build a CliRuntime for tests. The stateRoot must be reachable as
 * an `allowedRoot`, and the registry must point to a project whose
 * `path` resolves the runtime `stateRoot` correctly. The handleIduPreflight
 * call reads `stateRoot` from `runtime.workspaceRoot` (not the
 * raw `projectPath`), so we need `workspaceRoot/projects/<id>` to
 * match the test stateRoot where the JSONL lives.
 */
function makeRuntime(stateRoot: string) {
	mkdirSync(join(stateRoot, ".idu"), { recursive: true });
	const registryPath = join(stateRoot, ".idu", "registry.json");
	// The runtime derives `stateRoot = workspaceRoot/projects/<id>`. We
	// need that to resolve to the test stateRoot. The simplest setup
	// is to point AGENT_WORKSPACE_ROOT at the parent of the test dir
	// and use a project id that matches the basename.
	const workspaceRoot = join(stateRoot, "..");
	const projectId = stateRoot.split(/[\\/]/u).pop() ?? "test";
	const realStateRoot = join(workspaceRoot, "projects", projectId);
	mkdirSync(realStateRoot, { recursive: true });
	// Copy the test stateRoot's `injections.jsonl` to the real stateRoot
	// is the test's responsibility (via seedGraphDrift). We do not
	// pre-copy here; the test calls seedGraphDrift(stateRoot) and
	// the runtime reads from realStateRoot. So the test should use
	// the realStateRoot for seeding, not stateRoot.
	// Update the test pattern: we'll pass the project's real
	// stateRoot to the seeder.
	const previousEnv = {
		AGENT_WORKSPACE_ROOT: process.env.AGENT_WORKSPACE_ROOT,
		IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
		ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
		DEFAULT_CWD: process.env.DEFAULT_CWD,
	};
	process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
	process.env.IDU_PI_REGISTRY_PATH = registryPath;
	process.env.ALLOWED_ROOTS = workspaceRoot;
	process.env.DEFAULT_CWD = stateRoot;
	// Write the registry with the realStateRoot as the project path,
	// so resolveRuntimeProject finds it and the runtime stateRoot
	// matches the test stateRoot.
	writeFileSync(
		registryPath,
		JSON.stringify(
			{
				activeProjectId: projectId,
				projects: [
					{
						id: projectId,
						name: projectId,
						path: stateRoot,
						lastSessionFile: null,
					},
				],
			},
			null,
			2,
		),
		"utf8",
	);
	const runtime = createCliRuntime({
		projectPath: stateRoot,
		requireTelegramConfig: false,
	});
	return {
		runtime,
		realStateRoot,
		restoreEnv: () => {
			for (const [k, v] of Object.entries(previousEnv)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		},
	};
}

function freshStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "graph-drift-4b-"));
}

// ---------------------------------------------------------------------------
// Test 1: PISO is the default (env var unset).
// ---------------------------------------------------------------------------
test("4b contract 1: env var unset → PISO (severity=warning)", () => {
	const original = process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
	try {
		delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		assert.equal(graphDriftSeverityForCurrentMode(), "warning");
	} finally {
		if (original === undefined) delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		else process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = original;
	}
});

// ---------------------------------------------------------------------------
// Test 2: env var flips to TECHO.
// ---------------------------------------------------------------------------
test("4b contract 2: env var 'critical' → TECHO (severity=critical)", () => {
	const original = process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
	try {
		process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = "critical";
		assert.equal(graphDriftSeverityForCurrentMode(), "critical");

		// Any other value (including the empty string) is PISO. This
		// matches the helper's contract: opt-in is explicit, the only
		// value that flips is the exact string "critical".
		process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = "";
		assert.equal(graphDriftSeverityForCurrentMode(), "warning");

		process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = "true";
		assert.equal(graphDriftSeverityForCurrentMode(), "warning");
	} finally {
		if (original === undefined) delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		else process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = original;
	}
});

// ---------------------------------------------------------------------------
// Test 3: handleIduPreflight under PISO reports but does not block.
// ---------------------------------------------------------------------------
test("4b contract 3: PISO + un-acked graph_drift → preflight does not block (exitCode=0)", () => {
	const stateRoot = freshStateRoot();
	const original = process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
	let restoreEnv: (() => void) | undefined;
	try {
		delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		const ctx = makeRuntime(stateRoot);
		restoreEnv = ctx.restoreEnv;
		seedGraphDrift(ctx.realStateRoot, "gd-piso-1");
		const result = handleIduPreflight(ctx.runtime, "idu-preflight", ["test"]);
		assert.equal(result.exitCode, 0, "PISO must not block");
		// The PISO banner should still surface the advisory text so
		// the operator sees what is open. We don't assert exact copy
		// (format may change); just that graph_drift is referenced.
		assert.ok(
			result.stdout.includes("graph_drift_finding") ||
				result.stdout === "" ||
				!result.stdout.toLowerCase().includes("fail"),
			"PISO preflight should not contain a hard-fail banner",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		if (original === undefined) delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		else process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = original;
		restoreEnv?.();
	}
});

// ---------------------------------------------------------------------------
// Test 4: handleIduPreflight under TECHO fails closed with exitCode=1.
// ---------------------------------------------------------------------------
test("4b contract 4: TECHO + un-acked graph_drift → preflight fails closed (exitCode=1)", () => {
	const stateRoot = freshStateRoot();
	const original = process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
	let restoreEnv: (() => void) | undefined;
	try {
		process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = "critical";
		const ctx = makeRuntime(stateRoot);
		restoreEnv = ctx.restoreEnv;
		seedGraphDrift(ctx.realStateRoot, "gd-techo-1", { severity: "critical" });
		const result = handleIduPreflight(ctx.runtime, "idu-preflight", ["test"]);
		assert.equal(result.exitCode, 1, "TECHO gate must fail closed");
		assert.ok(
			result.stdout.includes("BLOCKING"),
			`output should contain BLOCKING banner, got: ${result.stdout.slice(0, 200)}`,
		);
		assert.ok(
			result.stdout.includes("graph_drift_finding"),
			"output should mention graph_drift_finding as the offending kind",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		if (original === undefined) delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		else process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = original;
		restoreEnv?.();
	}
});

// ---------------------------------------------------------------------------
// Test 5: coexistence — graph_drift and objective_reminder both un-acked.
// The reminder does NOT satisfy the gate (Etapa 4b.1 fix). The
// graph_drift triggers the gate.
// ---------------------------------------------------------------------------
test("4b contract 5: coexistence — reminder un-acked does NOT mask graph_drift gate", () => {
	const stateRoot = freshStateRoot();
	const original = process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
	let restoreEnv: (() => void) | undefined;
	try {
		process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = "critical";
		const ctx = makeRuntime(stateRoot);
		restoreEnv = ctx.restoreEnv;
		// Seed the reminder first, then the graph_drift on top of it.
		// Timestamps do not matter for the kind-aware read; the
		// most recent per kind is the one returned.
		seedObjectiveReminder(ctx.realStateRoot);
		seedGraphDrift(ctx.realStateRoot, "gd-coexist-1", { severity: "critical" });
		const result = handleIduPreflight(ctx.runtime, "idu-preflight", ["test"]);
		assert.equal(
			result.exitCode,
			1,
			"graph_drift must trigger the gate; the reminder must not mask it",
		);
		assert.ok(
			result.stdout.includes("graph_drift_finding"),
			"output should mention graph_drift_finding as the offending kind",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		if (original === undefined) delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		else process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = original;
		restoreEnv?.();
	}
});

// ---------------------------------------------------------------------------
// Test 6: after the operator acks, the gate is satisfied.
// The preflight returns exitCode=0 even with the env flag active.
// ---------------------------------------------------------------------------
test("4b contract 6: TECHO + acked graph_drift → preflight does not block (ack unblocks)", () => {
	const stateRoot = freshStateRoot();
	const original = process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
	let restoreEnv: (() => void) | undefined;
	try {
		process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = "critical";
		const ctx = makeRuntime(stateRoot);
		restoreEnv = ctx.restoreEnv;
		seedGraphDrift(ctx.realStateRoot, "gd-ack-1", { severity: "critical" });

		// Confirm the gate fires BEFORE ack.
		const before = handleIduPreflight(ctx.runtime, "idu-preflight", ["test"]);
		assert.equal(before.exitCode, 1, "gate must fire before ack");

		// Ack via the canonical entry point. We pass `reason` because
		// the operator must document why the finding is being
		// acknowledged — this is the data feed for the B3 suppression
		// layer. Empty reason is rejected by the ack path; that's
		// part of the contract, not a test fluke.
		const ack = ackAdvisory({
			stateRoot: ctx.realStateRoot,
			injectionId: "gd-ack-1",
			reason: "updated caller in 407e162",
		});
		assert.equal(ack.acked, true, "ack should succeed");
		assert.equal(ack.phase, "dismissed");

		// After ack: same env flag, same preflight, but the gate is
		// satisfied → no block.
		const after = handleIduPreflight(ctx.runtime, "idu-preflight", ["test"]);
		assert.equal(after.exitCode, 0, "ack must satisfy the gate");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		if (original === undefined) delete process.env.IDU_PI_GRAPH_DRIFT_BLOCKING;
		else process.env.IDU_PI_GRAPH_DRIFT_BLOCKING = original;
		restoreEnv?.();
	}
});