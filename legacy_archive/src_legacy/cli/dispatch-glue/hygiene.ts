/**
 * hygiene.ts — args parser + formatters for `idu-hygiene-migrate` and
 * `idu-hygiene-sweep` commands. Re-exported by `index.ts`.
 *
 * All 3 functions are part of the 20-function public surface.
 */

import type { MigrationResult } from "../../hygiene-migrate.js";
import type { PlanSweepResult } from "../../sweep-command.js";

/**
 * Parse `idu-hygiene-migrate` args. Supports `--repo-root <path>` (with
 * optional `=` form). Unknown flags throw so the CLI surfaces a clear
 * error rather than silently ignoring them.
 */
export function parseHygieneMigrateArgs(rawArgs: readonly string[]): {
	repoRoot?: string;
} {
	const args = [...rawArgs];
	let repoRoot: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--repo-root") {
			const value = args[i + 1];
			if (typeof value !== "string" || value.length === 0) {
				throw new Error("--repo-root requiere un valor");
			}
			repoRoot = value;
			i++;
			continue;
		}
		if (arg.startsWith("--repo-root=")) {
			const value = arg.slice("--repo-root=".length);
			if (value.length === 0) {
				throw new Error("--repo-root requiere un valor");
			}
			repoRoot = value;
			continue;
		}
		throw new Error(`Flag desconocido para idu-hygiene-migrate: ${arg}`);
	}
	return { ...(repoRoot !== undefined ? { repoRoot } : {}) };
}

/** Format a hygiene sweep result for CLI output. */
export function formatHygieneSweepResult(
	repoRoot: string,
	result: PlanSweepResult,
): string {
	const lines: string[] = [];
	lines.push("idu-pi hygiene sweep");
	lines.push("");
	lines.push(`repoRoot: ${repoRoot}`);
	lines.push(
		`Sensor snapshot: ${result.sensorSnapshot.ts} (${result.sensorSnapshot.findings.length} findings)`,
	);
	lines.push(`Revalidated at: ${result.revalidatedAt}`);
	lines.push("");
	if (result.paths.length > 0) {
		lines.push(`Paths to delete (${result.paths.length}):`);
		for (let i = 0; i < result.paths.length; i++) {
			const p = result.paths[i];
			const finding = result.sensorSnapshot.findings.find((f) => f.path === p);
			lines.push(`- ${p}${finding ? ` (matched: ${finding.pattern})` : ""}`);
		}
	} else {
		lines.push("Paths to delete: (none)");
	}
	lines.push("");
	if (result.commands.length > 0) {
		lines.push(`Suggested commands (${result.commands.length}):`);
		for (const cmd of result.commands) {
			lines.push(cmd);
		}
	}
	lines.push("");
	if (result.skipped.length > 0) {
		lines.push(`Skipped (${result.skipped.length}):`);
		for (const entry of result.skipped) {
			lines.push(`- ${entry.path} (${entry.reason})`);
		}
	} else {
		lines.push("Skipped: (none)");
	}
	lines.push("");
	lines.push("idu-pi does NOT delete. Run the suggested commands to clean up.");
	return lines.join("\n");
}

export function formatHygieneMigrateResult(
	repoRoot: string,
	result: MigrationResult,
): string {
	const lines: string[] = [];
	lines.push("idu-pi hygiene migrate");
	lines.push("");
	lines.push(`repoRoot: ${repoRoot}`);
	lines.push(`moved: ${result.moved.length}`);
	lines.push(`skipped: ${result.skipped.length}`);
	lines.push(`errors: ${result.errors.length}`);
	if (result.moved.length > 0) {
		lines.push("");
		lines.push("Files:");
		for (const entry of result.moved) {
			lines.push(`- ${entry.from} -> ${entry.to}`);
		}
	}
	if (result.skipped.length > 0) {
		lines.push("");
		lines.push("Skipped:");
		for (const entry of result.skipped) {
			lines.push(`- ${entry.from}: ${entry.reason}`);
		}
	}
	if (result.errors.length > 0) {
		lines.push("");
		lines.push("Errors:");
		for (const entry of result.errors) {
			lines.push(`- ${entry.from}: ${entry.message}`);
		}
	}
	return lines.join("\n");
}
