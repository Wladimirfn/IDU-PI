/**
 * CLI surfaces for role engine — T1.7a.
 *
 * Two new commands:
 * - idu-orchestrator-advisory [--role <id>] [--since <iso>] [--limit N]
 * - idu-role-engine-status
 */

import type { CliRuntime } from "./cli.js";
import type { IduModelRoleId } from "./model-assignments.js";
import {
	DEFAULT_ROLE_ENGINE_CONFIG,
	formatRoleEngineConfigResult,
	saveRoleEngineConfig,
	type RoleEngineConfigPatch,
} from "./role-engine-config.js";
import type { RoleAdvisory } from "./roles/index.js";

export type RoleEngineStatusReport = {
	config: {
		enabled: boolean;
		maxRoleInvocationsPerTurn: number;
		roleEnabled: Record<string, boolean>;
		roleCooldownMs: Record<string, number>;
	};
	lastFires: Array<{ roleId: string; lastFireAt: string }>;
	lastCapWarning: string | undefined;
	advisoryStreamSummary: {
		totalAdvisories: number;
		lastAdvisory: string | undefined;
	};
};

/**
 * Parse orchestrator advisory CLI arguments.
 */
function parseOrchestratorAdvisoryArgs(rest: string[]): {
	roleId?: string;
	sinceMs?: number;
	limit?: number;
} {
	const options: { roleId?: string; sinceMs?: number; limit?: number } = {};

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--role" && i + 1 < rest.length) {
			options.roleId = rest[i + 1];
			i++;
		} else if (arg === "--since" && i + 1 < rest.length) {
			const ts = Date.parse(rest[i + 1]);
			if (!isNaN(ts)) {
				options.sinceMs = ts;
			}
			i++;
		} else if (arg === "--limit" && i + 1 < rest.length) {
			const n = parseInt(rest[i + 1], 10);
			if (!isNaN(n) && n >= 0) {
				options.limit = n;
			}
			i++;
		}
	}

	return options;
}

/**
 * Run the idu-orchestrator-advisory CLI command.
 */
export function runIdOrchestratorAdvisoryCommand(
	rest: string[],
	runtime: CliRuntime,
): string {
	const options = parseOrchestratorAdvisoryArgs(rest);
	const advisories = runtime.getOrchestratorAdvisory(options);
	return runtime.formatOrchestratorAdvisory(advisories);
}

/**
 * Run the idu-role-engine-status CLI command.
 */
export function runIdRoleEngineStatusCommand(
	_rest: string[],
	runtime: CliRuntime,
): string {
	const report = runtime.getRoleEngineStatus();
	return runtime.formatRoleEngineStatus(report);
}

export function runIdRoleEngineCommand(
	rest: string[],
	runtime: CliRuntime,
): string {
	const action = rest[0];
	if (action === "status" || action === undefined) {
		return runIdRoleEngineStatusCommand(rest.slice(1), runtime);
	}
	if (action !== "enable" && action !== "disable") {
		return "Usage: idu-role-engine enable|disable|status [--role <roleId>]";
	}

	const roleId = parseRoleArg(rest.slice(1));
	if (roleId === "invalid") {
		return `Invalid role id. Valid roles: ${Object.keys(DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled).join(", ")}`;
	}

	const enabled = action === "enable";
	const patch: RoleEngineConfigPatch = roleId
		? { roleEnabled: { [roleId]: enabled } }
		: { enabled };
	const result = runtime.saveRoleEngineConfig
		? runtime.saveRoleEngineConfig(patch)
		: saveRoleEngineConfig(runtime.workspaceRoot, patch);
	const binding = runtime.rebindRoleEngine?.();

	return [
		formatRoleEngineConfigResult({
			path: `${runtime.workspaceRoot}/role-engine.json`,
			state: result,
			previous: null,
			changed: true,
		}),
		...(binding
			? [
					"",
					`binding: ${binding.enabled ? "enabled" : "disabled"} (${binding.subscriptionCount} subscriptions)`,
				]
			: []),
	].join("\n");
}

function parseRoleArg(args: string[]): IduModelRoleId | "invalid" | undefined {
	const index = args.indexOf("--role");
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (!value) return "invalid";
	if (value in DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled) {
		return value as IduModelRoleId;
	}
	return "invalid";
}

/**
 * Format orchestrator advisories as a human-readable string.
 */
export function formatOrchestratorAdvisory(rows: RoleAdvisory[]): string {
	if (rows.length === 0) {
		return "No orchestrator advisories found.";
	}

	const lines: string[] = [];
	lines.push(`Found ${rows.length} advisories:`);
	lines.push("");

	for (const row of rows) {
		const ts = row.ts;
		const roleId = row.roleId;
		const priority = row.priority;
		const advisory = row.advisory;
		const evidenceRefs = row.evidenceRefs.join(", ");

		lines.push(`  ${ts} | ${roleId} | priority ${priority} | ${advisory}`);
		if (evidenceRefs) {
			lines.push(`    evidence: ${evidenceRefs}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format role engine status as a human-readable string.
 */
export function formatRoleEngineStatus(report: RoleEngineStatusReport): string {
	const lines: string[] = [];

	lines.push("Role Engine Status:");
	lines.push("");
	lines.push("Configuration:");
	lines.push(`  Enabled: ${report.config.enabled}`);
	lines.push(
		`  Max invocations per turn: ${report.config.maxRoleInvocationsPerTurn}`,
	);
	lines.push("");

	// Per-role enabled state
	lines.push("Per-role enabled:");
	for (const [roleId, enabled] of Object.entries(report.config.roleEnabled)) {
		lines.push(`  ${roleId}: ${enabled}`);
	}
	lines.push("");

	// Last fires
	if (report.lastFires.length > 0) {
		lines.push("Last fire per role:");
		for (const fire of report.lastFires) {
			lines.push(`  ${fire.roleId}: ${fire.lastFireAt}`);
		}
		lines.push("");
	}

	// Last cap warning
	if (report.lastCapWarning) {
		lines.push(`Last cap warning: ${report.lastCapWarning}`);
		lines.push("");
	}

	// Advisory stream summary
	lines.push("Advisory stream summary:");
	lines.push(
		`  Total advisories: ${report.advisoryStreamSummary.totalAdvisories}`,
	);
	if (report.advisoryStreamSummary.lastAdvisory) {
		lines.push(`  Last advisory: ${report.advisoryStreamSummary.lastAdvisory}`);
	}

	return lines.join("\n");
}
