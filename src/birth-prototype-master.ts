export type BirthPrototypeStatus =
	| "missing"
	| "draft"
	| "reviewed"
	| "approved"
	| "stale";

export type BirthPackageManager = "pnpm" | "yarn" | "npm" | "unknown";

export type BirthStackRecommendation = {
	packageManager: BirthPackageManager;
	runtime: string;
};

export type BirthPrototypeInput = {
	productIntent: string;
	visualStyle: string;
	layoutBase: string;
	stackRecommendation: BirthStackRecommendation;
	alternativesDiscarded: string[];
	dependencies: { allowed: string[]; risky: string[] };
	motionRules: string[];
	uiPatterns: string[];
	forbiddenPatterns: string[];
	bibliotecarioReferences: string[];
	scalingRules: string[];
};

export type BirthPrototypeMaster = BirthPrototypeInput & {
	version: 1;
	projectId: string;
	status: BirthPrototypeStatus;
	approvedBy?: string;
	approvedAt?: string;
};

export type BirthPrototypeValidation = {
	ok: boolean;
	missingFields: string[];
};

export function createPrototypeMasterDraft(input: {
	projectId: string;
} & BirthPrototypeInput): BirthPrototypeMaster {
	return {
		version: 1,
		projectId: input.projectId,
		status: "draft",
		productIntent: input.productIntent,
		visualStyle: input.visualStyle,
		layoutBase: input.layoutBase,
		stackRecommendation: input.stackRecommendation,
		alternativesDiscarded: [...input.alternativesDiscarded],
		dependencies: {
			allowed: [...input.dependencies.allowed],
			risky: [...input.dependencies.risky],
		},
		motionRules: [...input.motionRules],
		uiPatterns: [...input.uiPatterns],
		forbiddenPatterns: [...input.forbiddenPatterns],
		bibliotecarioReferences: [...input.bibliotecarioReferences],
		scalingRules: [...input.scalingRules],
	};
}

export function reviewPrototypeMaster(
	draft: BirthPrototypeMaster,
): BirthPrototypeMaster {
	if (draft.status !== "draft") {
		throw new Error(`cannot review a prototype in status '${draft.status}'`);
	}
	return { ...draft, status: "reviewed" };
}

export function approvePrototypeMaster(
	reviewed: BirthPrototypeMaster,
	approvedBy: string,
): BirthPrototypeMaster {
	if (reviewed.status !== "reviewed") {
		throw new Error(
			`cannot approve a prototype in status '${reviewed.status}'; review first`,
		);
	}
	const validation = validatePrototypeMaster(reviewed);
	if (!validation.ok) {
		throw new Error(
			`prototype failed validation: ${validation.missingFields.join(", ")}`,
		);
	}
	return {
		...reviewed,
		status: "approved",
		approvedBy,
		approvedAt: new Date().toISOString(),
	};
}

export function validatePrototypeMaster(
	input: Partial<BirthPrototypeInput> & { projectId?: string; status?: BirthPrototypeStatus; productIntent?: string; visualStyle?: string; layoutBase?: string; stackRecommendation?: BirthStackRecommendation; forbiddenPatterns?: readonly string[]; scalingRules?: readonly string[] },
): BirthPrototypeValidation {
	const missing: string[] = [];
	const intent = input.productIntent ?? "";
	const visual = input.visualStyle ?? "";
	const layout = input.layoutBase ?? "";
	const stack = input.stackRecommendation ?? { packageManager: "unknown" as const, runtime: "" };
	const forbidden = input.forbiddenPatterns ?? [];
	const scaling = input.scalingRules ?? [];
	if (!intent.trim()) missing.push("productIntent");
	if (!visual.trim()) missing.push("visualStyle");
	if (!layout.trim()) missing.push("layoutBase");
	if (!stack.runtime.trim()) {
		missing.push("stackRecommendation.runtime");
	}
	if (stack.packageManager === "unknown") {
		missing.push("stackRecommendation.packageManager");
	}
	if (forbidden.length === 0) {
		missing.push("forbiddenPatterns");
	}
	if (scaling.length === 0) {
		missing.push("scalingRules");
	}
	return { ok: missing.length === 0, missingFields: missing };
}
