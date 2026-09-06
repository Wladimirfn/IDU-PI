import type { MasterPlanTaskTree } from "./master-plan-task-tree.js";

export type LifecycleBindingStatus =
	| "bound"
	| "blocked_missing_lifecycle_binding";

export type LifecycleBindingInput = {
	hitoId?: string;
	specId?: string;
	flowId?: string;
	contractIds?: readonly string[];
	evidenceRefs?: readonly string[];
};

export type LifecycleBinding = {
	version: 1;
	status: LifecycleBindingStatus;
	hitoId?: string;
	specId?: string;
	flowId?: string;
	contractIds: string[];
	evidenceRefs: string[];
	blockingReasons: string[];
};

export type BuildLifecycleBindingInput = LifecycleBindingInput & {
	taskTree?: MasterPlanTaskTree;
};

export function buildLifecycleBinding(
	input: BuildLifecycleBindingInput,
): LifecycleBinding {
	const base = validateLifecycleBinding(input);
	if (base.status !== "bound" || !input.taskTree) return base;
	if (!input.taskTree.hitos.some((hito) => hito.id === base.hitoId)) {
		return {
			...base,
			status: "blocked_missing_lifecycle_binding",
			blockingReasons: [
				...base.blockingReasons,
				`hitoId '${base.hitoId}' was not found in the Master Plan task tree.`,
			],
		};
	}
	return base;
}

export function validateLifecycleBinding(
	input: LifecycleBindingInput,
): LifecycleBinding {
	const hitoId = clean(input.hitoId);
	const specId = clean(input.specId);
	const flowId = clean(input.flowId);
	const contractIds = dedupeClean(input.contractIds ?? []);
	const evidenceRefs = dedupeClean(input.evidenceRefs ?? []);
	const blockingReasons: string[] = [];
	if (!hitoId) blockingReasons.push("hitoId is required.");
	if (!specId) blockingReasons.push("specId is required.");
	if (!flowId) blockingReasons.push("flowId is required.");
	if (contractIds.length === 0) {
		blockingReasons.push("contractIds must include at least one contract.");
	}
	if (evidenceRefs.length === 0) {
		blockingReasons.push(
			"evidenceRefs must include at least one evidence reference.",
		);
	}
	return {
		version: 1,
		status:
			blockingReasons.length === 0
				? "bound"
				: "blocked_missing_lifecycle_binding",
		...(hitoId ? { hitoId } : {}),
		...(specId ? { specId } : {}),
		...(flowId ? { flowId } : {}),
		contractIds,
		evidenceRefs,
		blockingReasons,
	};
}

function clean(value: string | undefined): string {
	return (value ?? "").trim();
}

function dedupeClean(values: readonly string[]): string[] {
	return [...new Set(values.map(clean).filter(Boolean))];
}
