#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { canonicalDirectory, isAllowedCwd, loadConfig } from "./config.js";
import { createCliRuntime, type CliRuntime } from "./cli.js";
import type { SkillDraftFromLessonsMode } from "./skill-draft-from-lessons.js";
import { applyPackageEnvDefaults, resolveIduRegistryPath } from "./cli-home.js";
import { runIduBootstrap } from "./idu-bootstrap.js";
import {
	projectEnroll,
	projectInstallStatus,
	type ProjectEnrollResult,
} from "./idu-installer.js";
import {
	buildPreflightOrchestratorAdvisory,
	buildProjectAdvisoryForOrchestrator,
	buildSupervisorLoopOrchestratorAdvisory,
} from "./orchestrator-advisory.js";
import {
	buildPhysicalEvidenceGateways,
	buildPostflightEvidenceGateways,
	buildPreflightEvidenceGateways,
	buildSourceRequiredActionsEvidenceGateways,
	buildTaskPackageEvidenceGateways,
} from "./evidence-gateways.js";
import {
	buildDecisionEnvelope,
	decisionEnvelopeFromAdvisory,
	decisionEnvelopeFromEvidence,
} from "./decision-envelope.js";
import { buildPostflightTaskTrace } from "./postflight-core.js";
import {
	CONTEXT_BUDGETS,
	createContextBudgetUsage,
	mergeContextBudgetUsage,
	sliceListToBudget,
	sliceTextToBudget,
	type ContextBudgetProfile,
	type ContextBudgetUsage,
} from "./context-budget.js";
import { buildArchitecturalPruningPlan } from "./architectural-pruning-plan.js";
import { buildContextPruningAdvisoryReport } from "./context-pruning-advisory.js";
import { buildAutonomousAlertEngineReport } from "./autonomous-alert-engine.js";
import { runAutomaticov1AdvisoryCycle } from "./automaticov1-cycle.js";
import { buildIduExecutionReadiness } from "./idu-execution-readiness.js";
import { buildMasterPlanTaskTree } from "./master-plan-task-tree.js";
import {
	appendAutonomousAlertDecision,
	readAutonomousAlertEngineState,
	updateAutonomousAlertControlState,
} from "./autonomous-alert-engine-state.js";
import {
	buildSupervisorSelfMaintenanceAdvisory,
	SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
} from "./supervisor-self-maintenance-advisory.js";
import {
	buildExternalIntelligenceReport,
	writeExternalIntelligenceReport,
} from "./external-intelligence.js";
import {
	recommendExternalSources,
	type ExternalSourceDomain,
} from "./external-source-registry.js";
import { inferTaskTemplateKind } from "./task-templates.js";
import {
	activateIduSession,
	configureIduSessionStore,
	deactivateIduSession,
	getIduSessionStatus,
} from "./idu-session.js";
import {
	getActiveProject,
	loadRegistry,
	slugifyProjectId,
} from "./projects.js";
import type { StructuredTask } from "./structured-task-queue.js";
import { loadProjectCore } from "./project-core.js";
import { loadProjectConstitution } from "./project-constitution.js";
import {
	buildIduUsageReport,
	filterRecentIduUsageEvents,
	readIduUsageEvents,
	recordIduUsageEvent,
} from "./usage-events.js";
import {
	agentLabEffectivenessEventFromRequestPlan,
	agentLabEffectivenessEventFromRunResult,
	agentLabEffectivenessEventFromStatus,
	buildAgentLabEffectivenessReport,
	readAgentLabEffectivenessEvents,
	recordAgentLabEffectivenessEventDeferred,
} from "./agentlab-effectiveness-events.js";
import {
	contextQualityEventFromSupervisorContextPack,
	recordContextQualityEventDeferred,
} from "./context-quality-events.js";
import {
	filterRecentSupervisorActivityEvents,
	readSupervisorActivityEvents,
	recordSupervisorActivityEventDeferred,
	summarizeSupervisorActivityEvents,
} from "./supervisor-activity-events.js";
import {
	buildAgentLabWorkloadEnvelope,
	type AgentLabSpecialty,
	type AgentLabWorkloadEnvelope,
} from "./agentlab-supervisor-contract.js";
import type {
	AgentLabReviewRequestPlan,
	AgentLabSourceLibraryEvidence,
} from "./agentlab-review-requests.js";
import type {
	AgentLabReviewRunResult,
	AgentLabReviewStatus,
} from "./agentlab-review-runner.js";
import type {
	SourceRecommendationReport,
	SourceRequiredActionsReport,
} from "./source-digest.js";

type JsonObject = Record<string, unknown>;

export type IduMcpToolName =
	| "idu_project_status"
	| "idu_project_enroll"
	| "idu_project_reset_state"
	| "idu_bootstrap_project"
	| "idu_start"
	| "idu_status"
	| "idu_activate"
	| "idu_deactivate"
	| "idu_prepare"
	| "idu_master_plan_status"
	| "idu_master_plan_create"
	| "idu_master_plan_review"
	| "idu_master_plan_approve"
	| "idu_master_plan_reject"
	| "idu_plan_snapshot"
	| "idu_next_advisory_action"
	| "idu_continuation_proposal"
	| "idu_task_package_create"
	| "idu_supervisor_context_pack"
	| "idu_orchestrator_procedure"
	| "idu_task_context"
	| "idu_preflight"
	| "idu_advisory"
	| "idu_postflight"
	| "idu_supervisor_tick"
	| "idu_supervisor_cron_plan"
	| "idu_architectural_pruning_plan"
	| "idu_context_pruning_advisory"
	| "idu_supervisor_self_maintenance_advisory"
	| "idu_autonomous_alerts_status"
	| "idu_autonomous_alerts_tick"
	| "idu_autonomous_alerts_control"
	| "idu_automaticov1_cycle"
	| "idu_bibliotecario_proactive_advisory"
	| "idu_external_intelligence_report"
	| "idu_external_source_recommend"
	| "idu_task"
	| "idu_queue_detail"
	| "idu_queue_complete"
	| "idu_semantic_audit_status"
	| "idu_source_status"
	| "idu_source_add"
	| "idu_source_remove"
	| "idu_source_read"
	| "idu_source_extract"
	| "idu_source_report"
	| "idu_source_research_report"
	| "idu_source_digest"
	| "idu_source_digest_status"
	| "idu_source_chunk_read"
	| "idu_source_recommend_for_task"
	| "idu_source_required_actions"
	| "idu_source_skill_candidates_create"
	| "idu_source_skill_candidates_review"
	| "idu_skill_draft_from_lessons"
	| "idu_source_refresh"
	| "idu_agentlab_request_create"
	| "idu_agentlab_review_run"
	| "idu_agentlab_review_status";

export type IduMcpProjectResolutionStatus =
	| "registered_project"
	| "active_project"
	| "unregistered_project"
	| "invalid_project";

export type IduMcpProjectResolution = {
	status: IduMcpProjectResolutionStatus;
	projectId: string;
	projectPath: string;
	stateRoot?: string;
	recommendedNext?: string;
	safeNotes: string[];
	errors: string[];
};

export type IduMcpToolResult = {
	ok: boolean;
	tool: IduMcpToolName;
	projectId: string | null;
	projectPath: string | null;
	summary: string;
	data: JsonObject;
	safeNotes: string[];
	errors: string[];
};

export type IduMcpRuntimeFactory = (projectPath?: string) => CliRuntime;
export type IduMcpProjectResolver = (
	projectPath?: string,
) => IduMcpProjectResolution;

export type IduMcpServerOptions = {
	runtimeFactory?: IduMcpRuntimeFactory;
	projectResolver?: IduMcpProjectResolver;
};

export type McpJsonRpcRequest = {
	jsonrpc?: unknown;
	id?: unknown;
	method?: unknown;
	params?: unknown;
};

