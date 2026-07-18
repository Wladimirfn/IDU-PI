/**
 * helpers.ts — setup, project, dashboard, and pre/postflight builders.
 *
 * Internal-only. Re-exported by `index.ts`. Used by `src/cli.ts` for
 * the `idu-setup`, `idu-project`, `idu-preflight`, `idu-postflight`,
 * `idu-prepare`, and `idu-status` cases.
 *
 * Body moved verbatim from src/cli.ts (lines 3904-4186 in main @ 42b7eaa).
 * No source-level deltas; this is a pure move. (Verified byte-identical
 * to the original — see PR 3 commit body.)
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../config.js";
import {
	resolvePiAgentDir,
	type IduMcpTarget,
	detectAgentConfigs,
	detectSystem,
	detectTools,
	formatIduSetupStatus,
	formatInstallIduMcpConfigResult,
	formatProjectEnrollResult,
	formatProjectInstallStatus,
	installIduMcpConfig,
	printIduMcpConfig,
	projectEnroll,
	projectInstallStatus,
} from "../../idu-installer.js";
import {
	buildCliHomeStatus,
	formatSetupWizardNonInteractive,
	formatSetupPathHelp,
	resolveCliPackageRoot,
	resolveIduRegistryPath,
} from "../../cli-home.js";
import {
	formatProjectStatePaths,
	resolveProjectStatePaths,
} from "../../project-state.js";
import {
	inspectProjectConnection,
	type ProjectConnectionReport,
} from "../../project-connection.js";
import {
	formatIduProjectDashboard,
	type IduProjectDashboardReport,
} from "../../idu-project-dashboard.js";
import type { IduSupervisorHookResult } from "../../idu-supervisor-hooks.js";
import { cliCommandFor } from "../dispatch-glue/index.js";
import { initProjectConfig, inspectProjectMap } from "../../config-wizard.js";
import {
	readProjectAlignmentState,
	recordProjectAlignmentState,
} from "../../project-alignment-state.js";
import { loadProjectBlueprint } from "../../project-blueprint.js";
import { loadProjectFlows } from "../../project-flows.js";
import { loadConfirmedProjectConstitution } from "../../project-constitution.js";
import {
	analyzeProjectPreflight,
	type ProjectPreflightReport,
} from "../../project-preflight.js";
import {
	readProjectPostflightGitState,
	analyzeProjectPostflight,
	type PostflightGitRunner,
	type ProjectPostflightReport,
} from "../../project-postflight.js";
import { buildPostflightPhysicalGates } from "../../physical-gates.js";
import { runIduPrepare, type IduPrepareResult } from "../../idu-prepare.js";
import {
	scanProjectMap,
	suggestProjectFlowsFromScan,
	saveProjectFlowsDraft,
	reviewProjectFlowsDraft,
} from "../../project-map-scanner.js";
import type { RuntimeContext } from "../dispatch-glue/index.js";

export function handleSetupCommand(rest: string[]): string {
	const subcommand = rest[0] ?? "status";
	const target = parseMcpTarget(rest);
	const agentDir =
		target === "opencode"
			? join(homedir(), ".config", "opencode")
			: resolvePiAgentDir();
	const packageRoot = resolveCliPackageRoot();
	const mcpServerPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"mcp-server.js",
	);
	const extensionSourcePath = join(
		packageRoot,
		".pi",
		"extensions",
		"idu-pi-commands.ts",
	);
	if (subcommand === "status") {
		const mcpInstalled = existsSync(join(agentDir, "mcp.json"));
		return formatIduSetupStatus({
			system: detectSystem(),
			tools: detectTools(),
			agentConfigs: detectAgentConfigs(),
			mcpInstalled,
		});
	}
	if (subcommand === "wizard") {
		return formatSetupWizardNonInteractive(
			buildCliHomeStatus({
				argvPath: process.argv[1],
				stdinInteractive: false,
			}),
		);
	}
	if (subcommand === "path-help") {
		return formatSetupPathHelp();
	}
	if (subcommand === "mcp-print") {
		return printIduMcpConfig({ mcpServerPath, target });
	}
	if (subcommand === "mcp-init") {
		const force = rest.includes("--force");
		const dryRun = rest.includes("--dry-run");
		const result = installIduMcpConfig({
			agentDir,
			mcpServerPath,
			target,
			extensionSourcePath,
			force,
			dryRun,
		});
		return formatInstallIduMcpConfigResult(result);
	}
	throw new Error(
		"Uso: idu-pi setup [status|wizard|path-help|mcp-init|mcp-print] [--target pi|opencode] [--force] [--dry-run]",
	);
}

export function parseMcpTarget(args: string[]): IduMcpTarget {
	const targetFlag = args.find((arg) => arg.startsWith("--target="));
	const targetIndex = args.indexOf("--target");
	const target =
		targetFlag?.split("=")[1] ??
		(targetIndex >= 0 ? args[targetIndex + 1] : undefined);
	if (!target) return "pi";
	if (target === "pi" || target === "opencode") return target;
	throw new Error("Uso: --target pi|opencode");
}

export function handleProjectCommand(rest: string[]): string {
	const subcommand = rest[0];
	const config = loadConfig({ requireTelegram: false });
	const registryPath = resolveIduRegistryPath();
	if (subcommand === "enroll") {
		const projectPath = rest[1];
		if (!projectPath)
			throw new Error("Uso: idu-pi project enroll <projectPath> [projectId]");
		return formatProjectEnrollResult(
			projectEnroll({
				projectPath,
				projectId: rest[2],
				workspaceRoot: config.agentWorkspaceRoot,
				allowedRoots: config.allowedRoots,
				registryPath,
			}),
		);
	}
	if (subcommand === "status") {
		const projectPath = rest[1];
		if (!projectPath)
			throw new Error("Uso: idu-pi project status <projectPath>");
		return formatProjectInstallStatus(
			projectInstallStatus({
				projectPath,
				workspaceRoot: config.agentWorkspaceRoot,
				allowedRoots: config.allowedRoots,
				mcpAvailable: existsSync(join(resolvePiAgentDir(), "mcp.json")),
				registryPath,
			}),
		);
	}
	if (subcommand === "state-path") {
		const projectPath = rest[1];
		if (!projectPath)
			throw new Error("Uso: idu-pi project state-path <projectPath>");
		const status = projectInstallStatus({
			projectPath,
			workspaceRoot: config.agentWorkspaceRoot,
			allowedRoots: config.allowedRoots,
			registryPath,
		});
		return formatProjectStatePaths(
			resolveProjectStatePaths({
				workspaceRoot: config.agentWorkspaceRoot,
				projectId: status.projectId,
				projectPath: status.projectPath,
			}),
		);
	}
	throw new Error(
		"Uso: idu-pi project [enroll|status|state-path] <projectPath> [projectId]",
	);
}

export function inspectConnection(context: RuntimeContext): ProjectConnectionReport {
	return inspectProjectConnection({
		registry: context.registry,
		defaultCwd: context.config.defaultCwd,
		allowedRoots: context.config.allowedRoots,
		workspaceRoot: context.runtimeWorkspaceRoot,
		...(context.activeProject.stateRoot
			? { stateRoot: context.activeProject.stateRoot }
			: {}),
		projectId: context.activeProject.id,
		alignmentState: readProjectAlignmentState(context.runtimeWorkspaceRoot, {
			projectId: context.activeProject.id,
			projectPath: context.activeProject.path,
		}),
	});
}

export function formatCliSupervisorStartupSection(
	startup: IduSupervisorHookResult | undefined,
): string[] {
	if (!startup) return [""];
	const reason = startup.reason ? ` (${startup.reason})` : "";
	return [
		"",
		"Arranque supervisor:",
		`${startup.status}${reason} — ${startup.summary}`,
	];
}

export function formatDashboard(report: ProjectConnectionReport): string {
	return formatIduProjectDashboard({
		projectId: report.projectId,
		configStatus: report.configStatus,
		alignmentStatus: report.alignmentStatus,
		readiness: report.readiness,
		reason: report.alignmentReason,
		recommendedNext: cliCommandFor(report.recommendedNext),
	} satisfies IduProjectDashboardReport);
}

export function buildPreflightReport(
	request: string,
	context: RuntimeContext,
): ProjectPreflightReport {
	const connection = inspectConnection(context);
	const blueprint =
		connection.projectPath &&
		connection.blueprint?.source === "project-local" &&
		connection.blueprint.valid
			? loadProjectBlueprint(
					context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				)
			: undefined;
	const flows =
		connection.projectPath &&
		connection.flows?.source === "project-local" &&
		connection.flows.valid
			? loadProjectFlows(
					context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				)
			: undefined;
	const constitution = loadConfirmedProjectConstitution(
		context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
	);
	return analyzeProjectPreflight(request, {
		connection,
		blueprint,
		flows,
		constitutionStatus: constitution,
		projectId: connection.projectId,
		projectPath: connection.projectPath,
	});
}

// Bounded git subprocess helper for postflight git reads. Mirrors the
// readGitHead precedent but adds an explicit timeout so a hanging git cannot
// stall postflight. TODO(shared-module): extract alongside the worktree
// overlay git runners into a single shared subprocess primitive.
const POSTFLIGHT_GIT_TIMEOUT_MS = 5000;

function gitOutput(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		timeout: POSTFLIGHT_GIT_TIMEOUT_MS,
		stdio: ["ignore", "pipe", "ignore"],
	});
}

export function buildPostflightReport(
	context: RuntimeContext,
): ProjectPostflightReport {
	const connection = inspectConnection(context);
	const projectPath = connection.projectPath ?? context.activeProject.path;
	const flows =
		connection.projectPath &&
		connection.flows?.source === "project-local" &&
		connection.flows.valid
			? loadProjectFlows(
					context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				)
			: undefined;
	// Git state must reflect the EFFECTIVE working tree: when the active
	// project was resolved via the worktree overlay, effectiveCwd is the
	// worktree path and git diff/status must read from there, not from the
	// governance (main repo) path. projectPath above is the governance path.
	const gitCwd = context.effectiveCwd ?? projectPath;
	const gitRunner: PostflightGitRunner = (_command, args) =>
		gitOutput(args, gitCwd);
	const gitState = readProjectPostflightGitState(gitCwd, gitRunner);
	const constitution = loadConfirmedProjectConstitution(
		context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
	);
	const report = analyzeProjectPostflight({
		projectPath,
		connectionReport: connection,
		projectFlows: flows,
		constitutionStatus: constitution,
		changedFiles: gitState.changedFiles,
		diffSummary: gitState.diffSummary,
	});
	const reportWithWarnings = {
		...report,
		warnings: [...gitState.warnings, ...report.warnings],
	};
	return {
		...reportWithWarnings,
		physicalGates: buildPostflightPhysicalGates({
			projectPath,
			gitState,
			report: reportWithWarnings,
		}),
	};
}

export function runPrepare(context: RuntimeContext): IduPrepareResult {
	const reportsPath = context.reportsPath;
	const projectId = context.activeProject.id;
	const projectPath = context.activeProject.path;
	const result = runIduPrepare({
		projectId,
		projectPath,
		reportsPath,
		inspectConnection: () => inspectConnection(context),
		initProjectConfig: () =>
			initProjectConfig(
				projectPath,
				context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				projectId,
			),
		inspectProjectMap: () =>
			inspectProjectMap(
				projectPath,
				context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				{
					activeProjectId: projectId,
					activeProjectName: context.activeProject.name,
				},
			),
		loadProjectFlows: () =>
			loadProjectFlows(
				context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
			),
		scanProjectMap: (flows) =>
			scanProjectMap(
				projectPath,
				context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				flows,
			),
		suggestProjectFlows: (flows) =>
			suggestProjectFlowsFromScan(
				projectPath,
				context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				flows,
			),
		draftProjectFlows: (flows) =>
			saveProjectFlowsDraft(
				projectPath,
				context.activeProject.stateRoot ?? context.runtimeWorkspaceRoot,
				flows,
				reportsPath,
			),
		reviewProjectFlowsDraft: (draftPathOrLatest, flows) =>
			reviewProjectFlowsDraft(draftPathOrLatest, flows, reportsPath),
		postflight: () => buildPostflightReport(context),
		createStructuredTask: (input) =>
			context.structuredTaskQueue.enqueueTask(input),
	});
	recordProjectAlignmentState(context.runtimeWorkspaceRoot, {
		projectId,
		projectPath,
		alignmentStatus: result.alignmentStatus,
		readiness: result.readiness,
		alignmentReason: [`último prepare: ${result.recommendedNext}`],
		differencesDetected: result.differencesDetected,
	});
	return result;
}
