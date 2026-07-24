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

test("postflight task trace treats fully-ignored changes as no-op mode", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: [],
		expectedFiles: [],
		expectedChangeMode: "no-op",
		ignoredFiles: [".codegraph/", "birth/"],
		report: {
			changedFiles: [".codegraph/", "birth/"],
			observedChangeMode: "code",
			impactedAreas: [],
			risk: "low",
		},
	});

	assert.equal(trace.observedChangeMode, "no-op");
	assert.equal(trace.matchesIntent, true);
	assert.equal(trace.modeDelta, null);
	assert.deepEqual(trace.ignoredFiles, [".codegraph/", "birth/"]);
	assert.equal(trace.objectiveProgress, "none");
});

test("postflight task trace keeps raw mode when an unignored file exists", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: [],
		expectedFiles: ["docs/"],
		expectedChangeMode: "no-op",
		ignoredFiles: [".codegraph/"],
		report: {
			changedFiles: [".codegraph/", "src/rogue.ts"],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, false);
	assert.deepEqual(trace.unexpectedAreas, ["src/rogue.ts"]);
	assert.deepEqual(trace.ignoredFiles, [".codegraph/"]);
});

// #309 — auto-exclude stateRoot/** and constitution paths from changedFiles

test("postflight task trace auto-excludes files under stateRoot when stateRoot is provided", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		stateRoot: "C:\\Users\\elmas\\Documents\\bridge-agents\\projects\\idu-pi",
		report: {
			changedFiles: [
				"src/mcp-server.ts",
				"C:\\Users\\elmas\\Documents\\bridge-agents\\projects\\idu-pi\\config\\project-constitution.json",
				"C:\\Users\\elmas\\Documents\\bridge-agents\\projects\\idu-pi\\.idu\\config\\project-blueprint.json",
			],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.unexpectedAreas, []);
	assert.deepEqual(trace.ignoredFiles, [
		"C:\\Users\\elmas\\Documents\\bridge-agents\\projects\\idu-pi\\config\\project-constitution.json",
		"C:\\Users\\elmas\\Documents\\bridge-agents\\projects\\idu-pi\\.idu\\config\\project-blueprint.json",
	]);
});

test("postflight task trace auto-excludes explicit constitution paths even when stateRoot differs", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		constitutionPaths: [
			"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
			"C:\\bridge\\projects\\idu-pi\\config\\project-constitution.json",
		],
		report: {
			changedFiles: [
				"src/mcp-server.ts",
				"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
				"C:\\bridge\\projects\\idu-pi\\config\\project-constitution.json",
			],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.unexpectedAreas, []);
	assert.deepEqual(trace.ignoredFiles, [
		"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
		"C:\\bridge\\projects\\idu-pi\\config\\project-constitution.json",
	]);
});

test("postflight task trace auto-excludes stateRoot + explicit constitution paths combined", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		stateRoot: "C:\\bridge\\projects\\idu-pi",
		constitutionPaths: [
			"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
		],
		report: {
			changedFiles: [
				"src/mcp-server.ts",
				"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
				"C:\\bridge\\projects\\idu-pi\\config\\project-constitution.json",
				"C:\\bridge\\projects\\idu-pi\\reports\\some-other.json",
			],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, true);
	assert.deepEqual(trace.unexpectedAreas, []);
	// stateRoot/** includes both constitution paths + the reports file.
	// The explicit constitutionPaths entry is contained by stateRoot so its auto-exclude is reported.
	assert.deepEqual(trace.ignoredFiles, [
		"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
		"C:\\bridge\\projects\\idu-pi\\config\\project-constitution.json",
		"C:\\bridge\\projects\\idu-pi\\reports\\some-other.json",
	]);
});

test("postflight task trace stateRoot auto-exclude does not hide unexpected files outside stateRoot", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		stateRoot: "C:\\bridge\\projects\\idu-pi",
		report: {
			changedFiles: [
				"src/mcp-server.ts",
				"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
				"scripts/rogue.ts",
			],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, false);
	assert.deepEqual(trace.unexpectedAreas, ["scripts/rogue.ts"]);
	assert.deepEqual(trace.ignoredFiles, [
		"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
	]);
});

test("postflight task trace stateRoot auto-exclude + only stateRoot changes → mode 'no-op'", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: [],
		expectedFiles: ["src/"],
		expectedChangeMode: "no-op",
		stateRoot: "C:\\bridge\\projects\\idu-pi",
		report: {
			changedFiles: [
				"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
				"C:\\bridge\\projects\\idu-pi\\config\\project-constitution.json",
			],
			observedChangeMode: "code",
			impactedAreas: [],
			risk: "low",
		},
	});

	assert.equal(trace.observedChangeMode, "no-op");
	assert.equal(trace.matchesIntent, true);
	assert.equal(trace.modeDelta, null);
	assert.equal(trace.objectiveProgress, "none");
});

test("postflight task trace without stateRoot/constitutionPaths keeps current behavior", () => {
	const trace = buildPostflightTaskTrace({
		expectedContracts: ["agent"],
		expectedFiles: ["src/"],
		expectedChangeMode: "code",
		report: {
			changedFiles: [
				"src/mcp-server.ts",
				"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
			],
			observedChangeMode: "code",
			impactedAreas: ["orquestación"],
			risk: "low",
		},
	});

	assert.equal(trace.matchesIntent, false);
	assert.deepEqual(trace.unexpectedAreas, [
		"C:\\bridge\\projects\\idu-pi\\.idu\\config\\project-constitution.json",
	]);
});
