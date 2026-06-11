import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { shouldUseAutomaticGuardrails } from "./idu-session.js";
import {
	runIduSupervisorLoop,
	type IduSupervisorLoopInput,
	type IduSupervisorLoopResult,
	type IduSupervisorTrigger,
} from "./idu-supervisor-loop.js";
import type { LabDbRepository } from "./lab-db-repository.js";
import type { ProjectPreflightRisk } from "./project-preflight.js";
import type { SemanticAuditTriggerResult } from "./semantic-audit-trigger.js";
import type {
	StructuredTask,
	StructuredTaskQueue,
} from "./structured-task-queue.js";
import {
	recordSupervisorActivityEventDeferred,
	supervisorActivityInputFromLoopResult,
	type SupervisorActivityRecordInput,
} from "./supervisor-activity-events.js";

export type IduSupervisorHookReason =
	| "idu_inactive"
	| "no_new_events"
	| "throttled"
	| "supervisor_failed";

export type IduSupervisorHookResult = {
	status: "completed" | "skipped" | "warning";
	reason?: IduSupervisorHookReason;
	trigger: IduSupervisorTrigger;
	projectId: string;
	bypassedThrottle: boolean;
	throttleStatePath: string;
	summary: string;
	supervisor?: IduSupervisorLoopResult;
	warning?: string;
	safety: {
		agentLabsExecuted: false;
		rulesApplied: false;
		memoryDeleted: false;
		projectCoreModified: false;
	};
};

type HookRepository = Pick<
	LabDbRepository,
	| "getSemanticAuditStats"
	| "getSemanticAuditCheckpoint"
	| "createSemanticAuditRun"
	| "updateSemanticAuditCheckpoint"
>;

type CommonHookInput = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	labDbPath?: string;
	reportsPath?: string;
	repository: HookRepository;
	queue: StructuredTaskQueue;
	isIduActive?: (projectId: string) => boolean;
	runSupervisorLoop?: (
		input: IduSupervisorLoopInput,
	) => IduSupervisorLoopResult;
	now?: () => Date;
	throttleMs?: number;
	options?: Partial<IduSupervisorLoopInput["options"]>;
	supervisorActivityStateRoot?: string;
	recordSupervisorActivity?: (event: SupervisorActivityRecordInput) => void;
};

export type MaybeRunSupervisorAfterTaskInput = CommonHookInput & {
	task?: Pick<StructuredTask, "guardRisk">;
};

export type MaybeRunSupervisorAfterPostflightInput = CommonHookInput & {
	risk: ProjectPreflightRisk;
};

export type MaybeRunSupervisorAfterSemanticTriggerInput = CommonHookInput & {
	semanticTrigger: SemanticAuditTriggerResult;
};

export type ShouldThrottleSupervisorLoopInput = {
	lastRunAt?: string;
	now: Date;
	throttleMs?: number;
};

type HookState = {
	projects?: Record<string, { lastRunAt?: string }>;
};

const DEFAULT_THROTTLE_MS = 10 * 60 * 1000;
const SAFE_FLAGS = {
	agentLabsExecuted: false,
	rulesApplied: false,
	memoryDeleted: false,
	projectCoreModified: false,
} as const;

export function maybeRunSupervisorOnIduActivation(
	input: CommonHookInput,
): IduSupervisorHookResult {
	return maybeRunSupervisor({
		...input,
		trigger: "on_idu_activation",
		allowSemanticDraft: false,
		allowAgentTaskPlan: false,
		bypassThrottle: false,
		relevantEvent: true,
	});
}

export function maybeRunSupervisorAfterTask(
	input: MaybeRunSupervisorAfterTaskInput,
): IduSupervisorHookResult {
	const bypassThrottle = isHighOrBlocker(input.task?.guardRisk);
	return maybeRunSupervisor({
		...input,
		trigger: "after_task_registered",
		allowSemanticDraft: false,
		allowAgentTaskPlan: false,
		bypassThrottle,
		relevantEvent: true,
	});
}

