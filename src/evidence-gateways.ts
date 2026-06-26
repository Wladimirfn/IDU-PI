import type { PhysicalGateEvidence } from "./physical-gates.js";
import type { ProjectPostflightReport } from "./project-postflight.js";
import type { ProjectPreflightReport } from "./project-preflight.js";
import type { SourceRequiredActionsReport } from "./source-digest.js";

type JsonObject = Record<string, unknown>;

export type EvidenceGatewayStatus =
	| "pass"
	| "warn"
	| "block"
	| "needs_human"
	| "needs_evidence";

export type EvidenceGatewaySource =
	| "preflight"
	| "postflight"
	| "task_package"
	| "source_required_actions"
	| "constitution"
	| "physical_gate";

export type EvidenceItem = {
	id: string;
	type:
		| "risk"
		| "context"
		| "file"
		| "rule"
		| "source"
		| "trace"
		| "policy"
		| "physical"
		| "command";
	source: EvidenceGatewaySource;
	summary: string;
	status: EvidenceGatewayStatus;
	data?: JsonObject;
};

export type EvidenceRequiredAction = {
	id: string;
	owner: "orchestrator" | "human" | "worker";
	action: string;
	reason: string;
	blocking: boolean;
	data?: JsonObject;
};

export type EvidenceGateway = {
	id: string;
	source: EvidenceGatewaySource;
	status: EvidenceGatewayStatus;
	allowedToProceed: boolean;
	summary: string;
	evidence: EvidenceItem[];
	requiredActions: EvidenceRequiredAction[];
	advisoryOnly: true;
};

export function buildPreflightEvidenceGateways(
	report: ProjectPreflightReport,
): EvidenceGateway[] {
	const evidence: EvidenceItem[] = [
		{
			id: "preflight-risk",
			type: "risk",
			source: "preflight",
			summary: `Preflight risk: ${report.risk}`,
			status: statusFromRisk(report.risk, report.requiresHumanConfirmation),
			data: {
				risk: report.risk,
				okToProceed: report.okToProceed,
				connectionStatus: report.connectionStatus,
			},
		},
		...report.affectedAreas.map((area, index) => ({
			id: `preflight-area-${index + 1}`,
			type: "context" as const,
			source: "preflight" as const,
			summary: `Affected area: ${area}`,
			status: report.risk === "low" ? ("pass" as const) : ("warn" as const),
			data: { area },
		})),
		...report.missingContext.map((missing, index) => ({
			id: `preflight-missing-context-${index + 1}`,
			type: "context" as const,
			source: "preflight" as const,
			summary: missing,
			status: "needs_evidence" as const,
			data: { missingContext: missing },
		})),
		...report.warnings.map((warning, index) => ({
			id: `preflight-warning-${index + 1}`,
			type: "context" as const,
			source: "preflight" as const,
			summary: warning,
			status: "warn" as const,
			data: { warning },
		})),
	];

	if (report.constitutionGate) {
		evidence.push({
			id: "preflight-constitution-gate",
			type: "rule",
			source: "constitution",
			summary: `Constitution gate risk: ${report.constitutionGate.risk}`,
			status: statusFromRisk(
				report.constitutionGate.risk,
				report.constitutionGate.requiresHumanConfirmation,
			),
			data: {
				affectedRules: report.constitutionGate.affectedRules,
				failures: report.constitutionGate.failures,
				warnings: report.constitutionGate.warnings,
			},
		});
	}

	const requiredActions: EvidenceRequiredAction[] = [];
	if (report.missingContext.length > 0) {
		requiredActions.push({
			id: "preflight-provide-missing-context",
			owner: "orchestrator",
			action: "provide_missing_context_or_reduce_scope",
			reason: "Preflight detected missing evidence/context.",
			blocking: report.risk === "blocker",
			data: { missingContext: report.missingContext },
		});
	}
	if (report.requiresHumanConfirmation) {
		requiredActions.push({
			id: "preflight-human-confirmation",
			owner: "human",
			action: "approve_or_adjust_before_implementation",
			reason: "Preflight requires explicit human/orchestrator confirmation.",
			blocking: report.risk === "blocker" || report.risk === "high",
			data: { recommendedNext: report.recommendedNext },
		});
	}
	if (report.shouldRunAgentLab) {
		requiredActions.push({
			id: "preflight-agentlab-review",
			owner: "orchestrator",
			action: "consider_explicit_agentlab_review",
			reason:
				"Preflight risk suggests audit-only AgentLab evidence may be needed.",
			blocking: false,
		});
	}

	return [
		gateway({
			id: "preflight-evidence",
			source: "preflight",
			status: statusFromRisk(report.risk, report.requiresHumanConfirmation),
			summary: report.recommendedNext,
			evidence,
			requiredActions,
		}),
	];
}

