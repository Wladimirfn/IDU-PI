import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIduExecutionReadiness } from "../src/idu-execution-readiness.js";

test("execution readiness requires confirmed core active constitution fresh context and task tree", () => {
	const readiness = buildIduExecutionReadiness({
		coreStatus: "draft",
		constitutionStatus: "draft",
		taskTreeStatus: "ready",
		mcpContextPackStaleness: "fresh",
	});

	assert.equal(readiness.status, "not_ready");
	assert.ok(
		readiness.blockingReasons.some((reason) => /Project Core/u.test(reason)),
	);
	assert.ok(
		readiness.blockingReasons.some((reason) => /Constitution/u.test(reason)),
	);
});

test("execution readiness blocks stale unknown context and missing task tree", () => {
	const missingTaskTree = buildIduExecutionReadiness({
		coreStatus: "confirmed",
		constitutionStatus: "active",
		taskTreeStatus: "empty",
		mcpContextPackStaleness: "fresh",
	});
	assert.equal(missingTaskTree.status, "missing_task_tree");

	const staleContext = buildIduExecutionReadiness({
		coreStatus: "confirmed",
		constitutionStatus: "active",
		taskTreeStatus: "ready",
		mcpContextPackStaleness: "stale",
	});
	assert.equal(staleContext.status, "stale_context");

	const unknownContext = buildIduExecutionReadiness({
		coreStatus: "confirmed",
		constitutionStatus: "active",
		taskTreeStatus: "ready",
	});
	assert.equal(unknownContext.status, "stale_context");
	assert.equal(unknownContext.mcpContextPackStaleness, "unknown");
});

test("execution readiness is ready only when all foundations are current", () => {
	const readiness = buildIduExecutionReadiness({
		coreStatus: "confirmed",
		constitutionStatus: "active",
		taskTreeStatus: "ready",
		mcpContextPackStaleness: "fresh",
	});

	assert.equal(readiness.status, "execution_ready");
	assert.deepEqual(readiness.blockingReasons, []);
});
