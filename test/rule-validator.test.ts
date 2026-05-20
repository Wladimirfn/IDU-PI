import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	AgentLabFinding,
	AgentLabReport,
} from "../src/agentlab-contract.js";
import type { ProjectBlueprint } from "../src/project-blueprint.js";
import type { ProjectFlows } from "../src/project-flows.js";
import {
	validateAgentLabReportAgainstRules,
	validateFindingAgainstRules,
} from "../src/rule-validator.js";

function blueprint(): ProjectBlueprint {
	return {
		projectName: "Idu-pi",
		projectGoal: "Coordinate local AI agents safely.",
		projectType: "private-ai-orchestrator",
		version: "1.0.0",
		agentHierarchy: ["Humano = gerente", "AgentLabs = auditan"],
		architectureRules: ["JSONL remains primary"],
		forbiddenActions: [
			"Labs no pueden hacer commit.",
			"Labs no pueden hacer push.",
			"Labs no deben modificar repo real.",
		],
		qualityRules: ["Toda propuesta debe tener evidencia."],
		requiredValidation: ["corepack pnpm build", "corepack pnpm test"],
		createdAt: "2026-05-20T00:00:00.000Z",
		updatedAt: "2026-05-20T00:00:00.000Z",
	};
}

function flows(): ProjectFlows {
	return {
		version: "1.0.0",
		projectType: "private-ai-orchestrator",
		invariants: [
			"Labs no pueden hacer commit.",
			"Labs no pueden hacer push.",
			"No aceptar findings sin evidence.",
		],
		qualityRules: ["Build/test deben preservarse."],
		forbiddenTransitions: ["lab -> commit", "lab -> push"],
		allowedTransitions: ["lab -> report"],
		validationChecklist: ["corepack pnpm build", "corepack pnpm test"],
		modules: [
			{
				id: "lab",
				name: "Lab",
				description: "Lab module.",
				screens: ["lab-screen"],
				dataStores: ["lab-store"],
				connectedModules: [],
			},
		],
		screens: [
			{
				id: "lab-screen",
				path: "/lab",
				module: "lab",
				purpose: "Lab screen.",
				uiElements: ["run-lab-button"],
			},
		],
		uiElements: [
			{
				id: "run-lab-button",
				type: "button",
				selector: "#run-lab",
				label: "Run lab",
				expectedAction: "Runs lab.",
			},
		],
		dataStores: [
			{
				id: "lab-store",
				type: "json",
				tables: ["reports"],
				ownerModule: "lab",
			},
		],
		flows: [
			{
				id: "agent-lab-review",
				name: "Agent lab review",
				module: "lab",
				trigger: "run lab",
				steps: [
					{
						order: 1,
						type: "ui_action",
						from: "run-lab-button",
						to: "lab-store",
						description: "Run lab and record report.",
					},
				],
				expectedResult: "Lab report recorded.",
				testTargets: ["run-lab-button"],
			},
		],
		moduleConnections: [],
	};
}

function finding(
	patch: Partial<AgentLabFinding> = {},
): AgentLabFinding & { ruleIds?: string[] } {
	return {
		title: "Build fails",
		description: "Build exits with TypeScript errors.",
		evidence: "corepack pnpm build exited with code 2",
		severity: "medium",
		confidence: "high",
		category: "code_quality",
		proposal: {
			summary: "Fix the TypeScript error.",
			steps: ["Inspect build output", "Apply minimal fix"],
			risk: "Low.",
			requiresHumanApproval: false,
		},
		...patch,
	};
}

function report(patch: Partial<AgentLabReport> = {}): AgentLabReport {
	return {
		role: "code_quality",
		summary: "Lab report.",
		findings: [finding()],
		...patch,
	};
}

test("validateAgentLabReportAgainstRules passes a valid report", () => {
	const result = validateAgentLabReportAgainstRules(
		report(),
		blueprint(),
		flows(),
	);

	assert.deepEqual(result, { ok: true, failures: [], warnings: [] });
});

test("validateFindingAgainstRules fails when evidence is missing", () => {
	const invalid = finding({ evidence: "" });

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].field, "evidence");
});

test("validateFindingAgainstRules fails high finding without human approval", () => {
	const invalid = finding({ severity: "high" });

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.match(
		result.failures.map((failure) => failure.message).join("\n"),
		/requiresHumanApproval/u,
	);
});

test("validateFindingAgainstRules fails when title is missing", () => {
	const result = validateFindingAgainstRules(
		finding({ title: "" }),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].field, "title");
});

test("validateFindingAgainstRules fails when description is missing", () => {
	const result = validateFindingAgainstRules(
		finding({ description: "" }),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].field, "description");
});

test("validateFindingAgainstRules fails proposal with commit from lab", () => {
	const invalid = finding({
		proposal: {
			summary: "Commit from lab workspace.",
			steps: ["Run git commit from lab"],
			risk: "Critical.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].severity, "critical");
	assert.match(result.failures[0].message, /commit/u);
});

test("validateFindingAgainstRules fails proposal with push from lab", () => {
	const invalid = finding({
		proposal: {
			summary: "Push from lab workspace.",
			steps: ["git push origin feature"],
			risk: "Critical.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.equal(result.failures[0].severity, "critical");
	assert.match(result.failures[0].message, /push/u);
});

test("validateFindingAgainstRules fails real repo modification from clone without approval", () => {
	const invalid = finding({
		proposal: {
			summary: "Modify repo real from clone.",
			steps: ["Edit real repo from clone workspace"],
			risk: "High.",
			requiresHumanApproval: false,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), flows());

	assert.equal(result.ok, false);
	assert.match(
		result.failures.map((failure) => failure.ruleId).join("\n"),
		/realRepo\.humanApproval/u,
	);
});

test("validateFindingAgainstRules fails arbitrary blueprint forbiddenActions", () => {
	const customBlueprint = {
		...blueprint(),
		forbiddenActions: ["Delete production data"],
	};
	const invalid = finding({
		proposal: {
			summary: "Delete production data to reset state.",
			steps: ["Delete production data"],
			risk: "Critical.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, customBlueprint, flows());

	assert.equal(result.ok, false);
	assert.match(result.failures[0].ruleId, /blueprint\.forbiddenActions/u);
});

test("validateFindingAgainstRules fails arbitrary flow invariants", () => {
	const customFlows = {
		...flows(),
		invariants: ["Never skip regression tests"],
	};
	const invalid = finding({
		proposal: {
			summary: "Skip regression tests for speed.",
			steps: ["Skip regression tests"],
			risk: "Medium.",
			requiresHumanApproval: true,
		},
	});

	const result = validateFindingAgainstRules(invalid, blueprint(), customFlows);

	assert.equal(result.ok, false);
	assert.match(result.failures[0].ruleId, /flows\.invariants/u);
});

test("validateFindingAgainstRules warns on unknown ruleIds", () => {
	const result = validateFindingAgainstRules(
		finding({ ruleIds: ["missing-rule"] } as Partial<AgentLabFinding>),
		blueprint(),
		flows(),
	);

	assert.equal(result.ok, true);
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].ruleId, "missing-rule");
});

test("validateAgentLabReportAgainstRules passes report with no findings", () => {
	const result = validateAgentLabReportAgainstRules(
		report({ findings: [] }),
		blueprint(),
		flows(),
	);

	assert.deepEqual(result, { ok: true, failures: [], warnings: [] });
});

test("rule validation does not modify inputs", () => {
	const inputReport = report();
	const before = JSON.stringify(inputReport);

	validateAgentLabReportAgainstRules(inputReport, blueprint(), flows());

	assert.equal(JSON.stringify(inputReport), before);
});