export function buildPostflightEvidenceGateways(input: {
	report: ProjectPostflightReport;
	taskTrace?: JsonObject;
}): EvidenceGateway[] {
	const { report, taskTrace } = input;
	const evidence: EvidenceItem[] = [
		{
			id: "postflight-risk",
			type: "risk",
			source: "postflight",
			summary: `Postflight risk: ${report.risk}`,
			status: statusFromRisk(report.risk, report.requiresHumanConfirmation),
			data: {
				risk: report.risk,
				observedChangeMode: report.observedChangeMode,
				impactedAreas: report.impactedAreas,
			},
		},
		...report.changedFiles.map((file, index) => ({
			id: `postflight-changed-file-${index + 1}`,
			type: "file" as const,
			source: "postflight" as const,
			summary: `Changed file: ${file}`,
			status:
				report.risk === "blocker" ? ("block" as const) : ("warn" as const),
			data: { file },
		})),
		...(report.ignoredFiles ?? []).map((file, index) => ({
			id: `postflight-ignored-file-${index + 1}`,
			type: "file" as const,
			source: "postflight" as const,
			summary: `Ignored file: ${file}`,
			status: "pass" as const,
			data: { file, ignored: true },
		})),
		...report.warnings.map((warning, index) => ({
			id: `postflight-warning-${index + 1}`,
			type: "context" as const,
			source: "postflight" as const,
			summary: warning,
			status: "warn" as const,
			data: { warning },
		})),
	];

	if (taskTrace) {
		evidence.push({
			id: "postflight-task-trace",
			type: "trace",
			source: "postflight",
			summary:
				taskTrace.matchesIntent === false
					? "Postflight task trace does not fully match expected intent."
					: "Postflight task trace matches expected intent.",
			status: taskTrace.matchesIntent === false ? "needs_evidence" : "pass",
			data: taskTrace,
		});
	}
	if (report.constitutionGate) {
		evidence.push({
			id: "postflight-constitution-gate",
			type: "rule",
			source: "constitution",
			summary: `Constitution gate risk: ${report.constitutionGate.risk}`,
			status: statusFromRisk(
				report.constitutionGate.risk,
				report.constitutionGate.requiresHumanConfirmation,
			),
			data: {
				affectedRules: report.constitutionGate.affectedRules,
				failures: report.constitutionGate.failures,
				warnings: report.constitutionGate.warnings,
			},
		});
	}

	const requiredActions: EvidenceRequiredAction[] = [];
	if (report.requiresHumanConfirmation) {
		requiredActions.push({
			id: "postflight-human-confirmation",
			owner: "human",
			action: "review_postflight_before_closure",
			reason: "Postflight risk or deterministic gates require confirmation.",
			blocking: report.risk === "blocker" || report.risk === "high",
			data: { recommendedNext: report.recommendedNext },
		});
	}
	if (report.shouldRunAgentLab || report.suggestedAgentLabs.length > 0) {
		requiredActions.push({
			id: "postflight-agentlab-review",
			owner: "orchestrator",
			action: "consider_explicit_agentlab_review",
			reason: "Postflight suggests audit-only AgentLab review.",
			blocking: report.risk === "blocker",
			data: { suggestedAgentLabs: report.suggestedAgentLabs },
		});
	}
	if (taskTrace?.matchesIntent === false) {
		requiredActions.push({
			id: "postflight-resolve-task-trace-delta",
			owner: "orchestrator",
			action: "resolve_task_trace_delta",
			reason:
				"Observed changes do not fully match expected files/contracts/mode.",
			blocking: false,
			data: taskTrace,
		});
	}

	const status =
		taskTrace?.matchesIntent === false
			? "needs_evidence"
			: statusFromRisk(report.risk, report.requiresHumanConfirmation);
	return [
		gateway({
			id: "postflight-evidence",
			source: "postflight",
			status,
			summary: report.recommendedNext,
			evidence,
			requiredActions,
		}),
	];
}

