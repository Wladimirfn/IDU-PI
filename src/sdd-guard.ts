import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface SddGuardCheckResult {
	blocked: boolean;
	reason?: string;
	change?: string;
	workUnit?: string;
}

export function checkActiveSddAttempt(workingDir: string, taskPrompt?: string): SddGuardCheckResult {
	// 1. Explicit task prompt heuristics for SDD implementation / Work Units
	if (taskPrompt) {
		const sddPattern = /\b(?:sdd-attempt acquire|sdd-apply|Work Unit:\s*["']?([^"'\n]+)["']?|WU\d+|implement(?:ing)?\s+(?:WU\d+|work unit))\b/i;
		const match = taskPrompt.match(sddPattern);
		if (match) {
			return {
				blocked: true,
				reason: `Task explicitly targets SDD implementation / Work Unit ("${match[0]}").`,
				workUnit: match[1] || match[0],
			};
		}
	}

	// 2. Active SDD attempt on disk via openspec/changes
	const openspecChangesDir = join(workingDir, "openspec", "changes");
	if (!existsSync(openspecChangesDir)) {
		return { blocked: false };
	}

	try {
		const entries = readdirSync(openspecChangesDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);

		let candidateChanges = entries;
		if (taskPrompt) {
			const mentioned = entries.filter((c) => taskPrompt.includes(c));
			if (mentioned.length > 0) {
				candidateChanges = mentioned;
			}
		}

		for (const change of candidateChanges) {
			try {
				const stdout = execFileSync("gentle-ai", ["sdd-attempt", "status", "--cwd", workingDir, "--change", change], {
					encoding: "utf8",
					timeout: 2000,
					stdio: ["ignore", "pipe", "ignore"],
				});
				const status = JSON.parse(stdout);
				if (status.active_attempt && status.active_attempt.outcome === "running") {
					return {
						blocked: true,
						change,
						workUnit: status.active_attempt.work_unit || `ordinal ${status.active_attempt.ordinal}`,
						reason: `Active SDD attempt is currently running for change "${change}" (Work Unit: "${status.active_attempt.work_unit || status.active_attempt.ordinal}").`,
					};
				}
			} catch {
				// gentle-ai not installed or call failed, continue
			}
		}
	} catch {
		// best effort
	}

	return { blocked: false };
}
