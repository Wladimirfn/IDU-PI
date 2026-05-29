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
	| "idu_bootstrap_project"
	| "idu_start"
	| "idu_status"
	| "idu_activate"
	| "idu_deactivate"
	| "idu_prepare"
	| "idu_preflight"
	| "idu_advisory"
	| "idu_postflight"
	| "idu_supervisor_tick"
	| "idu_task"
	| "idu_queue_detail"
	| "idu_semantic_audit_status"
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
		"idu_agentlab_request_create",
		"Crea solicitud formal AgentLab; no ejecuta AgentLabs.",
		{
			source: requiredEnum("Fuente de solicitud.", [
				"postflight",
				"master-plan",
				"skill-draft",
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
		case "idu_preflight": {
			const request = requiredText(args, "request");
			const report = runtime.preflight(request);
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: `Riesgo ${report.risk}: ${report.affectedAreas.join(", ") || "sin impacto detectado"}`,
				data: {
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
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: advisory.recommendation,
				data: {
					advisoryText: runtime.formatAdvisory(advisory),
					risk: advisory.level,
					suggestedNextSteps: advisory.actions,
					advisory,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Advisory solamente: no ejecuté scan, IA ni AgentLabs.",
				],
			});
		}
		case "idu_postflight": {
			const report = runtime.postflight();
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: report.recommendedNext,
				data: {
					changedFiles: report.changedFiles,
					risk: report.risk,
					gates: report.constitutionGate ?? null,
					suggestedAgentLabs: report.suggestedAgentLabs,
					requiresHumanConfirmation: report.requiresHumanConfirmation,
					report,
				},
				safeNotes: [
					...resolution.safeNotes,
					"Postflight lee estado git; no hace commit ni push.",
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
			return envelope({
				ok: true,
				tool: name,
				projectId: runtime.projectId,
				projectPath: runtime.projectPath,
				summary: result.summary,
				data: {
					stepsExecuted: result.steps.filter(
						(step) => step.status !== "skipped",
					),
					skippedReasons: result.steps.filter(
						(step) => step.status === "skipped",
					),
					safeNotes: result.recommendedNext,
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
		case "idu_agentlab_request_create": {
			const source = requiredText(args, "source");
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

function defaultRuntimeFactory(projectPath?: string): CliRuntime {
	return createCliRuntime({ projectPath, requireTelegramConfig: false });
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

function requiredText(args: JsonObject, key: string): string {
	const value = stringArg(args, key);
	if (!value) throw new Error(`Missing required argument: ${key}`);
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
