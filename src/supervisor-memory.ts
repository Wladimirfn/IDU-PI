/**
 * supervisor-memory.ts — builds the "where did I leave off" context
 * that the supervisor receives on each wake-up.
 *
 * Two sources, one block, CODE-driven:
 *   1. finding_status_events — recent verdicts with reasons (local DB)
 *   2. Engram CLI — narrative between sessions (local CLI)
 *
 * Both are CODE-driven, not LLM-driven. The code queries and formats;
 * the model receives the result in the prompt. Never the pattern from
 * lab-service.ts:103 where the LLM is asked to "orqueste con Engram."
 *
 * #414 trap: each role's clone has origin pointing to a local path.
 * Engram resolves project by git remote — from inside a clone, it
 * can't find idu-pi. The CLI --project flag overrides this.
 *
 * Budget: 2000 chars. This is MODEL INPUT context (the supervisor
 * prompt), not a Telegram message. supervisor_context_pack handles
 * 10000 chars total. Asking for 3 Engram memories + 5 verdicts + an
 * open-findings summary fits comfortably in 2000 with room for all to
 * survive. The earlier 400-char budget came from a phone-reading
 * criterion — wrong budget for the wrong consumer.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMORY_BUDGET_CHARS = 2000;
const ENGRAM_TIMEOUT_MS = 5000;
const LOCAL_VERDICT_LIMIT = 5;

// ---------------------------------------------------------------------------
// Engram CLI
// ---------------------------------------------------------------------------

/**
 * Resolve the Engram binary: PATH first, then the known install
 * location on this machine. Never hardcode the path in call sites.
 */
function resolveEngramBinary(): string | null {
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const output = execFileSync(cmd, ["engram"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (output) {
			return output.split("\n")[0]!.trim();
		}
	} catch {
		// Not in PATH
	}

	const known =
		process.platform === "win32"
			? join(homedir(), "AppData", "Local", "engram", "bin", "engram.exe")
			: join(homedir(), ".local", "bin", "engram");
	return existsSync(known) ? known : null;
}

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
		return null;
	}
}

function compactEngram(raw: string, maxChars: number): string {
	const lines = raw.split("\n");
	const compact: string[] = [];
	let used = 0;
	for (const line of lines) {
		const isTitle = line.includes("—") && (line.includes("#") || line.includes("["));
		const isContent = line.trim().startsWith("**") || line.trim().length > 20;
		if (!isTitle && !isContent) continue;
		if (used + line.length > maxChars) break;
		compact.push(line.trim());
		used += line.length + 1;
	}
	return compact.join("\n");
}

// ---------------------------------------------------------------------------
// Local tables (finding_status_events, bug_findings)
// ---------------------------------------------------------------------------

/**
 * Query the last N transitions from finding_status_events. Excludes
 * births (WHERE old_status IS NOT NULL). Each row is one verdict with
 * its reason — the labeled data point #397 measures.
 *
 * Uses execFileSync like the codebase's other sqlite3 calls (see
 * lab-db.js). No dep injection for simplicity — if the DB doesn't
 * exist yet, return null (no verdicts yet).
 */
function queryRecentVerdicts(labDbPath: string): string | null {
	if (!existsSync(labDbPath)) return null;
	try {
		const output = execFileSync(
			"sqlite3",
			["-json", labDbPath,
				`SELECT finding_id, old_status, new_status, actor, substr(note, 1, 120) AS note, created_at FROM finding_status_events WHERE old_status IS NOT NULL ORDER BY created_at DESC LIMIT ${LOCAL_VERDICT_LIMIT};`,
			],
			{
				encoding: "utf8",
				timeout: 3000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		if (!output || output === "[]") return null;
		const rows = JSON.parse(output) as Array<{
			finding_id: string;
			old_status: string;
			new_status: string;
			actor: string;
			note: string;
			created_at: string;
		}>;
		return rows
			.map(
				(r) =>
					`${r.finding_id}: ${r.old_status}→${r.new_status} (${r.actor}, "${r.note}")`,
			)
			.join("\n");
	} catch {
		return null;
	}
}

/**
 * Count open findings by severity. Same exclusion as the orchestrator's
 * listOpenFindings (status NOT IN fixed/ignored/duplicate).
 */
function queryOpenFindingsSummary(labDbPath: string): string | null {
	if (!existsSync(labDbPath)) return null;
	try {
		const output = execFileSync(
			"sqlite3",
			["-json", labDbPath,
				`SELECT severity, COUNT(*) as count FROM bug_findings WHERE project_id = (SELECT project_id FROM bug_findings LIMIT 1) AND status NOT IN ('fixed','ignored','duplicate') GROUP BY severity ORDER BY severity;`,
			],
			{
				encoding: "utf8",
				timeout: 3000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		if (!output || output === "[]") return null;
		const rows = JSON.parse(output) as Array<{
			severity: string;
			count: number;
		}>;
		return rows.map((r) => `${r.count} ${r.severity}`).join(", ");
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the supervisor's "previous context" block.
 *
 * Three sections:
 *   1. Recent verdicts (from finding_status_events) — what was decided
 *   2. Open findings summary (from bug_findings) — what's still open
 *   3. Engram narrative — context between sessions
 *
 * Project id is derived from the stateRoot path (the last segment,
 * per project-state.ts convention: `<workspace>/projects/<projectId>`).
 *
 * @returns compact text (≤2000 chars) for prompt injection, or empty
 * string when both sources are empty/unavailable.
 */
export function buildSupervisorMemory(input: {
	stateRoot: string;
}): string {
	const segments = input.stateRoot.replace(/\\/gu, "/").split("/").filter(Boolean);
	const projectId = segments[segments.length - 1];
	if (!projectId) return "";

	const sections: string[] = [];
	const labDbPath = join(input.stateRoot, "lab.db");

	// Section 1: recent verdicts
	const verdicts = queryRecentVerdicts(labDbPath);
	if (verdicts) {
		sections.push(`## Recent verdicts\n${verdicts}`);
	}

	// Section 2: open findings summary
	const openSummary = queryOpenFindingsSummary(labDbPath);
	if (openSummary) {
		sections.push(`## Open findings (excluding fixed/ignored)\n${openSummary}`);
	}

	// Section 3: Engram narrative
	const engram = queryEngramMemory(
		projectId,
		"finding status decision verdict critical",
		3,
	);
	if (engram) {
		sections.push(`## Project narrative (from Engram)\n${compactEngram(engram, MEMORY_BUDGET_CHARS / 3)}`);
	}

	let result = sections.join("\n\n");
	if (result.length > MEMORY_BUDGET_CHARS) {
		result = result.substring(0, MEMORY_BUDGET_CHARS - 1) + "…";
	}
	return result;
}
