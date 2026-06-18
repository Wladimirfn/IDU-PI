/**
 * helpers.ts — master-plan + automaticov1 + execution-director helpers
 * for the CLI dispatch.
 *
 * Internal-only. Re-exported by `index.ts`. Used by `src/cli.ts` for
 * the cases `idu-master-plan-*`, `idu-automaticov1`,
 * `idu-execution-director-tick`, `idu-events`, `master-plan-*` aliases.
 *
 * AUDIT-FIX (PR 2): formatExecutionDirectorTick has one forced type
 * annotation. Inside `cli.ts`, `note` was inferred as `string` by
 * context. When extracted to this module, the inference context changed;
 * under `noImplicitAny` strict mode, TypeScript required an explicit
 * annotation. Zero runtime effect (type annotations are erased).
 */

import type { Automaticov1CycleResult } from "../../automaticov1-cycle.js";
import { runAutomaticov1AdvisoryCycle } from "../../automaticov1-cycle.js";
import {
	buildExecutionDirectorTick,
	type ExecutionDirectorTickInput,
} from "../../execution-director-tick.js";
import { inferTaskTemplateKind } from "../../task-templates.js";
import { getIduSessionStatus } from "../../idu-session.js";
import { buildIduExecutionReadiness } from "../../idu-execution-readiness.js";
import { readIduUsageEvents, buildIduUsageReport } from "../../usage-events.js";
import { loadProjectConstitution } from "../../project-constitution.js";
import { loadProjectCore } from "../../project-core.js";
import { buildMasterPlanTaskTree } from "../../master-plan-task-tree.js";
import {
	recommendExternalSources,
	type ExternalSourceDomain,
} from "../../external-source-registry.js";
import { buildExternalIntelligenceReport } from "../../external-intelligence.js";
import {
	inspectEvents,
	formatInspectEventsReport,
} from "../../events-inspector.js";
import {
	ProposalOutboxStore,
	type FlowBoundProposal,
} from "../../proposal-outbox.js";
import { buildCliSelfMaintenanceReport } from "../_shared/index.js";
import type { CliRuntime } from "../../cli.js";
import type { CliResult } from "../dispatch-glue/index.js";
import { ok } from "../dispatch-glue/index.js";
import type { ExecutionDirectorCliResult } from "./types.js";

export function loadAutomaticov1Plan(runtime: CliRuntime) {
	if (!runtime.masterPlanReview) return undefined;
	try {
		return runtime.masterPlanReview("latest").plan;
	} catch {
		return undefined;
	}
}

export function loadCliExecutionReadiness(runtime: CliRuntime) {
	const taskTree = buildMasterPlanTaskTree(loadAutomaticov1Plan(runtime));
	const usageReport = buildIduUsageReport(
		readIduUsageEvents(runtime.workspaceRoot, 500),
	);
	return buildIduExecutionReadiness({
		coreStatus: safeProjectCoreStatus(runtime.projectPath),
		constitutionStatus: safeProjectConstitutionStatus(runtime.projectPath),
		taskTreeStatus: taskTree.status,
		mcpContextPackStaleness: usageReport.mcpContextPackStaleness,
	});
}

export function safeProjectCoreStatus(projectPath: string) {
	try {
		return loadProjectCore(projectPath).status;
	} catch {
		return "unknown" as const;
	}
}

export function safeProjectConstitutionStatus(projectPath: string) {
	try {
		return loadProjectConstitution(projectPath).status;
	} catch {
		return "unknown" as const;
	}
}

export function runCliExecutionDirectorTick(
	input: ExecutionDirectorTickInput & { stateRoot: string },
): ExecutionDirectorCliResult {
	const tick = buildExecutionDirectorTick(input);
	const store = new ProposalOutboxStore({ stateRoot: input.stateRoot });
	const savedProposals = tick.proposals.map((proposal) =>
		store.createProposal(proposal),
	);
	return { ...tick, savedProposals };
}

