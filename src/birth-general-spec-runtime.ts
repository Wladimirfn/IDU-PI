import { writeBirthArtifact } from "./birth-artifacts.js";
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

export function approveBirthGeneralSpec(
	input: ApproveBirthGeneralSpecInput,
): ApproveBirthGeneralSpecResult {
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
		specVersion: 1,
		provenance: {},
		evidence: {},
		approvedBy: input.approvedBy,
		approvedAt: new Date().toISOString(),
	};
	writeBirthArtifact(input.stateRoot, "general-spec", spec);
	return { version: 1, projectId: input.projectId, generalSpec: spec };
}