export function buildPhysicalEvidenceGateways(
	physicalGates: PhysicalGateEvidence[],
): EvidenceGateway[] {
	if (physicalGates.length === 0) return [];
	const evidence: EvidenceItem[] = physicalGates.map((gate) => ({
		id: gate.id,
		type: gate.command ? "command" : "physical",
		source: "physical_gate",
		summary: gate.summary,
		status: evidenceStatusFromPhysicalGate(gate.status),
		data: gate as unknown as JsonObject,
	}));
	const requiredActions: EvidenceRequiredAction[] = physicalGates
		.filter((gate) =>
			["fail", "error", "needs_evidence"].includes(gate.status),
		)
		.map((gate) => ({
			id: `${gate.id}-resolve`,
			owner: "orchestrator",
			action: "resolve_failed_physical_gate",
			reason: gate.summary,
			blocking: gate.status === "fail",
			data: { gateId: gate.id, kind: gate.kind, status: gate.status },
		}));
	const status = gatewayStatusFromPhysicalGates(physicalGates);
	return [
		gateway({
			id: "physical-gates",
			source: "physical_gate",
			status,
			summary: physicalGatewaySummary(physicalGates),
			evidence,
			requiredActions,
		}),
	];
}

export function buildTaskPackageEvidenceGateways(
	taskPackage: JsonObject,
): EvidenceGateway[] {
	const preconditions = objectField(taskPackage, "preconditions");
	const governanceReview = objectField(taskPackage, "governanceReview");
	const preconditionsBlocked = preconditions.blocked === true;
	const humanApprovalRequired = taskPackage.humanApprovalRequired === true;
	const orchestratorDecisionRequired =
		taskPackage.orchestratorDecisionRequired === true;
	const status: EvidenceGatewayStatus = preconditionsBlocked
		? "block"
		: humanApprovalRequired || orchestratorDecisionRequired
			? "needs_human"
			: governanceReview.required === true
				? "warn"
				: "pass";
	const evidence: EvidenceItem[] = [
		{
			id: "taskpkg-preconditions",
			type: "policy",
			source: "task_package",
			summary: preconditionsBlocked
				? "Task package preconditions are blocked."
				: "Task package preconditions are satisfied.",
			status: preconditionsBlocked ? "block" : "pass",
			data: preconditions,
		},
		{
			id: "taskpkg-governance-review",
			type: "policy",
			source: "task_package",
			summary: "Governance review is required before worker implementation.",
			status: governanceReview.required === true ? "needs_human" : "pass",
			data: governanceReview,
		},
	];
	const requiredActions: EvidenceRequiredAction[] = [];
	if (preconditionsBlocked) {
		requiredActions.push({
			id: "taskpkg-resolve-preconditions",
			owner: "orchestrator",
			action: "resolve_task_package_preconditions",
			reason: "Task package preconditions are blocked.",
			blocking: true,
			data: preconditions,
		});
	}
	if (governanceReview.required === true) {
		requiredActions.push({
			id: "taskpkg-run-governance-review",
			owner: "orchestrator",
			action: "run_governance_review_before_worker",
			reason:
				"Idu-pi package is advisory; the orchestrator must review scope/contracts.",
			blocking: false,
			data: governanceReview,
		});
	}
	if (taskPackage.postflightRequired === true) {
		requiredActions.push({
			id: "taskpkg-postflight-required",
			owner: "orchestrator",
			action: "run_idu_postflight_after_diff",
			reason: "Task package requires postflight evidence after implementation.",
			blocking: false,
		});
	}
	return [
		gateway({
			id: "taskpkg-evidence",
			source: "task_package",
			status,
			summary: preconditionsBlocked
				? "Task package is blocked until preconditions are resolved."
				: "Task package requires orchestrator governance review before implementation.",
			evidence,
			requiredActions,
		}),
	];
}

