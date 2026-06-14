import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { approveBirthGeneralSpec } from "../src/birth-general-spec-runtime.js";
import { readBirthArtifact } from "../src/birth-artifacts.js";
import type { BirthGeneralSpec } from "../src/birth-general-spec.js";

test("approveBirthGeneralSpec bumps specVersion on each approval", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-g4-spec-version-"));
	try {
		// First approval: specVersion should be 1
		await approveBirthGeneralSpec({
			projectId: "demo",
			stateRoot,
			approvedBy: "owner",
			sections: {
				navigation: [],
				baseComponents: ["Button"],
				pageStructureRules: [],
				dataRules: [],
				interactionRules: [],
				motionRules: [],
				accessibilityCriteria: [],
				performanceCriteria: [],
			},
		});
		const first = readBirthArtifact<BirthGeneralSpec>(
			stateRoot,
			"general-spec",
		);
		assert.equal(first?.specVersion, 1);

		// Second approval: specVersion should be 2
		await approveBirthGeneralSpec({
			projectId: "demo",
			stateRoot,
			approvedBy: "owner",
			sections: {
				navigation: [],
				baseComponents: ["Button", "Card"],
				pageStructureRules: [],
				dataRules: [],
				interactionRules: [],
				motionRules: [],
				accessibilityCriteria: [],
				performanceCriteria: [],
			},
		});
		const second = readBirthArtifact<BirthGeneralSpec>(
			stateRoot,
			"general-spec",
		);
		assert.equal(second?.specVersion, 2);

		// Third approval: specVersion should be 3
		await approveBirthGeneralSpec({
			projectId: "demo",
			stateRoot,
			approvedBy: "owner",
			sections: {
				navigation: [],
				baseComponents: ["Button", "Card", "Input"],
				pageStructureRules: [],
				dataRules: [],
				interactionRules: [],
				motionRules: [],
				accessibilityCriteria: [],
				performanceCriteria: [],
			},
		});
		const third = readBirthArtifact<BirthGeneralSpec>(
			stateRoot,
			"general-spec",
		);
		assert.equal(third?.specVersion, 3);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
