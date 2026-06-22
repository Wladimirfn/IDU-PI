#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { canonicalDirectory, isAllowedCwd, loadConfig } from "./config.js";
import { createCliRuntime, type CliRuntime } from "./cli.js";
import { runSensorImpulses } from "./sensor-impulses.js";
import { categorizeFindings } from "./supervisor-categorize.js";
import { readPendingBlockingInjection } from "./objective-injection.js";
import { recordLifecycleEvent } from "./telemetry-lifecycle.js";
import {
	formatBibliotecarioInit,
	runBibliotecarioInit,
} from "./cli-bibliotecario-init.js";
import {
	buildModelInvocationStatusOrError,
	formatModelInvocationStatus,
} from "./cli-model-invocation-status.js";
import { formatSkillRating, runSkillRating } from "./cli-skill-rating.js";
import {
	disableSupervisorTrigger,
	enableSupervisorTrigger,
	formatSupervisorTriggerResult,
	formatSupervisorTriggerStatus,
	getSupervisorTriggerStatus,
} from "./supervisor-trigger.js";
import {
	disableTriggerEngineConfig,
	enableTriggerEngineConfig,
	formatTriggerEngineConfigResult,
	formatTriggerEngineConfigStatus,
	getTriggerEngineConfigStatus,
} from "./trigger-engine-config.js";
import {
	DEFAULT_ROLE_ENGINE_CONFIG,
	disableRoleEngineConfig,
	enableRoleEngineConfig,
	formatRoleEngineConfigResult,
	getRoleEngineConfigStatus,
} from "./role-engine-config.js";
import type { IduModelRoleId } from "./model-assignments.js";
import type { SkillDraftFromLessonsMode } from "./skill-draft-from-lessons.js";
import { applyPackageEnvDefaults, resolveIduRegistryPath } from "./cli-home.js";
import { runIduBootstrap } from "./idu-bootstrap.js";
import {
	migrateHygieneLayout,
	type MigrationResult,
} from "./hygiene-migrate.js";
import { planSweep, type PlanSweepResult } from "./sweep-command.js";
import { runHygieneSensor } from "./hygiene-sensor.js";
import { ackAdvisory, type AckAdvisoryResult } from "./idu-ack-advisory.js";
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
import {
	handleBirthStatus,
	handleBirthExistingScan,
	handleBirthBibliotecarioDiscovery,
	handleBirthValidate,
	handleBirthRepoPlan,
	type BirthRepoPlan,
} from "./birth-runtime.js";
import { approveBirthGeneralSpec } from "./birth-general-spec-runtime.js";
import { runVisualDerivation } from "./birth-general-spec-derive.js";
import {
	runGenesisMissionConfirm,
	runGenesisMissionDraft,
} from "./genesis-mission-tools.js";
import {
	loadSkillsForTask,
	loadSkillsIndexFromLabDb,
} from "./skills-index-runtime.js";
import { packSkillsIndex } from "./skills-index.js";
import { readTaxonomyGuide } from "./taxonomy-placement.js";
import { handleBirthPrototypeMaster } from "./birth-prototype-runtime.js";
import {
	readPendingInjections,
	markInjectionAcked,
} from "./injection-store.js";
import { applyPrune, planPrune } from "./idu-outbox-prune.js";
import { listDecisions } from "./decision-ledger.js";
import { emitOrchestratorTurn } from "./role-events.js";
import { TRIGGER_DEFINITIONS } from "./trigger-engine.js";
import { readBirthArtifact } from "./birth-artifacts.js";
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

// PR 1 (Item 4): shared types and helpers (envelope, tool, arg parsers,
// SAFE_BASE_NOTES, redact*, dedupe, isRecord) moved to src/mcp/_shared/.
// They are the universal contract every tool handler will import.
// NEVER re-define here — that would break the contract. mcp-server.ts
// re-exports them so existing imports (mcp-server.js → IduMcpToolName,
// JsonObject, etc.) keep working without changes.
import {
	handleBootstrapProject,
	handleProjectEnroll,
	handleProjectStatus,
	handleStart,
} from "./mcp/lifecycle/index.js";
import {
	handleActivate,
	handleDeactivate,
	handleProjectResetState,
	handleStatus,
} from "./mcp/session/index.js";
import {
	handleSupervisorSelfMaintenanceAdvisory,
	handleSupervisorTrigger,
	handleTriggerEngine,
} from "./mcp/supervisor-trigger/index.js";
import {
	handleRoleEngineControl,
	handleRoleEngineStatus,
} from "./mcp/role/index.js";
import {
	handleOrchestratorProcedure,
	handleSupervisorContextPack,
	handleTaskContext,
} from "./mcp/supervisor-context/index.js";
import {
	handleAdvisory,
	handlePostflight,
	handlePreflight,
} from "./mcp/preflight/index.js";
import {
	handleExternalIntelligenceReport,
	handleExternalSourceRecommend,
} from "./mcp/external/index.js";
import {
	handleQueueComplete,
	handleQueueDetail,
	handleTask,
} from "./mcp/task-queue/index.js";
import { handleSemanticAuditStatus } from "./mcp/semantic/index.js";
import {
	handleAgentLabRequestCreate,
	handleAgentLabReviewRun,
	handleAgentLabReviewStatus,
} from "./mcp/agentlab/index.js";
import {
	SAFE_BASE_NOTES,
	asRecord,
	booleanArg,
	dedupe,
	envelope,
	isRecord,
	optionalBoolean,
	optionalEnum,
	optionalObject,
	optionalString,
	optionalStringArray,
	parseGeneralSpecSectionsArg,
	positiveIntegerArg,
	redactObject,
	redactSecrets,
	requiredEnum,
	requiredJsonStringArray,
	requiredOneOf,
	requiredString,
	requiredText,
	stringArg,
	stringListArg,
	tool,
} from "./mcp/_shared/index.js";
import type {
	IduMcpToolDefinition,
	IduMcpToolName,
	IduMcpToolResult,
	JsonObject,
} from "./mcp/_shared/index.js";