export function buildSourceRequiredActionsEvidenceGateways(
	report: SourceRequiredActionsReport,
): EvidenceGateway[] {
	const hasActions = report.actions.length > 0;
	const evidence: EvidenceItem[] = report.actions.map((action, index) => ({
		id: `source-required-action-${index + 1}`,
		type: "source",
		source: "source_required_actions",
		summary: `Source requires specialized reader: ${action.title}`,
		status: "needs_evidence",
		data: {
			sourceId: action.sourceId,
			title: action.title,
			kind: action.kind,
			digestStatus: action.digestStatus,
			conversionStatus: action.conversionStatus,
			requiredAction: action.requiredAction,
			contractPromotionAllowed: action.contractPromotionAllowed,
		},
	}));
	if (!hasActions) {
		evidence.push({
			id: "source-required-actions-none",
			type: "source",
			source: "source_required_actions",
			summary: "No source currently requires a specialized reader.",
			status: "pass",
			data: { actions: 0 },
		});
	}
	return [
		gateway({
			id: "source-required-actions-evidence",
			source: "source_required_actions",
			status: hasActions ? "needs_evidence" : "pass",
			summary: hasActions
				? `${report.actions.length} source(s) require specialized reader evidence.`
				: "All registered sources have no pending specialized-reader action.",
			evidence,
			requiredActions: report.actions.map((action, index) => ({
				id: `dispatch-librarian-reader-${index + 1}`,
				owner: "orchestrator",
				action: action.requiredAction.action,
				reason: action.requiredAction.reason,
				blocking: true,
				data: {
					sourceId: action.sourceId,
					title: action.title,
					recommendedAgent: action.requiredAction.recommendedAgent,
					recommendedReaderType: action.requiredAction.recommendedReaderType,
					instructions: action.requiredAction.instructions,
					contractPromotionAllowed:
						action.requiredAction.contractPromotionAllowed,
				},
			})),
		}),
	];
}

function evidenceStatusFromPhysicalGate(
	status: PhysicalGateEvidence["status"],
): EvidenceGatewayStatus {
	if (status === "fail") return "block";
	if (status === "error" || status === "needs_evidence") return "needs_evidence";
	if (status === "warn" || status === "not_run") return "warn";
	return "pass";
}

function gatewayStatusFromPhysicalGates(
	physicalGates: PhysicalGateEvidence[],
): EvidenceGatewayStatus {
	if (physicalGates.some((gate) => gate.status === "fail")) return "block";
	if (
		physicalGates.some((gate) =>
			["error", "needs_evidence"].includes(gate.status),
		)
	) {
		return "needs_evidence";
	}
	if (
		physicalGates.some((gate) =>
			["warn", "not_run"].includes(gate.status),
		)
	) {
		return "warn";
	}
	return "pass";
}

function physicalGatewaySummary(physicalGates: PhysicalGateEvidence[]): string {
	const counts = physicalGates.reduce<Record<string, number>>((acc, gate) => {
		acc[gate.status] = (acc[gate.status] ?? 0) + 1;
		return acc;
	}, {});
	return `Physical gates: ${Object.entries(counts)
		.map(([status, count]) => `${status}=${count}`)
		.join(", ")}`;
}

function gateway(
	input: Omit<EvidenceGateway, "allowedToProceed" | "advisoryOnly">,
): EvidenceGateway {
	return {
		...input,
		allowedToProceed: input.status === "pass" || input.status === "warn",
		advisoryOnly: true,
	};
}

function statusFromRisk(
	risk: "low" | "medium" | "high" | "blocker",
	requiresHuman: boolean,
): EvidenceGatewayStatus {
	if (risk === "blocker") return "block";
	if (requiresHuman || risk === "high") return "needs_human";
	if (risk === "medium") return "warn";
	return "pass";
}

function objectField(source: JsonObject, key: string): JsonObject {
	const value = source[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: {};
}

// Tema B: shared file-classifier primitive (was duplicated between
// project-postflight.ts and project-constitution.ts). Path-based check so
// callers cannot bypass it by reword-only mentions of "database" / "schema".
export function isDbFile(file: string): boolean {
	return /(prisma|supabase|sqlite|lab-db|migration|migrations|schema)/u.test(
		file,
	);
}