export type McpJsonRpcResponse = {
	jsonrpc: "2.0";
	id: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

export type IduMcpToolDefinition = {
	name: IduMcpToolName;
	description: string;
	inputSchema: JsonObject;
};

const SAFE_BASE_NOTES = [
	"MCP expone Idu-pi al orquestador; no reemplaza el núcleo supervisor.",
	"No ejecuté Telegram.",
	"No hice commit ni push.",
];

const TOOLS: IduMcpToolDefinition[] = [
	tool(
		"idu_project_status",
		"Inspecciona registro y estado aislado del proyecto sin escribir archivos.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_project_enroll",
		"Registra explícitamente un proyecto y crea estado aislado sin drafts ni scans.",
		{
			projectPath: requiredString("Ruta obligatoria del proyecto objetivo."),
			projectId: optionalString("ID opcional del proyecto."),
		},
	),
	tool(
		"idu_project_reset_state",
		"Borra todo el estado aislado del proyecto registrado sin desregistrar ni tocar el repo real. Requiere confirm=true.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			confirm: optionalBoolean(
				"Debe ser true para ejecutar el borrado destructivo.",
			),
		},
	),
	tool(
		"idu_bootstrap_project",
		"Bootstrap explícito: enrola y crea drafts seguros sólo si allowCreateDrafts=true.",
		{
			projectPath: requiredString("Ruta obligatoria del proyecto objetivo."),
			allowCreateDrafts: optionalBoolean(
				"Permite crear Project Core/Constitution/blueprint/flows draft.",
			),
			activate: optionalBoolean("Activa guardrails después del bootstrap."),
		},
	),
	tool(
		"idu_start",
		"Entrada cómoda para proyectos ya registrados: activa y muestra dashboard sin enrolar automáticamente.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool("idu_status", "Inspecta conexión, sesión y siguiente acción segura.", {
		projectPath: optionalString("Ruta opcional del proyecto objetivo."),
	}),
	tool(
		"idu_activate",
		"Activa guardrails automáticos de Idu-pi sin scans pesados.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool("idu_deactivate", "Desactiva guardrails automáticos de Idu-pi.", {
		projectPath: optionalString("Ruta opcional del proyecto objetivo."),
	}),
	tool("idu_prepare", "Ejecuta prepare seguro sin IA ni AgentLabs.", {
		projectPath: optionalString("Ruta opcional del proyecto objetivo."),
	}),
	tool(
		"idu_master_plan_status",
		"Lee estado y rutas del Plan Maestro sin regenerar ni modificar el repo real.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_master_plan_create",
		"Crea o regenera un Plan Maestro normativo en stateRoot; separa documentación declarada, realidad construida y flujos permanentes.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			reason: optionalString("Motivo de regeneración."),
		},
	),
	tool(
		"idu_master_plan_review",
		"Revisa el Plan Maestro actual o selector indicado y devuelve JSON estructurado más markdown.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			selector: optionalString("Selector; usar latest por defecto."),
		},
	),
	tool(
		"idu_master_plan_approve",
		"Aprueba explícitamente el Plan Maestro seleccionado en stateRoot sin aplicar flows, ejecutar AgentLabs ni tocar el repo real.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			selector: optionalString("Selector; usar latest por defecto."),
			reason: optionalString("Motivo/evidencia de aprobación."),
		},
	),
	tool(
		"idu_master_plan_reject",
		"Rechaza explícitamente el Plan Maestro seleccionado en stateRoot sin borrar drafts ni tocar el repo real.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			selector: optionalString("Selector; usar latest por defecto."),
			reason: optionalString("Motivo del rechazo."),
		},
	),
	tool(
		"idu_plan_snapshot",
		"Devuelve snapshot compacto del Plan Maestro aprobado para que el orquestador cargue lineamientos sin reparsear todo el plan.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			selector: optionalString("Selector; usar latest por defecto."),
		},
	),
	tool(
		"idu_next_advisory_action",
		"Propone una próxima acción candidata desde el Plan aprobado; no implementa ni ejecuta AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			request: optionalString(
				"Solicitud humana opcional para orientar la acción.",
			),
			mode: optionalString("Modo: from_plan o from_request."),
			maxScope: optionalString("Alcance máximo sugerido: small o medium."),
		},
	),
	tool(
		"idu_continuation_proposal",
		"Propone el próximo avance autónomo alineado al Plan Maestro y cola actual; advisory-only, no implementa ni ejecuta AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			request: optionalString("Solicitud opcional para orientar continuidad."),
			autonomyWindowMinutes: optionalString(
				"Ventana de autonomía solicitada en minutos.",
			),
			maxScope: optionalString("Alcance máximo sugerido: small o medium."),
		},
	),
	tool(
		"idu_task_package_create",
		"Crea paquete de tarea para subagentes normales con brief obligatorio de governance-review antes de codificar.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			request: requiredString("Solicitud o acción candidata a empaquetar."),
			actionId: optionalString("ID opcional de acción candidata."),
			includePlanSnapshot: optionalBoolean(
				"Incluye snapshot compacto del plan.",
			),
		},
	),
	tool(
		"idu_supervisor_context_pack",
		"Compone un paquete compacto de objetivo, Plan Maestro, contratos, riesgos y gates para el orquestador/subagentes sin volcar docs largas.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			request: requiredString(
				"Solicitud o decisión que necesita contexto supervisor.",
			),
			includePlanSnapshot: optionalBoolean(
				"Incluye snapshot compacto del Plan Maestro.",
			),
		},
	),
	tool(
		"idu_orchestrator_procedure",
		"Devuelve procedimiento asesor para que el orquestador cree/actualice plan, implemente o audite sin que Idu-pi se imponga.",
		{
			purpose: requiredEnum("Propósito del procedimiento.", [
				"create_plan",
				"update_plan",
				"implement_change",
				"postflight_review",
			]),
			request: optionalString("Solicitud humana o resumen del cambio."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_task_context",
		"Entrega contexto asesor para una tarea: contratos afectados, lecturas, labs audit-only y guía para subagentes del orquestador.",
		{
			request: requiredString("Texto de la tarea o cambio propuesto."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool("idu_preflight", "Evalúa riesgo e impacto de una solicitud humana.", {
		request: requiredString("Texto humano a evaluar."),
		projectPath: optionalString("Ruta opcional del proyecto objetivo."),
	}),
	tool("idu_advisory", "Genera advisory seguro desde preflight.", {
		request: requiredString("Texto humano a asesorar."),
		projectPath: optionalString("Ruta opcional del proyecto objetivo."),
	}),
	tool(
		"idu_postflight",
		"Inspecciona cambios locales y gates sin aplicar cambios.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			actionId: optionalString(
				"ID opcional de acción candidata para trazabilidad.",
			),
			taskPackageId: optionalString(
				"ID opcional de paquete de tarea para trazabilidad.",
			),
			expectedContracts: optionalStringArray(
				"Contratos esperados para comparar contra el postflight.",
			),
			expectedFiles: optionalStringArray(
				"Archivos esperados para detectar áreas inesperadas.",
			),
			ignoredFiles: optionalStringArray(
				"Archivos local-only/ignorados explícitamente para esta revisión postflight.",
			),
			expectedChangeMode: optionalString(
				'Modo esperado del cambio: "no-op", "docs", "tests", "code" o "stateRoot".',
			),
		},
	),
	tool(
		"idu_supervisor_tick",
		"Ejecuta un tick seguro del supervisor según flags explícitos.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			allowSemanticDraft: optionalBoolean(
				"Permite draft semántico; default false.",
			),
			allowAgentTaskPlan: optionalBoolean(
				"Permite plan de tareas; default false.",
			),
		},
	),
	tool(
		"idu_supervisor_cron_plan",
		"Propone un tick cron advisory-only del supervisor; no escribe, no crea drafts, no ejecuta AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_architectural_pruning_plan",
		"Devuelve plan advisory-only de poda arquitectónica; no borra, no aprueba y no refactoriza.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_context_pruning_advisory",
		"Devuelve reporte advisory-only de deuda semántica/context pruning; no borra, no archiva y no promueve contratos.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_supervisor_self_maintenance_advisory",
		"Devuelve reporte advisory-only de autocuidado supervisor: backlog, tareas stale y patrones repetidos; no escribe, no crea tareas y no ejecuta AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_autonomous_alerts_status",
		"Lee estado y reporte raw-honesty del motor de alertas autónomas; advisory-only y sin writes.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_autonomous_alerts_tick",
		"Evalúa alertas autónomas y devuelve decisiones advisory-only; creación de tareas se implementa en slice posterior.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			allowTaskCreation: optionalBoolean(
				"Solicita crear tareas; Task 3 lo reporta sin crear tareas.",
			),
		},
	),
	tool(
		"idu_autonomous_alerts_control",
		"Activa, desactiva, pausa, reanuda o controla dominios de alertas autónomas con escritura stateRoot-only.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			action: requiredString(
				"enable, disable, pause, resume, disable_domain o enable_domain.",
			),
			domain: optionalString("Dominio a activar/desactivar."),
			pauseMinutes: optionalString("Minutos de pausa, default 60."),
			reason: optionalString("Motivo humano/orquestador para auditoría."),
		},
	),
	tool(
		"idu_automaticov1_cycle",
		"Ejecuta el primer ciclo autónomo bounded/advisory: alert scheduler, supervisor plan, Bibliotecario snapshot, external intelligence opcional y skill proposals opcionales.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			allowTaskCreation: optionalBoolean(
				"Permite crear hasta 3 tareas rutinarias; default false.",
			),
			allowExternalFetch: optionalBoolean(
				"Permite consultar fuentes externas exactas allowlist; default false.",
			),
			allowSkillProposals: optionalBoolean(
				"Permite crear propuestas de skill reports-only; default false.",
			),
		},
	),
	tool(
		"idu_bibliotecario_proactive_advisory",
		"Coordina superficies Bibliotecario proactivas: plan, fuentes/ecosistema, skills y deuda semántica; advisory-only, sin writes ni AgentLabs.",
		{
			request: requiredString(
				"Decisión, tarea o duda a fundamentar con Bibliotecario.",
			),
			domains: optionalStringArray(
				"Dominios para registry externo no-fetch, e.g. security, web, database.",
			),
			language: optionalString("Lenguaje opcional, e.g. typescript."),
			framework: optionalString("Framework/runtime opcional, e.g. node."),
			maxMatches: optionalString(
				"Máximo opcional de fuentes externas registry.",
			),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_external_intelligence_report",
		"Consulta fuentes externas exactas/allowlist para inteligencia de ecosistema; guarda reporte stateRoot-only, advisory-only, sin updates ni AgentLabs.",
		{
			sourceIds: optionalStringArray(
				"IDs exactos allowlist: nodejs-releases, nextjs-releases, npm-advisories. Default: todos.",
			),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_external_source_recommend",
		"Recomienda fuentes externas desde registry no-fetch por tarea/dominio/lenguaje/framework; no consulta web ni promueve contratos.",
		{
			request: requiredString("Tarea o pregunta a contrastar con el registry."),
			domains: optionalStringArray(
				"Dominios transversales, e.g. programming_structure, web, security, database, standards, academic.",
			),
			language: optionalString("Lenguaje opcional, e.g. html, typescript."),
			framework: optionalString(
				"Framework opcional, e.g. nextjs, react, node.",
			),
			maxMatches: optionalString("Máximo opcional de recomendaciones (1-20)."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_task",
		"Interpreta intención humana y registra tarea estructurada segura.",
		{
			text: requiredString("Texto humano de tarea."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_queue_detail",
		"Devuelve cola estructurada con ids completos y guardStatus.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_queue_complete",
		"Marca una tarea estructurada como completada con evidencia explícita; no ejecuta IA ni AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			taskId: requiredString("ID o prefijo de tarea a completar."),
			evidence: requiredString(
				"Evidencia de cierre: commit, tests, postflight o reviewer.",
			),
		},
	),
	tool(
		"idu_semantic_audit_status",
		"Lee estado/checkpoint de auditoría semántica.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_status",
		"Lee estado de Source Library en stateRoot sin escribir ni promover contratos.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_add",
		"Copia/registra documentación manual local en Source Library stateRoot; PDFs intentan conversión best-effort desde texto embebido, sin OCR ni contratos automáticos.",
		{
			path: requiredString("Ruta local .md, .txt o .pdf a registrar."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_remove",
		"Remueve una fuente registrada de Source Library y sus copias en stateRoot; no toca contratos.",
		{
			sourceId: requiredString("ID de fuente a remover."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_read",
		"Lee contenido acotado de una fuente registrada; PDFs convertidos pueden ser legibles y los no convertidos quedan metadata-only.",
		{
			sourceId: requiredString("ID de fuente a leer."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_extract",
		"Extrae texto acotado para markdown/text y lee PDFs convertidos; PDFs sin texto embebido quedan metadata-only sin OCR.",
		{
			sourceId: requiredString("ID de fuente a extraer."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_report",
		"Reporta metadata, estado y limitaciones de una fuente registrada.",
		{
			sourceId: requiredString("ID de fuente a reportar."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_research_report",
		"Crea reporte advisory de investigación sobre fuentes registradas y texto extraído; sin web ni contratos automáticos.",
		{
			query: requiredString("Consulta a buscar en fuentes registradas."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_digest",
		"Genera digest/chunks advisory para una fuente registrada; stateRoot only, sin web ni contratos automáticos.",
		{
			sourceId: requiredString("ID de fuente a digerir."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_digest_status",
		"Lee estado de digests e índice bibliotecario sin escribir.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_chunk_read",
		"Lee un chunk/tomo generado por Source Digest de forma acotada.",
		{
			sourceId: requiredString("ID de fuente."),
			chunkId: requiredString("ID del chunk a leer."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_recommend_for_task",
		"Recomienda fuentes/chunks relevantes para una tarea del orquestador desde el índice local; no implementa.",
		{
			request: requiredString(
				"Tarea o solicitud a contrastar con la biblioteca.",
			),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_required_actions",
		"Lista fuentes sin lectura real que requieren que el orquestador despache un lector bibliotecario/document-reader.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_skill_candidates_create",
		"Genera reporte JSON de candidatas de skill derivadas de Source Library; reports-only, no instala skills ni promueve contratos.",
		{
			selector: optionalString("Selector de fuente o all; all por defecto."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_skill_candidates_review",
		"Revisa un reporte de candidatas de skill derivadas de Source Library; latest por defecto.",
		{
			pathOrLatest: optionalString("Ruta de reporte o latest."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_skill_draft_from_lessons",
		"Genera propuestas o drafts de skill desde fallos/lecciones registradas; reports-only, requiere aprobación humana y no instala skills.",
		{
			mode: optionalEnum("Modo: proposal-only o approved-only.", [
				"proposal-only",
				"approved-only",
			]),
			selector: optionalString(
				"Selector de compaction/proposals; si se omite en proposal-only crea compaction nueva.",
			),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_source_refresh",
		"Recalcula hashes/estado de Source Library sin tocar contratos ni ejecutar AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_agentlab_request_create",
		"Crea solicitud formal AgentLab; no ejecuta AgentLabs.",
		{
			source: requiredEnum("Fuente de solicitud.", [
				"postflight",
				"master-plan",
				"skill-draft",
				"external-source-intelligence",
				"specialist-audit-plan",
			]),
			selector: optionalString("Selector; usar latest por defecto."),
			objective: optionalString("Objetivo acotado para specialist-audit-plan."),
			context: optionalString("Contexto compacto para specialist-audit-plan."),
			specialties: optionalStringArray(
				"Especialidades explícitas para specialist-audit-plan.",
			),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_agentlab_review_run",
		"Ejecuta review AgentLab explícito respetando sandbox/clone guard.",
		{
			selector: optionalString("Selector; usar latest por defecto."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_agentlab_review_status",
		"Lee estado de revisión AgentLab sin ejecutar labs.",
		{
			selector: optionalString("Selector; usar latest por defecto."),
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
];

export function listIduMcpTools(): IduMcpToolDefinition[] {
	return TOOLS.map((toolDefinition) => ({ ...toolDefinition }));
}

export function resolveMcpProjectContext(
	inputProjectPath?: string,
): IduMcpProjectResolution {
	try {
		applyPackageEnvDefaults();
		const config = loadConfig({ requireTelegram: false });
		const registry = loadRegistry(config.defaultCwd, config.allowedRoots, {
			createIfMissing: false,
			registryPath: resolveIduRegistryPath(),
		});
		if (inputProjectPath?.trim()) {
			const projectPath = canonicalDirectory(inputProjectPath.trim());
			if (!isAllowedCwd(projectPath, config.allowedRoots)) {
				return invalidProject(projectPath, [
					`Ruta fuera de ALLOWED_ROOTS: ${projectPath}`,
				]);
			}
			const registered = registry.projects.find((project) =>
				samePath(project.path, projectPath),
			);
			if (!registered) {
				return {
					status: "unregistered_project",
					projectId: slugifyProjectId(
						projectPath.split(/[\\/]/u).at(-1) ?? "project",
					),
					projectPath,
					recommendedNext:
						"Registrá el proyecto en Idu-pi antes de usar MCP o pasá un projectPath ya registrado.",
					safeNotes: ["No escribí el registry automáticamente."],
					errors: [`Proyecto no registrado: ${projectPath}`],
				};
			}
			return {
				status: "registered_project",
				projectId: registered.id,
				projectPath: registered.path,
				...(registered.stateRoot ? { stateRoot: registered.stateRoot } : {}),
				safeNotes: [],
				errors: [],
			};
		}
		const activeProject = getActiveProject(registry);
		if (activeProject) {
			return {
				status: "active_project",
				projectId: activeProject.id,
				projectPath: activeProject.path,
				...(activeProject.stateRoot
					? { stateRoot: activeProject.stateRoot }
					: {}),
				safeNotes: [],
				errors: [],
			};
		}
		const cwd = canonicalDirectory(process.cwd());
		return {
			status: "unregistered_project",
			projectId: slugifyProjectId(cwd.split(/[\\/]/u).at(-1) ?? "project"),
			projectPath: cwd,
			recommendedNext:
				"No hay proyecto activo registrado. Registrá el proyecto en Idu-pi o pasá projectPath explícito.",
			safeNotes: [
				"Usé process.cwd() solo como candidato; no escribí registry.",
			],
			errors: ["No hay active project en registry."],
		};
	} catch (error) {
		const projectPath = inputProjectPath?.trim() || process.cwd();
		return invalidProject(projectPath, [redactSecrets(errorMessage(error))]);
	}
}

function isAgentLabReviewRequestPlan(
	value: unknown,
): value is AgentLabReviewRequestPlan {
	return (
		isRecord(value) &&
		typeof value.generatedAt === "string" &&
		typeof value.projectId === "string" &&
		Array.isArray(value.requests) &&
		Array.isArray(value.errors)
	);
}

function isAgentLabReviewRunResult(
	value: unknown,
): value is AgentLabReviewRunResult {
	return (
		isRecord(value) &&
		typeof value.generatedAt === "string" &&
		typeof value.projectId === "string" &&
		Array.isArray(value.runs) &&
		Array.isArray(value.consolidatedFindings) &&
		Array.isArray(value.safeNotes)
	);
}

function isAgentLabReviewStatus(value: unknown): value is AgentLabReviewStatus {
	return (
		isRecord(value) &&
		typeof value.path === "string" &&
		typeof value.name === "string" &&
		typeof value.valid === "boolean" &&
		Array.isArray(value.errors)
	);
}

function isAgentLabWorkloadEnvelope(
	value: unknown,
): value is AgentLabWorkloadEnvelope {
	return (
		isRecord(value) &&
		value.authority === "advisory" &&
		value.advisoryOnly === true &&
		typeof value.status === "string"
	);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

async function recordMcpUsage(
	runtime: CliRuntime,
	result: IduMcpToolResult,
	durationMs: number,
	stateRoot?: string,
): Promise<void> {
	if (!stateRoot) return;
	const decisionEnvelope = isRecord(result.data.decisionEnvelope)
		? result.data.decisionEnvelope
		: undefined;
	await recordIduUsageEvent(stateRoot, {
		projectId: runtime.projectId,
		surface: "mcp",
		action: result.tool,
		active: getIduSessionStatus(runtime.projectId).active,
		risk: stringValue(result.data.risk),
		recommendation: stringValue(decisionEnvelope?.recommendation),
		allowedToProceed: booleanValue(decisionEnvelope?.allowedToProceed),
		requiresHuman:
			booleanValue(decisionEnvelope?.requiresHuman) ??
			booleanValue(result.data.requiresHumanConfirmation),
		durationMs,
		ok: result.ok,
	});
}

function recordMcpContextQuality(
	runtime: CliRuntime,
	result: IduMcpToolResult,
	stateRoot?: string,
): void {
	if (
		!stateRoot ||
		result.tool !== "idu_supervisor_context_pack" ||
		!result.ok
	) {
		return;
	}
	recordContextQualityEventDeferred(
		stateRoot,
		contextQualityEventFromSupervisorContextPack(
			runtime.projectId,
			result.data,
			"mcp",
		),
	);
}

function recordMcpAgentLabEffectiveness(
	runtime: CliRuntime,
	result: IduMcpToolResult,
	stateRoot?: string,
): void {
	if (!stateRoot) return;
	if (result.tool === "idu_agentlab_request_create") {
		const plan = result.data.plan;
		if (isAgentLabReviewRequestPlan(plan)) {
			recordAgentLabEffectivenessEventDeferred(
				stateRoot,
				agentLabEffectivenessEventFromRequestPlan(
					runtime.projectId,
					plan,
					"mcp",
				),
			);
		}
		return;
	}
	if (result.tool === "idu_agentlab_review_run") {
		const runResult = result.data.result;
		if (isAgentLabReviewRunResult(runResult)) {
			recordAgentLabEffectivenessEventDeferred(
				stateRoot,
				agentLabEffectivenessEventFromRunResult(
					runtime.projectId,
					runResult,
					"mcp",
				),
			);
		}
		return;
	}
	if (result.tool === "idu_agentlab_review_status") {
		const status = result.data.status;
		if (isAgentLabReviewStatus(status)) {
			recordAgentLabEffectivenessEventDeferred(
				stateRoot,
				agentLabEffectivenessEventFromStatus(
					runtime.projectId,
					status,
					isAgentLabWorkloadEnvelope(result.data.workloadEnvelope)
						? result.data.workloadEnvelope
						: undefined,
					"mcp",
				),
			);
		}
	}
}

export async function callIduMcpTool(
	name: string,
	input: unknown = {},
	options: IduMcpServerOptions = {},
): Promise<IduMcpToolResult> {
	if (!isToolName(name)) {
		return envelope({
			ok: false,
			tool: "idu_status",
			projectId: null,
			projectPath: null,
			summary: `Herramienta MCP desconocida: ${name}`,
			data: { requestedTool: name },
			errors: [`Herramienta MCP desconocida: ${name}`],
		});
	}
	const args = asRecord(input);
	if (isProjectLifecycleTool(name)) {
		return handleProjectLifecycleTool(name, args, options);
	}
	const resolution = (options.projectResolver ?? resolveMcpProjectContext)(
		stringArg(args, "projectPath"),
	);
	if (
		resolution.status === "unregistered_project" ||
		resolution.status === "invalid_project"
	) {
		return envelope({
			ok: false,
			tool: name,
			projectId: resolution.projectId,
			projectPath: resolution.projectPath,
			summary:
				resolution.status === "unregistered_project"
					? "Proyecto no registrado para Idu-pi MCP."
					: "Proyecto inválido para Idu-pi MCP.",
			data: {
				resolutionStatus: resolution.status,
				recommendedNext: resolution.recommendedNext,
			},
			safeNotes: resolution.safeNotes,
			errors: resolution.errors,
		});
	}
	try {
		const runtime = (options.runtimeFactory ?? defaultRuntimeFactory)(
			resolution.projectPath,
		);
		const startedAt = Date.now();
		const result = await dispatchTool(name, args, runtime, resolution);
		if (!isReadOnlyAlertTelemetryExcludedTool(name)) {
			await recordMcpUsage(
				runtime,
				result,
				Date.now() - startedAt,
				resolution.stateRoot,
			);
			recordMcpAgentLabEffectiveness(runtime, result, resolution.stateRoot);
			recordMcpContextQuality(runtime, result, resolution.stateRoot);
		}
		return result;
	} catch (error) {
		return envelope({
			ok: false,
			tool: name,
			projectId: resolution.projectId,
			projectPath: resolution.projectPath,
			summary: `Falló ${name}: ${redactSecrets(errorMessage(error))}`,
			data: { resolutionStatus: resolution.status },
			safeNotes: resolution.safeNotes,
			errors: [redactSecrets(errorMessage(error))],
		});
	}
}

export async function handleMcpRequest(
	request: McpJsonRpcRequest,
	options: IduMcpServerOptions = {},
): Promise<McpJsonRpcResponse | undefined> {
	if (
		!isRecord(request) ||
		request.jsonrpc !== "2.0" ||
		typeof request.method !== "string"
	) {
		return jsonRpcError(request?.id ?? null, -32600, "Invalid Request");
	}
	if (request.id === undefined) {
		if (request.method === "notifications/initialized") return undefined;
		return undefined;
	}
	switch (request.method) {
		case "initialize":
			return jsonRpcResult(request.id, {
				protocolVersion: "2024-11-05",
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "idu-pi-mcp", version: "0.1.1" },
			});
		case "ping":
			return jsonRpcResult(request.id, {});
		case "tools/list":
			return jsonRpcResult(request.id, { tools: listIduMcpTools() });
		case "tools/call": {
			const params = asRecord(request.params);
			const name = stringArg(params, "name");
			if (!name) return jsonRpcError(request.id, -32602, "Missing tool name");
			const result = await callIduMcpTool(
				name,
				params.arguments ?? {},
				options,
			);
			return jsonRpcResult(request.id, {
				content: [
					{ type: "text", text: `${JSON.stringify(result, null, 2)}\n` },
				],
				isError: !result.ok,
			});
		}
		default:
			return jsonRpcError(
				request.id,
				-32601,
				`Method not found: ${request.method}`,
			);
	}
}

export function parseMcpLine(
	line: string,
): McpJsonRpcRequest | undefined | McpJsonRpcResponse {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed) as McpJsonRpcRequest;
	} catch {
		return jsonRpcError(null, -32700, "Parse error");
	}
}

export function runMcpServer(options: IduMcpServerOptions = {}): void {
	let buffer = "";
	stdin.setEncoding("utf8");
	stdin.on("data", (chunk) => {
		buffer += chunk;
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			void handleLine(line, options);
			newlineIndex = buffer.indexOf("\n");
		}
	});
	stdin.on("end", () => {
		if (buffer.trim()) void handleLine(buffer, options);
	});
}

async function handleLine(
	line: string,
	options: IduMcpServerOptions,
): Promise<void> {
	const parsed = parseMcpLine(line);
	if (!parsed) return;
	if ("error" in parsed) {
		writeResponse(parsed);
		return;
	}
	const response = await handleMcpRequest(parsed, options);
	if (response) writeResponse(response);
}

type IduProjectLifecycleToolName =
	| "idu_project_status"
	| "idu_project_enroll"
	| "idu_bootstrap_project"
	| "idu_start";

function isProjectLifecycleTool(
	name: IduMcpToolName,
): name is IduProjectLifecycleToolName {
	return [
		"idu_project_status",
		"idu_project_enroll",
		"idu_bootstrap_project",
		"idu_start",
	].includes(name);
}

function isReadOnlyAlertTelemetryExcludedTool(name: IduMcpToolName): boolean {
	return (
		name === "idu_supervisor_self_maintenance_advisory" ||
		name === "idu_autonomous_alerts_status" ||
		name === "idu_autonomous_alerts_tick"
	);
}

async function handleProjectLifecycleTool(
	name: IduProjectLifecycleToolName,
	args: JsonObject,
	options: IduMcpServerOptions,
): Promise<IduMcpToolResult> {
	try {
		applyPackageEnvDefaults();
		const config = loadConfig({ requireTelegram: false });
		const registryPath = resolveIduRegistryPath();
		switch (name) {
			case "idu_project_status": {
				const projectPath = resolveLifecycleProjectPath(
					stringArg(args, "projectPath"),
				);
				const status = projectInstallStatus({
					projectPath,
					workspaceRoot: config.agentWorkspaceRoot,
					allowedRoots: config.allowedRoots,
					registryPath,
					mcpAvailable: true,
				});
				return envelope({
					ok: true,
					tool: name,
					projectId: status.projectId,
					projectPath: status.projectPath,
					summary: status.registered
						? "Proyecto registrado en Idu-pi."
						: "Proyecto no registrado en Idu-pi.",
					data: { ...status },
					safeNotes: ["Solo leí estado; no escribí registry ni archivos."],
				});
			}
			case "idu_project_enroll": {
				const projectPath = requiredText(args, "projectPath");
				const result = projectEnroll({
					projectPath,
					projectId: stringArg(args, "projectId"),
					workspaceRoot: config.agentWorkspaceRoot,
					allowedRoots: config.allowedRoots,
					registryPath,
				});
				return envelope(projectEnrollEnvelope(name, result));
			}
			case "idu_bootstrap_project": {
				const projectPath = requiredText(args, "projectPath");
				const allowCreateDrafts = booleanArg(args, "allowCreateDrafts", false);
				const activate = booleanArg(args, "activate", false);
				if (!allowCreateDrafts) {
					const result = projectEnroll({
						projectPath,
						workspaceRoot: config.agentWorkspaceRoot,
						allowedRoots: config.allowedRoots,
						registryPath,
					});
					if (activate) {
						configureProjectSessionStore(result.statePaths);
						activateIduSession(result.project.id);
					}
					return envelope({
						...projectEnrollEnvelope(name, result),
						summary: activate
							? "Proyecto enrolado y guardrails activados; no creé drafts porque allowCreateDrafts=false."
							: "Proyecto enrolado; no creé drafts porque allowCreateDrafts=false.",
						data: {
							project: result.project,
							statePaths: result.statePaths,
							created: result.created,
							allowCreateDrafts,
							activated: activate,
						},
					});
				}
				const result = runIduBootstrap({
					projectPath,
					config,
					registryPath,
					activate,
				});
				return envelope({
					ok: true,
					tool: name,
					projectId: result.project.id,
					projectPath: result.project.path,
					summary: activate
						? "Bootstrap completo: drafts seguros creados/verificados y guardrails activados."
						: "Bootstrap completo: drafts seguros creados/verificados sin activar guardrails.",
					data: {
						project: result.project,
						statePaths: result.statePaths,
						created: result.created,
						existing: result.existing,
						alreadyBootstrapped: result.alreadyBootstrapped,
						shouldRunPrepare: result.shouldRunPrepare,
						allowCreateDrafts,
						activated: activate,
					},
					safeNotes: [
						"Project Core/Constitution son drafts hasta confirmación humana.",
						"No ejecuté AgentLabs.",
						"No hice commit ni push.",
					],
					errors: result.criticalDecisions,
				});
			}
			case "idu_start": {
				const resolution = (
					options.projectResolver ?? resolveMcpProjectContext
				)(stringArg(args, "projectPath"));
				if (resolution.status === "unregistered_project") {
					return envelope({
						ok: false,
						tool: name,
						projectId: resolution.projectId,
						projectPath: resolution.projectPath,
						summary:
							"Proyecto no registrado; idu_start no enrola automáticamente.",
						data: {
							resolutionStatus: resolution.status,
							recommendedNext:
								"Usá idu_project_enroll o idu_bootstrap_project explícitamente.",
						},
						safeNotes: [
							...resolution.safeNotes,
							"No escribí registry ni drafts desde idu_start.",
						],
						errors: resolution.errors,
					});
				}
				if (resolution.status === "invalid_project") {
					return envelope({
						ok: false,
						tool: name,
						projectId: resolution.projectId,
						projectPath: resolution.projectPath,
						summary: "Proyecto inválido para Idu-pi MCP.",
						data: { resolutionStatus: resolution.status },
						safeNotes: resolution.safeNotes,
						errors: resolution.errors,
					});
				}
				const runtime = (options.runtimeFactory ?? defaultRuntimeFactory)(
					resolution.projectPath,
				);
				activateIduSession(runtime.projectId);
				const supervisorStartup = runtime.supervisorOnIduActivation();
				const connection = runtime.inspectConnection();
				return envelope({
					ok: true,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: `Idu-pi activo; alignment=${connection.alignmentStatus}.`,
					data: {
						resolutionStatus: resolution.status,
						active: true,
						configStatus: connection.configStatus,
						alignmentStatus: connection.alignmentStatus,
						recommendedNext: connection.recommendedNext,
						supervisorStartup: compactSupervisorStartup(supervisorStartup),
						connection,
					},
					safeNotes: [
						...resolution.safeNotes,
						"idu_start no enrola proyectos ni crea drafts.",
						"Arranque supervisor ejecutado con límites seguros; no ejecuta AgentLabs ni aplica reglas por sí solo.",
					],
				});
			}
		}
	} catch (error) {
		return envelope({
			ok: false,
			tool: name,
			projectId: null,
			projectPath: stringArg(args, "projectPath") ?? null,
			summary: `Falló ${name}: ${redactSecrets(errorMessage(error))}`,
			data: {},
			errors: [redactSecrets(errorMessage(error))],
		});
	}
}

function compactSupervisorStartup(
	startup:
		| {
				status: string;
				trigger: string;
				reason?: string;
				summary: string;
				safety: JsonObject;
		  }
		| undefined,
): JsonObject | null {
	if (!startup) return null;
	return {
		status: startup.status,
		trigger: startup.trigger,
		reason: startup.reason,
		summary: startup.summary,
		safety: startup.safety,
	};
}

function governanceConfigData(): JsonObject {
	const config = loadConfig({ requireTelegram: false });
	return {
		...config.iduGovernance,
		principle:
			"Idu-pi MCP informa, audita y recomienda; el orquestador decide, ejecuta y comunica.",
	};
}

function workerBoundaryData(): JsonObject {
	return {
		orchestratorOwns: [
			"decisión final",
			"comunicación con el usuario",
			"subagentes worker/scout/reviewer",
			"worktrees/sandboxes",
			"implementación y tests",
		],
		iduPiOwns: [
			"auditoría del proyecto",
			"contratos operativos",
			"Plan Maestro/Doc/reports en stateRoot",
			"detección de drift y recomendaciones",
		],
		agentLabsOwn: [
			"auditoría audit-only",
			"pruebas de cambios",
			"detección de desviaciones contra Plan Maestro",
			"sugerencias de actualización de flujos",
		],
		agentLabsMustNot: [
			"implementar features",
			"editar repo real",
			"crear workspaces propios dentro de stateRoot",
			"hacer commit/push",
		],
	};
}

function buildOrchestratorProcedure(
	purpose: string,
	request: string,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): JsonObject {
	const connection = runtime.inspectConnection();
	const governanceConfig = governanceConfigData();
	const workerBoundary = workerBoundaryData();
	const baseSteps = [
		"Consultar Idu-pi MCP para estado, contratos y riesgos.",
		"Revalidar la auditoría con subagentes propios del orquestador.",
		"Leer Plan Maestro y Doc/<project> antes de decidir.",
		"Usar AgentLabs sólo como auditores/pruebas/drift, nunca como workers.",
		"Comunicar al usuario la conclusión del orquestador: grave, leve, pendiente y próximo paso.",
	];
	const purposeSteps: Record<string, string[]> = {
		create_plan: [
			"Si no hay plan o está stale, ejecutar auditoría general del proyecto.",
			"Pedir a subagentes del orquestador validar frontend, auth, datos, arquitectura y flujos.",
			"Correr/reusar AgentLabs audit-only si la evidencia es insuficiente o hay riesgo high/critical.",
			"Construir Plan Maestro con cumple/no cumple, contratos, violaciones y hitos.",
			"Si falta evidencia, pedir auditoría profunda antes de cerrar como DRAFT_CONFIABLE.",
		],
		update_plan: [
			"Comparar Plan Maestro/Doc contra repo y diff actual.",
			"Detectar drift de contratos, flujos y violaciones.",
			"Actualizar stateRoot Doc/Plan sólo con evidencia y mantener historial en reports.",
		],
		implement_change: [
			"Llamar idu_supervisor_context_pack para obtener objetivo compacto, Plan Maestro, contratos, riesgos, lecturas y gates antes de delegar.",
			"Usar idu_task_context como fallback si el pack no está disponible o como consulta puntual adicional.",
			"Delegar implementación a workers normales del orquestador con ese contexto.",
			"Ejecutar postflight y auditorías audit-only antes de cerrar.",
		],
		postflight_review: [
			"Inspeccionar diff y cambios locales.",
			"Verificar contratos afectados y DoD.",
			"Si hay drift, pedir AgentLab audit-only y proponer actualización de flujos/Doc.",
		],
	};
	return {
		summary: `Procedimiento asesor para ${purpose}`,
		purpose,
		request,
		project: {
			id: runtime.projectId,
			path: runtime.projectPath,
			resolutionStatus: resolution.status,
			configStatus: connection.configStatus,
			alignmentStatus: connection.alignmentStatus,
		},
		governanceConfig,
		workerBoundary,
		procedure: [...baseSteps, ...(purposeSteps[purpose] ?? [])],
		mustConsult: [
			"idu_status",
			"idu_supervisor_context_pack antes de delegar implementación",
			"idu_task_context como fallback o asesoría puntual",
			"idu_postflight después del diff",
			"idu_agentlab_* sólo si se requiere auditoría/prueba/drift",
		],
		mustNot: [
			"No permitir que Idu-pi se imponga sin revalidación del orquestador.",
			"No usar AgentLabs para codificar.",
			"No crear workspaces permanentes en stateRoot.",
			"No presentar Plan Maestro como confiable si falta evidencia crítica.",
		],
		recommendedNext:
			connection.alignmentStatus === "aligned"
				? "Continuar con idu_supervisor_context_pack, idu_task_context o idu_postflight según etapa."
				: connection.recommendedNext,
	};
}

function configureProjectSessionStore(
	statePaths: ProjectEnrollResult["statePaths"],
): void {
	configureIduSessionStore({
		workspaceRoot: statePaths.stateRoot,
		filePath: statePaths.sessionStatePath,
	});
}

function projectEnrollEnvelope(
	name: IduMcpToolName,
	result: ProjectEnrollResult,
): Parameters<typeof envelope>[0] {
	return {
		ok: true,
		tool: name,
		projectId: result.project.id,
		projectPath: result.project.path,
		summary:
			"Proyecto enrolado con estado aislado; no creé drafts ni ejecuté scans.",
		data: {
			project: result.project,
			statePaths: result.statePaths,
			created: result.created,
		},
		safeNotes: [
			...result.safeNotes,
			"No creé Project Core ni Constitution.",
			"No ejecuté scan ni AgentLabs.",
		],
	};
}

function resolveLifecycleProjectPath(inputProjectPath?: string): string {
	if (inputProjectPath?.trim()) return inputProjectPath.trim();
	const resolution = resolveMcpProjectContext();
	return resolution.projectPath;
}

function readRuntimeStructuredTasks(runtime: CliRuntime): {
	status: "available" | "unavailable";
	tasks: StructuredTask[];
	safeNotes: string[];
} {
	if (!runtime.listTasks) {
		return {
			status: "unavailable",
			tasks: [],
			safeNotes: [
				"Structured task queue direct access was unavailable; report used an empty task snapshot.",
			],
		};
	}
	try {
		return {
			status: "available",
			tasks: runtime.listTasks(),
			safeNotes: ["Leí snapshot de cola estructurada sin modificarla."],
		};
	} catch {
		return {
			status: "unavailable",
			tasks: [],
			safeNotes: [
				"Structured task queue read failed safely; report used an empty task snapshot.",
			],
		};
	}
}

function loadRuntimeAutomaticov1Plan(runtime: CliRuntime) {
	if (!runtime.masterPlanReview) return undefined;
	try {
		return runtime.masterPlanReview("latest").plan;
	} catch {
		return undefined;
	}
}

function loadRuntimeExecutionReadiness(runtime: CliRuntime, stateRoot: string) {
	const taskTree = buildMasterPlanTaskTree(
		loadRuntimeAutomaticov1Plan(runtime),
	);
	const usageReport = buildIduUsageReport(readIduUsageEvents(stateRoot, 500));
	return buildIduExecutionReadiness({
		coreStatus: safeRuntimeProjectCoreStatus(runtime.projectPath),
		constitutionStatus: safeRuntimeProjectConstitutionStatus(
			runtime.projectPath,
		),
		taskTreeStatus: taskTree.status,
		mcpContextPackStaleness: usageReport.mcpContextPackStaleness,
	});
}

function safeRuntimeProjectCoreStatus(projectPath: string) {
	try {
		return loadProjectCore(projectPath).status;
	} catch {
		return "unknown" as const;
	}
}

function safeRuntimeProjectConstitutionStatus(projectPath: string) {
	try {
		return loadProjectConstitution(projectPath).status;
	} catch {
		return "unknown" as const;
	}
}

function buildRuntimeSelfMaintenanceReport(
	runtime: CliRuntime,
	stateRoot: string,
): {
	taskRead: ReturnType<typeof readRuntimeStructuredTasks>;
	report: ReturnType<typeof buildSupervisorSelfMaintenanceAdvisory>;
} {
	const taskRead = readRuntimeStructuredTasks(runtime);
	const now = new Date();
	const supervisorActivity = summarizeSupervisorActivityEvents(
		filterRecentSupervisorActivityEvents(
			readSupervisorActivityEvents(stateRoot),
			now,
			SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
		),
	);
	const usageReport = buildIduUsageReport(
		filterRecentIduUsageEvents(
			readIduUsageEvents(stateRoot),
			now,
			SELF_MAINTENANCE_PRESSURE_WINDOW_MS,
		),
		{ now },
	);
	const agentLabEffectiveness = buildAgentLabEffectivenessReport(
		readAgentLabEffectivenessEvents(stateRoot),
	);
	let semanticNewEvents = 0;
	try {
		const semanticDelta = runtime.semanticAuditStatus().newEvents;
		semanticNewEvents =
			semanticDelta.labRuns +
			semanticDelta.findings +
			semanticDelta.proposals +
			semanticDelta.tasks +
			semanticDelta.userSignals +
			semanticDelta.memoryItems;
	} catch {
		semanticNewEvents = 0;
	}
	return {
		taskRead,
		report: buildSupervisorSelfMaintenanceAdvisory({
			projectId: runtime.projectId,
			now,
			tasks: taskRead.tasks,
			supervisorEvents: supervisorActivity.totalEvents,
			supervisorActivitySkipped:
				(supervisorActivity.byReason.idu_inactive ?? 0) +
				(supervisorActivity.byReason.no_new_events ?? 0) +
				(supervisorActivity.byReason.not_enough_data ?? 0),
			supervisorActivityThrottled: supervisorActivity.byReason.throttled ?? 0,
			usageFailures: usageReport.failed,
			usageNotAllowed: usageReport.notAllowed,
			usageRequiresHuman: usageReport.requiresHuman,
			agentLabStaleRequests: agentLabEffectiveness.staleRequests,
			semanticNewEvents,
		}),
	};
}

async function dispatchTool(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	switch (name) {
		case "idu_status": {
			const connection = runtime.inspectConnection();
			const session = getIduSessionStatus(runtime.projectId);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `${session.active ? "Activo" : "Inactivo"}; config=${connection.configStatus}; alignment=${connection.alignmentStatus}`,
				data: {
					resolutionStatus: resolution.status,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					active: session.active,
					configStatus: connection.configStatus,
					alignmentStatus: connection.alignmentStatus,
					sessionStatePath: session.sessionStatePath,
					recommendedNext: connection.recommendedNext,
					connection,
				},
				safeNotes: resolution.safeNotes,
			});
		}
		case "idu_activate": {
			const session = activateIduSession(runtime.projectId);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary:
					"Guardrails automáticos activados sin scan pesado ni AgentLabs.",
				data: session as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"No ejecuté scan pesado.",
					"No ejecuté AgentLabs.",
				],
			});
		}
		case "idu_deactivate": {
			const session = deactivateIduSession(runtime.projectId);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: "Guardrails automáticos desactivados.",
				data: session as unknown as JsonObject,
				safeNotes: resolution.safeNotes,
			});
		}
		case "idu_project_reset_state": {
			const confirmed = booleanArg(args, "confirm", false);
			if (!confirmed) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Reset cancelado: falta confirm=true.",
					data: { requiresConfirmation: true },
					safeNotes: [
						...resolution.safeNotes,
						"No borré nada porque falta confirmación explícita.",
					],
					errors: ["Para borrar stateRoot enviá confirm=true."],
				});
			}
			const result = runtime.projectStateReset(true);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `StateRoot limpiado: ${result.stateRoot}`,
				data: result as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Borré sólo estado aislado de Idu-pi.",
					"No desregistré el proyecto ni toqué el repo real.",
				],
			});
		}
		case "idu_prepare": {
			const result = runtime.prepare();
			return envelope({
				ok: result.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: result.recommendedNext,
				data: result as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Prepare seguro: no ejecuté IA ni AgentLabs.",
				],
				errors: result.errors,
			});
		}
		case "idu_master_plan_status": {
			if (!runtime.masterPlanStatus) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const status = runtime.masterPlanStatus();
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Plan Maestro: ${status.status}`,
				data: status as unknown as JsonObject,
				safeNotes: [...resolution.safeNotes, "No regeneré el Plan Maestro."],
			});
		}
		case "idu_master_plan_create": {
			if (!runtime.masterPlanRedraft) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const result = runtime.masterPlanRedraft(stringArg(args, "reason"));
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Plan Maestro creado: ${result.plan.status}`,
				data: {
					status: result.plan.status,
					jsonPath: result.jsonPath,
					markdownPath: result.markdownPath,
					flowArtifact: result.plan.flowArtifact,
					plan: result.plan,
				} as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Creé/regeneré sólo artefactos de gobernanza en stateRoot.",
					"No ejecuté AgentLabs, no apliqué flows y no toqué el repo real.",
				],
			});
		}
		case "idu_master_plan_review": {
			if (!runtime.masterPlanReview) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const review = runtime.masterPlanReview(
				stringArg(args, "selector") ?? "latest",
			);
			return envelope({
				ok: review.plan.status !== "incompatible",
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Review Plan Maestro: ${review.plan.status}`,
				data: review as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Review sin regenerar ni ejecutar AgentLabs.",
				],
				errors:
					review.plan.status === "incompatible"
						? review.plan.criticalRisks
						: [],
			});
		}
		case "idu_master_plan_approve": {
			if (!runtime.masterPlanApprove) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const result = runtime.masterPlanApprove(
				stringArg(args, "selector") ?? "latest",
				stringArg(args, "reason"),
				"mcp",
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Plan Maestro aprobado: ${result.plan.status}`,
				data: {
					status: result.plan.status,
					jsonPath: result.jsonPath,
					markdownPath: result.markdownPath,
					flowArtifact: result.plan.flowArtifact,
					approval: result.plan.approval,
					plan: result.plan,
				} as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Aprobé explícitamente sólo el Plan Maestro en stateRoot.",
					"No apliqué flows, no ejecuté AgentLabs y no toqué el repo real.",
				],
			});
		}
		case "idu_master_plan_reject": {
			if (!runtime.masterPlanReject) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const result = runtime.masterPlanReject(
				stringArg(args, "selector") ?? "latest",
				stringArg(args, "reason"),
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Plan Maestro rechazado: ${result.plan.status}`,
				data: {
					status: result.plan.status,
					jsonPath: result.jsonPath,
					markdownPath: result.markdownPath,
					flowArtifact: result.plan.flowArtifact,
					approval: result.plan.approval,
					plan: result.plan,
				} as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Rechacé explícitamente sólo el Plan Maestro en stateRoot.",
					"No borré drafts, no ejecuté AgentLabs y no toqué el repo real.",
				],
			});
		}
		case "idu_plan_snapshot": {
			if (!runtime.masterPlanReview) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const review = runtime.masterPlanReview(
				stringArg(args, "selector") ?? "latest",
			);
			const snapshot = buildPlanSnapshot(review, runtime);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Snapshot Plan Maestro: ${snapshot.planStatus}`,
				data: snapshot,
				safeNotes: [
					...resolution.safeNotes,
					"Snapshot compacto: no regeneré Plan Maestro ni ejecuté AgentLabs.",
				],
			});
		}
		case "idu_next_advisory_action": {
			if (!runtime.masterPlanReview) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const request = stringArg(args, "request") ?? "";
			const review = runtime.masterPlanReview("latest");
			const advisoryAction = buildNextAdvisoryAction(
				buildPlanSnapshot(review, runtime),
				request,
				stringArg(args, "mode") ?? "from_plan",
				stringArg(args, "maxScope") ?? "small",
			);
			advisoryAction.decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: String(advisoryAction.recommendation),
				severity: "info",
				confidence: 0.72,
				summary: String((advisoryAction.candidateAction as JsonObject).title),
				requiresHuman: false,
				orchestratorDecisionRequired: Boolean(
					advisoryAction.orchestratorDecisionRequired,
				),
				allowedToProceed: true,
				evidenceRefs: ["plan:snapshot", "candidate_action"],
				nextActions: [String(advisoryAction.recommendation)],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Acción candidata: ${String((advisoryAction.candidateAction as JsonObject).title)}`,
				data: advisoryAction,
				safeNotes: [
					...resolution.safeNotes,
					"Acción candidata solamente: Idu-pi no implementa.",
					"No ejecuté AgentLabs; el orquestador decide llamadas explícitas.",
				],
			});
		}
		case "idu_continuation_proposal": {
			if (!runtime.masterPlanReview) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const review = runtime.masterPlanReview("latest");
			const proposal = buildContinuationProposal(
				runtime,
				buildPlanSnapshot(review, runtime),
				stringArg(args, "request") ?? "",
				positiveIntegerArg(args, "autonomyWindowMinutes"),
				stringArg(args, "maxScope") ?? "small",
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: String(proposal.summary),
				data: proposal,
				safeNotes: [
					...resolution.safeNotes,
					"Propuesta de continuidad solamente: Idu-pi no implementa.",
					"No ejecuté AgentLabs; el orquestador decide llamadas explícitas.",
					"Ejecutar idu_postflight antes de cerrar la próxima tarea.",
				],
			});
		}
		case "idu_task_package_create": {
			if (!runtime.masterPlanReview) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const request = requiredText(args, "request");
			const review = runtime.masterPlanReview("latest");
			const snapshot = buildPlanSnapshot(review, runtime);
			const advisoryAction = buildNextAdvisoryAction(
				snapshot,
				request,
				"from_request",
				"small",
			);
			const taskPackage = buildTaskPackage(
				snapshot,
				advisoryAction,
				request,
				stringArg(args, "actionId"),
				booleanArg(args, "includePlanSnapshot", false),
			);
			const taskPackageEvidenceGateways =
				buildTaskPackageEvidenceGateways(taskPackage);
			taskPackage.evidenceGateways = taskPackageEvidenceGateways;
			taskPackage.decisionEnvelope = decisionEnvelopeFromEvidence(
				name,
				String(taskPackage.recommendation),
				taskPackageEvidenceGateways,
				{
					recommendation: String(taskPackage.recommendation),
					severity: taskPackage.humanApprovalRequired
						? "needs_approval"
						: "warning",
					confidence: 0.74,
					requiresHuman: Boolean(taskPackage.humanApprovalRequired),
					orchestratorDecisionRequired: Boolean(
						taskPackage.orchestratorDecisionRequired,
					),
					nextActions: [String(taskPackage.recommendation)],
				},
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Paquete de tarea advisory: ${taskPackage.id}`,
				data: taskPackage,
				safeNotes: [
					...resolution.safeNotes,
					"Paquete para subagentes normales; Idu-pi no implementa.",
					"Governance-review del orquestador debe ocurrir antes del worker.",
				],
			});
		}
		case "idu_supervisor_context_pack": {
			if (!runtime.masterPlanReview) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Master Plan no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Master Plan no disponible en este runtime."],
				});
			}
			const request = requiredText(args, "request");
			const pack = buildSupervisorContextPack(
				runtime,
				request,
				booleanArg(args, "includePlanSnapshot", false),
			);
			const supervisorConsultation = pack.supervisorConsultation as
				| SupervisorConsultation
				| undefined;
			pack.decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation:
					supervisorConsultation?.supervisorRecommendation ?? "warn",
				severity: supervisorConsultation?.severity ?? "warning",
				confidence: supervisorConsultation?.confidence ?? 0.78,
				summary: String(pack.summary),
				requiresHuman: Boolean(pack.humanApprovalRequired),
				orchestratorDecisionRequired: true,
				allowedToProceed: supervisorConsultation?.proceed ?? true,
				evidenceRefs: supervisorConsultation?.evidenceRefs ?? [
					"readme:vision",
					"plan:snapshot",
					"task:context",
				],
				nextActions: arrayField(pack, "autonomyGates").map(String),
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: String(pack.summary),
				data: pack,
				safeNotes: [
					...resolution.safeNotes,
					"Context pack advisory: no implementé, no escribí archivos y no ejecuté AgentLabs.",
					"Inyecta metas y gates; el orquestador decide y ejecuta.",
				],
			});
		}
		case "idu_orchestrator_procedure": {
			const purpose = requiredOneOf(args, "purpose", [
				"create_plan",
				"update_plan",
				"implement_change",
				"postflight_review",
			]);
			const request = stringArg(args, "request") ?? "";
			const procedure = buildOrchestratorProcedure(
				purpose,
				request,
				runtime,
				resolution,
			);
			procedure.decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: "warn",
				severity: "info",
				confidence: 0.7,
				summary: String(procedure.summary),
				requiresHuman: false,
				orchestratorDecisionRequired: true,
				allowedToProceed: true,
				evidenceRefs: ["project:resolution", "procedure:must_consult"],
				nextActions: [String(procedure.recommendedNext)],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: String(procedure.summary),
				data: procedure,
				safeNotes: [
					...resolution.safeNotes,
					"Idu-pi MCP informa y guía; el orquestador decide y comunica al usuario.",
					"AgentLabs son audit-only: no implementan ni crean workspaces.",
				],
			});
		}
		case "idu_task_context": {
			const request = requiredText(args, "request");
			const report = runtime.preflight(request);
			const alignmentAdvisory = buildPreflightOrchestratorAdvisory(report);
			const decisionEnvelope = decisionEnvelopeFromAdvisory(
				name,
				alignmentAdvisory,
			);
			const supervisorConsultation = buildConsultationFromAdvisory({
				source: name,
				planObjective: planObjectiveForRuntime(runtime),
				advisory: alignmentAdvisory as unknown as JsonObject,
				risks: [
					String(report.risk),
					...arrayField(report as unknown as JsonObject, "warnings").map(
						String,
					),
				],
				gates: ["Preflight antes de delegar", "Orquestador decide si procede"],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Contexto asesor: ${alignmentAdvisory.recommendation}`,
				data: {
					alignmentAdvisory,
					decisionEnvelope,
					supervisorConsultation,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					report,
				},
				safeNotes: [
					...resolution.safeNotes,
					"No ejecuté AgentLabs ni escribí archivos.",
					"El orquestador debe pasar este contexto a sus subagentes normales si decide implementar.",
				],
			});
		}
		case "idu_preflight": {
			const request = requiredText(args, "request");
			const report = runtime.preflight(request);
			const alignmentAdvisory = buildPreflightOrchestratorAdvisory(report);
			const evidenceGateways = buildPreflightEvidenceGateways(report);
			const decisionEnvelope = decisionEnvelopeFromAdvisory(
				name,
				alignmentAdvisory,
				evidenceGateways,
			);
			const supervisorConsultation = buildConsultationFromAdvisory({
				source: name,
				planObjective: planObjectiveForRuntime(runtime),
				advisory: alignmentAdvisory as unknown as JsonObject,
				risks: [
					String(report.risk),
					...arrayField(report as unknown as JsonObject, "warnings").map(
						String,
					),
				],
				gates: [
					"Preflight antes de delegar",
					"No implementar si requiere aprobación humana",
				],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: alignmentAdvisory.summary,
				data: {
					alignmentAdvisory,
					decisionEnvelope,
					supervisorConsultation,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					evidenceGateways,
					risk: report.risk,
					detectedImpact: report.affectedAreas,
					rulesAffected: report.constitutionGate?.affectedRules ?? [],
					recommendedAction: report.recommendedNext,
					requiresHumanConfirmation: report.requiresHumanConfirmation,
					report,
				},
				safeNotes: [
					...resolution.safeNotes,
					"No ejecuté AgentLabs.",
					"No modifiqué archivos.",
				],
			});
		}
		case "idu_advisory": {
			const request = requiredText(args, "request");
			const advisory = runtime.advisory(request);
			const alignmentAdvisory = buildProjectAdvisoryForOrchestrator(advisory);
			const decisionEnvelope = decisionEnvelopeFromAdvisory(
				name,
				alignmentAdvisory,
			);
			const supervisorConsultation = buildConsultationFromAdvisory({
				source: name,
				planObjective: planObjectiveForRuntime(runtime),
				advisory: alignmentAdvisory as unknown as JsonObject,
				risks: [String(advisory.level)],
				gates: ["Advisory al orquestador", "Sin scan/IA/AgentLab automático"],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: alignmentAdvisory.summary,
				data: {
					alignmentAdvisory,
					decisionEnvelope,
					supervisorConsultation,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					risk: advisory.level,
					suggestedNextSteps: advisory.actions,
					advisory,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Advisory al orquestador: no ejecuté scan, IA ni AgentLabs.",
				],
			});
		}
		case "idu_postflight": {
			const report = runtime.postflight();
			const actionId = stringArg(args, "actionId");
			const taskPackageId = stringArg(args, "taskPackageId");
			const expectedContracts = stringListArg(args, "expectedContracts");
			const expectedFiles = stringListArg(args, "expectedFiles");
			const ignoredFiles = stringListArg(args, "ignoredFiles");
			const expectedChangeMode = stringArg(args, "expectedChangeMode");
			const taskTrace = buildPostflightTaskTrace({
				actionId,
				taskPackageId,
				expectedContracts,
				expectedFiles,
				ignoredFiles,
				expectedChangeMode,
				report,
			});
			const physicalGateways = buildPhysicalEvidenceGateways(
				report.physicalGates ?? [],
			);
			const evidenceGateways = [
				...buildPostflightEvidenceGateways({
					report,
					taskTrace,
				}),
				...physicalGateways,
			];
			const decisionEnvelope = decisionEnvelopeFromEvidence(
				name,
				report.recommendedNext,
				evidenceGateways,
				{
					recommendation: taskTrace.matchesIntent ? "warn" : "needs_evidence",
					severity: report.requiresHumanConfirmation
						? "needs_approval"
						: "warning",
					confidence: 0.76,
					requiresHuman: report.requiresHumanConfirmation,
					orchestratorDecisionRequired: true,
					suggestedAgentLabs: report.suggestedAgentLabs,
					nextActions: [report.recommendedNext, String(taskTrace.nextAdvisory)],
				},
			);
			const postflightStops = [
				...taskTrace.contractDelta.map(
					(delta) => `Contrato esperado no observado: ${delta.contract}`,
				),
				...taskTrace.unexpectedAreas.map(
					(area) => `Área inesperada en cambios: ${area}`,
				),
				...(taskTrace.modeDelta ? [String(taskTrace.modeDelta)] : []),
			];
			const supervisorConsultation = buildSupervisorConsultation({
				source: name,
				planObjective: planObjectiveForRuntime(runtime),
				supervisorRecommendation: String(decisionEnvelope.recommendation),
				severity: String(decisionEnvelope.severity),
				confidence: decisionEnvelope.confidence,
				risks: [String(report.risk), ...report.warnings],
				gates: [
					"Postflight antes de cerrar",
					"Resolver taskTrace antes de merge si hay delta",
				],
				contracts: taskTrace.observedContracts,
				evidenceRefs: decisionEnvelope.evidenceRefs,
				proceed: Boolean(
					decisionEnvelope.allowedToProceed && taskTrace.matchesIntent,
				),
				proceedRationale: taskTrace.matchesIntent
					? "Postflight coincide con intención esperada; el orquestador puede proceder si gates físicos/evidencia son suficientes."
					: "Postflight requiere evidencia adicional antes de cerrar.",
				stopRationale: postflightStops,
				requiresHuman: decisionEnvelope.requiresHuman,
				suggestedAgentLabs: report.suggestedAgentLabs,
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: report.recommendedNext,
				data: {
					decisionEnvelope,
					supervisorConsultation,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					changedFiles: report.changedFiles,
					ignoredFiles: report.ignoredFiles ?? [],
					observedChangeMode: report.observedChangeMode ?? "code",
					risk: report.risk,
					gates: report.constitutionGate ?? null,
					physicalGates: report.physicalGates ?? [],
					physicalGateways,
					evidenceGateways,
					suggestedAgentLabs: report.suggestedAgentLabs,
					requiresHumanConfirmation: report.requiresHumanConfirmation,
					taskTrace,
					report,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Postflight lee estado git; no hace commit ni push.",
					"Physical gates reportan evidencia disponible; Idu-pi no ejecutó build/test automáticamente.",
					"Trazabilidad advisory: no cierra ni aplica cambios automáticamente.",
				],
			});
		}
		case "idu_supervisor_tick": {
			const allowSemanticDraft = booleanArg(args, "allowSemanticDraft", false);
			const allowAgentTaskPlan = booleanArg(args, "allowAgentTaskPlan", false);
			const result = runtime.supervisorTick({
				allowSemanticDraft,
				allowAgentTaskPlan,
			});
			const alignmentAdvisory = buildSupervisorLoopOrchestratorAdvisory(result);
			const decisionEnvelope = decisionEnvelopeFromAdvisory(
				name,
				alignmentAdvisory,
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: alignmentAdvisory.summary,
				data: {
					alignmentAdvisory,
					decisionEnvelope,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					stepsExecuted: result.steps.filter(
						(step) => step.status !== "skipped",
					),
					skippedReasons: result.steps.filter(
						(step) => step.status === "skipped",
					),
					recommendedNext: result.recommendedNext,
					status: result.status,
					reason: result.reason,
					allowSemanticDraft,
					allowAgentTaskPlan,
					result,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Supervisor tick no ejecuta AgentLabs.",
					"No aplica reglas ni modifica Project Core/Constitution.",
				],
			});
		}
		case "idu_supervisor_cron_plan": {
			const plan = runtime.supervisorCronPlan();
			const alignmentAdvisory = buildSupervisorLoopOrchestratorAdvisory(
				plan.loop,
			);
			const decisionEnvelope = decisionEnvelopeFromAdvisory(
				name,
				alignmentAdvisory,
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Cron plan: ${plan.classification}`,
				data: {
					alignmentAdvisory,
					decisionEnvelope,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					classification: plan.classification,
					proposedActions: plan.proposedActions,
					advisoryOnly: plan.advisoryOnly,
					writesAllowed: plan.writesAllowed,
					agentLabsAllowed: plan.agentLabsAllowed,
					plan,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Cron plan es advisory-only: no escribe auditorías, drafts ni tareas.",
					"No ejecuta AgentLabs ni aprueba acciones automáticamente.",
				],
			});
		}
		case "idu_architectural_pruning_plan": {
			const plan = buildArchitecturalPruningPlan({
				projectId: runtime.projectId,
			});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: "warn",
				severity: "warning",
				confidence: 0.78,
				summary: "Architectural pruning plan requires review before changes.",
				requiresHuman: true,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs: plan.candidates.map((candidate) => candidate.id),
				nextActions: plan.recommendedNext,
				requiredActions: [
					{
						id: "architectural-pruning-human-review",
						owner: "human",
						action: "review_pruning_plan_before_changes",
						reason:
							"Architectural pruning must not be applied without human/orchestrator approval.",
						blocking: true,
					},
				],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Architectural pruning candidates: ${plan.candidates.length}`,
				data: {
					decisionEnvelope,
					plan,
					candidates: plan.candidates,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes: [
					...resolution.safeNotes,
					"Plan de poda advisory-only: no borré archivos ni apliqué refactors.",
					"No aprobé recomendaciones, no ejecuté AgentLabs y no escribí reportes runtime.",
				],
			});
		}
		case "idu_context_pruning_advisory": {
			const report = buildContextPruningAdvisoryReport({
				stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,
				projectId: runtime.projectId,
				repoRoot: runtime.projectPath,
			});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: report.signals.length ? "warn" : "allow",
				severity: report.signals.some((signal) => signal.severity === "high")
					? "warning"
					: "info",
				confidence: 0.8,
				summary: `Semantic debt advisory signals: ${report.signals.length}`,
				requiresHuman: false,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs: report.signals.map((signal) => signal.id),
				nextActions: [
					"Review signals before adding more context or sources.",
					"Revalidate stale evidence before plan decisions depend on it.",
					"Do not delete, archive, refactor, or promote contracts from this report alone.",
				],
				requiredActions: report.signals.length
					? [
							{
								id: "semantic-debt-orchestrator-review",
								owner: "orchestrator",
								action: "review_semantic_debt_signals_before_cleanup",
								reason:
									"Semantic debt signals are advisory and must not trigger automatic cleanup.",
								blocking: true,
							},
						]
					: [],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Semantic debt advisory signals: ${report.signals.length}`,
				data: {
					decisionEnvelope,
					report,
					signals: report.signals,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes: [
					...resolution.safeNotes,
					"Reporte de deuda semántica advisory-only: no borré archivos, no archivé fuentes y no apliqué refactors.",
					"No promoví contratos, no degradé contratos, no ejecuté AgentLabs y no escribí analytics remota.",
					"No guardé prompts ni documentos crudos; sólo devolví conteos, ids, rutas y metadatos derivados.",
				],
			});
		}
		case "idu_autonomous_alerts_status": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const state = readAutonomousAlertEngineState(stateRoot);
			const selfMaintenance = buildRuntimeSelfMaintenanceReport(
				runtime,
				stateRoot,
			);
			const taskRead = selfMaintenance.taskRead;
			const report = buildAutonomousAlertEngineReport({
				projectId: runtime.projectId,
				control: state.control,
				tasks: taskRead.tasks,
				selfMaintenanceSignals: selfMaintenance.report.signals,
				allowTaskCreation: false,
				cooldowns: state.cooldowns,
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Autonomous alert status: ${report.decisions.length} decision(s).`,
				data: { report, state },
				safeNotes: [
					...resolution.safeNotes,
					...report.safeNotes,
					"Status read-only: no alert state, tasks, AgentLabs, rules, skills, contracts, or dependencies were changed.",
					...taskRead.safeNotes,
				],
			});
		}
		case "idu_autonomous_alerts_tick": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const state = readAutonomousAlertEngineState(stateRoot);
			const selfMaintenance = buildRuntimeSelfMaintenanceReport(
				runtime,
				stateRoot,
			);
			const taskRead = selfMaintenance.taskRead;
			const allowTaskCreation = booleanArg(args, "allowTaskCreation", false);
			const report = buildAutonomousAlertEngineReport({
				projectId: runtime.projectId,
				control: state.control,
				tasks: taskRead.tasks,
				selfMaintenanceSignals: selfMaintenance.report.signals,
				allowTaskCreation,
				cooldowns: state.cooldowns,
			});
			const tasksCreated: Array<{
				taskId: string;
				alertId: string;
				evidenceRefs: string[];
			}> = [];
			const taskCreationBlockedByHumanEscalation = report.humanEscalations.some(
				(decision) =>
					["repeated_bug", "security", "db"].includes(decision.domain),
			);
			for (const decision of report.decisions) {
				if (
					decision.recommendedAction === "create_task" &&
					decision.taskDraft &&
					allowTaskCreation &&
					!taskCreationBlockedByHumanEscalation &&
					tasksCreated.length < 3
				) {
					const taskKind = inferTaskTemplateKind(decision.taskDraft.text);
					const task = runtime.createTask(taskKind, decision.taskDraft.text);
					tasksCreated.push({
						taskId: task.id,
						alertId: decision.id,
						evidenceRefs: decision.evidenceRefs,
					});
					appendAutonomousAlertDecision(stateRoot, decision);
				} else if (
					decision.recommendedAction === "ask_human" &&
					allowTaskCreation
				) {
					appendAutonomousAlertDecision(stateRoot, decision);
				}
			}
			const finalReport = { ...report, tasksCreated };
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Autonomous alert tick: ${tasksCreated.length} task(s) created, ${finalReport.humanEscalations.length} escalation(s).`,
				data: {
					report: finalReport,
					allowTaskCreation,
					taskCreationStatus: allowTaskCreation ? "enabled" : "disabled",
				},
				safeNotes: [
					...resolution.safeNotes,
					...finalReport.safeNotes,
					"Tick may create capped routine tasks only; it did not implement code, run AgentLabs, update dependencies, or mutate rules/skills/contracts.",
					...taskRead.safeNotes,
				],
			});
		}
		case "idu_autonomous_alerts_control": {
			if (!resolution.stateRoot) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"Autonomous alert control requires a registered project stateRoot.",
					data: { resolutionStatus: resolution.status },
					safeNotes: [
						...resolution.safeNotes,
						"No escribí control de alertas porque falta stateRoot registrado.",
					],
					errors: ["registered stateRoot is required"],
				});
			}
			const action = requiredText(args, "action");
			const now = new Date();
			const current = readAutonomousAlertEngineState(resolution.stateRoot, now);
			let disabledDomains = current.control.disabledDomains;
			if (action === "disable_domain") {
				disabledDomains = [
					...new Set([...disabledDomains, requiredText(args, "domain")]),
				];
			} else if (action === "enable_domain") {
				const domain = requiredText(args, "domain");
				disabledDomains = disabledDomains.filter((item) => item !== domain);
			}
			const pauseMinutes = positiveIntegerArg(args, "pauseMinutes") ?? 60;
			let pausedUntil = current.control.pausedUntil;
			if (action === "pause") {
				pausedUntil = new Date(
					now.getTime() + pauseMinutes * 60 * 1000,
				).toISOString();
			} else if (action === "resume") {
				pausedUntil = "1970-01-01T00:00:00.000Z";
			}
			let active = current.control.active;
			if (action === "enable") active = true;
			else if (action === "disable") active = false;
			if (
				action !== "enable" &&
				action !== "disable" &&
				action !== "pause" &&
				action !== "resume" &&
				action !== "disable_domain" &&
				action !== "enable_domain"
			) {
				throw new Error(
					`unsupported autonomous alerts control action: ${action}`,
				);
			}
			const state = updateAutonomousAlertControlState(
				resolution.stateRoot,
				{
					active,
					...(pausedUntil ? { pausedUntil } : {}),
					disabledDomains,
					reason: stringArg(args, "reason") ?? action,
				},
				now,
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Autonomous alerts control updated: ${action}`,
				data: { state },
				safeNotes: [
					...resolution.safeNotes,
					"Control write is stateRoot-only; no repo files, tasks, AgentLabs, rules, skills, contracts, or dependencies were changed.",
				],
			});
		}
		case "idu_supervisor_self_maintenance_advisory": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const selfMaintenance = buildRuntimeSelfMaintenanceReport(
				runtime,
				stateRoot,
			);
			const taskRead = selfMaintenance.taskRead;
			const report = selfMaintenance.report;
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: report.signals.length ? "warn" : "allow",
				severity: report.signals.some((signal) => signal.severity === "high")
					? "warning"
					: "info",
				confidence: report.signals.length ? 0.8 : 0.7,
				summary: `Supervisor self-maintenance advisory signals: ${report.signals.length}`,
				requiresHuman: false,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs: report.signals.map((signal) => signal.id),
				nextActions: report.recommendedActions,
				requiredActions: report.signals.length
					? [
							{
								id: "supervisor-self-maintenance-orchestrator-review",
								owner: "orchestrator",
								action: "review_self_maintenance_advisory_before_changes",
								reason:
									"Self-maintenance signals are advisory and must not trigger automatic writes, task creation, AgentLabs, rules, or skill changes.",
								blocking: true,
							},
						]
					: [],
			});
			const safeNotes = [
				...resolution.safeNotes,
				...report.safeNotes,
				"No creé tareas, no modifiqué reglas, no modifiqué skills y no toqué AgentLabs.",
				...taskRead.safeNotes,
			];
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Supervisor self-maintenance advisory signals: ${report.signals.length}`,
				data: {
					decisionEnvelope,
					report,
					signals: report.signals,
					structuredTaskInputStatus: taskRead.status,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes,
			});
		}
		case "idu_automaticov1_cycle": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			let selfMaintenance:
				| ReturnType<typeof buildRuntimeSelfMaintenanceReport>
				| undefined;
			const loadSelfMaintenance = () => {
				selfMaintenance ??= buildRuntimeSelfMaintenanceReport(
					runtime,
					stateRoot,
				);
				return selfMaintenance;
			};
			const request =
				"automaticov1 cyclic autonomous loop: Bibliotecario evidence/news/docs intelligence, supervisor participation, skill proposals, project structure optimization, failure detection and repair boundaries.";
			const result = await runAutomaticov1AdvisoryCycle({
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				stateRoot,
				iduActive: getIduSessionStatus(runtime.projectId).active,
				allowTaskCreation: booleanArg(args, "allowTaskCreation", false),
				allowExternalFetch: booleanArg(args, "allowExternalFetch", false),
				allowSkillDraftProposal: booleanArg(args, "allowSkillProposals", false),
				usageEvents: readIduUsageEvents(stateRoot, 500),
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
				loadTasks: () => loadSelfMaintenance().taskRead.tasks,
				loadTaskTree: () =>
					buildMasterPlanTaskTree(loadRuntimeAutomaticov1Plan(runtime)),
				loadExecutionReadiness: () =>
					loadRuntimeExecutionReadiness(runtime, stateRoot),
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
			recordSupervisorActivityEventDeferred(stateRoot, {
				projectId: runtime.projectId,
				eventType: "supervisor_tick",
				origin: "orchestrator_requested",
				trigger: "cron_planning",
				status: result.status === "ran" ? "completed" : "skipped",
				active: getIduSessionStatus(runtime.projectId).active,
				createdTasks: result.alertScheduledTick.tasksCreated.length,
				ok: result.status === "ran",
			});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: result.status === "ran" ? "warn" : "warn",
				severity: result.status === "ran" ? "info" : "warning",
				confidence: 0.78,
				summary: `automaticov1 cycle: ${result.status}`,
				requiresHuman: true,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs: result.evidenceRefs,
				nextActions: result.nextActions,
				requiredActions: [
					{
						id: "automaticov1-orchestrator-review",
						owner: "orchestrator",
						action: "review_cycle_report_before_changes",
						reason:
							"automaticov1 coordinates autonomous engines but must not authorize implementation, dependency updates, skill installation, contracts, or AgentLabs.",
						blocking: true,
					},
				],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `automaticov1 cycle: ${result.status}`,
				data: {
					decisionEnvelope,
					result,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes: [
					...resolution.safeNotes,
					...result.safeNotes,
					"MCP automaticov1 no autoriza implementación; el orquestador decide próximos cambios.",
				],
			});
		}
		case "idu_bibliotecario_proactive_advisory": {
			const request = requiredText(args, "request");
			const sourceRecommendations = runtime.sourceRecommend(request);
			const requiredSourceActions = runtime.sourceRequiredActions();
			const externalRegistry = recommendExternalSources({
				projectId: runtime.projectId,
				request,
				domains: stringListArg(args, "domains") as ExternalSourceDomain[],
				language: stringArg(args, "language"),
				framework: stringArg(args, "framework"),
				maxMatches: positiveIntegerArg(args, "maxMatches"),
			});
			const semanticDebt = buildContextPruningAdvisoryReport({
				stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,
				projectId: runtime.projectId,
				repoRoot: runtime.projectPath,
			});
			let skillReview: JsonObject;
			let skillReviewStatus = "missing";
			try {
				skillReview = compactSourceSkillCandidateReview(
					runtime.sourceSkillCandidatesReview("latest"),
				);
				skillReviewStatus = skillReview.ok === true ? "available" : "missing";
			} catch (error) {
				skillReviewStatus = "missing";
				skillReview = compactSourceSkillCandidateReview({
					ok: false,
					errors: [error instanceof Error ? error.message : String(error)],
				});
			}
			const planLibrarian = {
				surface: "plan_librarian",
				recommendation: "review_evidence_before_plan_or_contract_change",
				evidenceRefs: ["plan:snapshot", "source:recommendations"],
				requiredReads: [
					"Plan Maestro vigente",
					"master-plan.flows.json",
					"Doc/<project>/04-contratos-aprobados.md",
					"Source Library recommendation refs",
				],
				contractPromotionAllowed: false,
				limitations: [
					"No crea, aprueba ni rechaza Plan Maestro.",
					"No promueve contratos; sólo pide evidencia y revisión del orquestador.",
				],
			};
			const boundedSourceRecommendations =
				boundSourceRecommendationForInjection(sourceRecommendations);
			const boundedSourceMatches = arrayField(
				boundedSourceRecommendations,
				"matches",
			) as JsonObject[];
			const evidencePolicy = externalRegistry.evidencePolicy;
			const sourceEcosystem = {
				surface: "source_ecosystem",
				local: {
					matches: boundedSourceMatches.map((match) => ({
						sourceId: String(match.sourceId ?? ""),
						title: String(match.title ?? ""),
						chunkIds: arrayField(match, "chunkIds").map(String),
						confidence: String(match.confidence ?? "low"),
						whyRelevant: String(match.whyRelevant ?? ""),
					})),
					missingKnowledge: arrayField(
						boundedSourceRecommendations,
						"missingKnowledge",
					).map(String),
					limitations: arrayField(
						boundedSourceRecommendations,
						"limitations",
					).map(String),
					requiredActions: requiredSourceActions.actions,
					contextPressure: boundedSourceRecommendations.contextPressure,
				},
				externalRegistry: {
					matches: externalRegistry.matches.map((match) => ({
						sourceId: match.sourceId,
						name: match.name,
						category: match.category,
						whyRelevant: match.whyRelevant,
						automationMode: match.automationMode,
						promotionAllowed: match.promotionAllowed,
						claimType: match.claimType,
						evidenceRole: match.evidenceRole,
						canonicality: match.canonicality,
						requiresCorroboration: match.requiresCorroboration,
						forbiddenAsSoleAuthority: match.forbiddenAsSoleAuthority,
						policyWarnings: match.policyWarnings.slice(0, 4),
					})),
					limitations: externalRegistry.limitations,
					fetchAllowed: externalRegistry.fetchAllowed,
					rawDocsStored: externalRegistry.rawDocsStored,
				},
				rawContentIncluded: false,
				webFetchAllowed: false,
				contractPromotionAllowed: false,
			};
			const skillOptimization = {
				surface: "skill_optimization",
				recommendation: "proposal_only",
				skillPromotionAllowed: false,
				writesAllowed: false,
				installAllowed: false,
				existingCandidateReportStatus: skillReviewStatus,
				existingCandidateReport: skillReview,
				limitations: [
					"No crea ni instala skills desde esta advisory.",
					"Las skills se proponen, el supervisor enruta, el humano/orquestador aprueba y un único writer aplica.",
				],
			};
			const failureSemanticDebt = {
				surface: "failure_semantic_debt",
				signals: semanticDebt.signals.map((signal) => ({
					id: signal.id,
					category: signal.category,
					severity: signal.severity,
					evidenceRefs: signal.evidenceRefs,
					summary: signal.summary,
					recommendedAction: signal.recommendedAction,
				})),
				totals: semanticDebt.totals,
				limitations: semanticDebt.limitations,
			};
			const contextPressure = semanticDebt.signals.some(
				(signal) => signal.severity === "high",
			)
				? "high"
				: semanticDebt.signals.length > 0
					? "medium"
					: "low";
			const resourceContextCheck = {
				rawContentIncluded: false,
				webFetchAllowed: false,
				writesAllowed: false,
				agentLabAutoRunAllowed: false,
				contractPromotionAllowed: false,
				skillPromotionAllowed: false,
				tokenCostMeasured: false,
				estimatedTokenUse: "not_measured",
				pressure: contextPressure,
				surfacesConsulted: 4,
				localSourceMatches: boundedSourceMatches.length,
				externalRegistryMatches: externalRegistry.matches.length,
				semanticDebtSignals: semanticDebt.signals.length,
				contextBudgetSignals: semanticDebt.totals.contextQualityEvents,
				recommendation:
					contextPressure === "high"
						? "review_resource_and_semantic_debt_before_adding_more_context"
						: contextPressure === "medium"
							? "review_before_adding_more_context"
							: "bounded_context_ok",
			};
			const evidenceRefs = [
				...boundedSourceMatches.map(
					(match) => `source:${String(match.sourceId)}`,
				),
				...externalRegistry.matches.map(
					(match) => `external-source:${match.sourceId}`,
				),
				...semanticDebt.signals.map((signal) => signal.id),
			];
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: "warn",
				severity: semanticDebt.signals.some(
					(signal) => signal.severity === "high",
				)
					? "warning"
					: "info",
				confidence: 0.78,
				summary: "Bibliotecario proactive advisory surfaces composed.",
				requiresHuman: false,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs,
				nextActions: [
					"Use this advisory to choose a bounded next slice; do not implement from it directly.",
					"Ask human/orchestrator before contracts, skills, AgentLabs, dependency updates, or cleanup.",
					"Prefer exact source/chunk refs and resource checks over loading broad docs.",
				],
				requiredActions: [
					{
						id: "bibliotecario-surfaces-orchestrator-review",
						owner: "orchestrator",
						action: "review_bibliotecario_surfaces_before_changes",
						reason:
							"Composite Bibliotecario advisory coordinates evidence but must not authorize implementation, contract promotion, skill writes, web fetch, or AgentLabs.",
						blocking: true,
					},
				],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: "Bibliotecario proactive advisory surfaces composed.",
				data: {
					decisionEnvelope,
					planLibrarian,
					evidencePolicy,
					sourceEcosystem,
					skillOptimization,
					failureSemanticDebt,
					resourceContextCheck,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes: [
					...resolution.safeNotes,
					"Bibliotecario proactive advisory es sólo coordinación de evidencia; no implementa.",
					"No hice writes, no consulté web/live sources, no promoví contratos ni skills.",
					"No ejecuté AgentLabs ni creé solicitudes AgentLab.",
					"No incluí documentos, chunks, prompts ni reportes crudos; sólo refs, conteos y metadata compacta.",
				],
			});
		}
		case "idu_external_intelligence_report": {
			if (!resolution.stateRoot) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"External intelligence requires registered Idu-pi stateRoot; refusing workspace fallback.",
					data: {
						stateRootRequired: true,
						workspaceFallbackAllowed: false,
					},
					safeNotes: [
						...resolution.safeNotes,
						"No escribí reporte externo porque falta stateRoot registrado.",
						"External intelligence escribe sólo bajo stateRoot/reports; no usa workspaceRoot como fallback.",
					],
					errors: ["missing_state_root"],
				});
			}
			const report = await buildExternalIntelligenceReport({
				projectId: runtime.projectId,
				sourceIds: stringListArg(args, "sourceIds"),
			});
			const paths = writeExternalIntelligenceReport({
				stateRoot: resolution.stateRoot,
				report,
			});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: report.signals.length ? "warn" : "allow",
				severity: report.signals.some(
					(signal) =>
						signal.severity === "critical" || signal.severity === "high",
				)
					? "warning"
					: "info",
				confidence: 0.78,
				summary: `External intelligence signals: ${report.signals.length}`,
				requiresHuman: false,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs: report.signals.map((signal) => signal.evidenceRef),
				nextActions: [
					"Review external signals before feasibility, dependency, security, or update decisions.",
					"Do not update dependencies, promote contracts, or run AgentLabs from this report alone.",
				],
				requiredActions: report.signals.length
					? [
							{
								id: "external-intelligence-orchestrator-review",
								owner: "orchestrator",
								action: "review_external_intelligence_before_plan_decision",
								reason:
									"External ecosystem signals are advisory and require orchestrator review before any plan/dependency decision.",
								blocking: true,
							},
						]
					: [],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `External intelligence signals: ${report.signals.length}`,
				data: {
					decisionEnvelope,
					report,
					paths,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes: [
					...resolution.safeNotes,
					"External intelligence allowlist-only: no acepté URLs arbitrarias ni hice búsqueda web libre.",
					"Guardé sólo reporte normalizado bajo stateRoot/reports; no guardé cuerpos crudos, prompts, docs, headers ni env.",
					"No actualicé dependencias, no promoví contratos y no aprobé cambios por esta señal.",
					"No ejecuté AgentLabs ni analytics remota.",
				],
			});
		}
		case "idu_external_source_recommend": {
			const request = requiredText(args, "request");
			const report = recommendExternalSources({
				projectId: runtime.projectId,
				request,
				domains: stringListArg(args, "domains") as ExternalSourceDomain[],
				language: stringArg(args, "language"),
				framework: stringArg(args, "framework"),
				maxMatches: positiveIntegerArg(args, "maxMatches"),
			});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: report.matches.length ? "allow" : "warn",
				severity: report.matches.length ? "info" : "warning",
				confidence: 0.8,
				summary: `External source registry matches: ${report.matches.length}`,
				requiresHuman: false,
				orchestratorDecisionRequired: report.matches.length > 0,
				allowedToProceed: false,
				evidenceRefs: report.matches.map(
					(match) => `external-source:${match.sourceId}`,
				),
				nextActions: [
					"Use registry matches as source pointers for feasibility and planning, not as fetched evidence.",
					"Verify official/academic/community sources before changing contracts, dependencies, or implementation structure.",
				],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `External source registry matches: ${report.matches.length}`,
				data: {
					decisionEnvelope,
					report,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
				},
				safeNotes: [
					...resolution.safeNotes,
					"External source registry: no hice web/live fetch ni acepté URLs libres.",
					"no guardé raw docs, prompts ni cuerpos externos; sólo devolví descriptores y recomendaciones.",
					"No importé Source Library, no actualicé dependencias y no aprobé cambios por esta señal.",
					"No promoví contratos y No ejecuté AgentLabs.",
				],
			});
		}
		case "idu_task": {
			const text = requiredText(args, "text");
			const kind = inferTaskTemplateKind(text);
			const task = runtime.createTask(kind, text);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Tarea registrada: ${task.id}; guard=${task.guardStatus ?? "clear"}`,
				data: task as unknown as JsonObject,
				safeNotes: [
					...resolution.safeNotes,
					"Registré tarea estructurada; no ejecuté IA ni AgentLabs.",
				],
			});
		}
		case "idu_queue_detail": {
			const runtimeWithList = runtime as CliRuntime & {
				listTasks?: () => StructuredTask[];
			};
			const tasks = runtimeWithList.listTasks
				? runtimeWithList.listTasks()
				: parseTaskList(runtime.queueDetail());
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `${tasks.length} tarea(s) en cola estructurada.`,
				data: {
					tasks: tasks.map((task) => ({
						id: task.id,
						text: task.text,
						priority: task.priority,
						semanticPriority: task.semanticPriority,
						status: task.status,
						completionEvidence: task.completionEvidence,
						guardStatus: task.guardStatus ?? "clear",
						guardRisk: task.guardRisk,
						guardReason: task.guardReason,
					})),
					guardStatus: tasks.some(
						(task) =>
							task.status !== "done" &&
							task.guardStatus === "needs_confirmation",
					)
						? "needs_confirmation"
						: "clear",
				},
				safeNotes: resolution.safeNotes,
			});
		}
		case "idu_queue_complete": {
			const taskId = requiredText(args, "taskId");
			const evidence = requiredText(args, "evidence");
			const runtimeWithComplete = runtime as CliRuntime & {
				queueComplete?: (
					idOrPrefix: string,
					evidence: string,
				) => StructuredTask | undefined;
			};
			const task = runtimeWithComplete.queueComplete?.(taskId, evidence);
			if (!task) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Tarea no encontrada para completar.",
					data: { taskId },
					safeNotes: resolution.safeNotes,
					errors: ["Tarea no encontrada para completar."],
				});
			}
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Tarea completada: ${task.id}`,
				data: {
					taskId: task.id,
					status: task.status,
					task: task as unknown as JsonObject,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Marqué tarea como completada con evidencia explícita.",
					"No ejecuté IA ni AgentLabs.",
				],
			});
		}
		case "idu_semantic_audit_status": {
			const report = runtime.semanticAuditStatus();
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `shouldRun=${String(report.decision.shouldRun)} trigger=${report.decision.triggerReason}`,
				data: {
					stats: report.stats,
					checkpoint: report.checkpoint,
					shouldRun: report.decision.shouldRun,
					triggerReason: report.decision.triggerReason,
					report,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Solo leí estado de auditoría semántica.",
				],
			});
		}
		case "idu_source_status": {
			const status = runtime.sourceLibraryStatus();
			return envelope({
				ok: status.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source Library: ${status.state} (${status.sources.length} sources)`,
				data: { status },
				safeNotes: [
					...resolution.safeNotes,
					"Solo leí Source Library en stateRoot.",
					"No promoví contratos ni ejecuté AgentLabs.",
				],
				errors: status.errors,
			});
		}
		case "idu_source_add": {
			const result = runtime.sourceLibraryAdd(requiredText(args, "path"));
			return envelope({
				ok: result.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source agregada: ${result.addedSource?.id ?? "sin fuente"}`,
				data: { result, addedSource: result.addedSource },
				safeNotes: [
					...resolution.safeNotes,
					"Copié documentación bajo stateRoot/Doc/<project>/Source Library; texto legible puede generar snapshots/Markdown seguros.",
					"PDFs intentan conversión best-effort desde texto embebido; no hice OCR ni parsing pesado.",
					"No promoví contratos ni ejecuté AgentLabs.",
				],
				errors: result.errors,
			});
		}
		case "idu_source_remove": {
			const result = runtime.sourceLibraryRemove(
				requiredText(args, "sourceId"),
			);
			return envelope({
				ok: result.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source removida: ${result.removedSource?.id ?? "sin fuente"}`,
				data: { result, removedSource: result.removedSource },
				safeNotes: [
					...resolution.safeNotes,
					"Removí sólo archivos registrados dentro de Source Library stateRoot.",
					"No cambié contratos, Project Core, Constitution, flows ni skills.",
					"No ejecuté AgentLabs.",
				],
				errors: result.errors,
			});
		}
		case "idu_source_read": {
			const result = withSourceContentBudget(
				runtime.sourceLibraryRead(requiredText(args, "sourceId")),
				"source_chunk_read",
				"result.content",
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source read: ${result.source.id} status=${result.readStatus}`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Leí sólo fuentes registradas en Source Library stateRoot.",
					"No cambié contratos ni ejecuté AgentLabs.",
					"No consulté web/live sources.",
				],
			});
		}
		case "idu_source_extract": {
			const result = runtime.sourceLibraryExtract(
				requiredText(args, "sourceId"),
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source extract: ${result.source.id} status=${result.extractionStatus}`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Extracción de texto escribe sólo bajo Source Library stateRoot cuando corresponde.",
					"PDFs convertidos se leen desde Markdown seguro; PDFs sin texto embebido quedan metadata-only. No hice OCR ni parsing pesado.",
					"No cambié contratos ni ejecuté AgentLabs.",
				],
			});
		}
		case "idu_source_report": {
			const result = runtime.sourceLibraryReport(
				requiredText(args, "sourceId"),
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source report: ${result.source.id} extraction=${result.extractionStatus}`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Reporté metadata de fuente registrada solamente.",
					"No cambié contratos ni ejecuté AgentLabs.",
				],
			});
		}
		case "idu_source_research_report": {
			const result = withSourceResearchBudget(
				runtime.sourceLibraryResearch(requiredText(args, "query")),
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source research: ${result.signals.length} señales`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Investigué sólo fuentes registradas y texto extraído/legible.",
					"No consulté web/live sources.",
					"No promoví contratos ni ejecuté AgentLabs.",
				],
			});
		}
		case "idu_source_digest": {
			const result = runtime.sourceDigest(requiredText(args, "sourceId"));
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source digest: ${result.sourceId} mode=${result.processingMode}`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Digest/chunks escritos bajo stateRoot/Doc/<project>/sources/{chunks,digests} y source-library-index.json.",
					"No consulté web/live sources ni ejecuté AgentLabs.",
					"No promoví contratos.",
				],
			});
		}
		case "idu_source_digest_status": {
			const result = runtime.sourceDigestStatus();
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source digest status: ${result.digests.length} fuentes`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Leí sólo estado de digests en Source Library stateRoot.",
					"No promoví contratos ni ejecuté AgentLabs.",
				],
			});
		}
		case "idu_source_chunk_read": {
			const result = withSourceContentBudget(
				runtime.sourceChunkRead(
					requiredText(args, "sourceId"),
					requiredText(args, "chunkId"),
				),
				"source_chunk_read",
				"result.content",
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source chunk read: ${result.chunkId}`,
				data: { result },
				safeNotes: [
					...resolution.safeNotes,
					"Leí sólo chunks registrados bajo Source Library stateRoot.",
					"No consulté web/live sources ni ejecuté AgentLabs.",
				],
			});
		}
		case "idu_source_recommend_for_task": {
			const rawResult = runtime.sourceRecommend(requiredText(args, "request"));
			const result = boundSourceRecommendationForInjection(rawResult);
			const matches = arrayField(result, "matches") as JsonObject[];
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: matches.length > 0 ? "warn" : "allow",
				severity: matches.length > 0 ? "warning" : "info",
				confidence: 0.68,
				summary: `Source recommendations: ${matches.length} matches`,
				requiresHuman: false,
				orchestratorDecisionRequired: matches.length > 0,
				allowedToProceed: true,
				evidenceRefs: matches.map(
					(match) => `source:${String(match.sourceId)}`,
				),
				nextActions: matches.map((match) =>
					String(match.orchestratorInstruction ?? ""),
				),
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source recommendations: ${matches.length} matches`,
				data: { result, decisionEnvelope },
				safeNotes: [
					...resolution.safeNotes,
					"Recomendé fuentes/chunks desde índice local; el orquestador decide y manda subagentes.",
					"No implementé, no consulté web/live sources y no ejecuté AgentLabs.",
					"No promoví contratos.",
				],
			});
		}
		case "idu_source_required_actions": {
			const result = runtime.sourceRequiredActions();
			const evidenceGateways =
				buildSourceRequiredActionsEvidenceGateways(result);
			const decisionEnvelope = decisionEnvelopeFromEvidence(
				name,
				`Source required actions: ${result.actions.length}`,
				evidenceGateways,
				{
					recommendation:
						result.actions.length > 0 ? "needs_evidence" : "allow",
					severity: result.actions.length > 0 ? "needs_approval" : "info",
					confidence: 0.86,
					requiresHuman: false,
					orchestratorDecisionRequired: result.actions.length > 0,
					nextActions: result.actions.map(
						(action) => action.requiredAction.instructions,
					),
				},
			);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source required actions: ${result.actions.length}`,
				data: {
					result,
					actions: result.actions,
					evidenceGateways,
					decisionEnvelope,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Listé fuentes que requieren lector bibliotecario; el orquestador debe despachar el subagente.",
					"No implementé, no ejecuté AgentLabs y no consulté web/live sources.",
					"No promoví contratos.",
				],
			});
		}
		case "idu_source_skill_candidates_create": {
			const result = runtime.sourceSkillCandidatesCreate(
				stringArg(args, "selector") ?? "all",
			);
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: result.report.candidates.length
					? "needs_approval"
					: "allow",
				severity: result.report.candidates.length ? "warning" : "info",
				confidence: 0.72,
				summary: `Source skill candidates: ${result.report.candidates.length}`,
				requiresHuman: true,
				orchestratorDecisionRequired: result.report.candidates.length > 0,
				allowedToProceed: true,
				evidenceRefs: result.report.candidates.flatMap(
					(candidate) => candidate.evidenceRefs,
				),
				nextActions: [
					"Human/orchestrator must review before any skill promotion.",
					"Optional future AgentLab review can audit comprehension and duplicates.",
				],
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source skill candidates: ${result.report.candidates.length}`,
				data: { result, decisionEnvelope },
				safeNotes: [
					...resolution.safeNotes,
					"Creé sólo un reporte JSON bajo stateRoot/reports.",
					"No instalé skills, no escribí .agents/.atl y no promoví contratos.",
					"tokens/cost: no medido.",
				],
			});
		}
		case "idu_source_skill_candidates_review": {
			const review = runtime.sourceSkillCandidatesReview(
				stringArg(args, "pathOrLatest") ?? "latest",
			);
			return envelope({
				ok: review.ok,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: review.ok
					? `Source skill candidate report valid: ${review.report.candidates.length} candidates`
					: `Source skill candidate report invalid: ${review.errors.length} errors`,
				data: { review },
				safeNotes: [
					...resolution.safeNotes,
					"Validé reporte advisory/reports-only; no instalé skills ni ejecuté AgentLabs.",
					"tokens/cost: no medido.",
				],
				errors: review.ok ? [] : review.errors,
			});
		}
		case "idu_skill_draft_from_lessons": {
			const rawMode = stringArg(args, "mode") ?? "proposal-only";
			const mode = rawMode as SkillDraftFromLessonsMode;
			if (mode !== "proposal-only" && mode !== "approved-only") {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Modo inválido para skill draft from lessons.",
					data: { mode: rawMode },
					safeNotes: [
						...resolution.safeNotes,
						"No generé propuestas ni drafts de skill.",
					],
					errors: ["mode must be proposal-only or approved-only"],
				});
			}
			const result = runtime.skillDraftFromLessons({
				mode,
				selector: stringArg(args, "selector"),
			});
			const createdCount =
				result.mode === "proposal-only"
					? result.createdProposals.length
					: result.createdDrafts.length;
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: createdCount ? "needs_approval" : "needs_evidence",
				severity: createdCount ? "warning" : "info",
				confidence: 0.78,
				summary:
					result.mode === "proposal-only"
						? `Skill proposals from lessons: ${createdCount}`
						: `Skill drafts from approved proposals: ${createdCount}`,
				requiresHuman: true,
				orchestratorDecisionRequired: true,
				allowedToProceed: false,
				evidenceRefs: [
					...(result.semanticDraftPath
						? [`semantic-draft:${result.semanticDraftPath}`]
						: []),
					...(result.proposalsPath
						? [`skill-proposals:${result.proposalsPath}`]
						: []),
					...(result.skillDraftPath
						? [`skill-draft:${result.skillDraftPath}`]
						: []),
				],
				requiredActions: result.requiredActions.map((action, index) => ({
					id: `skill-draft-from-lessons-${index + 1}`,
					owner: "orchestrator",
					action,
					reason:
						"Skill learning artifacts require explicit human/orchestrator approval.",
					blocking: false,
				})),
				nextActions: result.nextActions,
			});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary:
					result.mode === "proposal-only"
						? `Skill proposals from lessons: ${createdCount}`
						: `Skill drafts from approved proposals: ${createdCount}`,
				data: { result, decisionEnvelope },
				safeNotes: [...resolution.safeNotes, ...result.safeNotes],
			});
		}
		case "idu_source_refresh": {
			const status = runtime.sourceLibraryRefresh();
			return envelope({
				ok: status.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Source Library refresh: ${status.state}`,
				data: { status },
				safeNotes: [
					...resolution.safeNotes,
					"Refresh recalculó estado/hashes en stateRoot únicamente.",
					"No cambié contratos, Project Core, Constitution, flows ni skills.",
					"No ejecuté AgentLabs.",
				],
				errors: status.errors,
			});
		}
		case "idu_agentlab_request_create": {
			const source = requiredOneOf(args, "source", [
				"postflight",
				"master-plan",
				"skill-draft",
				"external-source-intelligence",
				"specialist-audit-plan",
			]);
			const selector = stringArg(args, "selector") ?? "latest";
			const specialties = agentLabSpecialtiesArg(args, "specialties");
			if (source === "specialist-audit-plan" && specialties.errors.length > 0) {
				return envelope({
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Solicitud AgentLab specialist-audit-plan inválida.",
					data: {},
					safeNotes: [
						...resolution.safeNotes,
						"No ejecuté AgentLabs.",
						"No creé solicitud AgentLab inválida.",
					],
					errors: specialties.errors,
				});
			}
			const objective = stringArg(args, "objective");
			const context = stringArg(args, "context");
			const sourceLibraryEvidence =
				source === "external-source-intelligence"
					? compactSourceLibraryEvidence(
							runtime.sourceRecommend(context ?? objective ?? selector),
						)
					: undefined;
			const plan = runtime.agentLabRequestCreate(source, selector, {
				objective,
				context,
				specialties: specialties.values,
				externalSourceLibraryEvidence: sourceLibraryEvidence,
			});
			const workloadEnvelope =
				plan.workloadEnvelope ??
				buildAgentLabWorkloadEnvelope({
					status: "requested",
					statusReason:
						"Solicitud AgentLab creada; no ejecuta revisión automáticamente.",
					generatedAt: plan.generatedAt,
					source: "mcp",
					requests: plan.requests,
				});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: plan.errors.length > 0 ? "block" : "warn",
				severity: plan.errors.length > 0 ? "needs_approval" : "warning",
				confidence: 0.72,
				summary: `Solicitud AgentLab creada: ${plan.path ?? "sin ruta"}`,
				requiresHuman: false,
				orchestratorDecisionRequired: true,
				allowedToProceed: plan.errors.length === 0,
				evidenceRefs: plan.requests.map(
					(request) => `agentlab-request:${request.specialty}`,
				),
				suggestedAgentLabs: [
					...new Set(plan.requests.map((request) => request.specialty)),
				],
				nextActions: [
					"Run idu_agentlab_review_run only by explicit orchestrator decision.",
				],
			});
			return envelope({
				ok: plan.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Solicitud AgentLab creada: ${plan.path ?? "sin ruta"}`,
				data: {
					decisionEnvelope,
					workloadEnvelope,
					requestFilePath: plan.path,
					specialties: [
						...new Set(plan.requests.map((request) => request.specialty)),
					],
					plan,
				},
				safeNotes: [
					...resolution.safeNotes,
					"No ejecuté AgentLabs.",
					"Solicitud formal solamente.",
					...(source === "external-source-intelligence"
						? [
								"Usé sólo Source Library/digests locales cuando estuvieron disponibles; no hice web/live fetch.",
							]
						: []),
				],
				errors: plan.errors,
			});
		}
		case "idu_agentlab_review_run": {
			const selector = stringArg(args, "selector") ?? "latest";
			const result = await runtime.agentLabReviewRun(selector);
			const aggregateStatus = aggregateRunStatus(
				result.runs.map((run) => run.status),
			);
			const envelopeStatus =
				aggregateStatus === "unknown" ? "skipped" : aggregateStatus;
			const workloadEnvelope =
				result.workloadEnvelope ??
				buildAgentLabWorkloadEnvelope({
					status: envelopeStatus as
						| "completed"
						| "partial"
						| "timed_out"
						| "skipped"
						| "failed"
						| "security_violation",
					statusReason: `AgentLab run aggregate status: ${aggregateStatus}.`,
					generatedAt: result.generatedAt,
					source: "mcp",
					runs: result.runs,
				});
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `AgentLab review run: ${result.consolidatedSummary}`,
				data: {
					workloadEnvelope,
					runFilePath: result.path,
					status: aggregateStatus,
					findingsCount: result.consolidatedFindings.length,
					securityViolations: result.runs.filter(
						(run) => run.status === "security_violation",
					).length,
					result,
				},
				safeNotes: [
					...resolution.safeNotes,
					...result.safeNotes,
					"AgentLab review runner debe respetar sandbox/clone guard.",
				],
			});
		}
		case "idu_agentlab_review_status": {
			const selector = stringArg(args, "selector") ?? "latest";
			const status = runtime.agentLabReviewStatus(selector);
			const runs = status.result?.runs ?? [];
			const workloadEnvelope = agentLabStatusWorkloadEnvelope(status);
			const recommendations = runs.flatMap((run) => run.recommendations);
			const agentLabRequiresHuman =
				!status.valid ||
				status.result?.requiresHumanApproval === true ||
				runs.some((run) => run.requiresHumanApproval) ||
				recommendations.some(
					(recommendation) => recommendation.requiresHumanApproval,
				);
			const agentLabHumanActions = agentLabRequiresHuman
				? [
						{
							id: "agentlab-review-human-approval",
							owner: "human" as const,
							action: "review_agentlab_before_proceeding",
							reason:
								"AgentLab status or recommendation requires human/orchestrator approval.",
							blocking: true,
							data: {
								recommendedNext: status.result?.recommendedNext,
								recommendations: recommendations
									.filter(
										(recommendation) => recommendation.requiresHumanApproval,
									)
									.map((recommendation) => recommendation.title),
							},
						},
					]
				: [];
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: status.valid
					? agentLabRequiresHuman
						? "ask_human"
						: "warn"
					: "block",
				severity: agentLabRequiresHuman ? "needs_approval" : "warning",
				confidence: 0.74,
				summary: status.valid
					? `Estado AgentLab: ${status.name}`
					: "Estado AgentLab inválido.",
				requiresHuman: agentLabRequiresHuman,
				orchestratorDecisionRequired: true,
				allowedToProceed: status.valid && !agentLabRequiresHuman,
				evidenceRefs: (status.result?.consolidatedFindings ?? []).map(
					(finding, index) => `agentlab-finding:${index + 1}:${finding.title}`,
				),
				requiredActions: agentLabHumanActions,
				suggestedAgentLabs: runs.map((run) => run.specialty),
				nextActions: recommendations.map(
					(recommendation) => recommendation.suggestedNextStep,
				),
			});
			return envelope({
				ok: status.valid,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: status.valid
					? `Estado AgentLab: ${status.name}`
					: "Estado AgentLab inválido.",
				data: {
					decisionEnvelope,
					workloadEnvelope,
					statusBySpecialty: Object.fromEntries(
						runs.map((run) => [run.specialty, run.status]),
					),
					findings: status.result?.consolidatedFindings ?? [],
					recommendations,
					testsSuggested: runs.flatMap((run) => run.testsSuggested),
					status,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Solo leí reporte AgentLab; no ejecuté labs.",
				],
				errors: status.errors,
			});
		}
	}
	throw new Error(`Tool ${name} is handled before runtime dispatch.`);
}

type MasterPlanReviewResult = ReturnType<
	NonNullable<CliRuntime["masterPlanReview"]>
>;

type PlanSnapshot = JsonObject & {
	authority: "advisory";
	planStatus: string;
	objective: string;
	operationalContracts: unknown[];
	flows: unknown[];
	contextBudget: ContextBudgetUsage;
};

type SupervisorConsultation = JsonObject & {
	version: 1;
	authority: "advisory";
	source: string;
	supervisorRecommendation: string;
	severity: string;
	confidence: number;
	risks: string[];
	gates: string[];
	contracts: string[];
	evidenceRefs: string[];
	proceed: boolean;
	proceedRationale: string;
	stopRationale: string[];
	requiresHuman: boolean;
	agentLabs: { mode: "audit_only"; autoRun: false; suggested: string[] };
};

function defaultRuntimeFactory(projectPath?: string): CliRuntime {
	return createCliRuntime({ projectPath, requireTelegramConfig: false });
}

function buildSupervisorConsultation(input: {
	source: string;
	planObjective?: string;
	supervisorRecommendation: string;
	severity: string;
	confidence: number;
	risks?: string[];
	gates?: string[];
	contracts?: string[];
	evidenceRefs?: string[];
	proceed: boolean;
	proceedRationale: string;
	stopRationale?: string[];
	requiresHuman: boolean;
	suggestedAgentLabs?: string[];
}): SupervisorConsultation {
	return {
		version: 1,
		authority: "advisory",
		source: input.source,
		...(input.planObjective ? { planObjective: input.planObjective } : {}),
		supervisorRecommendation: input.supervisorRecommendation,
		severity: input.severity,
		confidence: input.confidence,
		risks: (input.risks ?? []).slice(0, 8),
		gates: (input.gates ?? []).slice(0, 8),
		contracts: dedupe(input.contracts ?? []).slice(0, 8),
		evidenceRefs: dedupe(input.evidenceRefs ?? []).slice(0, 12),
		proceed: input.proceed,
		proceedRationale: input.proceedRationale,
		stopRationale: (input.stopRationale ?? []).slice(0, 8),
		requiresHuman: input.requiresHuman,
		agentLabs: {
			mode: "audit_only",
			autoRun: false,
			suggested: dedupe(input.suggestedAgentLabs ?? []).slice(0, 8),
		},
	};
}

function planObjectiveForRuntime(runtime: CliRuntime): string | undefined {
	if (!runtime.masterPlanReview) return undefined;
	try {
		const review = runtime.masterPlanReview("latest");
		const plan = review.plan as unknown as JsonObject;
		return (
			String(plan.inferredObjective ?? plan.executiveSummary ?? "").trim() ||
			undefined
		);
	} catch {
		return undefined;
	}
}

function buildConsultationFromAdvisory(input: {
	source: string;
	planObjective?: string;
	advisory: JsonObject;
	risks?: string[];
	gates?: string[];
	proceedRationale?: string;
}): SupervisorConsultation {
	const requiresHuman = Boolean(input.advisory.requiresHuman);
	const recommendation = String(input.advisory.recommendation ?? "warn");
	const severity = String(input.advisory.severity ?? "warning");
	const stopRationale = requiresHuman
		? ["Supervisor requiere revisión humana/orquestador antes de proceder."]
		: [];
	return buildSupervisorConsultation({
		source: input.source,
		planObjective: input.planObjective,
		supervisorRecommendation: recommendation,
		severity,
		confidence: Number(input.advisory.confidence ?? 0.7),
		risks: input.risks,
		gates: input.gates,
		contracts: arrayField(input.advisory, "contractsAffected").map(String),
		evidenceRefs: arrayField(input.advisory, "evidenceRefs").map(String),
		proceed: !requiresHuman && recommendation !== "block",
		proceedRationale:
			input.proceedRationale ??
			(!requiresHuman
				? "Supervisor no detectó bloqueo; el orquestador puede proceder con gates y evidencia."
				: "Supervisor recomienda detenerse hasta resolver revisión humana/orquestador."),
		stopRationale,
		requiresHuman,
		suggestedAgentLabs: arrayField(input.advisory, "suggestedAgentLabs").map(
			String,
		),
	});
}

function buildSupervisorContextPack(
	runtime: CliRuntime,
	request: string,
	includePlanSnapshot: boolean,
): JsonObject {
	if (!runtime.masterPlanReview) {
		throw new Error("Master Plan no disponible en este runtime.");
	}
	const review = runtime.masterPlanReview("latest");
	const snapshot = buildPlanSnapshot(review, runtime);
	const humanVision = budgetTextField(
		extractHumanVision(runtime.projectPath),
		"supervisor_context_pack",
		"goals.humanVision",
	);
	const taskGoalResult = sliceTextToBudget({
		text: request,
		profile: "supervisor_context_pack",
		path: "goals.taskGoal",
		maxChars: 320,
	});
	const taskGoal = { value: taskGoalResult.text, usage: taskGoalResult.usage };
	const compactRequest = taskGoal.value;
	const advisoryAction = buildNextAdvisoryAction(
		snapshot,
		compactRequest,
		"from_request",
		"small",
	);
	const taskPackage = buildTaskPackage(
		snapshot,
		advisoryAction,
		compactRequest,
		undefined,
		false,
	);
	const report = runtime.preflight(request);
	const alignmentAdvisory = buildPreflightOrchestratorAdvisory(report);
	const contracts = dedupe([
		...arrayField(taskPackage, "contracts").map(String),
		...arrayField(
			alignmentAdvisory as unknown as JsonObject,
			"contractsAffected",
		).map(String),
	]);
	const requiredReads = dedupe([
		...arrayField(taskPackage, "filesToRead").map(String),
		...arrayField(
			alignmentAdvisory as unknown as JsonObject,
			"requiredReads",
		).map(String),
	]);
	const risks = dedupe([
		...arrayField(snapshot, "risks").map(String),
		...arrayField(report as unknown as JsonObject, "warnings").map(String),
	]);
	const safeRisks = budgetStringArray(
		risks,
		"supervisor_context_pack",
		"risks",
	);
	const safeReads = budgetStringArray(
		requiredReads,
		"supervisor_context_pack",
		"requiredReads",
	);
	const autonomyGates = [
		"Consultar Plan Maestro antes de definir objetivo o declarar cierre.",
		"Ejecutar governance-review del orquestador antes del worker.",
		"Corregir bugs dentro del objetivo aprobado con tests y evidencia.",
		"Ejecutar idu_postflight antes de cerrar o commitear.",
		"No commit/push/publicación sin instrucción explícita del humano u orquestador autorizado.",
		"AgentLabs son audit-only y sólo por llamada explícita; nunca implementan.",
		"Si falta evidencia o cobertura, reportar parcial/omisiones en vez de asumir aprobado.",
	];
	const skipNoiseGuidance = [
		"No leas docs completas si el pack ya trae objetivo, contratos y gates suficientes.",
		"No cargues Source Library completa; pedí chunks concretos cuando la tarea lo requiera.",
		"Ignorá subagent-artifacts, dist, node_modules, logs y stateRoot salvo que la tarea los nombre.",
		"No trates safeNotes o memoria como contrato aprobado; el Plan Maestro gobierna.",
		"No infieras tokens/costo/contexto si no hay evidencia estructurada.",
	];
	const humanApprovalRequired =
		Boolean(alignmentAdvisory.requiresHuman) ||
		Boolean(
			(taskPackage.agentLabPolicy as JsonObject | undefined)
				?.requiresHumanApproval,
		);
	const preconditions = taskPackage.preconditions as JsonObject | undefined;
	const preconditionBlocked = Boolean(preconditions?.blocked);
	const stopRationale = [
		...(alignmentAdvisory.requiresHuman
			? [
					"Supervisor requiere revisión humana/orquestador por riesgo o alcance.",
				]
			: []),
		...(preconditionBlocked
			? ["Task package está bloqueado por precondiciones."]
			: []),
	];
	const sourceEvidence = buildSupervisorSourceEvidence(runtime, compactRequest);
	const embeddedPlanSnapshot = includePlanSnapshot
		? compactPlanSnapshotForContextPack(snapshot)
		: undefined;
	const embeddedPlanSnapshotUsage = embeddedPlanSnapshot
		? budgetEmbeddedPlanSnapshotForContextPack(embeddedPlanSnapshot)
		: undefined;
	const supervisorConsultation = buildSupervisorConsultation({
		source: "idu_supervisor_context_pack",
		planObjective: snapshot.objective,
		supervisorRecommendation: String(alignmentAdvisory.recommendation),
		severity: String(alignmentAdvisory.severity),
		confidence: Number(alignmentAdvisory.confidence ?? 0.78),
		risks: safeRisks.items,
		gates: autonomyGates,
		contracts,
		evidenceRefs: dedupe([
			"readme:vision",
			"plan:snapshot",
			"task:context",
			...alignmentAdvisory.evidenceRefs,
		]),
		proceed: !alignmentAdvisory.requiresHuman && !preconditionBlocked,
		proceedRationale:
			!alignmentAdvisory.requiresHuman && !preconditionBlocked
				? "Supervisor no detectó bloqueo; el orquestador puede proceder mostrando gates y evidencia."
				: "Supervisor exige resolver stopRationale antes de proceder.",
		stopRationale,
		requiresHuman: humanApprovalRequired,
		suggestedAgentLabs: alignmentAdvisory.suggestedAgentLabs,
	});
	return {
		packVersion: 1,
		authority: "advisory",
		audience: "orchestrator_subagents",
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		request: compactRequest,
		summary: "Supervisor context pack listo para el orquestador.",
		goals: {
			humanVision: humanVision.value,
			planObjective: snapshot.objective,
			taskGoal: taskGoal.value,
		},
		contracts,
		risks: safeRisks.items,
		requiredReads: safeReads.items,
		skipNoiseGuidance,
		autonomyGates,
		humanApprovalRequired,
		supervisorConsultation,
		sourceEvidence,
		taskPackage,
		taskContext: {
			recommendation: alignmentAdvisory.recommendation,
			severity: alignmentAdvisory.severity,
			confidence: alignmentAdvisory.confidence,
			summary: alignmentAdvisory.summary,
			contractsAffected: alignmentAdvisory.contractsAffected,
			requiredReads: alignmentAdvisory.requiredReads,
			suggestedAgentLabs: alignmentAdvisory.suggestedAgentLabs,
			requiresHuman: alignmentAdvisory.requiresHuman,
			evidenceRefs: alignmentAdvisory.evidenceRefs,
		},
		...(embeddedPlanSnapshot ? { planSnapshot: embeddedPlanSnapshot } : {}),
		contextBudget: mergeContextBudgetUsage("supervisor_context_pack", [
			humanVision.usage,
			taskGoal.usage,
			safeRisks.usage,
			safeReads.usage,
			...(embeddedPlanSnapshotUsage ? [embeddedPlanSnapshotUsage] : []),
		]),
		governanceConfig: governanceConfigData(),
		workerBoundary: workerBoundaryData(),
	};
}

function compactPlanSnapshotForContextPack(snapshot: PlanSnapshot): JsonObject {
	return {
		authority: snapshot.authority,
		planStatus: snapshot.planStatus,
		planApproved: snapshot.planApproved,
		projectId: snapshot.projectId,
		projectPath: snapshot.projectPath,
		objective: snapshot.objective,
		summary: snapshot.summary,
		flowArtifact: snapshot.flowArtifact,
		blockers: snapshot.blockers,
		recommendedNext: snapshot.recommendedNext,
	};
}

function budgetEmbeddedPlanSnapshotForContextPack(
	snapshot: JsonObject,
): ContextBudgetUsage {
	const serialized = JSON.stringify(snapshot);
	return createContextBudgetUsage("supervisor_context_pack", {
		usedChars: serialized.length,
	});
}

function buildSupervisorSourceEvidence(
	runtime: CliRuntime,
	request: string,
): JsonObject {
	const recommendation = runtime.sourceRecommend(request);
	const required = runtime.sourceRequiredActions();
	return {
		version: 1,
		authority: "advisory",
		source: "source_library",
		rawContentIncluded: false,
		contractPromotionAllowed: false,
		agentLabAutoRunAllowed: false,
		orchestratorGuidance: [
			"Usar sólo IDs y chunk refs como punteros; no tratar fuentes como contratos.",
			"Leer chunks nombrados con idu_source_chunk_read o despachar document-reader antes de implementar si la tarea depende de esa evidencia.",
			"No ejecutar AgentLabs, web fetch, promoción de contratos ni cambios de dependencias desde este pack.",
		],
		recommendationReport: boundSupervisorSourceRecommendation(recommendation),
		requiredActions: boundSupervisorSourceRequiredActions(required),
	};
}

function boundSupervisorSourceRecommendation(
	report: SourceRecommendationReport,
): JsonObject {
	return {
		projectId: report.projectId,
		request: boundSupervisorSourceText(report.request, 240),
		generatedAt: report.generatedAt,
		matches: report.matches.slice(0, 3).map((match) => ({
			sourceId: boundSupervisorSourceText(match.sourceId, 120),
			title: boundSupervisorSourceText(match.title, 160),
			chunkIds: match.chunkIds
				.slice(0, 5)
				.map((chunkId) => boundSupervisorSourceText(chunkId, 160)),
			whyRelevant: boundSupervisorSourceText(match.whyRelevant, 280),
			confidence: match.confidence,
			orchestratorInstruction: boundSupervisorSourceText(
				match.orchestratorInstruction,
				280,
			),
			contractPromotionAllowed: false,
		})),
		missingKnowledge: report.missingKnowledge
			.slice(0, 5)
			.map((item) => boundSupervisorSourceText(item, 220)),
		limitations: report.limitations
			.slice(0, 5)
			.map((item) => boundSupervisorSourceText(item, 220)),
		contractPromotionAllowed: false,
	};
}

function boundSourceRecommendationForInjection(
	report: SourceRecommendationReport,
): JsonObject {
	const bounded = boundSupervisorSourceRecommendation(report);
	const originalChunkRefs = report.matches.reduce(
		(total, match) => total + match.chunkIds.length,
		0,
	);
	const boundedMatches = arrayField(bounded, "matches") as JsonObject[];
	const boundedChunkRefs = boundedMatches.reduce(
		(total, match) => total + arrayField(match, "chunkIds").length,
		0,
	);
	const truncated =
		report.matches.length > boundedMatches.length ||
		originalChunkRefs > boundedChunkRefs ||
		report.request.length > String(bounded.request ?? "").length ||
		report.missingKnowledge.length >
			arrayField(bounded, "missingKnowledge").length ||
		report.limitations.length > arrayField(bounded, "limitations").length;
	return {
		...bounded,
		contextPressure: {
			mode: "advisory_only",
			tokenCostMeasured: false,
			estimatedTokenUse: "not_measured",
			pressure: truncated ? "medium" : "low",
			recommendation: truncated
				? "review_before_adding_more_context"
				: "bounded_context_ok",
			rawContentIncluded: false,
			webFetchAllowed: false,
			writesAllowed: false,
			contractPromotionAllowed: false,
			matchCount: boundedMatches.length,
			originalMatchCount: report.matches.length,
			chunkRefCount: boundedChunkRefs,
			originalChunkRefCount: originalChunkRefs,
			truncated,
		},
	};
}

function boundSupervisorSourceRequiredActions(
	report: SourceRequiredActionsReport,
): JsonObject {
	return {
		projectId: report.projectId,
		generatedAt: report.generatedAt,
		actions: report.actions.slice(0, 3).map((item) => ({
			sourceId: boundSupervisorSourceText(item.sourceId, 120),
			title: boundSupervisorSourceText(item.title, 160),
			kind: item.kind,
			digestStatus: item.digestStatus,
			conversionStatus: item.conversionStatus,
			requiredAction: {
				owner: item.requiredAction.owner,
				action: item.requiredAction.action,
				reason: boundSupervisorSourceText(item.requiredAction.reason, 220),
				recommendedAgent: item.requiredAction.recommendedAgent,
				recommendedReaderType: item.requiredAction.recommendedReaderType,
				instructions: boundSupervisorSourceText(
					item.requiredAction.instructions,
					280,
				),
				contractPromotionAllowed: false,
			},
			contractPromotionAllowed: false,
		})),
		limitations: report.limitations
			.slice(0, 5)
			.map((item) => boundSupervisorSourceText(item, 220)),
		contractPromotionAllowed: false,
	};
}

function boundSupervisorSourceText(value: string, maxChars: number): string {
	const normalized = value.replace(/\s+/gu, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 28)).trimEnd()}… [source ref truncated]`;
}

function extractHumanVision(projectPath: string): string {
	const readme = ["README.md", "readme.md"]
		.map((name) => join(projectPath, name))
		.find((path) => existsSync(path));
	if (!readme) return "README no disponible; usar Plan Maestro vigente.";
	const content = readFileSync(readme, "utf8");
	const lines = content
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("```"));
	const normalizedLines = lines.map((line) => line.replace(/^#+\s*/u, ""));
	const selected: string[] = [];
	for (const line of normalizedLines.slice(0, 2)) {
		pushHumanVisionLine(selected, line, 10);
	}
	for (const [index, line] of normalizedLines.entries()) {
		if (
			/qué problema|que problema|qué no es|que no es|cómo funciona|como funciona|arquitectura simple/iu.test(
				line,
			)
		) {
			pushHumanVisionLine(selected, line, 10);
			pushHumanVisionLine(selected, normalizedLines[index + 1] ?? "", 10);
		}
	}
	for (const line of normalizedLines) {
		if (/orquestador|supervisor|agentlab/iu.test(line)) {
			pushHumanVisionLine(selected, line);
		}
		if (selected.length >= 8 || selected.join("\n").length > 850) break;
	}
	return selected.join("\n");
}

function pushHumanVisionLine(
	selected: string[],
	line: string,
	maxLines = 8,
): void {
	const compact = compactHumanVisionLine(line);
	if (!compact || selected.includes(compact)) return;
	if (
		selected.length >= maxLines ||
		[...selected, compact].join("\n").length > 900
	)
		return;
	selected.push(compact);
}

function compactHumanVisionLine(line: string): string {
	const normalized = line.replace(/\s+/gu, " ").trim();
	if (normalized.length <= 80) return normalized;
	return `${normalized.slice(0, 77).trimEnd()}…`;
}

function buildPlanSnapshot(
	review: MasterPlanReviewResult,
	runtime: CliRuntime,
): PlanSnapshot {
	const plan = review.plan as unknown as JsonObject;
	const status = String(plan.status ?? "unknown");
	const criticalRisks = arrayField(plan, "criticalRisks");
	const driftFindings = arrayField(plan, "driftFindings");
	const objective = budgetTextField(
		String(
			plan.inferredObjective ??
				plan.executiveSummary ??
				"Objetivo no definido.",
		),
		"plan_snapshot",
		"objective",
	);
	const summary = budgetTextField(
		String(plan.executiveSummary ?? ""),
		"plan_snapshot",
		"summary",
	);
	const approvedClaims = budgetJsonArray(
		arrayField(plan, "canonicalClaims"),
		"plan_snapshot",
		"approvedClaims",
	);
	const operationalContracts = budgetJsonArray(
		arrayField(plan, "operationalContracts"),
		"plan_snapshot",
		"operationalContracts",
	);
	const workMilestones = budgetJsonArray(
		arrayField(plan, "workMilestones"),
		"plan_snapshot",
		"workMilestones",
	);
	const budgetedDriftFindings = budgetJsonArray(
		driftFindings,
		"plan_snapshot",
		"driftFindings",
	);
	const risks = budgetStringArray(
		dedupe([
			...criticalRisks.map(String),
			...arrayField(plan, "qualityRisks").map(String),
			...arrayField(plan, "securityRisks").map(String),
			...arrayField(plan, "architectureRisks").map(String),
		]),
		"plan_snapshot",
		"risks",
	);
	const flows = budgetJsonArray(
		arrayField(plan, "projectFlows"),
		"plan_snapshot",
		"flows",
	);
	const blockers = budgetJsonArray(
		status === "approved" ? criticalRisks : ["Plan Maestro no aprobado"],
		"plan_snapshot",
		"blockers",
	);
	const recommendedNext = budgetJsonArray(
		arrayField(plan, "recommendedNext"),
		"plan_snapshot",
		"recommendedNext",
	);
	const recommendedAgentLabs = budgetJsonArray(
		arrayField(
			(review.revisionAntesDeZarpar as JsonObject | undefined) ?? {},
			"recommendedAgentLabs",
		),
		"plan_snapshot",
		"recommendedAgentLabs",
	);
	return {
		authority: "advisory",
		planStatus: status,
		planApproved: status === "approved",
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		objective: objective.value,
		summary: summary.value,
		approvedClaims: approvedClaims.items,
		operationalContracts: operationalContracts.items,
		workMilestones: workMilestones.items,
		driftFindings: budgetedDriftFindings.items,
		risks: risks.items,
		flows: flows.items,
		flowArtifact: String(plan.flowArtifact ?? "master-plan.flows.json"),
		blockers: blockers.items,
		recommendedNext: recommendedNext.items,
		recommendedAgentLabs: recommendedAgentLabs.items,
		governanceConfig: governanceConfigData(),
		workerBoundary: workerBoundaryData(),
		contextBudget: mergeContextBudgetUsage("plan_snapshot", [
			objective.usage,
			summary.usage,
			approvedClaims.usage,
			operationalContracts.usage,
			workMilestones.usage,
			budgetedDriftFindings.usage,
			risks.usage,
			flows.usage,
			blockers.usage,
			recommendedNext.usage,
			recommendedAgentLabs.usage,
		]),
	};
}

function budgetTextField(
	value: string,
	profile: ContextBudgetProfile,
	path: string,
): { value: string; usage: ContextBudgetUsage } {
	const result = sliceTextToBudget({ text: value, profile, path });
	return { value: result.text, usage: result.usage };
}

function budgetStringArray(
	items: string[],
	profile: ContextBudgetProfile,
	path: string,
): { items: string[]; usage: ContextBudgetUsage } {
	return sliceListToBudget({ items, profile, path });
}

function budgetJsonArray(
	items: unknown[],
	profile: ContextBudgetProfile,
	path: string,
): { items: unknown[]; usage: ContextBudgetUsage } {
	const budget = CONTEXT_BUDGETS[profile];
	const selected = items.slice(0, budget.maxArrayItems);
	const usages: ContextBudgetUsage[] = [];
	const budgetedItems = selected.map((item, index) => {
		const serialized = JSON.stringify(item) ?? String(item);
		const result = sliceTextToBudget({
			text: serialized,
			profile,
			path: `${path}[${index}]`,
			maxChars: budget.maxArrayItemChars,
		});
		usages.push(result.usage);
		if (!result.usage.truncated) return item;
		return {
			contextBudgetTruncated: true,
			excerpt: result.text,
			originalType: Array.isArray(item) ? "array" : typeof item,
		};
	});
	if (items.length > budget.maxArrayItems) {
		usages.push(
			createContextBudgetUsage(profile, {
				truncated: true,
				omitted: [
					{
						path,
						reason: "max_items",
						omittedItems: items.length - budget.maxArrayItems,
					},
				],
			}),
		);
	}
	return {
		items: budgetedItems,
		usage: mergeContextBudgetUsage(profile, usages),
	};
}

function withSourceContentBudget<
	T extends { content: string; truncated?: boolean },
>(
	result: T,
	profile: ContextBudgetProfile,
	path: string,
): T & { contextBudgetUsage: ContextBudgetUsage } {
	const budget = CONTEXT_BUDGETS[profile];
	const sliced = sliceTextToBudget({
		text: result.content,
		profile,
		path,
		maxChars: budget.maxSourceChars || budget.maxTextFieldChars,
	});
	const upstreamUsage = result.truncated
		? createContextBudgetUsage(profile, {
				truncated: true,
				omitted: [{ path, reason: "max_chars" }],
			})
		: createContextBudgetUsage(profile);
	const contextBudgetUsage = mergeContextBudgetUsage(profile, [
		sliced.usage,
		upstreamUsage,
	]);
	return {
		...result,
		content: sliced.text,
		truncated: Boolean(result.truncated) || sliced.usage.truncated,
		contextBudgetUsage,
	};
}

function withSourceResearchBudget<
	T extends {
		searchedSourceIds?: string[];
		signals?: unknown[];
		limitations?: string[];
	},
>(result: T): T & { contextBudgetUsage: ContextBudgetUsage } {
	const searchedSourceIds = budgetStringArray(
		(result.searchedSourceIds ?? []).map(String),
		"source_research",
		"result.searchedSourceIds",
	);
	const limitations = budgetStringArray(
		(result.limitations ?? []).map(String),
		"source_research",
		"result.limitations",
	);
	const signals = budgetJsonArray(
		result.signals ?? [],
		"source_research",
		"result.signals",
	);
	return {
		...result,
		searchedSourceIds: searchedSourceIds.items,
		limitations: limitations.items,
		signals: signals.items,
		contextBudgetUsage: mergeContextBudgetUsage("source_research", [
			searchedSourceIds.usage,
			limitations.usage,
			signals.usage,
		]),
	};
}

function buildNextAdvisoryAction(
	snapshot: PlanSnapshot,
	request: string,
	mode: string,
	maxScope: string,
): JsonObject {
	const planApproved = snapshot.planStatus === "approved";
	const title = request.trim()
		? `Acción candidata: ${request.trim()}`
		: (firstMilestoneAction(snapshot) ??
			"Acción candidata desde Plan Maestro aprobado");
	const contractsAffected = inferContractsFromSnapshot(snapshot, request);
	const requiredReads = dedupe([
		"Plan Maestro vigente",
		"master-plan.flows.json",
		"Doc/<project>/04-contratos-aprobados.md",
		"Doc/<project>/01-contratos-operativos.generado.md",
		...contractsAffected.map((area) => `Contrato ${area}`),
	]);
	return {
		authority: "advisory",
		recommendation: planApproved ? "warn" : "ask_human",
		orchestratorDecisionRequired: true,
		implementationOwner: "orchestrator",
		iduRole: "advisor_auditor",
		agentLabsRole: "audit_only",
		mode,
		maxScope,
		candidateAction: {
			id: stableActionId(title),
			title,
			whyNow: planApproved
				? "El Plan Maestro está aprobado; corresponde avanzar en unidades pequeñas con governance-review preventivo."
				: "El Plan Maestro aún no está aprobado; no conviene implementar sin aprobación.",
			planRefs: ["master-plan.json", String(snapshot.flowArtifact)],
			contractsAffected,
			scope: [
				"Preparar lineamientos de trabajo desde Plan Maestro aprobado.",
				"Mantener implementación en subagentes normales del orquestador.",
			],
			nonGoals: [
				"No implementar desde Idu-pi MCP.",
				"No ejecutar AgentLabs automáticamente desde tools advisory.",
				"No hacer commit/push ni tocar repo real fuera del worker normal.",
			],
			requiredReads,
			acceptanceCriteria: [
				"La acción declara contratos, flujos y criterios de verificación antes de codificar.",
				"Un subagente governance-review del orquestador valida el paquete antes del worker.",
				"AgentLabs quedan como audit-only y se ejecutan sólo por llamada explícita del orquestador.",
			],
			suggestedTests: [
				"Test MCP lista herramientas advisory nuevas.",
				"Test snapshot no escribe ni ejecuta AgentLabs.",
				"Test task package incluye governance-review brief y stop conditions.",
			],
			stopConditions: [
				"Aparece una herramienta de implementación como idu_apply o idu_implement.",
				"La acción requiere cambiar datos/seguridad sin aprobación humana u orquestador.",
				"Un AgentLab intenta codificar, modificar repo real o hacer commit/push.",
			],
		},
		agentLabPolicy: {
			mode: contractsAffected.some((contract) => contract === "security")
				? "required_before_apply"
				: "required_after_diff",
			execution: "orchestrator_explicit_call_only",
			specialties: dedupe([
				...(contractsAffected.includes("security") ? ["security"] : []),
				"architecture",
				"code_quality",
			]),
			requiresHumanApproval: contractsAffected.includes("security"),
			reason:
				"MCP recomienda política; el orquestador decide si ejecuta AgentLabs audit-only antes o después del worker.",
		},
		orchestratorGuidance: [
			"Enviar este paquete a un subagente governance-review antes de implementar.",
			"Si governance-review pasa, delegar código a subagentes normales del orquestador.",
			"Usar idu_postflight con actionId/taskPackageId después del diff.",
		],
	};
}

function buildContinuationProposal(
	runtime: CliRuntime,
	snapshot: PlanSnapshot,
	request: string,
	autonomyWindowMinutes: number | undefined,
	maxScope: string,
): JsonObject {
	const tasks = continuationTasks(runtime);
	const blockingPendingTask = findBlockingPendingContinuationTask(tasks);
	const selected = selectContinuationCandidate(snapshot, tasks, request);
	const selectedText = selected?.text ?? "";
	const preflight = selectedText ? runtime.preflight(selectedText) : undefined;
	const advisoryAction = buildNextAdvisoryAction(
		snapshot,
		selectedText,
		"continuation",
		maxScope,
	);
	const candidate = advisoryAction.candidateAction as JsonObject;
	candidate.origin = selected?.origin ?? "none";
	if (selected?.task) {
		candidate.queueTaskId = selected.task.id;
		candidate.title = selected.task.text;
	}
	const blockers = arrayField(snapshot, "blockers").map(String);
	const planApproved = snapshot.planStatus === "approved";
	const guardStatus = selected?.task?.guardStatus ?? null;
	const guardRisk = selected?.task?.guardRisk ?? null;
	const preflightRisk = preflight?.risk ?? null;
	const riskRequiresHuman = isHighContinuationRisk(preflightRisk);
	const guardRequiresHuman =
		guardStatus === "needs_confirmation" ||
		guardStatus === "rejected" ||
		isHighContinuationRisk(guardRisk);
	const scopeAllowed = maxScope === "small" || maxScope === "medium";
	const withinObjective = Boolean(
		selected?.origin === "queue" && planApproved && blockers.length === 0,
	);
	const allowedToProceed = Boolean(
		selected &&
			withinObjective &&
			scopeAllowed &&
			!blockingPendingTask &&
			!riskRequiresHuman &&
			!guardRequiresHuman,
	);
	const decision = selected
		? allowedToProceed
			? "continue_autonomously"
			: "ask_user"
		: "stop_no_safe_action";
	const requiresHuman = decision !== "continue_autonomously";
	const queueProgress = continuationQueueProgress(
		tasks,
		selected?.task,
		blockingPendingTask,
	);
	const taskPackage = selected
		? buildTaskPackage(
				snapshot,
				advisoryAction,
				selectedText,
				selected.task?.id,
				false,
			)
		: null;
	if (taskPackage && requiresHuman) {
		blockContinuationTaskPackage(taskPackage, decision);
	}
	const evidenceRefs = dedupe([
		"plan:snapshot",
		...(selected?.task ? [`queue:${selected.task.id}`] : []),
		...(preflight ? [`preflight:${preflight.risk}`] : []),
	]);
	return {
		proposalVersion: 1,
		authority: "advisory",
		source: "idu_continuation_proposal",
		summary: selected
			? `Continuidad propuesta: ${String(candidate.title)}`
			: "No hay acción segura de continuidad.",
		autonomy: {
			requested: Boolean(autonomyWindowMinutes),
			windowMinutes: autonomyWindowMinutes ?? null,
			maxScope,
		},
		decision,
		allowedToProceed,
		requiresHuman,
		orchestratorDecisionRequired: true,
		planAlignment: {
			planStatus: snapshot.planStatus,
			objective: snapshot.objective,
			withinObjective,
			blockers: [
				...blockers,
				...(blockingPendingTask
					? [`Tarea pendiente requiere decisión: ${blockingPendingTask.id}`]
					: []),
				...(selected && selected.origin !== "queue"
					? ["Continuidad autónoma requiere tarea de cola aprobada/limpia."]
					: []),
			],
			contractsAffected: arrayField(candidate, "contractsAffected"),
			evidenceRefs,
		},
		queueProgress,
		candidateAction: candidate,
		taskPackage,
		agentLabPolicy: {
			...(advisoryAction.agentLabPolicy as JsonObject),
			autoRun: false,
			role: "audit_only",
		},
		decisionEnvelope: buildDecisionEnvelope({
			tool: "idu_continuation_proposal",
			recommendation: allowedToProceed ? "allow" : "ask_human",
			severity: allowedToProceed ? "info" : "needs_approval",
			confidence: allowedToProceed ? 0.78 : 0.72,
			summary: selected
				? `Continuidad: ${String(candidate.title)}`
				: "No hay acción segura de continuidad.",
			requiresHuman,
			orchestratorDecisionRequired: true,
			allowedToProceed,
			evidenceRefs,
			nextActions: allowedToProceed
				? [
						"Crear paquete de tarea y ejecutar governance-review antes del worker.",
						"Delegar implementación a subagentes normales dentro del alcance aprobado.",
					]
				: ["Pedir decisión humana antes de continuar."],
		}),
		stopConditions: [
			...arrayField(candidate, "stopConditions"),
			"La próxima acción queda fuera del Plan Maestro aprobado.",
			"El preflight sube a high/blocker o el guard queda needs_confirmation.",
		],
	};
}

function continuationTasks(runtime: CliRuntime): StructuredTask[] {
	const runtimeWithList = runtime as CliRuntime & {
		listTasks?: () => StructuredTask[];
	};
	return runtimeWithList.listTasks
		? runtimeWithList.listTasks()
		: parseTaskList(runtime.queueDetail());
}

function selectContinuationCandidate(
	snapshot: PlanSnapshot,
	tasks: StructuredTask[],
	request: string,
): { origin: string; text: string; task?: StructuredTask } | undefined {
	const pending = tasks
		.filter((task) => task.status === "pending")
		.sort((a, b) => b.priority - a.priority);
	const nextTask = pending[0];
	if (nextTask) return { origin: "queue", text: nextTask.text, task: nextTask };
	if (request.trim()) return { origin: "request", text: request.trim() };
	const milestone = firstMilestoneAction(snapshot);
	if (milestone) return { origin: "master_plan_milestone", text: milestone };
	const recommendedNext = arrayField(snapshot, "recommendedNext").find(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
	if (recommendedNext) {
		return { origin: "recommended_next", text: recommendedNext.trim() };
	}
	return undefined;
}

function continuationQueueProgress(
	tasks: StructuredTask[],
	selectedTask: StructuredTask | undefined,
	blockingPendingTask: StructuredTask | undefined,
): JsonObject {
	const count = (status: StructuredTask["status"]) =>
		tasks.filter((task) => task.status === status).length;
	return {
		pending: count("pending"),
		running: count("running"),
		done: count("done"),
		failed: count("failed"),
		selectedTaskId: selectedTask?.id ?? null,
		selectedTaskGuardStatus: selectedTask?.guardStatus ?? null,
		selectedTaskGuardRisk: selectedTask?.guardRisk ?? null,
		blockingPendingTaskId: blockingPendingTask?.id ?? null,
		blockingPendingTaskGuardStatus: blockingPendingTask?.guardStatus ?? null,
		blockingPendingTaskGuardRisk: blockingPendingTask?.guardRisk ?? null,
	};
}

function findBlockingPendingContinuationTask(
	tasks: StructuredTask[],
): StructuredTask | undefined {
	return tasks
		.filter((task) => task.status === "pending")
		.sort((a, b) => b.priority - a.priority)
		.find(
			(task) =>
				task.guardStatus === "needs_confirmation" ||
				task.guardStatus === "rejected" ||
				isHighContinuationRisk(task.guardRisk),
		);
}

function blockContinuationTaskPackage(
	taskPackage: JsonObject,
	decision: string,
): void {
	taskPackage.humanApprovalRequired = true;
	taskPackage.recommendation = "ask_human";
	const preconditions = asRecord(taskPackage.preconditions);
	preconditions.blocked = true;
	preconditions.recommendation = "ask_human";
	preconditions.blockers = dedupe([
		...arrayField(preconditions, "blockers").map(String),
		`Continuation decision requires human review: ${decision}`,
	]);
	taskPackage.preconditions = preconditions;
}

function isHighContinuationRisk(risk: unknown): boolean {
	return risk === "high" || risk === "blocker";
}

function buildTaskPackage(
	snapshot: PlanSnapshot,
	advisoryAction: JsonObject,
	request: string,
	actionId: string | undefined,
	includePlanSnapshot: boolean,
): JsonObject {
	const candidate = advisoryAction.candidateAction as JsonObject;
	const id = actionId ?? String(candidate.id ?? stableActionId(request));
	const planApproved = snapshot.planStatus === "approved";
	const blockers = arrayField(snapshot, "blockers").map(String);
	return {
		taskPackageVersion: 1,
		id,
		actionId: id,
		authority: "advisory",
		planStatus: snapshot.planStatus,
		preconditions: {
			planApproved,
			blocked: !planApproved || blockers.length > 0,
			blockers,
			recommendation: planApproved ? "governance_review" : "ask_human",
		},
		recommendation: planApproved ? "warn" : "ask_human",
		owner: "orchestrator",
		implementationOwner: "normal_subagents",
		iduRole: "advisor_auditor",
		agentLabsRole: "audit_only",
		orchestratorDecisionRequired: true,
		objective: snapshot.objective,
		request,
		scope: arrayField(candidate, "scope"),
		nonGoals: arrayField(candidate, "nonGoals"),
		filesToRead: arrayField(candidate, "requiredReads"),
		likelyFilesToChange: [],
		contracts: arrayField(candidate, "contractsAffected"),
		acceptanceCriteria: arrayField(candidate, "acceptanceCriteria"),
		verification: arrayField(candidate, "suggestedTests"),
		postflightRequired: true,
		humanApprovalRequired:
			!planApproved ||
			Boolean(
				(advisoryAction.agentLabPolicy as JsonObject | undefined)
					?.requiresHumanApproval,
			),
		governanceReview: {
			required: true,
			reviewerRole: "orchestrator_subagent",
			mustRead: [
				"master-plan.json",
				"master-plan.flows.json",
				"Doc/<project>/04-contratos-aprobados.md",
				"Doc/<project>/01-contratos-operativos.generado.md",
			],
			questions: [
				"¿La acción respeta el objetivo aprobado?",
				"¿Toca flujos permanentes?",
				"¿Hay contratos block/critical afectados?",
				"¿Hace falta AgentLab antes de implementar?",
				"¿La tarea está suficientemente chica?",
			],
			passCriteria: [
				"scope claro",
				"nonGoals claros",
				"contratos afectados identificados",
				"tests/verificación definidos",
				"sin violaciones críticas sin aprobación",
			],
		},
		agentLabPolicy: advisoryAction.agentLabPolicy,
		stopConditions: [
			...arrayField(candidate, "stopConditions"),
			"AgentLab requerido antes de aplicar sin decisión explícita del orquestador.",
		],
		...(includePlanSnapshot ? { planSnapshot: snapshot } : {}),
	};
}

function arrayField(source: JsonObject, key: string): unknown[] {
	const value = source[key];
	return Array.isArray(value) ? value : [];
}

function firstMilestoneAction(snapshot: PlanSnapshot): string | undefined {
	for (const milestone of arrayField(snapshot, "workMilestones")) {
		if (!isRecord(milestone)) continue;
		const actions = arrayField(milestone, "actions");
		const first = actions.find((action) => typeof action === "string");
		if (typeof first === "string" && first.trim()) return first.trim();
	}
	return undefined;
}

function inferContractsFromSnapshot(
	snapshot: PlanSnapshot,
	request: string,
): string[] {
	const text =
		`${request} ${JSON.stringify(snapshot.operationalContracts)}`.toLowerCase();
	return dedupe([
		...(text.match(/auth|login|session|token|secret|seguridad|security/u)
			? ["security"]
			: []),
		...(text.match(/db|database|datos|sqlite|json|schema|persist/u)
			? ["data"]
			: []),
		...(text.match(/ui|frontend|html|css|pantalla/u) ? ["frontend"] : []),
		...(text.match(/mcp|agent|orquestador|subagent|agentlab|governance/u)
			? ["agent"]
			: []),
		"agent",
	]);
}

function stableActionId(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-|-$/gu, "")
		.slice(0, 48);
	return `plan-action-${slug || "next"}`;
}

function envelope(input: {
	ok: boolean;
	tool: IduMcpToolName;
	projectId: string | null;
	projectPath: string | null;
	summary: string;
	data: JsonObject;
	safeNotes?: string[];
	errors?: string[];
}): IduMcpToolResult {
	return {
		ok: input.ok,
		tool: input.tool,
		projectId: input.projectId,
		projectPath: input.projectPath,
		summary: redactSecrets(input.summary),
		data: redactObject(input.data),
		safeNotes: dedupe([...SAFE_BASE_NOTES, ...(input.safeNotes ?? [])]),
		errors: (input.errors ?? []).map(redactSecrets),
	};
}

function tool(
	name: IduMcpToolName,
	description: string,
	properties: JsonObject,
): IduMcpToolDefinition {
	const required = Object.entries(properties)
		.filter(([, value]) => isRecord(value) && value.__required === true)
		.map(([key]) => key);
	const cleanProperties = Object.fromEntries(
		Object.entries(properties).map(([key, value]) => {
			if (!isRecord(value)) return [key, value];
			const { __required: _ignored, ...rest } = value;
			return [key, rest];
		}),
	);
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties: cleanProperties,
			additionalProperties: false,
			...(required.length ? { required } : {}),
		},
	};
}