export function formatExecutionDirectorTick(
	result: ExecutionDirectorCliResult,
): string {
	return [
		"Execution Director Tick",
		`status: ${result.status}`,
		`authority: ${result.authority}`,
		`proposals: ${result.proposals.length}`,
		`savedProposals: ${result.savedProposals.length}`,
		"",
		"Safe notes:",
		...result.safeNotes.map((note: string) => `- ${note}`),
	].join("\n");
}

export function formatProposalOutbox(proposals: FlowBoundProposal[]): string {
	if (!proposals.length) return "Proposal outbox is empty.";
	return [
		`Proposal outbox (${proposals.length})`,
		...proposals.map(
			(proposal) =>
				`- ${proposal.id}: ${proposal.title} [${proposal.status}] hito=${proposal.hitoId} flow=${proposal.flowId}`,
		),
	].join("\n");
}

export function formatProposalDetail(
	proposal: FlowBoundProposal | undefined,
	id: string,
): string {
	if (!proposal) return `Proposal not found: ${id}`;
	return JSON.stringify(proposal, null, 2);
}

export async function runCliAutomaticov1Cycle(
	runtime: CliRuntime,
	parts: string[],
): Promise<Automaticov1CycleResult> {
	const command = parts[0] === "cycle" ? parts.slice(1) : parts;
	const allowTaskCreation = command.includes("--allow-task-creation");
	const allowExternalFetch = command.includes("--allow-external-fetch");
	const allowSkillDraftProposal = command.includes("--allow-skill-proposals");
	let selfMaintenance:
		| ReturnType<typeof buildCliSelfMaintenanceReport>
		| undefined;
	const loadSelfMaintenance = () => {
		selfMaintenance ??= buildCliSelfMaintenanceReport(
			runtime,
			runtime.workspaceRoot,
		);
		return selfMaintenance;
	};
	const request =
		"automaticov1 cyclic autonomous loop: Bibliotecario evidence/news/docs intelligence, supervisor participation, skill proposals, project structure optimization, failure detection and repair boundaries.";
	return runAutomaticov1AdvisoryCycle({
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		stateRoot: runtime.workspaceRoot,
		iduActive: getIduSessionStatus(runtime.projectId).active,
		allowTaskCreation,
		allowExternalFetch,
		allowSkillDraftProposal,
		usageEvents: readIduUsageEvents(runtime.workspaceRoot, 500),
		loadPlan: () => {
			if (!runtime.masterPlanReview) {
				return {
					status: "draft",
					inferredObjective:
						"Master Plan no disponible; automaticov1 bloqueado para evitar autonomía sin objetivo.",
					executiveSummary:
						"Master Plan no disponible; no se ejecuta ciclo autónomo real.",
					criticalRisks: ["Master Plan no disponible"],
				};
			}
			try {
				return runtime.masterPlanReview("latest").plan as unknown as Record<
					string,
					unknown
				>;
			} catch (error) {
				return {
					status: "draft",
					inferredObjective:
						"Master Plan no disponible o ilegible; automaticov1 bloqueado para evitar drift.",
					executiveSummary: String(
						error instanceof Error ? error.message : error,
					),
					criticalRisks: ["Master Plan no disponible"],
				};
			}
		},
		loadTasks: () => loadSelfMaintenance().tasks,
		loadTaskTree: () => buildMasterPlanTaskTree(loadAutomaticov1Plan(runtime)),
		loadExecutionReadiness: () => loadCliExecutionReadiness(runtime),
		loadSelfMaintenanceSignals: () => loadSelfMaintenance().report.signals,
		createTask: (draft) => {
			const task = runtime.createTask(
				inferTaskTemplateKind(draft.text),
				draft.text,
			);
			return { id: task.id };
		},
		buildSupervisorCronPlan: () => runtime.supervisorCronPlan(),
		buildBibliotecarioSnapshot: () => ({
			local: runtime.sourceRecommend(request),
			requiredActions: runtime.sourceRequiredActions(),
			externalRegistry: recommendExternalSources({
				projectId: runtime.projectId,
				request,
				domains: [
					"programming_structure",
					"security",
					"academic",
					"standards",
				] as ExternalSourceDomain[],
				language: "typescript",
				framework: "node",
				maxMatches: 8,
			}),
			rawContentIncluded: false,
			webFetchAllowed: false,
			contractPromotionAllowed: false,
		}),
		buildExternalIntelligenceReport: () =>
			buildExternalIntelligenceReport({ projectId: runtime.projectId }),
		createSkillDraftFromLessons: () =>
			runtime.skillDraftFromLessons({ mode: "proposal-only" }),
	});
}

