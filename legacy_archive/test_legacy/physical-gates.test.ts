import assert from "node:assert/strict";
import test from "node:test";
import { buildPhysicalEvidenceGateways } from "../src/evidence-gateways.js";
import { buildPostflightPhysicalGates } from "../src/physical-gates.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";

function report(patch: Partial<ProjectPostflightReport> = {}): ProjectPostflightReport {
	return {
		risk: "medium",
		changedFiles: ["src/app.ts"],
		observedChangeMode: "code",
		impactedAreas: ["code"],
		warnings: [],
		recommendedNext: "Review before merge.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
		...patch,
	};
}

test("postflight physical gates are deterministic advisory evidence", () => {
	const gates = buildPostflightPhysicalGates({
		projectPath: "/repo",
		gitState: {
			changedFiles: ["src/app.ts"],
			diffSummary: " src/app.ts | 1 +",
			warnings: [],
		},
		report: report(),
	});

	assert.deepEqual(
		gates.map((gate) => gate.id),
		[
			"physical-git-status",
			"physical-diff",
			"physical-report-hygiene",
			"physical-build-not-run",
			"physical-test-not-run",
		],
	);
	assert.equal(gates.every((gate) => gate.advisoryOnly), true);
	assert.equal(gates.every((gate) => gate.destructive === false), true);
	assert.equal(gates.find((gate) => gate.kind === "build")?.status, "not_run");
	assert.equal(gates.find((gate) => gate.kind === "test")?.status, "not_run");
});

test("physical evidence gateway blocks failed hard gates", () => {
	const gateway = buildPhysicalEvidenceGateways([
		{
			id: "physical-build",
			kind: "build",
			status: "fail",
			summary: "Build failed.",
			advisoryOnly: true,
			destructive: false,
		},
	])[0]!;

	assert.equal(gateway.source, "physical_gate");
	assert.equal(gateway.status, "block");
	assert.equal(gateway.allowedToProceed, false);
	assert.equal(gateway.requiredActions[0]?.action, "resolve_failed_physical_gate");
	assert.equal(gateway.requiredActions[0]?.blocking, true);
});

test("physical evidence gateway marks missing build/test evidence as warning", () => {
	const gates = buildPostflightPhysicalGates({
		projectPath: "/repo",
		gitState: { changedFiles: [], diffSummary: "", warnings: [] },
		report: report({ risk: "low", changedFiles: [], impactedAreas: [] }),
	});
	const gateway = buildPhysicalEvidenceGateways(gates)[0]!;

	assert.equal(gateway.status, "warn");
	assert.equal(gateway.allowedToProceed, true);
	assert.equal(
		gateway.evidence.some((item) => item.id === "physical-build-not-run"),
		true,
	);
});
