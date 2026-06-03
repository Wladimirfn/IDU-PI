export type ContextBudgetProfile =
	| "agentlab_request"
	| "agentlab_project_context"
	| "orchestrator_advisory"
	| "plan_snapshot"
	| "task_package"
	| "source_recommendation"
	| "source_chunk_read"
	| "source_research";

export type ContextBudgetOmissionReason =
	| "max_chars"
	| "max_items"
	| "raw_source_forbidden"
	| "raw_memory_forbidden"
	| "raw_report_forbidden";

export type ContextBudget = {
	profile: ContextBudgetProfile;
	maxTotalChars: number;
	maxTextFieldChars: number;
	maxArrayItems: number;
	maxArrayItemChars: number;
	maxSourceChars: number;
	allowRawSourceText: boolean;
	allowRawMemoryText: boolean;
	allowRawReportText: boolean;
};

export type ContextBudgetOmission = {
	path: string;
	reason: ContextBudgetOmissionReason;
	omittedChars?: number;
	omittedItems?: number;
};

export type ContextBudgetUsage = {
	profile: ContextBudgetProfile;
	maxTotalChars: number;
	usedChars: number;
	truncated: boolean;
	omitted: ContextBudgetOmission[];
	generatedAt: string;
	advisoryOnly: true;
	contractPromotionAllowed: false;
};

export type BudgetedText = {
	text: string;
	usage: ContextBudgetUsage;
};

export type BudgetedList = {
	items: string[];
	usage: ContextBudgetUsage;
};

export const CONTEXT_BUDGETS: Record<ContextBudgetProfile, ContextBudget> = {
	agentlab_request: {
		profile: "agentlab_request",
		maxTotalChars: 8_000,
		maxTextFieldChars: 1_500,
		maxArrayItems: 20,
		maxArrayItemChars: 300,
		maxSourceChars: 0,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	agentlab_project_context: {
		profile: "agentlab_project_context",
		maxTotalChars: 1_800,
		maxTextFieldChars: 900,
		maxArrayItems: 8,
		maxArrayItemChars: 300,
		maxSourceChars: 0,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	orchestrator_advisory: {
		profile: "orchestrator_advisory",
		maxTotalChars: 6_000,
		maxTextFieldChars: 1_000,
		maxArrayItems: 12,
		maxArrayItemChars: 400,
		maxSourceChars: 0,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	plan_snapshot: {
		profile: "plan_snapshot",
		maxTotalChars: 10_000,
		maxTextFieldChars: 1_200,
		maxArrayItems: 12,
		maxArrayItemChars: 500,
		maxSourceChars: 0,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	task_package: {
		profile: "task_package",
		maxTotalChars: 8_000,
		maxTextFieldChars: 1_000,
		maxArrayItems: 12,
		maxArrayItemChars: 400,
		maxSourceChars: 0,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	source_recommendation: {
		profile: "source_recommendation",
		maxTotalChars: 4_000,
		maxTextFieldChars: 700,
		maxArrayItems: 5,
		maxArrayItemChars: 350,
		maxSourceChars: 0,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	source_chunk_read: {
		profile: "source_chunk_read",
		maxTotalChars: 8_000,
		maxTextFieldChars: 8_000,
		maxArrayItems: 1,
		maxArrayItemChars: 8_000,
		maxSourceChars: 8_000,
		allowRawSourceText: true,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
	source_research: {
		profile: "source_research",
		maxTotalChars: 6_000,
		maxTextFieldChars: 600,
		maxArrayItems: 5,
		maxArrayItemChars: 350,
		maxSourceChars: 3_000,
		allowRawSourceText: false,
		allowRawMemoryText: false,
		allowRawReportText: false,
	},
};

export function createContextBudgetUsage(
	profile: ContextBudgetProfile,
	override: Partial<ContextBudgetUsage> = {},
): ContextBudgetUsage {
	const budget = CONTEXT_BUDGETS[profile];
	return {
		profile,
		maxTotalChars: budget.maxTotalChars,
		usedChars: 0,
		truncated: false,
		omitted: [],
		generatedAt: "deterministic",
		advisoryOnly: true,
		contractPromotionAllowed: false,
		...override,
	};
}

export function sliceTextToBudget(input: {
	text: string;
	profile: ContextBudgetProfile;
	path: string;
	maxChars?: number;
}): BudgetedText {
	const budget = CONTEXT_BUDGETS[input.profile];
	const maxChars = Math.max(
		0,
		Math.min(input.maxChars ?? budget.maxTextFieldChars, budget.maxTotalChars),
	);
	const text = input.text.trim();
	if (text.length <= maxChars) {
		return {
			text,
			usage: createContextBudgetUsage(input.profile, {
				usedChars: text.length,
			}),
		};
	}
	const sliced = text.slice(0, Math.max(0, maxChars - 20)).trimEnd();
	const output = `${sliced}\n[context truncated]`;
	return {
		text: output,
		usage: createContextBudgetUsage(input.profile, {
			usedChars: output.length,
			truncated: true,
			omitted: [
				{
					path: input.path,
					reason: "max_chars",
					omittedChars: text.length - sliced.length,
				},
			],
		}),
	};
}

export function sliceListToBudget(input: {
	items: string[];
	profile: ContextBudgetProfile;
	path: string;
	maxItems?: number;
	maxItemChars?: number;
}): BudgetedList {
	const budget = CONTEXT_BUDGETS[input.profile];
	const maxItems = Math.max(
		0,
		Math.min(input.maxItems ?? budget.maxArrayItems, budget.maxArrayItems),
	);
	const maxItemChars = Math.max(
		0,
		Math.min(
			input.maxItemChars ?? budget.maxArrayItemChars,
			budget.maxTextFieldChars,
		),
	);
	const usage = createContextBudgetUsage(input.profile);
	const selected = input.items.slice(0, maxItems);
	const items = selected.map((item, index) => {
		const result = sliceTextToBudget({
			text: item,
			profile: input.profile,
			path: `${input.path}[${index}]`,
			maxChars: maxItemChars,
		});
		usage.usedChars += result.text.length;
		if (result.usage.truncated) {
			usage.truncated = true;
			usage.omitted.push(...result.usage.omitted);
		}
		return result.text;
	});
	if (input.items.length > maxItems) {
		usage.truncated = true;
		usage.omitted.push({
			path: input.path,
			reason: "max_items",
			omittedItems: input.items.length - maxItems,
		});
	}
	return { items, usage };
}

export function mergeContextBudgetUsage(
	profile: ContextBudgetProfile,
	usages: ContextBudgetUsage[],
): ContextBudgetUsage {
	const budget = CONTEXT_BUDGETS[profile];
	const rawUsedChars = usages.reduce(
		(total, usage) => total + usage.usedChars,
		0,
	);
	const exceedsTotal = rawUsedChars > budget.maxTotalChars;
	return createContextBudgetUsage(profile, {
		usedChars: Math.min(rawUsedChars, budget.maxTotalChars),
		truncated: exceedsTotal || usages.some((usage) => usage.truncated),
		omitted: [
			...usages.flatMap((usage) => usage.omitted),
			...(exceedsTotal
				? [
						{
							path: "contextBudget.total",
							reason: "max_chars" as const,
							omittedChars: rawUsedChars - budget.maxTotalChars,
						},
					]
				: []),
		],
	});
}
