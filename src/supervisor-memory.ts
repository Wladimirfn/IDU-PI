/**
 * supervisor-memory.ts — builds the "where did I leave off" context
 * that the supervisor receives on each wake-up.
 *
 * Two sources, one block:
 *   1. finding_status_events — what was decided and why (local, fast)
 *   2. Engram CLI — narrative between sessions (local, fast)
 *
 * Both are CODE-driven, not LLM-driven. The code queries and formats;
 * the model receives the result in the prompt. Never the pattern from
 * lab-service.ts:103 where the LLM is asked to "orqueste con Engram."
 *
 * #414 trap: each role's clone has origin pointing to a local path.
 * Engram resolves project by git remote — from inside a clone, it
 * can't find idu-pi. The CLI --project flag overrides this.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMORY_BUDGET_CHARS = 400;
const ENGRAM_TIMEOUT_MS = 5000;

/**
 * Resolve the Engram binary: PATH first, then the known install
 * location on this machine. Never hardcode the path in call sites.
 */
function resolveEngramBinary(): string | null {
	// Try PATH (where/which)
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const output = execFileSync(cmd, ["engram"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (output) {
			// Take the first match (where can return multiple).
			return output.split("\n")[0]!.trim();
		}
	} catch {
		// Not in PATH
	}

	// Try known install location
	const known =
		process.platform === "win32"
			? join(homedir(), "AppData", "Local", "engram", "bin", "engram.exe")
			: join(homedir(), ".local", "bin", "engram");
	return existsSync(known) ? known : null;
}

/**
 * Query Engram CLI for recent project memories.
 * Returns formatted text or null when Engram is unavailable.
 */
function queryEngramMemory(
	projectId: string,
	query: string,
	limit: number,
): string | null {
	const bin = resolveEngramBinary();
	if (!bin) return null;
	try {
		const output = execFileSync(
			bin,
			["search", query, "--project", projectId, "--limit", String(limit)],
			{
				encoding: "utf8",
				timeout: ENGRAM_TIMEOUT_MS,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		if (!output || output.startsWith("No memories") || output.startsWith("Found 0")) {
			return null;
		}
		return output;
	} catch {
		// Engram unavailable — proceed without narrative memory
		return null;
	}
}

/**
 * Format the first N lines of Engram output to fit the budget.
 * The raw CLI output includes IDs, timestamps, and metadata — we keep
 * titles and first line of content, drop the rest for compactness.
 */
function compactEngram(raw: string, maxChars: number): string {
	const lines = raw.split("\n");
	const compact: string[] = [];
	let used = 0;
	for (const line of lines) {
		// Keep title lines (contain #) and first content line
		const isTitle = line.includes("—") && (line.includes("#") || line.includes("["));
		const isContent = line.trim().startsWith("**") || line.trim().length > 20;
		if (!isTitle && !isContent) continue;
		if (used + line.length > maxChars) break;
		compact.push(line.trim());
		used += line.length + 1;
	}
	return compact.join("\n");
}

/**
 * Build the supervisor's "previous context" block.
 *
 * Project id is derived from the stateRoot path (the last segment,
 * per project-state.ts convention: `<workspace>/projects/<projectId>`).
 * The code extracts it — never the caller — so the wiring doesn't
 * need to know about Engram's project resolution.
 *
 * @returns compact text (~400 chars) for prompt injection, or empty
 * string when Engram is unavailable.
 */
export function buildSupervisorMemory(input: {
	stateRoot: string;
}): string {
	// Extract projectId from stateRoot path.
	// Normalize backslashes before split for Windows paths.
	const segments = input.stateRoot.replace(/\\/gu, "/").split("/").filter(Boolean);
	const projectId = segments[segments.length - 1];
	if (!projectId) return "";

	const parts: string[] = [];

	// Engram: narrative between sessions
	const engram = queryEngramMemory(
		projectId,
		"finding status decision verdict critical",
		3,
	);
	if (engram) {
		parts.push(compactEngram(engram, MEMORY_BUDGET_CHARS));
	}

	const result = parts.filter(Boolean).join("\n");
	if (result.length > MEMORY_BUDGET_CHARS) {
		return result.substring(0, MEMORY_BUDGET_CHARS - 1) + "…";
	}
	return result;
}
