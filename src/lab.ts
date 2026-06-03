import type { AgentProfile } from "./config.js";
import type { AgentRouter } from "./agent-router.js";
import type { BugFindingInput, ProposalInput } from "./lab-db.js";
import { parseLabFindingsFromOutput } from "./lab-finding-parser.js";
import {
	loadLabProjectContext,
	type LabProjectContext,
} from "./lab-context.js";
import {
	createLabFindingRuleValidator,
	validateParsedLabFindingForPersistence,
	type LabFindingRuleValidator,
} from "./lab-rule-validation.js";
import {
	type LabReportStore,
	summarizeOutput,
	type LabRunRecord,
} from "./lab-reports.js";

export const LAB_DURATIONS = [
	{
		label: "quick",
		ms: 5 * 60_000,
		maxCommands: 1,
		description: "1 verificación corta",
	},
	{
		label: "3tests",
		ms: 15 * 60_000,
		maxCommands: 3,
		description: "hasta 3 comandos",
	},
	{
		label: "5tests",
		ms: 25 * 60_000,
		maxCommands: 5,
		description: "hasta 5 comandos",
	},
	{
		label: "full",
		ms: 45 * 60_000,
		maxCommands: 12,
		description: "suite completa razonable",
	},
] as const;

export type LabDuration = (typeof LAB_DURATIONS)[number];

export function parseLabDuration(input: string): LabDuration | undefined {
	const normalized = input.trim().toLowerCase().replace(/\.$/u, "");
	const index = Number(normalized);
	if (Number.isInteger(index) && index >= 1 && index <= LAB_DURATIONS.length) {
		return LAB_DURATIONS[index - 1];
	}
	return LAB_DURATIONS.find((duration) => duration.label === normalized);
}

export function formatDurationChoices(): string {
	return LAB_DURATIONS.map(
		(duration, index) =>
			`${index + 1}. ${duration.label} - ${duration.description}`,
	).join("\n");
}

export function labPrompt(
	duration: LabDuration,
	agent: AgentProfile,
	projectContext?: LabProjectContext,
): string {
	const contextBlock = projectContext
		? `\n\nProject context budget JSON:\n${JSON.stringify(projectContext.contextBudget, null, 2)}\n\nContexto del proyecto real:\n${projectContext.text}`
		: "";
	return `Modo laboratorio de tests para ${agent.label}. Profundidad: ${duration.label} (${duration.description}). Límite de seguridad: ${Math.round(duration.ms / 60_000)} minutos.${contextBlock}

Reglas obligatorias:
- Trabajá solo dentro de tu workspace/clon.
- No modifiques el repo real.
- No hagas commit.
- No hagas push.
- Corré como máximo ${duration.maxCommands} comandos de test/verificación.
- Si el proyecto usa pnpm, preferí Corepack: corepack pnpm test. No uses pnpm directo si no verificaste que está en PATH.
- No te cortes por tiempo salvo emergencia: terminá el comando en curso y reportá.
- Antes de verificar, detectá contexto del proyecto: scripts de test, README/docs, skills en .agents/skills o .pi/skills y MCP/tools disponibles.
- Si existe .agents/skills/buenas-practicas-bd/SKILL.md, considerala contexto prioritario.
- Usá MCP/tools disponibles solo si aportan evidencia; si fallan, reportalo como detalle técnico secundario.
- Si necesitás inspeccionar código, hacelo solo para diagnosticar.
- Reportá comandos ejecutados, resultados, fallas, evidencia, posible causa y sugerencia.
- Si un problema ya está resuelto, indicalo como resuelto.
- No inventes bugs: mejor devolver findings: [] que inventar problemas.
- Sin evidencia, title o description, no reportes algo como finding.
- Si revisaste y no encontraste fallas, explicá qué revisaste y dejá findings: [].

Formato preferente si hay hallazgos: respondé con JSON AgentLabReport válido. No es obligatorio todavía; si no podés producir JSON, podés responder texto normal.
Contrato AgentLabReport:
- role debe ser uno de: security, database, code_quality, ui_ux, performance, docs, general.
- summary es obligatorio.
- findings puede ser [] si no hay problemas con evidencia.
- Cada finding requiere title, description, evidence, severity, confidence y category.
- proposal requiere summary, steps, risk y requiresHumanApproval.
- high/critical requiere requiresHumanApproval true.
Ejemplo:
{
  "role": "general",
  "summary": "Resumen de la revisión",
  "findings": [],
  "commandsExecuted": ["corepack pnpm test"]
}

Formato de respuesta legacy aceptado:
Resumen corto
Tests/comandos ejecutados
Hallazgos con severidad y confianza
Sugerencias para el orquestador`;
}

export type LabRunRecorder = {
	recordLabRun(record: LabRunRecord): void;
	recordFindingWithProposal?(input: {
		finding: BugFindingInput;
		proposal?: ProposalInput;
	}): void;
};