export {
	SAFE_BASE_NOTES,
	asRecord,
	booleanArg,
	dedupe,
	envelope,
	isRecord,
	optionalBoolean,
	optionalEnum,
	optionalObject,
	optionalString,
	optionalStringArray,
	parseGeneralSpecSectionsArg,
	positiveIntegerArg,
	redactObject,
	redactSecrets,
	requiredEnum,
	requiredJsonStringArray,
	requiredOneOf,
	requiredString,
	requiredText,
	stringArg,
	stringListArg,
	tool,
} from "./mcp/_shared/index.js";
export type {
	IduMcpToolDefinition,
	IduMcpToolName,
	IduMcpToolResult,
	JsonObject,
} from "./mcp/_shared/index.js";

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
	tool(
		"idu_objective_status",
		"Lee el estado actual del PISO gate (objective reminder): blocking injection + reminderStatePath. Read-only mirror del CLI `idu-objective-status`.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool("idu_prepare", "Ejecuta prepare seguro sin IA ni AgentLabs.", {
		projectPath: optionalString("Ruta opcional del proyecto objetivo."),
	}),
	tool(
		"idu_bibliotecario_init",
		"Inicializa lab.db y la skill bootstrap del Bibliotecario para el proyecto activo.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_model_invocation_status",
		"Muestra el estado de invocaciones de modelos usando el lab.db resuelto del proyecto activo.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			role: optionalString("Rol opcional para filtrar invocaciones."),
			limit: {
				type: "number",
				description: "Límite opcional de filas por rol.",
			},
		},
	),
	tool(
		"idu_skill_rating",
		"Registra un score para una propuesta de skill del Bibliotecario.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			proposalId: requiredString("ID de propuesta a calificar."),
			score: {
				type: "number",
				description: "Score entero 0..10.",
				__required: true,
			},
		},
	),
	tool(
		"idu_supervisor_trigger",
		"Activa, desactiva o consulta el opt-in del supervisor trigger programado.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			action: requiredEnum("Acción: enable, disable o status.", [
				"enable",
				"disable",
				"status",
			]),
		},
	),
	tool(
		"idu_trigger_engine",
		"Activa, desactiva o consulta el opt-in persistente del trigger engine.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			action: requiredEnum("Acción: enable, disable o status.", [
				"enable",
				"disable",
				"status",
			]),
		},
	),
	tool(
		"idu_role_engine_control",
		"Activa o desactiva el RoleEngine global o una role específica. Advisory-only: no invoca modelos por sí mismo.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			action: requiredEnum("Acción: enable o disable.", ["enable", "disable"]),
			role: optionalString("Role opcional para cambiar sólo su flag."),
		},
	),
	tool(
		"idu_role_engine_status",
		"Consulta configuración y estado del RoleEngine sin invocar modelos.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			role: optionalString("Role opcional para inspección enfocada."),
		},
	),
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
		"idu_supervisor_consult",
		"Consulta un rol del role engine con un question concreto; devuelve respuesta real del modelo, respeta cooldowns y token budgets (rails).",
		{
			question: requiredString("Pregunta concreta para el rol."),
			role: optionalString(
				"Rol del role engine (default: supervisor-main). El rol debe estar habilitado en role-engine.json.",
			),
			context: optionalString("Contexto adicional para la pregunta."),
		},
	),
	tool(
		"idu_execution_director_tick",
		"Ejecuta un tick manual advisory-only del execution director y persiste propuestas flow-bound en stateRoot; no implementa ni ejecuta AgentLabs.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_proposal_outbox",
		"Lista propuestas flow-bound guardadas en stateRoot; sólo lectura, no toca el repo real.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_proposal_detail",
		"Lee detalle de una propuesta flow-bound desde stateRoot.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			id: requiredString("ID de propuesta."),
		},
	),
	tool(
		"idu_birth_status",
		"Lee el estado del Birth Pipeline desde stateRoot; readiness calculado a partir de contratos existentes (Project Core, Master Plan, Constitution, Bibliotecario, Prototype, General Spec).",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_birth_existing_scan",
		"Ejecuta un scan read-only del proyecto existente y persiste birth/existing-scan.json + birth/detected-specs.json en stateRoot. No marca Project Core ni Master Plan como aprobados.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_birth_bibliotecario_discovery",
		"Evalúa la postura Bibliotecario con base en fuentes locales detectadas y categorías externas pedidas. Ideas siempre idea_only.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_birth_validate",
		"Corre scan + Bibliotecario + readiness en una sola pasada y devuelve el envelope agregado.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_birth_repo_plan",
		"Evalúa un plan de repo y otorga repoWritesAllowed solo si Project Core está confirmado, Master Plan aprobado y pushApproved=true. No ejecuta git.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			repoPlan: optionalObject(
				"Plan de repo con repoName, visibility, owner, license, initialReadmePolicy, remoteProvider, pushApproved, branchPolicy, ciExpectation.",
			),
		},
	),
	tool(
		"idu_birth_prototype_master",
		"Crea, revisa o aprueba el Master Prototype / Pilot House. Persiste sólo en stateRoot/birth/prototype-master.json.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			action: optionalString(
				"Acción: 'draft' | 'review' | 'approve'. Default 'review'.",
			),
			draft: optionalObject(
				"Payload del prototype (sólo para action='draft').",
			),
			approvedBy: optionalString(
				"Identificador del aprobador humano (sólo para action='approve').",
			),
		},
	),
	tool(
		"idu_birth_general_spec",
		"Aprueba explícitamente la General Spec provista por el owner y persiste stateRoot/birth/general-spec.json. No deriva contenido ni usa IA.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			sections: optionalObject(
				"General Spec sections: navigation, baseComponents, pageStructureRules, dataRules, interactionRules, motionRules, accessibilityCriteria, performanceCriteria.",
			),
			approvedBy: optionalString("Identificador del aprobador humano."),
		},
	),
	tool(
		"idu_birth_general_spec_derive",
		"Ejecuta derivación visual owner-invoked para General Spec usando agentlab-ui-ux. No se dispara automáticamente desde approveBirthGeneralSpec.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			uiFiles: optionalStringArray(
				"Archivos UI permitidos para evidencia file:line del patch visual.",
			),
		},
	),
	tool(
		"idu_genesis_mission_draft",
		"Genera un mission draft no confirmado para el proyecto target; persiste mission-draft y devuelve el draft estructurado.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
		},
	),
	tool(
		"idu_genesis_mission_confirm",
		"Persiste un BlueprintArtifact confirmado a partir de un mission-draft existente; requiere owner explícito.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			owner: optionalString("Owner explícito que confirma la misión."),
		},
	),
	tool(
		"idu_skill_for_task",
		"Recomienda skills del índice local del proyecto para una tarea. Read-only.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			request: requiredString("Tarea o intención para rankear skills."),
		},
	),
	tool(
		"idu_pending_injections",
		"Lee inyecciones pendientes del stateRoot. Opcionalmente las marca como acked.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			ack: optionalBoolean(
				"Si true (default), marca las inyecciones devueltas como acked.",
			),
		},
	),
	tool(
		"idu_hygiene_migrate",
		"Migración one-time desde <repo>/config/ y <repo>/.agents/skills/ legacy a <repo>/.idu/. Idempotente. Sin repoRoot usa el proyecto activo.",
		{
			projectPath: optionalString(
				"Ruta opcional del repo a migrar; por defecto el proyecto activo.",
			),
		},
	),
	tool(
		"idu_hygiene_sweep",
		"Re-ejecuta el sensor de higiene y propone `rm <path>` por archivo exacto. ADVISORY ONLY — idu-pi NO borra; el orquestador corre los comandos. Paths dentro de <stateRoot>/**, <repo>/.git/**, <repo>/.idu/**, <repo>/node_modules/** son SKIP. Modo `auto` es interno y rechazado.",
		{
			projectPath: optionalString("Ruta opcional del proyecto a escanear."),
		},
	),
	tool(
		"idu_ack_advisory",
		"Descarta explícitamente un advisory pendiente (escape hatch). Marca el injection como acked y emite el evento de lifecycle `dismissed`. Usar solo para dismissal deliberado; la decisión queda en el audit log.",
		{
			injectionId: optionalString("ID del injection a descartar."),
			reason: optionalString(
				"Razón opcional del dismissal (aparece en el audit log).",
			),
		},
	),
	tool(
		"idu_outbox_prune",
		"Archiva propuestas e inyecciones más viejas que N días. Sin confirm=true es dry-run. StateRoot-only writes.",
		{
			projectPath: optionalString("Ruta opcional del proyecto objetivo."),
			olderThanDays: optionalEnum("Días de antiguedad; default 30.", [
				"7",
				"14",
				"30",
				"60",
				"90",
			]),
			confirm: optionalBoolean("Si true, aplica el archive; si no, dry-run."),
		},
	),
	tool(
		"idu_subscribe_triggers",
		"Describe los disparadores disponibles y su contrato. Read-only.",
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
		// PR-B Finding C: the workspace root is the canonical parent for
		// project stateRoots. When a project does not have an explicit
		// stateRoot registered, we derive the canonical one from this.
		const workspaceRootForProject = config.agentWorkspaceRoot;
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
				// PR-B Finding C: always set stateRoot. If the project
				// registry has a stateRoot, use it; otherwise derive the
				// canonical path (workspaceRoot/projects/<id>). This
				// removes the `?? runtime.workspaceRoot` ambiguity in
				// envelope() callers — read and write paths use the same
				// canonical path.
				stateRoot: registered.stateRoot
					? registered.stateRoot
					: join(workspaceRootForProject, "projects", registered.id),
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
				stateRoot: activeProject.stateRoot
					? activeProject.stateRoot
					: join(workspaceRootForProject, "projects", activeProject.id),
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
	// Emit orchestrator_turn event so supervisor-main and
	// supervisor-semantic (which are subscribed to this kind) receive
	// a stimulus at the start of every tool call. Best-effort: a
	// failure to append the event must not block the tool.
	try {
		const ctx = resolveMcpProjectContext(
			(options as { projectPath?: string }).projectPath,
		);
		if (ctx.projectId && ctx.stateRoot) {
			emitOrchestratorTurn({
				stateRoot: ctx.stateRoot,
				projectId: ctx.projectId,
				toolName: name,
				source: "mcp-server",
				now: new Date(),
			});
		}
	} catch {
		// best-effort; do not block the tool
	}
	if (!isToolName(name)) {
		return envelope({
			stateRoot: "",

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
			stateRoot: resolution.stateRoot,

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
		if (
			!isReadOnlyAlertTelemetryExcludedTool(name) &&
			runtime.projectId.trim()
		) {
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
			stateRoot: "",

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

// Restore the PISO gate's stateRoot to the value from the enclosing scope.
// Called at the end of every handleMcpRequest.

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

export type IduProjectLifecycleToolName =
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
			case "idu_project_status":
				return await handleProjectStatus(
					name,
					args,
					options,
					config,
					registryPath,
				);
			case "idu_project_enroll":
				return await handleProjectEnroll(
					name,
					args,
					options,
					config,
					registryPath,
				);
			case "idu_bootstrap_project":
				return await handleBootstrapProject(
					name,
					args,
					options,
					config,
					registryPath,
				);
			case "idu_start":
				return await handleStart(name, args, options);
		}
	} catch (error) {
		return envelope({
			stateRoot: "",

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

export function governanceConfigData(): JsonObject {
	const config = loadConfig({ requireTelegram: false });
	return {
		...config.iduGovernance,
		principle:
			"Idu-pi MCP informa, audita y recomienda; el orquestador decide, ejecuta y comunica.",
	};
}

export function workerBoundaryData(): JsonObject {
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

export function buildOrchestratorProcedure(
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

export function buildRuntimeSelfMaintenanceReport(
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
			usageFailures: usageReport.unresolvedFailures,
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
		case "idu_status":
			return await handleStatus(name, args, runtime, resolution);
		case "idu_activate":
			return await handleActivate(name, args, runtime, resolution);
		case "idu_deactivate":
			return await handleDeactivate(name, args, runtime, resolution);
		case "idu_project_reset_state":
			return await handleProjectResetState(
				name,
				args,
				runtime,
				resolution,
			);
		case "idu_prepare": {
			const result = runtime.prepare();
			return envelope({
				stateRoot: "",

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
		case "idu_bibliotecario_init": {
			const projectId = activeMcpProjectId(runtime, resolution);
			if (!projectId)
				return invalidMcpInput(
					name,
					runtime,
					resolution,
					"project id must be non-empty",
				);
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const init = runBibliotecarioInit({ stateRoot, projectId });
			if (!init.ok) {
				return invalidMcpInput(name, runtime, resolution, init.error, {
					stateRoot,
				});
			}
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId,
				projectPath: runtime.projectPath,
				summary: `Bibliotecario inicializado para ${projectId}.`,
				data: {
					activeProjectId: projectId,
					init,
					output: formatBibliotecarioInit(init),
				},
				safeNotes: resolution.safeNotes,
			});
		}
		case "idu_model_invocation_status": {
			const projectId = activeMcpProjectId(runtime, resolution);
			if (!projectId)
				return invalidMcpInput(
					name,
					runtime,
					resolution,
					"project id must be non-empty",
				);
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const labDbPath = runtime.labDbPath ?? join(stateRoot, "lab.db");
			const limit = positiveIntegerArg(args, "limit");
			if (args.limit !== undefined && limit === undefined) {
				return invalidMcpInput(
					name,
					runtime,
					resolution,
					"limit must be a positive integer",
				);
			}
			const result = buildModelInvocationStatusOrError({
				projectId,
				stateRoot,
				labDbPath,
				options: {
					...(stringArg(args, "role") ? { role: stringArg(args, "role") } : {}),
					...(limit !== undefined ? { limit } : {}),
				},
			});
			if (!result.ok)
				return invalidMcpInput(name, runtime, resolution, result.error, {
					labDbPath,
				});
			const formatter =
				runtime.formatModelInvocationStatus ?? formatModelInvocationStatus;
			const output = `lab.db path: ${labDbPath}\n${formatter(result.report)}`;
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId,
				projectPath: runtime.projectPath,
				summary: "Estado de invocaciones de modelos generado.",
				data: {
					labDbPath,
					output,
					report: result.report as unknown as JsonObject,
				},
				safeNotes: resolution.safeNotes,
			});
		}
		case "idu_skill_rating": {
			const projectId = activeMcpProjectId(runtime, resolution);
			if (!projectId)
				return invalidMcpInput(
					name,
					runtime,
					resolution,
					"project id must be non-empty",
				);
			const proposalId = stringArg(args, "proposalId");
			if (!proposalId)
				return invalidMcpInput(
					name,
					runtime,
					resolution,
					"proposalId must be non-empty",
				);
			const score = scoreArg(args, "score");
			if (!score.ok)
				return invalidMcpInput(name, runtime, resolution, score.error);
			const result = runSkillRating([proposalId, score.text], {
				stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,
			});
			if (!result.ok) {
				return invalidMcpInput(name, runtime, resolution, result.error, {
					proposalId,
					score: score.value,
					exitCode: result.exitCode,
				});
			}
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId,
				projectPath: runtime.projectPath,
				summary: `Skill rating registrado: ${proposalId}=${result.score}.`,
				data: {
					proposalId: result.proposalId,
					score: result.score,
					recommendation: result.recommendation,
					output: formatSkillRating(result),
				},
				safeNotes: resolution.safeNotes,
			});
		}
		case "idu_supervisor_trigger":
			return await handleSupervisorTrigger(name, args, runtime, resolution);
		case "idu_trigger_engine":
			return await handleTriggerEngine(name, args, runtime, resolution);
		case "idu_role_engine_control":
			return await handleRoleEngineControl(name, args, runtime, resolution);
		case "idu_role_engine_status":
			return await handleRoleEngineStatus(name, args, runtime, resolution);
		case "idu_master_plan_status": {
			if (!runtime.masterPlanStatus) {
				return envelope({
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
		case "idu_supervisor_context_pack":
			return await handleSupervisorContextPack(name, args, runtime, resolution);
		case "idu_orchestrator_procedure":
			return await handleOrchestratorProcedure(name, args, runtime, resolution);
		case "idu_task_context":
			return await handleTaskContext(name, args, runtime, resolution);
		case "idu_preflight":
			return await handlePreflight(name, args, runtime, resolution);
		case "idu_advisory":
			return await handleAdvisory(name, args, runtime, resolution);
		case "idu_postflight":
			return await handlePostflight(name, args, runtime, resolution);
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
				stateRoot: "",

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
		case "idu_execution_director_tick": {
			if (!runtime.executionDirectorTick) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Execution director no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Execution director no disponible en este runtime."],
				});
			}
			const result = runtime.executionDirectorTick();
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: result.status === "proposal_created" ? "warn" : "allow",
				severity:
					result.status === "blocked_missing_lifecycle_binding"
						? "warning"
						: "info",
				confidence: 0.78,
				summary: `Execution director tick: ${result.status}`,
				requiresHuman: result.savedProposals.length > 0,
				orchestratorDecisionRequired: result.savedProposals.length > 0,
				allowedToProceed: result.status !== "blocked_missing_lifecycle_binding",
				evidenceRefs: result.evidenceRefs,
				nextActions: result.savedProposals.length
					? ["Review proposal outbox; Idu-pi does not implement proposals."]
					: ["No proposal action required from this tick."],
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Execution director tick: ${result.status}; saved=${result.savedProposals.length}`,
				data: {
					decisionEnvelope,
					status: result.status,
					authority: result.authority,
					generatedAt: result.generatedAt,
					proposals: result.proposals,
					savedProposals: result.savedProposals,
					blockingReasons: result.blockingReasons,
					evidenceRefs: result.evidenceRefs,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					result,
				},
				safeNotes: [
					...resolution.safeNotes,
					...result.safeNotes,
					"Tick only persists proposal JSONL under stateRoot; it does not implement code.",
					"No AgentLabs were executed or scheduled automatically.",
				],
			});
		}
		case "idu_proposal_outbox": {
			if (!runtime.proposalOutbox) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Proposal outbox no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Proposal outbox no disponible en este runtime."],
				});
			}
			const proposals = runtime.proposalOutbox();
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Proposal outbox: ${proposals.length}`,
				data: { proposals },
				safeNotes: [
					...resolution.safeNotes,
					"Read proposal outbox from stateRoot only; no repo files were touched.",
					"Proposals are advisory and require orchestrator/human decision before work.",
				],
			});
		}
		case "idu_proposal_detail": {
			if (!runtime.proposalDetail) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Proposal outbox no disponible en este runtime.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["Proposal outbox no disponible en este runtime."],
				});
			}
			const id = requiredText(args, "id");
			const proposal = runtime.proposalDetail(id);
			return envelope({
				stateRoot: "",

				ok: Boolean(proposal),
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: proposal
					? `Proposal detail: ${id}`
					: `Proposal not found: ${id}`,
				data: { id, proposal: proposal ?? null },
				safeNotes: [
					...resolution.safeNotes,
					"Read proposal detail from stateRoot only; no repo files were touched.",
					"Proposal detail is advisory; Idu-pi does not implement it.",
				],
				errors: proposal ? [] : [`Proposal not found: ${id}`],
			});
		}
		case "idu_objective_status": {
			// PR-B: read-only MCP mirror of `idu-objective-status` CLI.
			// Surfaces the current PISO gate state for the orchestrator.
			const blocking = readPendingBlockingInjection(resolution.stateRoot ?? "");
			const reminderPath = join(
				resolution.stateRoot ?? "",
				"objective-reminder.json",
			);
			const reminderExists = existsSync(reminderPath);
			return envelope({
				ok: true,
				tool: name,
				projectId: resolution.projectId,
				projectPath: resolution.projectPath,
				summary: blocking
					? `objective reminder active: ${blocking.severity} ${blocking.kind} (acked=${blocking.acked}, ageMs=${blocking.ageMs})`
					: "objective reminder: no blocking injection",
				stateRoot: resolution.stateRoot,
				data: {
					blocking,
					reminderStatePath: reminderPath,
					reminderStateExists: reminderExists,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Read-only: no side effects, no enqueue.",
				],
			});
		}
		case "idu_supervisor_consult": {
			const question = requiredText(args, "question");
			const roleRaw = stringArg(args, "role") ?? "supervisor-main";
			const context = stringArg(args, "context") ?? "";
			const result = await runtime.supervisorConsult({
				role: roleRaw as never,
				question,
				context,
			});
			const decisionEnvelope = buildDecisionEnvelope({
				tool: name,
				recommendation: result.ok ? "warn" : "ask_human",
				severity: result.ok ? "info" : "warning",
				confidence: 0.7,
				summary: result.ok
					? `Supervisor consulted: ${result.role}`
					: `Consult failed: ${result.reason ?? "unknown"}`,
				requiresHuman: !result.ok,
				orchestratorDecisionRequired: true,
				allowedToProceed: result.ok,
				evidenceRefs: [
					`role:${result.role}`,
					`model:${result.model || "none"}`,
					`rail:wakeCount=${result.rail.wakeCount}`,
				],
				nextActions: result.ok
					? ["Read response and decide"]
					: ["Resolve blocker and retry consult"],
			});
			return envelope({
				stateRoot: "",

				ok: result.ok,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: result.ok
					? `Supervisor ${result.role} responded (${result.response.length} chars)`
					: `Consult blocked: ${result.reason ?? "unknown"}`,
				data: {
					decisionEnvelope,
					consult: {
						role: result.role,
						question,
						context,
						response: result.response,
						model: result.model,
						provider: result.provider,
						promptChars: result.promptChars,
						elapsedMs: result.elapsedMs,
						rail: {
							tokenBudget: result.rail.tokenBudget,
							successStreak: result.rail.successStreak,
							failureStreak: result.rail.failureStreak,
							wakeCount: result.rail.wakeCount,
							cooldownMs: result.rail.cooldownMs,
							cooldownRemainingMs: result.rail.cooldownRemainingMs,
						},
						reason: result.reason,
					},
				},
				safeNotes: [
					...resolution.safeNotes,
					"Consult invokes a real model via promptForRole.",
					"Role must be enabled in role-engine.json; consult respects rail cooldowns and token budgets.",
					"No commit/push, no Telegram, no AgentLab auto-run.",
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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
		case "idu_supervisor_self_maintenance_advisory":
			return await handleSupervisorSelfMaintenanceAdvisory(
				name,
				args,
				runtime,
				resolution,
			);
		case "idu_birth_status": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const env = handleBirthStatus({
				projectId: runtime.projectId,
				stateRoot,
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_state=${env.state} allowed=${env.allowedToImplement} repo=${env.repoWritesAllowed}`,
				data: { birth: env },
				safeNotes: [
					...resolution.safeNotes,
					"Birth status is advisory; readiness is derived from existing Idu-pi contracts.",
					"repoWritesAllowed remains false until Project Core + Master Plan are confirmed/approved AND a human push approval is recorded.",
				],
			});
		}
		case "idu_birth_existing_scan": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			if (!runtime.projectPath) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Existing project scan requires an active project path.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["active project path is missing"],
				});
			}
			const env = handleBirthExistingScan({
				projectId: runtime.projectId,
				stateRoot,
				projectPath: runtime.projectPath,
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_scan=${env.scan.scanId} pkg=${env.scan.observed.packageManager}`,
				data: { birth: env },
				safeNotes: [
					...resolution.safeNotes,
					"Scan is read-only; artifacts written only under stateRoot/birth/.",
					"Detected specs stay in status=draft until human approval.",
				],
			});
		}
		case "idu_birth_bibliotecario_discovery": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const scan = readBirthArtifact<{ observed?: { docs?: string[] } }>(
				stateRoot,
				"existing-scan",
			);
			const localRefs = (scan?.observed?.docs ?? [])
				.slice(0, 5)
				.map((p) => ({ path: p, quality: "secondary" as const }));
			const env = handleBirthBibliotecarioDiscovery({
				projectId: runtime.projectId,
				stateRoot,
				localSourceRefs: localRefs,
				requestedExternalCategories: [],
				externalPermission: "not_requested",
				masterPlanSummary: "",
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_bibliotecario_status=${env.discovery.status} ideas=${env.discovery.ideas.length}`,
				data: { birth: env },
				safeNotes: [
					...resolution.safeNotes,
					"Bibliotecario ideas are idea_only; no automatic decision or contract is created.",
					"External fetch requires explicit human permission.",
				],
			});
		}
		case "idu_birth_prototype_master": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as {
				action?: "draft" | "review" | "approve";
				draft?: Parameters<typeof handleBirthPrototypeMaster>[0]["draft"];
				approvedBy?: string;
			};
			const action = params.action ?? "review";
			const env = handleBirthPrototypeMaster({
				action,
				projectId: runtime.projectId,
				stateRoot,
				...(params.draft ? { draft: params.draft } : {}),
				...(params.approvedBy ? { approvedBy: params.approvedBy } : {}),
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_prototype_status=${env.prototype.status}`,
				data: { birth: env },
				safeNotes: [
					...resolution.safeNotes,
					"Master Prototype is approved only by explicit human action.",
					"Only stateRoot/birth/prototype-master.json is written.",
				],
			});
		}
		case "idu_birth_general_spec": {
			if (resolution.status !== "registered_project" || !resolution.stateRoot) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"General Spec approval requires an active project stateRoot.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["active project stateRoot is missing"],
				});
			}
			const params = args as JsonObject;
			const sections = parseGeneralSpecSectionsArg(params.sections);
			const birth = await approveBirthGeneralSpec({
				projectId: runtime.projectId,
				stateRoot: resolution.stateRoot,
				sections,
				approvedBy: stringArg(params, "approvedBy") ?? "owner",
			});
			const readiness = handleBirthStatus({
				projectId: runtime.projectId,
				stateRoot: resolution.stateRoot,
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_general_spec_status=${birth.generalSpec.status}`,
				data: { birth, readiness },
				safeNotes: [
					...resolution.safeNotes,
					"General Spec approval is explicit owner input; no derivation, model call, or Telegram surface was used.",
					"Only stateRoot/birth/general-spec.json is written.",
				],
			});
		}
		case "idu_birth_general_spec_derive": {
			if (resolution.status !== "registered_project" || !resolution.stateRoot) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"General Spec derivation requires an active project stateRoot.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["active project stateRoot is missing"],
				});
			}
			const params = args as JsonObject;
			const promptForRole = runtime.promptForRole;
			const result = await runVisualDerivation({
				stateRoot: resolution.stateRoot,
				uiFiles: stringListArg(params, "uiFiles"),
				promptForRole:
					promptForRole ?? (async () => ({ ok: false, output: "" })),
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_general_spec_derive applied=${result.appliedCount}`,
				data: { derivation: result },
				safeNotes: [
					...resolution.safeNotes,
					"General Spec visual derivation is owner-invoked only; approveBirthGeneralSpec does not auto-trigger it.",
					"Only stateRoot/birth/general-spec.json is written.",
				],
			});
		}
		case "idu_genesis_mission_draft": {
			if (resolution.status !== "registered_project" || !resolution.stateRoot) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"Genesis mission draft requires an enrolled project stateRoot.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["enrolled project stateRoot is missing"],
				});
			}
			const result = runGenesisMissionDraft({
				stateRoot: resolution.stateRoot,
				projectPath: runtime.projectPath,
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `mission-draft persisted for ${result.missionDraft.projectId}`,
				data: { missionDraft: result.missionDraft },
				safeNotes: [
					...resolution.safeNotes,
					"Mission draft is unconfirmed until idu_genesis_mission_confirm runs.",
					"Only stateRoot/birth/mission-draft.json is written.",
				],
			});
		}
		case "idu_genesis_mission_confirm": {
			if (resolution.status !== "registered_project" || !resolution.stateRoot) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"Genesis mission confirm requires an enrolled project stateRoot.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["enrolled project stateRoot is missing"],
				});
			}
			const owner = stringArg(args, "owner");
			if (!owner) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"Genesis mission confirm requires an explicit owner argument.",
					data: {},
					safeNotes: [
						...resolution.safeNotes,
						"No stateRoot file was written.",
					],
					errors: ["owner is required"],
				});
			}
			const result = runGenesisMissionConfirm({
				stateRoot: resolution.stateRoot,
				projectPath: runtime.projectPath,
				owner,
			});
			if (!result.ok) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: result.error ?? "Mission confirm failed.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: [result.error ?? "mission confirm failed"],
				});
			}
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `blueprint confirmed by ${result.blueprint.confirmedBy}`,
				data: { blueprint: result.blueprint },
				safeNotes: [
					...resolution.safeNotes,
					"Owner-invoked only; no auto-trigger from idu_genesis_mission_draft.",
					"Only stateRoot/birth/blueprint.json is written.",
				],
			});
		}
		case "idu_skill_for_task": {
			if (resolution.status !== "registered_project" || !resolution.stateRoot) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "idu_skill_for_task requires an enrolled project stateRoot.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["enrolled project stateRoot is missing"],
				});
			}
			const request = requiredText(args, "request");
			const skills = loadSkillsForTask(resolution.stateRoot, request);
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `skills ranked: ${skills.length} matches`,
				data: { request, skills },
				safeNotes: [
					...resolution.safeNotes,
					"Skills index is read from lab.db; no stateRoot or lab.db writes.",
					"No auto-promotion of skills or contracts.",
				],
			});
		}
		case "idu_birth_validate": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			if (!runtime.projectPath) {
				return envelope({
					stateRoot: "",

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "Birth validate requires an active project path.",
					data: {},
					safeNotes: resolution.safeNotes,
					errors: ["active project path is missing"],
				});
			}
			const env = handleBirthValidate({
				projectId: runtime.projectId,
				stateRoot,
				projectPath: runtime.projectPath,
			});
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_validate state=${env.readiness.state}`,
				data: { birth: env },
				safeNotes: [
					...resolution.safeNotes,
					"Birth validate runs read-only scan + Bibliotecario + readiness; nothing is written except under stateRoot/birth/.",
				],
			});
		}
		case "idu_birth_repo_plan": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as {
				repoPlan?: Partial<BirthRepoPlan>;
			};
			const plan: BirthRepoPlan = {
				repoName: String(params.repoPlan?.repoName ?? runtime.projectId),
				visibility:
					params.repoPlan?.visibility === "public" ? "public" : "private",
				owner: String(params.repoPlan?.owner ?? ""),
				license: String(params.repoPlan?.license ?? "MIT"),
				initialReadmePolicy: String(
					params.repoPlan?.initialReadmePolicy ?? "minimal",
				),
				remoteProvider:
					(params.repoPlan?.remoteProvider as
						| "github"
						| "gitlab"
						| "other"
						| undefined) ?? "github",
				pushApproved: Boolean(params.repoPlan?.pushApproved),
				branchPolicy: String(params.repoPlan?.branchPolicy ?? "main"),
				ciExpectation: String(params.repoPlan?.ciExpectation ?? ""),
			};
			const env = handleBirthRepoPlan({
				projectId: runtime.projectId,
				stateRoot,
				repoPlan: plan,
			});
			return envelope({
				stateRoot: "",

				ok: env.decision.repoWritesAllowed,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `birth_repo_plan repoWritesAllowed=${env.decision.repoWritesAllowed}`,
				data: { birth: env },
				safeNotes: [
					...resolution.safeNotes,
					"Repo plan is evaluated only; no git init/push is executed by Idu-pi.",
					"Human push approval is required and recorded before any repoWritesAllowed=true.",
				],
			});
		}
		case "idu_pending_injections": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as { ack?: boolean };
			// AUDITOR-FIX-A: default ack = FALSE. A routine pull (no flag)
			// only writes `delivered`. ack:true must be EXPLICIT — that's
			// the deliberate dismissal escape hatch. If we default to true,
			// every pull dismisses + acks the advisory, defeating Item 5's
			// forced-pull escalation. (Use idu_ack_advisory for the
			// dedicated escape hatch tool.)
			const ack = params.ack === true;
			const pending = readPendingInjections(stateRoot, {});
			if (pending.length > 0) {
				for (const inj of pending) {
					// Wire telemetry: write `delivered` for each surfaced advisory (#2467).
					// The cron evaluator will call markInjectionAcked when it writes
					// `resolved` (clear PISO gate) or `expired` (per-kind policy).
					// The path is included for hygiene advisories so the
					// path-absent predicate can be constructed.
					const meta = inj.meta as { path?: string } | undefined;
					recordLifecycleEvent({
						stateRoot,
						injectionId: inj.injectionId,
						phase: "delivered",
						kind: inj.kind,
						path: meta?.path,
						now: new Date(),
					});
					if (ack) {
						// ack:true on the pull = deliberate dismissal (escape hatch).
						// Same guard as idu_ack_advisory: only write the
						// `dismissed` event on a real transition. The
						// prior implementation always wrote the event
						// regardless of markInjectionAcked's outcome,
						// which produced phantom dismissals on no-op
						// calls (already-acked, not-found). The #156
						// audit caught this. Same fix here.
						const outcome = markInjectionAcked(stateRoot, inj.injectionId);
						if (outcome === "acked") {
							recordLifecycleEvent({
								stateRoot,
								injectionId: inj.injectionId,
								phase: "dismissed",
								kind: inj.kind,
								reason: "idu_pending_injections ack:true",
								now: new Date(),
							});
						}
					}
				}
			}
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `pending=${pending.length} acked=${ack ? pending.length : 0}`,
				data: {
					birth: {
						pendingInjections: pending,
						ackedCount: ack ? pending.length : 0,
					},
				},
				safeNotes: [
					...resolution.safeNotes,
					"Read pending injections from stateRoot only; no repo files were touched.",
					ack
						? "Side effect: mark-as-acked happened on disk."
						: "Side effect: read-only, no disk write.",
				],
			});
		}
		case "idu_hygiene_migrate": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as { projectPath?: string };
			const repoRoot = (params.projectPath ?? runtime.projectPath ?? "").trim();
			if (!repoRoot) {
				return envelope({
					stateRoot,

					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"idu_hygiene_migrate requires --projectPath or an active project.",
					data: {},
					safeNotes: [
						...resolution.safeNotes,
						"No migration executed: missing target repo root.",
					],
					errors: [
						"projectPath is required when no active project is registered",
					],
				});
			}
			const migration: MigrationResult = migrateHygieneLayout({
				repoRoot,
				stateRoot,
			});
			return envelope({
				stateRoot,

				ok: migration.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: repoRoot,
				summary: `moved=${migration.moved.length} skipped=${migration.skipped.length} errors=${migration.errors.length}`,
				data: {
					hygiene: {
						repoRoot,
						moved: migration.moved,
						skipped: migration.skipped,
						errors: migration.errors,
					},
				},
				safeNotes: [
					...resolution.safeNotes,
					"Territory model: migration only moves files idu-pi owns (manifest-driven).",
					"Idempotent: running twice does not double-move.",
					migration.errors.length > 0
						? `Side effect: ${migration.moved.length} moves applied; ${migration.errors.length} errors recorded in <stateRoot>/events.jsonl.`
						: `Side effect: ${migration.moved.length} moves applied; logged to <stateRoot>/events.jsonl.`,
				],
				...(migration.errors.length > 0
					? {
							errors: migration.errors.map((e) => `${e.from}: ${e.message}`),
						}
					: {}),
			});
		}
		case "idu_hygiene_sweep": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as { projectPath?: string; mode?: string };
			// The CLI/MCP surface only supports `advisory`. `auto` is
			// internal-only (used by the cron preflight to clean
			// <stateRoot>/tmp/**). Reject any other mode explicitly.
			if (params.mode && params.mode !== "advisory") {
				return envelope({
					stateRoot,
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: `idu_hygiene_sweep rejects mode='${params.mode}'`,
					data: {},
					safeNotes: [
						...resolution.safeNotes,
						"Mode `auto` is internal-only (idu-pi internal auto-clean of <stateRoot>/tmp/**).",
					],
					errors: [
						"auto mode is internal-only. Use mode='advisory' (default).",
					],
				});
			}
			const repoRoot = (params.projectPath ?? runtime.projectPath ?? "").trim();
			if (!repoRoot) {
				return envelope({
					stateRoot,
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary:
						"idu_hygiene_sweep requires --projectPath or an active project.",
					data: {},
					safeNotes: [
						...resolution.safeNotes,
						"No sweep executed: missing target repo root.",
					],
					errors: [
						"projectPath is required when no active project is registered",
					],
				});
			}
			// Re-run the sensor at sweep time for a fresh snapshot. The
			// sensor's findings[].path becomes the source of truth; the
			// sweep never re-discovers. (See design.md / spec.md.)
			const sensorOutput = runHygieneSensor({ stateRoot, repoPath: repoRoot });
			const sweep: PlanSweepResult = planSweep({
				sensorOutput,
				stateRoot,
				repoPath: repoRoot,
				mode: "advisory",
			});
			return envelope({
				stateRoot,
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: repoRoot,
				summary: `sweep: ${sweep.paths.length} paths to delete, ${sweep.skipped.length} skipped`,
				data: { sweep },
				safeNotes: [
					...resolution.safeNotes,
					"ADVISORY ONLY. idu-pi does NOT delete. The orchestrator runs the suggested commands.",
					"NEVER `find -delete`. Each command is `rm <exact-path>` from the sensor's findings[].path.",
					"Re-validated at sweep time: territoriality, pattern, existence, symlink target.",
				],
			});
		}
		case "idu_ack_advisory": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as { injectionId?: string; reason?: string };
			if (!params.injectionId) {
				return envelope({
					stateRoot,
					ok: false,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: "idu_ack_advisory requires --injectionId",
					data: {},
					safeNotes: [
						...resolution.safeNotes,
						"No ack executed: missing injectionId.",
					],
					errors: ["injectionId is required"],
				});
			}
			const result: AckAdvisoryResult = ackAdvisory({
				stateRoot,
				injectionId: params.injectionId,
				reason: params.reason,
			});
			return envelope({
				stateRoot,
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `acked ${result.injectionId} (${result.reason})`,
				data: { ack: result },
				safeNotes: [
					...resolution.safeNotes,
					"Explicit dismissal escape hatch. Audit log written.",
					"This is the dedicated tool for deliberate dismissal; the inline `ack:true` flag on idu_pending_injections still works for ad-hoc use.",
				],
			});
		}
		case "idu_outbox_prune": {
			const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
			const params = args as {
				olderThanDays?: string | number;
				confirm?: boolean;
			};
			const olderThanDays =
				typeof params.olderThanDays === "string"
					? Number(params.olderThanDays)
					: typeof params.olderThanDays === "number"
						? params.olderThanDays
						: 30;
			const confirm = params.confirm === true;
			const plan = planPrune(stateRoot, { olderThanDays });
			if (!confirm) {
				return envelope({
					stateRoot: "",

					ok: true,
					tool: name,
					projectId: runtime.projectId,
					projectPath: runtime.projectPath,
					summary: `dry-run: proposals=${plan.proposals.length} injections=${plan.injections.length} cutoff=${plan.cutoff}`,
					data: {
						outboxPrune: {
							dryRun: true,
							cutoff: plan.cutoff,
							proposals: plan.proposals.map((e) => ({
								id: e.id,
								createdAt: e.createdAt,
							})),
							injections: plan.injections.map((e) => ({
								id: e.id,
								createdAt: e.createdAt,
							})),
						},
					},
					safeNotes: [
						...resolution.safeNotes,
						"Dry run: no files were touched. Re-call with confirm=true to apply.",
					],
				});
			}
			const result = applyPrune(stateRoot, plan, { olderThanDays });
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `applied: archive=${result.archiveDir} archived(proposals=${result.archived.proposals}, injections=${result.archived.injections})`,
				data: {
					outboxPrune: {
						dryRun: false,
						cutoff: result.cutoff,
						archiveDir: result.archiveDir,
						archived: result.archived,
						removed: result.removed,
					},
				},
				safeNotes: [
					...resolution.safeNotes,
					"StateRoot-only writes: archived old entries to .archive/YYYY-MM-DD/ and removed from live files.",
				],
			});
		}
		case "idu_subscribe_triggers": {
			return envelope({
				stateRoot: "",

				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `triggers=${TRIGGER_DEFINITIONS.length}`,
				data: {
					birth: {
						triggers: TRIGGER_DEFINITIONS.map((d) => ({
							id: d.id,
							description: d.description,
							kinds: d.kinds,
							signature: d.signature,
							contract: {
								decisionRequired: d.contract.decisionRequired,
								severity: d.contract.severity,
								options: d.contract.options,
							},
						})),
					},
				},
				safeNotes: [
					...resolution.safeNotes,
					"Read-only; describe los disparadores y su contrato. No escribe.",
				],
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
					...result.recoveryActions.map((action) => ({
						id: action.id,
						owner: action.owner,
						action: action.action,
						reason: action.reason,
						blocking: action.blocking,
						data: {
							tool: action.tool,
							cliCommand: action.cliCommand,
						},
					})),
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
				stateRoot: "",

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
				stateRoot: "",

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
		case "idu_external_intelligence_report":
			return await handleExternalIntelligenceReport(name, args, runtime, resolution);
		case "idu_external_source_recommend":
			return await handleExternalSourceRecommend(name, args, runtime, resolution);
		case "idu_task":
			return await handleTask(name, args, runtime, resolution);
		case "idu_queue_detail":
			return await handleQueueDetail(name, args, runtime, resolution);
		case "idu_queue_complete":
			return await handleQueueComplete(name, args, runtime, resolution);
		case "idu_semantic_audit_status":
			return await handleSemanticAuditStatus(name, args, runtime, resolution);
		case "idu_source_status": {
			const status = runtime.sourceLibraryStatus();
			return envelope({
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
					stateRoot: "",

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
				stateRoot: "",

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
				stateRoot: "",

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
		case "idu_agentlab_request_create":
			return await handleAgentLabRequestCreate(name, args, runtime, resolution);
		case "idu_agentlab_review_run":
			return await handleAgentLabReviewRun(name, args, runtime, resolution);
		case "idu_agentlab_review_status":
			return await handleAgentLabReviewStatus(name, args, runtime, resolution);
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

export type SupervisorConsultation = JsonObject & {
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

export function defaultRuntimeFactory(projectPath?: string): CliRuntime {
	return createCliRuntime({ projectPath, requireTelegramConfig: false });
}

export function buildSupervisorConsultation(input: {
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

export function planObjectiveForRuntime(runtime: CliRuntime): string | undefined {
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

export function buildConsultationFromAdvisory(input: {
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

function buildActiveSkillsIndex(stateRoot: string): Array<{
	skillId: string;
	name: string;
	summary: string;
	path: string;
	rating: number;
}> {
	try {
		const entries = loadSkillsIndexFromLabDb(stateRoot);
		return packSkillsIndex(entries);
	} catch {
		return [];
	}
}

function detectProjectTypeForTaxonomy(runtime: CliRuntime): string {
	const path = (runtime.projectPath ?? "").toLowerCase();
	if (path.includes("component") || path.includes("ui")) return "web";
	if (path.includes("lib") || path.includes("pkg")) return "library";
	return "program";
}

export function buildSupervisorContextPack(
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
	const orchestratorAdvisories = buildOrchestratorAdvisoriesSection(runtime);
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
		activeSkillsIndex: buildActiveSkillsIndex(runtime.workspaceRoot),
		taxonomyGuide: readTaxonomyGuide(
			runtime.workspaceRoot,
			detectProjectTypeForTaxonomy(runtime),
		),
		contextBudget: mergeContextBudgetUsage("supervisor_context_pack", [
			humanVision.usage,
			taskGoal.usage,
			safeRisks.usage,
			safeReads.usage,
			...(embeddedPlanSnapshotUsage ? [embeddedPlanSnapshotUsage] : []),
		]),
		governanceConfig: governanceConfigData(),
		workerBoundary: workerBoundaryData(),
		orchestratorAdvisories,
	};
}

export function buildOrchestratorAdvisoriesSection(
	runtime: CliRuntime,
): JsonObject {
	// Get advisories from the runtime (last 500 to have enough data for grouping)
	const advisories = runtime.getOrchestratorAdvisory
		? runtime.getOrchestratorAdvisory({ limit: 500 })
		: [];

	// Group by roleId and cap at 5 per role
	const byRole: Record<string, JsonObject[]> = {};
	const roleAdvisoryMap = new Map<string, JsonObject[]>();

	for (const advisory of advisories) {
		const roleId = advisory.roleId;
		if (!roleAdvisoryMap.has(roleId)) {
			roleAdvisoryMap.set(roleId, []);
		}
		roleAdvisoryMap.get(roleId)!.push({
			ts: advisory.ts,
			priority: advisory.priority,
			advisory: advisory.advisory,
			evidenceRefs: advisory.evidenceRefs,
		});
	}

	// Cap each role at 5 advisories (most recent first)
	let total = 0;
	for (const [roleId, roleAdvisories] of roleAdvisoryMap.entries()) {
		// Sort by timestamp descending (most recent first)
		const sorted = roleAdvisories.sort((a, b) => {
			const tsA = String(a.ts);
			const tsB = String(b.ts);
			return tsB.localeCompare(tsA);
		});
		byRole[roleId] = sorted.slice(0, 5);
		total += byRole[roleId]!.length;
	}

	return {
		advisoryOnly: true,
		byRole,
		total,
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

export function arrayField(source: JsonObject, key: string): unknown[] {
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

export function activeMcpProjectId(
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): string | undefined {
	const candidate = runtime.projectId || resolution.projectId;
	return candidate.trim() ? candidate.trim() : undefined;
}

export function invalidMcpInput(
	name: IduMcpToolName,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
	message: string,
	data: JsonObject = {},
): IduMcpToolResult {
	return envelope({
		stateRoot: "",

		ok: false,
		tool: name,
		projectId: activeMcpProjectId(runtime, resolution) ?? null,
		projectPath: runtime.projectPath || resolution.projectPath || null,
		summary: `Invalid input for ${name}: ${message}`,
		data,
		safeNotes: resolution.safeNotes,
		errors: [message],
	});
}

function scoreArg(
	args: JsonObject,
	key: string,
): { ok: true; text: string; value: number } | { ok: false; error: string } {
	const raw = args[key];
	const text =
		typeof raw === "number" || typeof raw === "string"
			? String(raw).trim()
			: "";
	const value = Number(text);
	if (!text || !Number.isFinite(value) || !Number.isInteger(value)) {
		return { ok: false, error: `${key} must be an integer in 0..10` };
	}
	if (value < 0 || value > 10) {
		return { ok: false, error: `${key} must be in 0..10, got ${value}` };
	}
	return { ok: true, text, value };
}

export function supervisorTriggerActionArg(
	args: JsonObject,
): "enable" | "disable" | "status" | undefined {
	const direct = stringArg(args, "action");
	const positional = Array.isArray(args.args) ? args.args[0] : undefined;
	const value = (
		direct ?? (typeof positional === "string" ? positional.trim() : "")
	).toLowerCase();
	if (value === "enable" || value === "disable" || value === "status")
		return value;
	return undefined;
}

export function roleEngineControlActionArg(
	args: JsonObject,
): "enable" | "disable" | undefined {
	const action = supervisorTriggerActionArg(args);
	return action === "enable" || action === "disable" ? action : undefined;
}

export function roleEngineRoleArg(
	args: JsonObject,
): IduModelRoleId | "invalid" | undefined {
	const value = stringArg(args, "role");
	if (!value) return undefined;
	if (value in DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled) {
		return value as IduModelRoleId;
	}
	return "invalid";
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

export function compactSourceLibraryEvidence(
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

export function agentLabSpecialtiesArg(
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

export function parseTaskList(text: string): StructuredTask[] {
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

export function aggregateRunStatus(statuses: string[]): string {
	if (statuses.includes("security_violation")) return "security_violation";
	if (statuses.includes("timed_out")) return "timed_out";
	if (statuses.includes("failed")) return "failed";
	if (statuses.includes("partial")) return "partial";
	if (statuses.includes("completed")) return "completed";
	if (statuses.includes("skipped")) return "skipped";
	return "unknown";
}

export function agentLabStatusWorkloadEnvelope(status: {
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	runMcpServer();
}