export function maybeRunSupervisorAfterPostflight(
	input: MaybeRunSupervisorAfterPostflightInput,
): IduSupervisorHookResult {
	const bypassThrottle = isHighOrBlocker(input.risk);
	return maybeRunSupervisor({
		...input,
		trigger: "after_postflight",
		allowSemanticDraft: false,
		allowAgentTaskPlan: false,
		bypassThrottle,
		relevantEvent: true,
	});
}

export function maybeRunSupervisorAfterSemanticTrigger(
	input: MaybeRunSupervisorAfterSemanticTriggerInput,
): IduSupervisorHookResult {
	if (input.semanticTrigger.decision !== "executed") {
		return emitHookActivity(
			input,
			skipped(input, "after_semantic_threshold", "no_new_events"),
			false,
		);
	}
	const reason = input.semanticTrigger.triggerReason;
	const majorOrCritical =
		reason === "threshold_major" || reason === "critical_findings";
	return maybeRunSupervisor({
		...input,
		trigger: "after_semantic_threshold",
		allowSemanticDraft: majorOrCritical,
		allowAgentTaskPlan: false,
		bypassThrottle: majorOrCritical,
		relevantEvent: true,
	});
}

export function shouldThrottleSupervisorLoop(
	input: ShouldThrottleSupervisorLoopInput,
): boolean {
	if (!input.lastRunAt) return false;
	const last = new Date(input.lastRunAt).getTime();
	if (!Number.isFinite(last)) return false;
	return input.now.getTime() - last < (input.throttleMs ?? DEFAULT_THROTTLE_MS);
}

export function formatSupervisorHookResult(
	result: IduSupervisorHookResult,
): string {
	return [
		"Idu-pi Supervisor Hook",
		"",
		"Estado:",
		result.status,
		"",
		"Trigger:",
		result.trigger,
		"",
		"Resumen:",
		result.summary,
		...(result.warning ? ["", "Warning:", result.warning] : []),
		"",
		"Nota segura:",
		"No ejecuté AgentLabs, no apliqué reglas, no borré memoria y no modifiqué Project Core/Constitution/blueprint/flows; si falló, el flujo principal continúa.",
	].join("\n");
}

function maybeRunSupervisor(
	input: CommonHookInput & {
		trigger: IduSupervisorTrigger;
		allowSemanticDraft: boolean;
		allowAgentTaskPlan: boolean;
		bypassThrottle: boolean;
		relevantEvent: boolean;
	},
): IduSupervisorHookResult {
	if (!input.relevantEvent) {
		return emitHookActivity(
			input,
			skipped(input, input.trigger, "no_new_events"),
			false,
		);
	}
	const active = (input.isIduActive ?? shouldUseAutomaticGuardrails)(
		input.projectId,
	);
	if (!active) {
		return emitHookActivity(
			input,
			skipped(input, input.trigger, "idu_inactive"),
			false,
		);
	}

	const now = input.now?.() ?? new Date();
	const throttleStatePath = statePath(input.workspaceRoot);
	const state = readState(throttleStatePath);
	const lastRunAt = state.projects?.[input.projectId]?.lastRunAt;
	if (
		!input.bypassThrottle &&
		shouldThrottleSupervisorLoop({
			lastRunAt,
			now,
			throttleMs: input.throttleMs,
		})
	) {
		return emitHookActivity(
			input,
			{
				status: "skipped",
				reason: "throttled",
				trigger: input.trigger,
				projectId: input.projectId,
				bypassedThrottle: false,
				throttleStatePath,
				summary: "Supervisor omitido por throttle de 10 minutos.",
				safety: SAFE_FLAGS,
			},
			true,
		);
	}

	try {
		const supervisor = (input.runSupervisorLoop ?? runIduSupervisorLoop)({
			projectId: input.projectId,
			projectPath: input.projectPath,
			workspaceRoot: input.workspaceRoot,
			labDbPath: input.labDbPath,
			reportsPath: input.reportsPath,
			trigger: input.trigger,
			options: {
				allowSemanticDraft:
					input.options?.allowSemanticDraft ?? input.allowSemanticDraft,
				allowAgentTaskPlan:
					input.options?.allowAgentTaskPlan ?? input.allowAgentTaskPlan,
				dryRun: input.options?.dryRun ?? false,
				...(typeof input.options?.maxCreatedTasks === "number"
					? { maxCreatedTasks: input.options.maxCreatedTasks }
					: {}),
			},
			repository: input.repository,
			queue: input.queue,
			isIduActive: input.isIduActive,
		});
		writeState(throttleStatePath, input.projectId, now);
		return emitHookActivity(
			input,
			{
				status: supervisor.status === "warning" ? "warning" : "completed",
				trigger: input.trigger,
				projectId: input.projectId,
				bypassedThrottle: input.bypassThrottle,
				throttleStatePath,
				summary: supervisor.summary,
				supervisor,
				safety: SAFE_FLAGS,
			},
			true,
		);
	} catch (error) {
		return emitHookActivity(
			input,
			{
				status: "warning",
				reason: "supervisor_failed",
				trigger: input.trigger,
				projectId: input.projectId,
				bypassedThrottle: input.bypassThrottle,
				throttleStatePath,
				summary: "Supervisor automático falló; el flujo principal continúa.",
				warning: error instanceof Error ? error.message : String(error),
				safety: SAFE_FLAGS,
			},
			true,
		);
	}
}

