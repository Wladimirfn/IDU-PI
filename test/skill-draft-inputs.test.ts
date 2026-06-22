import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectDraftInputs } from "../src/skill-draft-inputs.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-b2-inputs-"));
}

test("collectDraftInputs returns only compactionEvents when all optional inputs are absent", async () => {
	const stateRoot = makeStateRoot();
	try {
		const inputs = await collectDraftInputs(stateRoot, "demo");
		assert.equal(typeof inputs.compactionEvents, "object");
		assert.equal(inputs.flows, undefined);
		assert.equal(inputs.blueprint, undefined);
		assert.equal(inputs.generalSpec, undefined);
		assert.equal(inputs.agentlabFindings, undefined);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs reads project-flows.json when present", async () => {
	const stateRoot = makeStateRoot();
	try {
		// F-Item3a: project-flows.json lives at Layout A (`.idu/config/`)
		// per the territory model. The previous test wrote at Layout B
		// which is the legacy location — `loadProjectFlows` migrates
		// Layout B to A on first read, so writing at A is the canonical
		// way to assert the loader finds it.
		mkdirSync(join(stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(stateRoot, ".idu", "config", "project-flows.json"),
			JSON.stringify({
				version: "1.0.0",
				projectType: "test",
				modules: [{ id: "m1", name: "Module 1" }],
			}),
			"utf8",
		);
		const inputs = await collectDraftInputs(stateRoot, "demo");
		assert.ok(inputs.flows);
		assert.equal(inputs.flows?.projectType, "test");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs reads birth/blueprint.json when present", async () => {
	const stateRoot = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "birth"), { recursive: true });
		writeFileSync(
			join(stateRoot, "birth", "blueprint.json"),
			JSON.stringify({
				version: 1,
				projectId: "demo",
				objective: "Test objective",
				unbreakableRules: ["Rule 1"],
				hierarchy: { languages: [], frameworks: [], packageManager: "npm" },
				confirmedBy: "owner",
				confirmedAt: "2026-06-14T00:00:00.000Z",
			}),
			"utf8",
		);
		const inputs = await collectDraftInputs(stateRoot, "demo");
		assert.ok(inputs.blueprint);
		assert.equal(inputs.blueprint?.objective, "Test objective");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs reads birth/general-spec.json when present", async () => {
	const stateRoot = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "birth"), { recursive: true });
		writeFileSync(
			join(stateRoot, "birth", "general-spec.json"),
			JSON.stringify({
				version: 1,
				projectId: "demo",
				status: "approved",
				derivedFrom: [],
				specVersion: 3,
				navigation: [],
				baseComponents: ["Button"],
				pageStructureRules: [],
				dataRules: [],
				interactionRules: [],
				motionRules: [],
				accessibilityCriteria: [],
				performanceCriteria: [],
				provenance: {},
				evidence: {},
			}),
			"utf8",
		);
		const inputs = await collectDraftInputs(stateRoot, "demo");
		assert.ok(inputs.generalSpec);
		assert.equal(inputs.generalSpec?.specVersion, 3);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs returns empty agentlabFindings when lab.db does not exist", async () => {
	const stateRoot = makeStateRoot();
	try {
		const inputs = await collectDraftInputs(stateRoot, "demo");
		// No lab.db → no findings (or empty array)
		assert.ok(
			inputs.agentlabFindings === undefined ||
				inputs.agentlabFindings.length === 0,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs reads open findings from lab.db when present", async () => {
	const stateRoot = makeStateRoot();
	try {
		// Create lab.db with a finding
		const { LabDbRepository } = await import("../src/lab-db-repository.js");
		const dbPath = join(stateRoot, "lab.db");
		const repo = new LabDbRepository(dbPath);
		repo.init();
		repo.recordBugFinding({
			id: "f1",
			projectId: "demo",
			title: "Test finding",
			description: "A test finding for B2",
			severity: "medium",
			confidence: "high",
			affectedFiles: ["src/test.ts"],
		});

		const inputs = await collectDraftInputs(stateRoot, "demo");
		assert.ok(inputs.agentlabFindings);
		assert.equal(inputs.agentlabFindings?.length, 1);
		assert.equal(inputs.agentlabFindings?.[0]?.id, "f1");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs returns empty agentlabFindings for a different project", async () => {
	const stateRoot = makeStateRoot();
	try {
		const { LabDbRepository } = await import("../src/lab-db-repository.js");
		const dbPath = join(stateRoot, "lab.db");
		const repo = new LabDbRepository(dbPath);
		repo.init();
		repo.recordBugFinding({
			id: "f1",
			projectId: "other-project",
			title: "Other project finding",
			description: "Should not be visible to demo project",
			severity: "medium",
			confidence: "high",
			affectedFiles: ["src/test.ts"],
		});

		const inputs = await collectDraftInputs(stateRoot, "demo");
		// No findings for "demo" project
		assert.ok(
			inputs.agentlabFindings === undefined ||
				inputs.agentlabFindings.length === 0,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs skips malformed project-flows.json without throwing", async () => {
	const stateRoot = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "config"), { recursive: true });
		writeFileSync(
			join(stateRoot, "config", "project-flows.json"),
			"{invalid json",
			"utf8",
		);
		const inputs = await collectDraftInputs(stateRoot, "demo");
		// Malformed JSON → skipped, no throw
		assert.equal(inputs.flows, undefined);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("collectDraftInputs reads all inputs when all are present", async () => {
	const stateRoot = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "config"), { recursive: true });
		mkdirSync(join(stateRoot, "birth"), { recursive: true });
		writeFileSync(
			join(stateRoot, "config", "project-flows.json"),
			JSON.stringify({ version: "1.0.0", projectType: "full" }),
			"utf8",
		);
		writeFileSync(
			join(stateRoot, "birth", "blueprint.json"),
			JSON.stringify({
				version: 1,
				projectId: "demo",
				objective: "All inputs",
				unbreakableRules: [],
				hierarchy: { languages: [], frameworks: [], packageManager: "npm" },
				confirmedBy: "owner",
				confirmedAt: "2026-06-14T00:00:00.000Z",
			}),
			"utf8",
		);
		writeFileSync(
			join(stateRoot, "birth", "general-spec.json"),
			JSON.stringify({
				version: 1,
				projectId: "demo",
				status: "approved",
				derivedFrom: [],
				specVersion: 1,
				navigation: [],
				baseComponents: [],
				pageStructureRules: [],
				dataRules: [],
				interactionRules: [],
				motionRules: [],
				accessibilityCriteria: [],
				performanceCriteria: [],
				provenance: {},
				evidence: {},
			}),
			"utf8",
		);
		const inputs = await collectDraftInputs(stateRoot, "demo");
		assert.ok(inputs.flows);
		assert.ok(inputs.blueprint);
		assert.ok(inputs.generalSpec);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
