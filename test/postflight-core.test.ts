import assert from "node:assert/strict";
import test from "node:test";
import { buildPostflightTaskTrace } from "../src/postflight-core.js";

test("postflight task trace passes when files, contracts, and mode match", () => {
	const trace = buildPostflightTaskTrace({
		actionId: "action-1",
		taskPackageId: "pkg-1",
		expectedContracts: ["agent", "tests"],
		expectedFiles: ["src/", "test/"],
		expectedChangeMode: "code",
		report: {
			changedFiles: ["src/mcp-server.ts", "test/mcp-server.test.ts"],
			ignoredFiles: ["subagent-artifacts/review.md"],
			observedChangeMode: "code",
			impactedAreas: ["code", "orquestación", "tests"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.unexpectedAreas, []);
	assert.deepEqual(trace.missingExpectedContracts, []);
	assert.equal(trace.modeDelta, null);
	assert.equal(trace.objectiveProgress, "partial");
	assert.deepEqual(trace.ignoredFiles, ["subagent-artifacts/review.md"]);
});

test("postflight task trace accepts explicit local-only ignored files", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		ignoredFiles: ["context.md"],
		report: {
			changedFiles: ["src/mcp-server.ts", "context.md"],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.unexpectedAreas, []);
	assert.deepEqual(trace.ignoredFiles, ["context.md"]);
	assert.equal(trace.modeDelta, null);
});

test("postflight task trace explicit ignores do not hide unexpected files", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		ignoredFiles: ["context.md"],
		report: {
			changedFiles: ["src/mcp-server.ts", "context.md", "scripts/rogue.ts"],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, false);
	assert.deepEqual(trace.unexpectedAreas, ["scripts/rogue.ts"]);
	assert.deepEqual(trace.ignoredFiles, ["context.md"]);
});

test("postflight task trace reports unexpected files, missing contracts, and mode deltas", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["security", "data"],
		expectedFiles: ["src/auth/"],
		expectedChangeMode: "code",
		report: {
			changedFiles: ["src/mcp-server.ts"],
			observedChangeMode: "docs",
			impactedAreas: ["orquestación"],
			risk: "high",
		},
	});

	assert.equal(trace.matchesIntent, false);
	assert.deepEqual(trace.unexpectedAreas, ["src/mcp-server.ts"]);
	assert.deepEqual(trace.missingExpectedContracts, ["security", "data"]);
	assert.deepEqual(trace.contractDelta, [
		{ contract: "security", status: "expected_not_observed" },
		{ contract: "data", status: "expected_not_observed" },
	]);
	assert.deepEqual(trace.modeDelta, { expected: "code", observed: "docs" });
	assert.equal(trace.objectiveProgress, "unclear");
});