function optionalString(description: string): JsonObject {
	return { type: "string", description };
}

function requiredString(description: string): JsonObject {
	return { ...optionalString(description), __required: true };
}

function optionalBoolean(description: string): JsonObject {
	return { type: "boolean", description };
}

function optionalStringArray(description: string): JsonObject {
	return { type: "array", items: { type: "string" }, description };
}

function optionalEnum(description: string, values: string[]): JsonObject {
	return { type: "string", enum: values, description };
}

function requiredEnum(description: string, values: string[]): JsonObject {
	return { type: "string", enum: values, description, __required: true };
}

function isToolName(name: string): name is IduMcpToolName {
	return TOOLS.some((toolDefinition) => toolDefinition.name === name);
}

function samePath(left: string, right: string): boolean {
	return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function invalidProject(
	path: string,
	errors: string[],
): IduMcpProjectResolution {
	return {
		status: "invalid_project",
		projectId: slugifyProjectId(path.split(/[\\/]/u).at(-1) ?? "project"),
		projectPath: path,
		recommendedNext:
			"Revisá DEFAULT_CWD/ALLOWED_ROOTS y el projectPath enviado.",
		safeNotes: ["No escribí el registry automáticamente."],
		errors,
	};
}

function jsonRpcResult(id: unknown, result: unknown): McpJsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
	id: unknown,
	code: number,
	message: string,
	data?: unknown,
): McpJsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function writeResponse(response: McpJsonRpcResponse): void {
	stdout.write(`${JSON.stringify(response)}\n`);
}

