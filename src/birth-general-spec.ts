import type { BirthPrototypeMaster } from "./birth-prototype-master.js";

export type BirthGeneralSpecStatus =
	| "missing"
	| "draft"
	| "reviewed"
	| "approved"
	| "stale";

export type BirthGeneralSpecSections = {
	navigation: string[];
	baseComponents: string[];
	pageStructureRules: string[];
	dataRules: string[];
	interactionRules: string[];
	motionRules: string[];
	accessibilityCriteria: string[];
	performanceCriteria: string[];
};

export type BirthGeneralSpec = BirthGeneralSpecSections & {
	version: 1;
	projectId: string;
	status: BirthGeneralSpecStatus;
	derivedFrom: Array<"project-core" | "master-plan" | "prototype-master">;
	approvedBy?: string;
	approvedAt?: string;
};

export type BirthPrototypeCheckResult = {
	ok: boolean;
	violations: string[];
};

export type BirthGeneralSpecValidation = {
	ok: boolean;
	missingFields: string[];
};

export function deriveGeneralSpec(input: {
	projectId: string;
	prototype: BirthPrototypeMaster;
	specInput: BirthGeneralSpecSections;
}): BirthGeneralSpec {
	if (input.prototype.status !== "approved") {
		throw new Error(
			`General Spec: prototype must be approved before derivation; current=${input.prototype.status}`,
		);
	}
	return {
		version: 1,
		projectId: input.projectId,
		status: "draft",
		derivedFrom: ["project-core", "master-plan", "prototype-master"],
		navigation: [...input.specInput.navigation],
		baseComponents: [...input.specInput.baseComponents],
		pageStructureRules: [...input.specInput.pageStructureRules],
		dataRules: [...input.specInput.dataRules],
		interactionRules: [...input.specInput.interactionRules],
		motionRules: [...input.specInput.motionRules],
		accessibilityCriteria: [...input.specInput.accessibilityCriteria],
		performanceCriteria: [...input.specInput.performanceCriteria],
	};
}

export function reviewGeneralSpec(spec: BirthGeneralSpec): BirthGeneralSpec {
	if (spec.status !== "draft") {
		throw new Error(`cannot review a general spec in status '${spec.status}'`);
	}
	return { ...spec, status: "reviewed" };
}

export function approveGeneralSpec(
	spec: BirthGeneralSpec,
	approvedBy: string,
): BirthGeneralSpec {
	if (spec.status !== "reviewed") {
		throw new Error(
			`cannot approve a general spec in status '${spec.status}'; review first`,
		);
	}
	const validation = validateGeneralSpec(spec);
	if (!validation.ok) {
		throw new Error(
			`general spec failed validation: ${validation.missingFields.join(", ")}`,
		);
	}
	return {
		...spec,
		status: "approved",
		approvedBy,
		approvedAt: new Date().toISOString(),
	};
}

export function validateGeneralSpec(
	spec: Partial<BirthGeneralSpecSections> & Partial<BirthGeneralSpec>,
): BirthGeneralSpecValidation {
	const missing: string[] = [];
	const navigation = spec.navigation ?? [];
	const baseComponents = spec.baseComponents ?? [];
	const pageStructureRules = spec.pageStructureRules ?? [];
	const dataRules = spec.dataRules ?? [];
	const interactionRules = spec.interactionRules ?? [];
	const motionRules = spec.motionRules ?? [];
	const accessibilityCriteria = spec.accessibilityCriteria ?? [];
	const performanceCriteria = spec.performanceCriteria ?? [];

	if (navigation.length === 0) missing.push("navigation");
	if (baseComponents.length === 0) missing.push("baseComponents");
	if (pageStructureRules.length === 0) missing.push("pageStructureRules");
	if (dataRules.length === 0) missing.push("dataRules");
	if (interactionRules.length === 0) missing.push("interactionRules");
	if (motionRules.length === 0) missing.push("motionRules");
	if (accessibilityCriteria.length === 0) missing.push("accessibilityCriteria");
	if (performanceCriteria.length === 0) missing.push("performanceCriteria");

	return { ok: missing.length === 0, missingFields: missing };
}

export function checkSpecAgainstPrototype(input: {
	prototype: BirthPrototypeMaster;
	pageSpecText: string;
}): BirthPrototypeCheckResult {
	const violations: string[] = [];
	const text = input.pageSpecText.toLowerCase();
	for (const forbidden of input.prototype.forbiddenPatterns) {
		const needle = forbidden.toLowerCase();
		if (needle && text.includes(needle)) {
			violations.push(
				`forbiddenPatterns violation: page spec uses '${forbidden}' which is forbidden by Master Prototype.`,
			);
		}
	}
	for (const motion of input.prototype.motionRules) {
		const needle = motion.toLowerCase();
		if (!needle.includes("prefers-reduced-motion")) continue;
		// Only flag if the page spec mentions motion/animation at all.
		if (/(motion|animat|transition)/u.test(text) && !text.includes("reduce")) {
			violations.push(
				`motionRules violation: page spec mentions motion but does not acknowledge prefers-reduced-motion.`,
			);
		}
	}
	return { ok: violations.length === 0, violations };
}
