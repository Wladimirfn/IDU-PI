import { readBirthArtifact, writeBirthArtifact } from "./birth-artifacts.js";
import { ensureDesignSkillForVersion } from "./spec-propagation.js";
import type { BirthGeneralSpec } from "./birth-general-spec.js";

export type ApproveBirthGeneralSpecInput = {
	stateRoot: string;
	projectId: string;
	sections: {
		navigation: string[];
		baseComponents: string[];
		pageStructureRules: string[];
		dataRules: string[];
		interactionRules: string[];
		motionRules: string[];
		accessibilityCriteria: string[];
		performanceCriteria: string[];
	};
	approvedBy: string;
};

export type ApproveBirthGeneralSpecResult = {
	version: 1;
	projectId: string;
	generalSpec: BirthGeneralSpec;
};

export async function approveBirthGeneralSpec(
	input: ApproveBirthGeneralSpecInput,
): Promise<ApproveBirthGeneralSpecResult> {
	const existing = readBirthArtifact<BirthGeneralSpec>(
		input.stateRoot,
		"general-spec",
	);
	const nextSpecVersion = (existing?.specVersion ?? 0) + 1;

	const spec: BirthGeneralSpec = {
		version: 1,
		projectId: input.projectId,
		status: "approved",
		derivedFrom: ["project-core", "master-plan", "prototype-master"],
		navigation: input.sections.navigation,
		baseComponents: input.sections.baseComponents,
		pageStructureRules: input.sections.pageStructureRules,
		dataRules: input.sections.dataRules,
		interactionRules: input.sections.interactionRules,
		motionRules: input.sections.motionRules,
		accessibilityCriteria: input.sections.accessibilityCriteria,
		performanceCriteria: input.sections.performanceCriteria,
		specVersion: nextSpecVersion,
		provenance: {},
		evidence: {},
		approvedBy: input.approvedBy,
		approvedAt: new Date().toISOString(),
	};
	writeBirthArtifact(input.stateRoot, "general-spec", spec);

	await ensureDesignSkillForVersion({
		spec: { specVersion: nextSpecVersion },
		skill: { derivedFromSpecVersion: existing?.specVersion ?? 1 },
		rederive: async () => {
			// Re-derive design skill from the updated spec
			// This is a placeholder; actual re-derivation would call the visual derivation
			// For now, we just ensure the version tracking is correct
		},
	});

	return { version: 1, projectId: input.projectId, generalSpec: spec };
}
