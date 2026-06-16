/**
 * sensor-impulses.ts — run sensor impulses for a set of changed files.
 *
 * For each changed file that matches a sensor pattern, this module:
 *   1. Reads the file content (truncated to 4000 chars to respect token budgets)
 *   2. Builds a context-rich question
 *   3. Calls \`consultSupervisor\` to fire an AgentLab role impulse
 *   4. Returns the results as a list of {match, consult, fileContent}
 *
 * This is the "wiring" half of the sensor architecture: postflight
 * (or any other entry point) calls this with the changedFiles list,
 * and the function emits one impulse per matching sensor.
 *
 * Per-role cooldowns and token budgets are enforced by the rail
 * (consultSupervisor handles them). Failures (role not enabled,
 * cooldown active, model error) are recorded per-impulse so the
 * caller can see exactly which sensors fired and which didn't.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consultSupervisor, type ConsultResult, type PromptForRoleOptions } from "./supervisor-consult.js";
import { matchSensors, type SensorMatch } from "./sensors.js";
import type { PromptForRoleResult } from "./agent-router.js";
import type { IduModelRoleId } from "./model-assignments.js";

const MAX_FILE_CONTENT_CHARS = 4_000;

export type SensorImpulseInput = {
	stateRoot: string;
	projectRoot: string;
	changedFiles: readonly string[];
	promptForRole: (
		role: IduModelRoleId,
		message: string,
		options: PromptForRoleOptions,
	) => Promise<PromptForRoleResult>;
};

export type SensorImpulseResult = {
	match: SensorMatch;
	consult: ConsultResult;
	fileContent: string | undefined;
};

function readFileCapped(path: string): string | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const raw = readFileSync(path, "utf8");
		return raw.length > MAX_FILE_CONTENT_CHARS
			? `${raw.slice(0, MAX_FILE_CONTENT_CHARS)}\n\n[... truncated at ${MAX_FILE_CONTENT_CHARS} chars ...]`
			: raw;
	} catch {
		return undefined;
	}
}

export async function runSensorImpulses(
	input: SensorImpulseInput,
): Promise<SensorImpulseResult[]> {
	const matches = matchSensors(input.changedFiles);
	const out: SensorImpulseResult[] = [];
	for (const match of matches) {
		const filePath = join(input.projectRoot, match.file);
		const fileContent = readFileCapped(filePath);
		const question = `Audit this change: ${match.file} (${match.description})`;
		const context = fileContent
			? `File: ${match.file}\n\nContent (truncated to ${MAX_FILE_CONTENT_CHARS} chars):\n\`\`\`\n${fileContent}\n\`\`\``
			: `File: ${match.file} (content unavailable)`;
		const consult = await consultSupervisor({
			stateRoot: input.stateRoot,
			role: match.role,
			question,
			context,
			promptForRole: input.promptForRole,
		});
		out.push({ match, consult, fileContent });
	}
	return out;
}