function parseLabFindings(record: LabRunRecord) {
	if (!record.rawOutput) return [];
	return parseLabFindingsFromOutput(record.rawOutput, {
		projectId: record.projectId,
		agentId: record.agentId,
		labRunId: record.id,
	});
}

function persistLabRun(options: {
	store: LabReportStore;
	labRunRecorder?: LabRunRecorder;
	record: LabRunRecord;
	projectPath: string;
	ruleValidator?: LabFindingRuleValidator;
}): void {
	options.store.append(options.record);
	try {
		options.labRunRecorder?.recordLabRun(options.record);
		const validator = resolveRuleValidator(options);
		for (const finding of parseLabFindings(options.record)) {
			const decision = safeValidateFinding(finding, validator);
			const { proposal, ...bugFinding } = decision.finding;
			options.labRunRecorder?.recordFindingWithProposal?.({
				finding: bugFinding,
				proposal:
					proposal && decision.proposalAllowed
						? {
								id: `${finding.id}-proposal`,
								proposalType: proposal.proposalType ?? "investigation",
								summary: proposal.summary,
								details: proposal.details,
								priority: proposal.priority,
								createdByAgentId: options.record.agentId,
							}
						: undefined,
			});
		}
	} catch {
		// SQLite/parser/rule validation persistence is secondary; JSONL remains the source of truth.
	}
}

function resolveRuleValidator(options: {
	projectPath: string;
	ruleValidator?: LabFindingRuleValidator;
}): LabFindingRuleValidator | undefined {
	if (options.ruleValidator) return options.ruleValidator;
	try {
		return createLabFindingRuleValidator(options.projectPath);
	} catch {
		return undefined;
	}
}

function safeValidateFinding(
	finding: ReturnType<typeof parseLabFindings>[number],
	validator: LabFindingRuleValidator | undefined,
) {
	try {
		return validateParsedLabFindingForPersistence(finding, validator);
	} catch {
		return validateParsedLabFindingForPersistence(finding, undefined);
	}
}

export async function runTestLab(options: {
	router: AgentRouter;
	profile: AgentProfile;
	duration: LabDuration;
	projectId: string;
	projectPath: string;
	store: LabReportStore;
	labRunRecorder?: LabRunRecorder;
	ruleValidator?: LabFindingRuleValidator;
}): Promise<LabRunRecord> {
	const runtime = options.router.runtimeForProfile(options.profile.id);
	const startedAt = new Date().toISOString();
	const id = `${Date.now().toString(36)}-${options.profile.id}`;

	if (runtime.workspaceKind !== "clone") {
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: "skipped",
			summary: "Saltado: el agente no usa workspace clone.",
			triageStatus: "skipped",
			decisionStatus: "none",
			engramStatus: "skipped",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		persistLabRun({
			store: options.store,
			labRunRecorder: options.labRunRecorder,
			record,
			projectPath: options.projectPath,
			ruleValidator: options.ruleValidator,
		});
		return record;
	}

	if (runtime.session.busy) {
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: "skipped",
			summary: "Saltado: el agente ya estaba ocupado.",
			triageStatus: "skipped",
			decisionStatus: "none",
			engramStatus: "skipped",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		persistLabRun({
			store: options.store,
			labRunRecorder: options.labRunRecorder,
			record,
			projectPath: options.projectPath,
			ruleValidator: options.ruleValidator,
		});
		return record;
	}

	try {
		const projectContext = loadLabProjectContext(options.projectPath);
		const result = await Promise.race([
			runtime.session.prompt(
				labPrompt(options.duration, options.profile, projectContext),
			),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("LAB_TIMEOUT")),
					options.duration.ms,
				).unref(),
			),
		]);
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: result.ok ? "completed" : "failed",
			summary: summarizeOutput(result.output),
			rawOutput: result.output,
			triageStatus: "pending",
			decisionStatus: "none",
			engramStatus: "pending",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		persistLabRun({
			store: options.store,
			labRunRecorder: options.labRunRecorder,
			record,
			projectPath: options.projectPath,
			ruleValidator: options.ruleValidator,
		});
		return record;
	} catch (error) {
		const timeout = error instanceof Error && error.message === "LAB_TIMEOUT";
		if (timeout) runtime.session.cancel();
		const record: LabRunRecord = {
			id,
			projectId: options.projectId,
			projectPath: options.projectPath,
			agentId: options.profile.id,
			agentLabel: options.profile.label,
			workspace: runtime.cwd,
			durationLabel: options.duration.label,
			durationMs: options.duration.ms,
			status: timeout ? "timeout" : "failed",
			summary: timeout
				? "Tiempo máximo alcanzado; agente cancelado."
				: "Ejecución falló.",
			error: error instanceof Error ? error.message : String(error),
			triageStatus: "pending",
			decisionStatus: "none",
			engramStatus: "pending",
			startedAt,
			finishedAt: new Date().toISOString(),
		};
		persistLabRun({
			store: options.store,
			labRunRecorder: options.labRunRecorder,
			record,
			projectPath: options.projectPath,
			ruleValidator: options.ruleValidator,
		});
		return record;
	}
}
