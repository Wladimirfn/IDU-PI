import type { MasterPlanTaskTree } from "./master-plan-task-tree.js";
import type { FlowBoundProposalInput } from "./proposal-outbox.js";
import type { SupervisorSelfMaintenanceSignal } from "./supervisor-self-maintenance-advisory.js";

export type ExecutionDirectorTickStatus =
	| "proposal_created"
	| "noop"
	| "blocked_missing_lifecycle_binding";

export type ExecutionDirectorTickInput = {
	projectId: string;
	now?: Date;
	taskTree?: MasterPlanTaskTree;
	selfMaintenanceSignals: readonly SupervisorSelfMaintenanceSignal[];
};

export type ExecutionDirectorTickResult = {
	version: 1;
	authority: "advisory";
	projectId: string;
	generatedAt: string;
	status: ExecutionDirectorTickStatus;
	proposals: FlowBoundProposalInput[];
	blockingReasons: string[];
	evidenceRefs: string[];
	safeNotes: string[];
};

const SUPERVISOR_LEARNING_LOOP_SPEC_ID = "spec-supervisor-learning-loop";
const SUPERVISOR_LEARNING_LOOP_FLOW_ID = "supervisor-learning-loop";

export function buildExecutionDirectorTick(
	input: ExecutionDirectorTickInput,
): ExecutionDirectorTickResult {
	const now = input.now ?? new Date();
	const hito =
		input.taskTree?.status === "ready" ? input.taskTree.hitos[0] : undefined;
	if (!hito) {
		return baseTick(input, now, {
			status: "blocked_missing_lifecycle_binding",
			blockingReasons: [
				"A ready hito is required before creating living-loop proposals.",
			],
		});
	}

	const signal = input.selfMaintenanceSignals.find(
		(candidate) => candidate.category === "learning_loop_pressure",
	);
	if (!signal) return baseTick(input, now, { status: "noop" });

	return baseTick(input, now, {
		status: "proposal_created",
		proposals: [buildLearningLoopProposal(input.projectId, hito.id, signal)],
		evidenceRefs: [...signal.evidenceRefs],
	});
}

function buildLearningLoopProposal(
	projectId: string,
	hitoId: string,
	signal: SupervisorSelfMaintenanceSignal,
): FlowBoundProposalInput {
	return {
		projectId,
		sourceTrigger: "execution-director-tick",
		sourceEngine: "supervisor",
		title: "Convert learning pressure into bounded project work",
		summary: signal.summary,
		hitoId,
		specId: SUPERVISOR_LEARNING_LOOP_SPEC_ID,
		flowId: SUPERVISOR_LEARNING_LOOP_FLOW_ID,
		contractIds: ["agent"],
		evidenceRefs: [...signal.evidenceRefs],
		risk: "low",
		policyDecision: "auto",
		recommendedAction: "create_task",
	};
}

function baseTick(
	input: ExecutionDirectorTickInput,
	now: Date,
	overrides: Partial<ExecutionDirectorTickResult>,
): ExecutionDirectorTickResult {
	return {
		version: 1,
		authority: "advisory",
		projectId: input.projectId,
		generatedAt: now.toISOString(),
		status: "noop",
		proposals: [],
		blockingReasons: [],
		evidenceRefs: [],
		safeNotes: [
			"Execution director tick is advisory: it creates proposals only and does not implement code.",
			"Every proposal must be bound to hito/spec/flow/contracts before execution.",
		],
		...overrides,
	};
}