export function formatCliAutomaticov1Cycle(
	result: Automaticov1CycleResult,
): string {
	const lines: string[] = [
		"🤖 automaticov1 cycle",
		`status: ${result.status}`,
		`authority: ${result.authority}`,
		`allowedToProceed: ${result.allowedToProceed}`,
		`taskCreation: ${result.allowTaskCreation ? "enabled" : "disabled"}`,
		`externalFetch: ${result.externalFetchExecuted ? "executed" : "disabled"}`,
		`skillProposals: ${result.skillProposalExecuted ? "executed" : "disabled"}`,
		`alertTick: ${result.alertScheduledTick.status}`,
		`alertDecisions: ${result.alertScheduledTick.report?.decisions.length ?? 0}`,
		`tasksCreated: ${result.alertScheduledTick.tasksCreated.length}`,
	];
	if (result.birth) {
		const b = result.birth;
		lines.push("");
		lines.push("Birth:");
		lines.push(`- state: ${b.state}`);
		lines.push(`- allowedToImplement: ${b.allowedToImplement}`);
		lines.push(`- repoWritesAllowed: ${b.repoWritesAllowed}`);
		lines.push(`- nextRequiredAction: ${b.nextRequiredAction}`);
		if (b.scopeLimit) lines.push(`- scopeLimit: ${b.scopeLimit}`);
		if (b.blockingReasons.length > 0) {
			lines.push("- blockingReasons:");
			for (const r of b.blockingReasons) lines.push(`  - ${r}`);
		}
	}
	lines.push("");
	lines.push("Evidence:");
	lines.push(...result.evidenceRefs.map((ref) => `- ${ref}`));
	lines.push("");
	lines.push("Next:");
	lines.push(...result.nextActions.map((action) => `- ${action}`));
	lines.push("");
	lines.push("Safe notes:");
	lines.push(...result.safeNotes.map((note) => `- ${note}`));
	return lines.join("\n");
}

export function handleCliEventsInspectCommand(
	runtime: CliRuntime,
	parts: string[],
): CliResult {
	const projectId =
		parts.find((p) => p.startsWith("--project="))?.slice("--project=".length) ??
		runtime.projectId;
	const kindsArg = parts
		.find((p) => p.startsWith("--kinds="))
		?.slice("--kinds=".length);
	const kinds = kindsArg
		? kindsArg
				.split(",")
				.map((k) => k.trim())
				.filter(Boolean)
		: undefined;
	const since = parts
		.find((p) => p.startsWith("--since="))
		?.slice("--since=".length);
	const until = parts
		.find((p) => p.startsWith("--until="))
		?.slice("--until=".length);
	const limitArg = parts
		.find((p) => p.startsWith("--limit="))
		?.slice("--limit=".length);
	const limit = limitArg ? Number.parseInt(limitArg, 10) : undefined;
	if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
		return ok(`Events: limit inválido "${limitArg}"`);
	}
	const result = inspectEvents({
		stateRoot: runtime.workspaceRoot,
		projectId,
		kinds,
		since: since ? new Date(since) : undefined,
		until: until ? new Date(until) : undefined,
		limit,
		now: new Date(),
	});
	return ok(formatInspectEventsReport(result));
}
