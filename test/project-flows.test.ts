import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatFlowsForPrompt,
	loadProjectFlows,
	validateProjectFlows,
} from "../src/project-flows.js";

async function withTempProject(
	fn: (projectPath: string) => void | Promise<void>,
): Promise<void> {
	const projectPath = mkdtempSync(join(tmpdir(), "idu-flows-project-"));
	try {
		await fn(projectPath);
	} finally {
		await rm(projectPath, { recursive: true, force: true });
	}
}

function validFlows(overrides: Record<string, unknown> = {}) {
	return {
		version: "1.0.0",
		projectType: "private-ai-orchestrator",
		invariants: ["Labs cannot commit", "Labs cannot push"],
		qualityRules: ["Every proposal needs evidence"],
		forbiddenTransitions: ["lab -> commit", "lab -> push"],
		allowedTransitions: ["lab -> report", "proposal -> human_approval"],
		validationChecklist: ["corepack pnpm build", "corepack pnpm test"],
		flows: [
			{
				id: "lab-review",
				summary: "AgentLabs audit isolated workspaces and report evidence.",
				steps: ["run lab", "record report", "human reviews"],
			},
		],
		...overrides,
	};
}

test("loadProjectFlows loads default flows", async () => {
	await withTempProject((projectPath) => {
		const flows = loadProjectFlows(projectPath);

		assert.equal(flows.projectType, "private-ai-orchestrator");
		assert.ok(flows.invariants.includes("Labs no pueden hacer commit."));
		assert.ok(
			flows.qualityRules.includes("Toda propuesta debe tener evidencia."),
		);
	});
});

test("loadProjectFlows loads project-local config when present", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-flows.json"),
			JSON.stringify(validFlows({ projectType: "custom-orchestrator" })),
		);

		const flows = loadProjectFlows(projectPath);

		assert.equal(flows.projectType, "custom-orchestrator");
		assert.deepEqual(flows.allowedTransitions, [
			"lab -> report",
			"proposal -> human_approval",
		]);
	});
});

test("loadProjectFlows fails clearly on invalid JSON", async () => {
	await withTempProject((projectPath) => {
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(
			join(projectPath, "config", "project-flows.json"),
			"{ invalid",
		);

		assert.throws(
			() => loadProjectFlows(projectPath),
			/Invalid project flows JSON/u,
		);
	});
});

test("validateProjectFlows fails when invariants are missing", () => {
	const flows = validFlows();
	delete (flows as { invariants?: string[] }).invariants;

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /invariants/u);
});

test("validateProjectFlows fails when qualityRules are missing", () => {
	const flows = validFlows();
	delete (flows as { qualityRules?: string[] }).qualityRules;

	const result = validateProjectFlows(flows);

	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /qualityRules/u);
});

test("formatFlowsForPrompt returns short useful text", () => {
	const result = validateProjectFlows(validFlows());
	assert.equal(result.ok, true);

	const text = formatFlowsForPrompt(result.flows);

	assert.match(text, /private-ai-orchestrator/u);
	assert.match(text, /Labs cannot commit/u);
	assert.match(text, /corepack pnpm test/u);
	assert.ok(text.length < 1200);
});

test("loadProjectFlows does not write files", async () => {
	await withTempProject((projectPath) => {
		const localPath = join(projectPath, "config", "project-flows.json");

		loadProjectFlows(projectPath);

		assert.equal(existsSync(localPath), false);
	});
});