function asRecord(value: unknown): JsonObject {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArg(args: JsonObject, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanArg(args: JsonObject, key: string, fallback: boolean): boolean {
	const value = args[key];
	return typeof value === "boolean" ? value : fallback;
}

function stringListArg(args: JsonObject, key: string): string[] {
	const value = args[key];
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

function positiveIntegerArg(args: JsonObject, key: string): number | undefined {
	const value = args[key];
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isInteger(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

const AGENTLAB_SPECIALTIES = new Set<AgentLabSpecialty>([
	"security",
	"database",
	"architecture",
	"code_quality",
	"ui_ux",
	"performance",
	"skill_review",
	"project_understanding",
	"docs",
	"token_cost",
	"librarian",
	"general",
]);

function compactSourceLibraryEvidence(
	report: SourceRecommendationReport,
): AgentLabSourceLibraryEvidence {
	const bounded = boundSourceRecommendationForInjection(report);
	const matches = (arrayField(bounded, "matches") as JsonObject[]).map(
		(match) => {
			const confidence: "high" | "medium" | "low" =
				match.confidence === "high" ||
				match.confidence === "medium" ||
				match.confidence === "low"
					? match.confidence
					: "low";
			return {
				sourceId: String(match.sourceId ?? ""),
				title: String(match.title ?? ""),
				chunkIds: arrayField(match, "chunkIds").map(String),
				whyRelevant: String(match.whyRelevant ?? ""),
				confidence,
			};
		},
	);
	return {
		request: String(bounded.request ?? ""),
		generatedAt: report.generatedAt,
		matches,
		missingKnowledge: arrayField(bounded, "missingKnowledge").map(String),
		limitations: arrayField(bounded, "limitations").map(String),
		contractPromotionAllowed: false,
	};
}

function compactSourceSkillCandidateReview(review: unknown): JsonObject {
	if (!isRecord(review)) {
		return {
			ok: false,
			reportRef: "latest",
			errors: ["Invalid source skill candidate review"],
		};
	}
	const report = isRecord(review.report) ? review.report : undefined;
	const candidates = Array.isArray(report?.candidates)
		? report.candidates.filter(isRecord)
		: [];
	return {
		ok: review.ok === true,
		reportRef: "latest",
		candidateCount: candidates.length,
		candidateRefs: candidates.slice(0, 5).map((candidate) => ({
			candidateId: stringValue(candidate.candidateId),
			title: stringValue(candidate.title),
			suggestedSkillName: stringValue(candidate.suggestedSkillName),
			sourceIds: stringArrayValue(candidate.sourceIds).slice(0, 5),
			chunkIds: stringArrayValue(candidate.chunkIds).slice(0, 5),
			evidenceRefs: stringArrayValue(candidate.evidenceRefs).slice(0, 5),
		})),
		limitations: stringArrayValue(report?.limitations).slice(0, 5),
		requiredActions: stringArrayValue(report?.requiredActions).slice(0, 5),
		errors: stringArrayValue(review.errors).slice(0, 5),
		rawContentIncluded: false,
		contractPromotionAllowed: false,
		skillPromotionAllowed: false,
	};
}

function stringArrayValue(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function agentLabSpecialtiesArg(
	args: JsonObject,
	key: string,
): { values?: AgentLabSpecialty[]; errors: string[] } {
	const rawValues = stringListArg(args, key);
	if (rawValues.length === 0) return { errors: [] };
	const errors = rawValues
		.filter((value) => !AGENTLAB_SPECIALTIES.has(value as AgentLabSpecialty))
		.map((value) => `specialty inválida: ${value}`);
	if (errors.length > 0) return { errors };
	return { values: [...new Set(rawValues)] as AgentLabSpecialty[], errors: [] };
}

function requiredText(args: JsonObject, key: string): string {
	const value = stringArg(args, key);
	if (!value) throw new Error(`Missing required argument: ${key}`);
	return value;
}

function requiredOneOf(
	args: JsonObject,
	key: string,
	allowedValues: string[],
): string {
	const value = requiredText(args, key);
	if (!allowedValues.includes(value)) {
		throw new Error(
			`Invalid argument ${key}: expected one of ${allowedValues.join(", ")}`,
		);
	}
	return value;
}

function parseTaskList(text: string): StructuredTask[] {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (Array.isArray(parsed)) return parsed.filter(isStructuredTask);
	} catch {
		// formatted queue output has no stable machine shape; return empty fallback.
	}
	return [];
}

function isStructuredTask(value: unknown): value is StructuredTask {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.text === "string"
	);
}

function aggregateRunStatus(statuses: string[]): string {
	if (statuses.includes("security_violation")) return "security_violation";
	if (statuses.includes("timed_out")) return "timed_out";
	if (statuses.includes("failed")) return "failed";
	if (statuses.includes("partial")) return "partial";
	if (statuses.includes("completed")) return "completed";
	if (statuses.includes("skipped")) return "skipped";
	return "unknown";
}

function agentLabStatusWorkloadEnvelope(status: {
	valid: boolean;
	errors: string[];
	result?: {
		generatedAt: string;
		runs: Array<{
			requestId: string;
			status: string;
			requiresHumanApproval?: boolean;
		}>;
		workloadEnvelope?: AgentLabWorkloadEnvelope;
	};
	workloadEnvelope?: AgentLabWorkloadEnvelope;
}): AgentLabWorkloadEnvelope {
	if (status.workloadEnvelope) return status.workloadEnvelope;
	if (status.result?.workloadEnvelope) return status.result.workloadEnvelope;
	const stale =
		!status.valid &&
		status.errors.some((error) =>
			/stale|pendiente|request actual/iu.test(error),
		);
	return buildAgentLabWorkloadEnvelope({
		status: stale ? "stale" : "failed",
		statusReason:
			status.errors[0] ??
			(stale ? "AgentLab run stale." : "AgentLab status unavailable."),
		generatedAt: status.result?.generatedAt ?? "deterministic",
		source: "status",
		runs: status.result?.runs ?? [],
		requestIds: [],
	});
}

function dedupe(items: string[]): string[] {
	return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function redactSecrets(input: string): string {
	return input
		.replace(
			/(token|secret|password|api[_-]?key)(\s*[:=]\s*)[^\s,;}]+/giu,
			"$1$2[REDACTED]",
		)
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gu, "Bearer [REDACTED]");
}

function redactObject<T>(value: T): T {
	return JSON.parse(
		JSON.stringify(value, (_key, inner) => {
			if (typeof inner === "string") return redactSecrets(inner);
			return inner as unknown;
		}),
	) as T;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	runMcpServer();
}