function emitHookActivity(
	input: Pick<
		CommonHookInput,
		| "projectId"
		| "workspaceRoot"
		| "supervisorActivityStateRoot"
		| "recordSupervisorActivity"
	>,
	result: IduSupervisorHookResult,
	active: boolean,
): IduSupervisorHookResult {
	try {
		const event: SupervisorActivityRecordInput = result.supervisor
			? {
					...supervisorActivityInputFromLoopResult(result.supervisor, {
						origin: "supervisor_auto_hook",
						eventType: "supervisor_hook",
					}),
					status: result.status,
					...(result.reason ? { reason: result.reason } : {}),
					bypassedThrottle: result.bypassedThrottle,
				}
			: {
					projectId: input.projectId,
					eventType: "supervisor_hook",
					origin: "supervisor_auto_hook",
					trigger: result.trigger,
					status: result.status,
					...(result.reason ? { reason: result.reason } : {}),
					active,
					bypassedThrottle: result.bypassedThrottle,
					ok: result.status !== "warning",
				};
		if (input.recordSupervisorActivity) input.recordSupervisorActivity(event);
		else {
			recordSupervisorActivityEventDeferred(
				input.supervisorActivityStateRoot ?? input.workspaceRoot,
				event,
			);
		}
	} catch {
		// Supervisor activity telemetry is best-effort and must never block hooks.
	}
	return result;
}

function skipped(
	input: Pick<CommonHookInput, "projectId" | "workspaceRoot">,
	trigger: IduSupervisorTrigger,
	reason: IduSupervisorHookReason,
): IduSupervisorHookResult {
	return {
		status: "skipped",
		reason,
		trigger,
		projectId: input.projectId,
		bypassedThrottle: false,
		throttleStatePath: statePath(input.workspaceRoot),
		summary:
			reason === "idu_inactive"
				? "Idu-pi está apagado. Hook omitido."
				: reason === "no_new_events"
					? "No hay eventos nuevos relevantes para supervisor."
					: "Supervisor omitido.",
		safety: SAFE_FLAGS,
	};
}

function statePath(workspaceRoot: string): string {
	return join(workspaceRoot, "reports", "idu-supervisor-hook-state.json");
}

function readState(path: string): HookState {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as HookState;
	} catch {
		return {};
	}
}

function writeState(path: string, projectId: string, now: Date): void {
	const state = readState(path);
	const projects = { ...(state.projects ?? {}) };
	projects[projectId] = { lastRunAt: now.toISOString() };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ projects }, null, 2)}\n`);
}

function isHighOrBlocker(risk: ProjectPreflightRisk | undefined): boolean {
	return risk === "high" || risk === "blocker";
}
