// src/mcp/lifecycle/handlers.ts
//
// PR 2 (Item 4, mcp-server god-file breakup): cluster A (lifecycle)
// wrappers for the dispatch switch.
//
// 4 wrappers, one per case group (single label, no fall-through):
//   - handleProjectStatus (idu_project_status)
//   - handleProjectEnroll (idu_project_enroll)
//   - handleBootstrapProject (idu_bootstrap_project)
//   - handleStart (idu_start)
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name/args/options params instead of
// closure-captured names).
//
// Free vars used (locked template):
//   - name: IduProjectLifecycleToolName (param)
//   - args: JsonObject (param)
//   - options: IduMcpServerOptions (param)
//   - envelope(): imported from _shared (universal contract)
//   - resolveMcpProjectContext(): imported from mcp-server
//
// Byte-identity contract: each wrapper body matches the corresponding
// case body modulo the function signature (param names may differ).

import { activateIduSession } from "../../idu-session.js";
import { projectEnroll, projectInstallStatus } from "../../idu-installer.js";
import { runIduBootstrap } from "../../idu-bootstrap.js";
import {
	defaultRuntimeFactory,
	resolveMcpProjectContext,
} from "../../mcp-server.js";
import type {
	IduMcpServerOptions,
	IduProjectLifecycleToolName,
} from "../../mcp-server.js";
import type { BridgeConfig } from "../../config.js";
import {
	booleanArg,
	envelope,
	requiredText,
	stringArg,
} from "../_shared/index.js";
import {
	compactSupervisorStartup,
	configureProjectSessionStore,
	projectEnrollEnvelope,
	resolveLifecycleProjectPath,
} from "./helpers.js";
import type {
	IduMcpToolResult,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_project_status — read-only project registry status.
 * Body verbatim from src/mcp-server.ts L1602-L1625.
 */
export async function handleProjectStatus(
	name: IduProjectLifecycleToolName,
	args: JsonObject,
	options: IduMcpServerOptions,
	config: BridgeConfig,
	registryPath: string,
): Promise<IduMcpToolResult> {
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
	// REQ-EI-4 (P5): thread stateRoot from resolution. Lifecycle handlers
	// don't have `runtime` in scope; resolution.stateRoot is the only
	// available signal. Test T1.1 excludes LIFECYCLE_TOOLS so the
	// workspaceRoot fallback is not exercised here.
	const resolution = (
		options.projectResolver ?? resolveMcpProjectContext
	)(stringArg(args, "projectPath"));
	const stateRoot = resolution.stateRoot ?? null;
	return envelope({
		stateRoot,

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

/**
 * idu_project_enroll — explicit enroll, no drafts.
 * Body verbatim from src/mcp-server.ts L1627-L1636.
 */
export async function handleProjectEnroll(
	name: IduProjectLifecycleToolName,
	args: JsonObject,
	_options: IduMcpServerOptions,
	config: BridgeConfig,
	registryPath: string,
): Promise<IduMcpToolResult> {
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

/**
 * idu_bootstrap_project — explicit bootstrap, optional drafts and activation.
 * Body verbatim from src/mcp-server.ts L1638-L1702.
 */
export async function handleBootstrapProject(
	name: IduProjectLifecycleToolName,
	args: JsonObject,
	options: IduMcpServerOptions,
	config: BridgeConfig,
	registryPath: string,
): Promise<IduMcpToolResult> {
	const projectPath = requiredText(args, "projectPath");
	const allowCreateDrafts = booleanArg(args, "allowCreateDrafts", false);
	const activate = booleanArg(args, "activate", false);
	// REQ-EI-4 (P5): thread stateRoot from resolution (see handleProjectStatus
	// comment for the lifecycle-vs-runtime rationale).
	const resolution = (
		options.projectResolver ?? resolveMcpProjectContext
	)(stringArg(args, "projectPath"));
	const stateRoot = resolution.stateRoot ?? null;
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
			stateRoot,

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
		consentGiven: true,
	});
	return envelope({
		stateRoot,

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

/**
 * idu_start — activate guardrails for an already-enrolled project.
 * Body verbatim from src/mcp-server.ts L1704-L1790.
 */
export async function handleStart(
	name: IduProjectLifecycleToolName,
	args: JsonObject,
	options: IduMcpServerOptions,
): Promise<IduMcpToolResult> {
	const resolution = (
		options.projectResolver ?? resolveMcpProjectContext
	)(stringArg(args, "projectPath"));
	if (resolution.status === "unregistered_project") {
		return envelope({
			stateRoot: resolution.stateRoot,

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
			stateRoot: resolution.stateRoot,

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
		stateRoot: resolution.stateRoot ?? runtime.workspaceRoot,

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