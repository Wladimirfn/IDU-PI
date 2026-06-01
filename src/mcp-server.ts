#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { canonicalDirectory, isAllowedCwd, loadConfig } from "./config.js";
import { createCliRuntime, type CliRuntime } from "./cli.js";
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
	| "idu_task_package_create"
	| "idu_orchestrator_procedure"
	| "idu_task_context"
	| "idu_preflight"
	| "idu_advisory"
	| "idu_postflight"
	| "idu_supervisor_tick"
	| "idu_task"
	| "idu_queue_detail"
	| "idu_semantic_audit_status"
	| "idu_source_status"
	| "idu_source_add"
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
		"Copia/registra documentación manual local en Source Library stateRoot; no parsea PDFs ni promueve contratos.",
		{
			path: requiredString("Ruta local .md, .txt o .pdf a registrar."),
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
			]),
			selector: optionalString("Selector; usar latest por defecto."),
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
		return await dispatchTool(name, args, runtime, resolution);
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
						connection,
					},
					safeNotes: [
						...resolution.safeNotes,
						"idu_start no enrola proyectos ni crea drafts.",
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
			"Llamar idu_task_context para obtener contratos afectados y lecturas obligatorias.",
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
			"idu_task_context antes de implementar",
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
				? "Continuar con idu_task_context o idu_postflight según etapa."
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
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Contexto asesor: ${alignmentAdvisory.recommendation}`,
				data: {
					alignmentAdvisory,
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
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: alignmentAdvisory.summary,
				data: {
					alignmentAdvisory,
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
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
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: alignmentAdvisory.summary,
				data: {
					alignmentAdvisory,
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
			const expectedChangeMode = stringArg(args, "expectedChangeMode");
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: report.recommendedNext,
				data: {
					governanceConfig: governanceConfigData(),
					workerBoundary: workerBoundaryData(),
					changedFiles: report.changedFiles,
					ignoredFiles: report.ignoredFiles ?? [],
					observedChangeMode: report.observedChangeMode ?? "code",
					risk: report.risk,
					gates: report.constitutionGate ?? null,
					suggestedAgentLabs: report.suggestedAgentLabs,
					requiresHumanConfirmation: report.requiresHumanConfirmation,
					taskTrace: buildPostflightTaskTrace({
						actionId,
						taskPackageId,
						expectedContracts,
						expectedFiles,
						expectedChangeMode,
						report,
					}),
					report,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Postflight lee estado git; no hace commit ni push.",
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
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: alignmentAdvisory.summary,
				data: {
					alignmentAdvisory,
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
						guardStatus: task.guardStatus ?? "clear",
						guardRisk: task.guardRisk,
						guardReason: task.guardReason,
					})),
					guardStatus: tasks.some(
						(task) => task.guardStatus === "needs_confirmation",
					)
						? "needs_confirmation"
						: "clear",
				},
				safeNotes: resolution.safeNotes,
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
					"Copié documentación sólo a stateRoot/Doc/<project>/sources/local.",
					"PDFs se registran como binarios; no hice OCR ni parsing pesado.",
					"No promoví contratos ni ejecuté AgentLabs.",
				],
				errors: result.errors,
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
			]);
			const selector = stringArg(args, "selector") ?? "latest";
			const plan = runtime.agentLabRequestCreate(source, selector);
			return envelope({
				ok: plan.errors.length === 0,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Solicitud AgentLab creada: ${plan.path ?? "sin ruta"}`,
				data: {
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
				],
				errors: plan.errors,
			});
		}
		case "idu_agentlab_review_run": {
			const selector = stringArg(args, "selector") ?? "latest";
			const result = await runtime.agentLabReviewRun(selector);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `AgentLab review run: ${result.consolidatedSummary}`,
				data: {
					runFilePath: result.path,
					status: aggregateRunStatus(result.runs.map((run) => run.status)),
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
			return envelope({
				ok: status.valid,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: status.valid
					? `Estado AgentLab: ${status.name}`
					: "Estado AgentLab inválido.",
				data: {
					statusBySpecialty: Object.fromEntries(
						(status.result?.runs ?? []).map((run) => [
							run.specialty,
							run.status,
						]),
					),
					findings: status.result?.consolidatedFindings ?? [],
					recommendations: (status.result?.runs ?? []).flatMap(
						(run) => run.recommendations,
					),
					testsSuggested: (status.result?.runs ?? []).flatMap(
						(run) => run.testsSuggested,
					),
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
};

function defaultRuntimeFactory(projectPath?: string): CliRuntime {
	return createCliRuntime({ projectPath, requireTelegramConfig: false });
}

function buildPlanSnapshot(
	review: MasterPlanReviewResult,
	runtime: CliRuntime,
): PlanSnapshot {
	const plan = review.plan as unknown as JsonObject;
	const status = String(plan.status ?? "unknown");
	const criticalRisks = arrayField(plan, "criticalRisks");
	const driftFindings = arrayField(plan, "driftFindings");
	return {
		authority: "advisory",
		planStatus: status,
		planApproved: status === "approved",
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		objective: String(
			plan.inferredObjective ??
				plan.executiveSummary ??
				"Objetivo no definido.",
		),
		summary: String(plan.executiveSummary ?? ""),
		approvedClaims: arrayField(plan, "canonicalClaims"),
		operationalContracts: arrayField(plan, "operationalContracts"),
		workMilestones: arrayField(plan, "workMilestones"),
		driftFindings,
		risks: dedupe([
			...criticalRisks.map(String),
			...arrayField(plan, "qualityRisks").map(String),
			...arrayField(plan, "securityRisks").map(String),
			...arrayField(plan, "architectureRisks").map(String),
		]),
		flows: arrayField(plan, "projectFlows"),
		flowArtifact: String(plan.flowArtifact ?? "master-plan.flows.json"),
		blockers:
			status === "approved" ? criticalRisks : ["Plan Maestro no aprobado"],
		recommendedNext: arrayField(plan, "recommendedNext"),
		recommendedAgentLabs: arrayField(
			(review.revisionAntesDeZarpar as JsonObject | undefined) ?? {},
			"recommendedAgentLabs",
		),
		governanceConfig: governanceConfigData(),
		workerBoundary: workerBoundaryData(),
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

function contractsFromPostflightImpact(areas: string[]): string[] {
	const text = areas.join(" ").toLowerCase();
	return dedupe([
		...(text.match(/seguridad|auth|secret|env/u) ? ["security"] : []),
		...(text.match(/db|storage|datos|schema/u) ? ["data"] : []),
		...(text.match(/docs/u) ? ["docs"] : []),
		...(text.match(/tests?/u) ? ["tests"] : []),
		...(text.match(/ui|frontend|components|pages|html|css/u)
			? ["frontend"]
			: []),
		...(text.match(/orquestaci|code|flujos|mapa/u) ? ["agent"] : []),
		...(areas.length ? ["agent"] : []),
	]);
}

function buildPostflightTaskTrace(input: {
	actionId?: string;
	taskPackageId?: string;
	expectedContracts: string[];
	expectedFiles: string[];
	expectedChangeMode?: string;
	report: {
		changedFiles: string[];
		ignoredFiles?: string[];
		observedChangeMode?: string;
		impactedAreas: string[];
		risk: string;
	};
}): JsonObject {
	const unexpectedAreas = input.expectedFiles.length
		? input.report.changedFiles.filter(
				(file) =>
					!input.expectedFiles.some((expected) =>
						normalizePath(file).startsWith(normalizePath(expected)),
					),
			)
		: [];
	const observedContracts = contractsFromPostflightImpact(
		input.report.impactedAreas,
	);
	const missingExpectedContracts = input.expectedContracts.filter(
		(contract) => !observedContracts.includes(contract),
	);
	const observedChangeMode = input.report.observedChangeMode ?? "code";
	const modeMatches = input.expectedChangeMode
		? input.expectedChangeMode === observedChangeMode
		: true;
	return {
		actionId: input.actionId ?? null,
		taskPackageId: input.taskPackageId ?? null,
		matchesIntent:
			unexpectedAreas.length === 0 &&
			missingExpectedContracts.length === 0 &&
			modeMatches,
		unexpectedAreas,
		ignoredFiles: input.report.ignoredFiles ?? [],
		expectedChangeMode: input.expectedChangeMode ?? null,
		observedChangeMode,
		modeDelta: modeMatches
			? null
			: { expected: input.expectedChangeMode, observed: observedChangeMode },
		expectedContracts: input.expectedContracts,
		observedContracts,
		contractDelta: missingExpectedContracts.map((contract) => ({
			contract,
			status: "expected_not_observed",
		})),
		missingExpectedContracts,
		objectiveProgress:
			input.report.changedFiles.length === 0
				? "none"
				: input.report.risk === "low"
					? "partial"
					: "unclear",
		nextAdvisory:
			input.report.risk === "low"
				? "Puede pasar a revisión del orquestador y AgentLab si la política lo requiere."
				: "Revalidar contratos y considerar AgentLab audit-only antes de cerrar.",
	};
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
	if (statuses.includes("failed")) return "failed";
	if (statuses.includes("completed")) return "completed";
	return statuses[0] ?? "skipped";
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
