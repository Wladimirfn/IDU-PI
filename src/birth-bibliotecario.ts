export type BibliotecarioSourceQuality = "primary" | "secondary" | "raw";

export type BibliotecarioExternalPermission =
	| "not_requested"
	| "granted"
	| "denied";

export type BibliotecarioAcquisitionState =
	| "local_sources_found"
	| "local_sources_empty"
	| "external_fetch_needed"
	| "external_fetch_blocked"
	| "external_sources_found"
	| "ideas_extracted"
	| "ideas_ready_for_orchestrator";

export type BibliotecarioIdeaCompatibility =
	| "compatible_with_master_plan"
	| "incompatible_with_master_plan"
	| "needs_review_against_master_plan";

export type BibliotecarioSourceRef = {
	path: string;
	quality: BibliotecarioSourceQuality;
};

export type BibliotecarioIdea = {
	id: string;
	summary: string;
	sourcePath: string;
	compatibility: BibliotecarioIdeaCompatibility;
	decisionStatus: "idea_only";
};

export type BibliotecarioDiscovery = {
	version: 1;
	projectId: string;
	status: BibliotecarioAcquisitionState;
	localSources: BibliotecarioSourceRef[];
	externalPermission: BibliotecarioExternalPermission;
	externalCategoriesNeeded: string[];
	externalSources: BibliotecarioSourceRef[];
	ideas: BibliotecarioIdea[];
	limitations: string[];
	nextRequiredAction: string;
};

export type EvaluateBibliotecarioInput = {
	projectId: string;
	localSourceRefs: BibliotecarioSourceRef[];
	requestedExternalCategories: string[];
	externalPermission: BibliotecarioExternalPermission;
	masterPlanSummary: string;
};

export function evaluateBibliotecarioAcquisition(
	input: EvaluateBibliotecarioInput,
): BibliotecarioDiscovery {
	const localSources = [...input.localSourceRefs];
	const limitations: string[] = [];
	const externalCategoriesNeeded = [
		...new Set(input.requestedExternalCategories),
	];

	let status: BibliotecarioAcquisitionState;
	if (localSources.length > 0) {
		status = "local_sources_found";
	} else if (externalCategoriesNeeded.length === 0) {
		status = "external_fetch_blocked";
		limitations.push(
			"No local sources and no external categories requested; cannot acquire evidence.",
		);
	} else if (input.externalPermission === "granted") {
		status = "external_fetch_needed";
	} else {
		status = "external_fetch_blocked";
		limitations.push(
			"External fetch requires explicit permission; current permission is not granted.",
		);
	}

	const ideas = localSources.map((src, index) => {
		const compatibility = classifyIdea(src.path, input.masterPlanSummary);
		return {
			id: `idea-${index + 1}`,
			summary: `Idea extracted from ${src.path}`,
			sourcePath: src.path,
			compatibility,
			decisionStatus: "idea_only" as const,
		};
	});

	return {
		version: 1,
		projectId: input.projectId,
		status,
		localSources,
		externalPermission: input.externalPermission,
		externalCategoriesNeeded,
		externalSources: [],
		ideas,
		limitations,
		nextRequiredAction: "idu_birth_bibliotecario_discovery",
	};
}

function classifyIdea(
	path: string,
	masterPlanSummary: string,
): BibliotecarioIdeaCompatibility {
	const plan = masterPlanSummary.toLowerCase();
	const p = path.toLowerCase();
	if (!plan) return "needs_review_against_master_plan";
	if (plan.includes("living") && /loop|continu|living|cycle/u.test(p)) {
		return "compatible_with_master_plan";
	}
	if (plan.includes("living") && /static|single|one-?shot/u.test(p)) {
		return "incompatible_with_master_plan";
	}
	return "needs_review_against_master_plan";
}
