import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBirthArtifact } from "../src/birth-artifacts.js";
import {
	inferMission,
	persistBlueprint,
	type BlueprintArtifact,
} from "../src/genesis-mission.js";
import type { BirthExistingScanResult } from "../src/birth-existing-scan.js";

function scanFixture(): BirthExistingScanResult {
	return {
		scan: {
			version: 1,
			scanId: "birth-scan-test",
			projectId: "demo",
			mode: "existing_project",
			observed: {
				packageManager: "pnpm",
				languages: ["TypeScript"],
				frameworks: ["react"],
				tests: ["test/app.test.ts"],
				docs: ["README.md"],
				styles: [],
				assets: [],
			},
			risks: [],
			approval: { status: "draft" },
		},
		detectedSpecs: {
			version: 1,
			projectId: "demo",
			derivedFromScanId: "birth-scan-test",
			status: "draft",
			detected: {
				stack: ["TypeScript", "pnpm", "react"],
				architecturePatterns: ["test_aware_layout"],
				visualPatterns: [],
				testPatterns: ["node_test_runner"],
			},
			generalSpecDraft: {
				version: 1,
				projectId: "demo",
				status: "draft",
				derivedFrom: [],
				navigation: [],
				baseComponents: [],
				pageStructureRules: [],
				dataRules: [],
				interactionRules: [],
				motionRules: [],
				accessibilityCriteria: [],
				performanceCriteria: [],
			},
			contradictions: [],
			approval: { status: "draft" },
		},
	};
}

test("inferMission derives a draft objective from docs package metadata and scan evidence", () => {
	const draft = inferMission(scanFixture(), {
		packageName: "demo-app",
		packageDescription: "Maintenance dashboard for field teams",
		readmeTitle: "Field Ops Console",
		tsconfigStrict: true,
	});

	assert.equal(draft.version, 1);
	assert.equal(draft.projectId, "demo");
	assert.equal(draft.status, "draft");
	assert.match(draft.objective, /Maintenance dashboard for field teams/u);
	assert.match(draft.objective, /Field Ops Console/u);
	assert.match(draft.objective, /react/u);
	assert.ok(!("confirmedBy" in draft), "draft must not be confirmed");
	assert.ok(draft.unbreakableRules.includes("All changes ship with tests."));
	assert.ok(
		draft.unbreakableRules.includes("TypeScript strict mode is mandatory."),
	);
	assert.deepEqual(draft.hierarchy.frameworks, ["react"]);
	assert.deepEqual(draft.hierarchy.languages, ["TypeScript"]);
});

test("persistBlueprint writes a confirmed blueprint that survives reread", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-genesis-blueprint-"));
	try {
		const blueprint: BlueprintArtifact = {
			version: 1,
			projectId: "demo",
			objective: "The objective of this project is to supervise delivery.",
			unbreakableRules: ["All changes ship with tests."],
			hierarchy: {
				languages: ["TypeScript"],
				frameworks: ["react"],
				packageManager: "pnpm",
			},
			confirmedBy: "owner",
			confirmedAt: "2026-06-13T00:00:00.000Z",
		};

		const path = persistBlueprint(stateRoot, blueprint);
		assert.match(path, /birth[/\\]blueprint\.json$/u);
		assert.deepEqual(
			readBirthArtifact<BlueprintArtifact>(stateRoot, "blueprint"),
			blueprint,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
