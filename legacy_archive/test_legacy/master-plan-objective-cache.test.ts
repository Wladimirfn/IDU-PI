import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeTempDir } from "./helpers/temp.js";
import {
	buildMasterPlanObjectiveSnapshot,
	getCachedMasterPlanObjectiveSnapshot,
	resolveMasterPlanObjectiveCachePath,
} from "../src/master-plan-objective-cache.js";

test("objective cache path stays under stateRoot reports", () => {
	const root = makeTempDir("idu-objective-cache-");
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
	assert.match(snapshot.blockReason ?? "", /not approved/u);
	assert.ok(snapshot.objective.length <= 500);
	assert.deepEqual(snapshot.risks, ["risk"]);
	assert.equal(snapshot.generatedAt, "2026-06-05T00:00:00.000Z");
	assert.equal(snapshot.expiresAt, "2026-06-05T01:00:00.000Z");
	assert.equal(snapshot.advisoryOnly, true);
});

test("buildMasterPlanObjectiveSnapshot blocks approved plan with missing objective", () => {
	const snapshot = buildMasterPlanObjectiveSnapshot({
		projectId: "idu-pi",
		projectPath: "C:/repo",
		now: new Date("2026-06-05T00:00:00.000Z"),
		plan: {
			status: "approved",
			criticalRisks: [],
		},
	});
	assert.equal(snapshot.planApproved, true);
	assert.equal(snapshot.blocked, true);
	assert.match(snapshot.blockReason ?? "", /objective missing/u);
});

test("getCachedMasterPlanObjectiveSnapshot reuses valid cache and writes stateRoot-only", () => {
	const stateRoot = makeTempDir("idu-objective-cache-");
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
			return {
				status: "approved",
				inferredObjective: "new",
				criticalRisks: [],
			};
		},
	});
	assert.equal(calls, 1);
	assert.equal(second.objective, first.objective);
	const cachePath = resolveMasterPlanObjectiveCachePath(stateRoot);
	assert.equal(existsSync(cachePath), true);
	const raw = readFileSync(cachePath, "utf8");
	assert.match(raw, /Idu-pi objective/u);
});

test("getCachedMasterPlanObjectiveSnapshot refreshes expired cache", () => {
	const stateRoot = makeTempDir("idu-objective-cache-");
	let calls = 0;
	getCachedMasterPlanObjectiveSnapshot({
		stateRoot,
		projectId: "idu-pi",
		projectPath: "C:/repo",
		now: new Date("2026-06-05T00:00:00.000Z"),
		ttlMinutes: 60,
		loadPlan: () => {
			calls += 1;
			return {
				status: "approved",
				inferredObjective: "first objective",
				criticalRisks: [],
			};
		},
	});
	const refreshed = getCachedMasterPlanObjectiveSnapshot({
		stateRoot,
		projectId: "idu-pi",
		projectPath: "C:/repo",
		now: new Date("2026-06-05T01:01:00.000Z"),
		ttlMinutes: 60,
		loadPlan: () => {
			calls += 1;
			return {
				status: "approved",
				inferredObjective: "refreshed objective",
				criticalRisks: [],
			};
		},
	});
	assert.equal(calls, 2);
	assert.equal(refreshed.objective, "refreshed objective");
});
