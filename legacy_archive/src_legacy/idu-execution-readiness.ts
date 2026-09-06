import type { ProjectConstitutionStatus } from "./project-constitution.js";
import type { ProjectCoreStatus } from "./project-core.js";
import type { MasterPlanTaskTreeStatus } from "./master-plan-task-tree.js";
import type { IduMcpContextPackStaleness } from "./usage-events.js";

export type IduExecutionReadinessStatus =
	| "execution_ready"
	| "not_ready"
	| "stale_context"
	| "missing_task_tree";

export type IduExecutionReadiness = {
	version: 1;
	status: IduExecutionReadinessStatus;
	coreStatus: ProjectCoreStatus | "missing" | "unknown";
	constitutionStatus: ProjectConstitutionStatus | "missing" | "unknown";
	taskTreeStatus: MasterPlanTaskTreeStatus | "unknown";
	mcpContextPackStaleness: IduMcpContextPackStaleness | "unknown";
	blockingReasons: string[];
};

export type BuildIduExecutionReadinessInput = {
	coreStatus?: ProjectCoreStatus | "missing" | "unknown";
	constitutionStatus?: ProjectConstitutionStatus | "missing" | "unknown";
	taskTreeStatus?: MasterPlanTaskTreeStatus | "unknown";
	mcpContextPackStaleness?: IduMcpContextPackStaleness | "unknown";
};

export function buildIduExecutionReadiness(
	input: BuildIduExecutionReadinessInput,
): IduExecutionReadiness {
	const coreStatus = input.coreStatus ?? "unknown";
	const constitutionStatus = input.constitutionStatus ?? "unknown";
	const taskTreeStatus = input.taskTreeStatus ?? "unknown";
	const mcpContextPackStaleness = input.mcpContextPackStaleness ?? "unknown";
	const blockingReasons: string[] = [];
	if (coreStatus !== "confirmed") {
		blockingReasons.push(
			`Project Core must be confirmed; current=${coreStatus}.`,
		);
	}
	if (constitutionStatus !== "active") {
		blockingReasons.push(
			`Constitution must be active; current=${constitutionStatus}.`,
		);
	}
	if (taskTreeStatus !== "ready") {
		blockingReasons.push(
			`Master Plan task tree must be ready; current=${taskTreeStatus}.`,
		);
	}
	if (mcpContextPackStaleness !== "fresh") {
		blockingReasons.push(
			`MCP supervisor context pack must be fresh; current=${mcpContextPackStaleness}.`,
		);
	}
	return {
		version: 1,
		status: readinessStatus(
			blockingReasons,
			taskTreeStatus,
			mcpContextPackStaleness,
		),
		coreStatus,
		constitutionStatus,
		taskTreeStatus,
		mcpContextPackStaleness,
		blockingReasons,
	};
}

function readinessStatus(
	blockingReasons: readonly string[],
	taskTreeStatus: MasterPlanTaskTreeStatus | "unknown",
	mcpContextPackStaleness: IduMcpContextPackStaleness | "unknown",
): IduExecutionReadinessStatus {
	if (blockingReasons.length === 0) return "execution_ready";
	if (taskTreeStatus !== "ready") return "missing_task_tree";
	if (mcpContextPackStaleness !== "fresh") {
		return "stale_context";
	}
	return "not_ready";
}
