/**
 * supervisor-memory.ts — builds the "where did I leave off" context
 * that the supervisor receives on each wake-up.
 *
 * Three sources, CODE-driven (not LLM-driven):
 *   1. Engram CLI — narrative between sessions (bridge, first)
 *   2. finding_status_events — recent verdicts with reasons (local DB)
 *   3. bug_findings — open findings summary by severity (local DB)
 *
 * The code queries and formats; the model receives the result in the
 * prompt. Never the pattern from lab-service.ts:103 where the LLM is
 * asked to "orqueste con Engram."
 *
 * #414 trap: each role's clone has origin pointing to a local path.
 * Engram resolves project by git remote — from inside a clone, it
 * can't find idu-pi. The CLI --project flag overrides this.
 *
 * Budget: 2000 chars total. Allocation by priority (engram has the
 * floor — it's the inter-session bridge):
 *   - Engram: 800 chars floor (we cut from it before giving it less)
 *   - Verdicts: 700 chars
 *   - Open findings summary: 500 chars
 *
 * Each section is truncated independently before joining, so dropping
 * the summary doesn't truncate the verdicts. The contract: every
 * section that's included survives intact OR with a trailing ellipsis.
 *
 * Why 2000 not 400: 400 was phone-reading. This is MODEL INPUT.
 * supervisor_context_pack handles 10000 chars total. 2000 fits 3
 * Engram memories + 5 verdicts + a summary without truncating any.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MEMORY_BUDGET_CHARS = 2000;
const ENGRAM_SECTION_CHARS = 800;
const VERDICTS_SECTION_CHARS = 700;
const OPEN_FINDINGS_SECTION_CHARS = 500;
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

function defaultEngramQuery(
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
		if (
			!output ||
			output.startsWith("No memories") ||
			output.startsWith("Found 0")
		) {
			return null;
		}
		return output;
	} catch {
		return null;
	}
}

function compactEngram(raw: string): string {
	const lines = raw.split("\n");
	const compact: string[] = [];
	for (const line of lines) {
		const isTitle =
			line.includes("—") &&
			(line.includes("#") || line.includes("["));
		const isContent =
			line.trim().startsWith("**") || line.trim().length > 20;
		if (!isTitle && !isContent) continue;
		compact.push(line.trim());
	}
	return compact.join("\n");
}

// ---------------------------------------------------------------------------
// Local tables (finding_status_events, bug_findings)
// ---------------------------------------------------------------------------

/**
 * Query the last N transitions from finding_status_events for a given
 * project_id. Excludes births (WHERE old_status IS NOT NULL). Each row
 * is one verdict with its reason — the labeled data point #397
 * measures.
 *
 * Filtered by project_id via JOIN: `finding_status_events` has no
 * project_id column (only finding_id FK). The lab.db is shared
 * across the supervisor and the lab service. Without the JOIN, the
 * supervisor would see verdicts from any project.
 *
 * Uses execFileSync like the codebase's other sqlite3 calls (see
 * lab-db.js). No dep injection for simplicity — if the DB doesn't
 * exist yet, return null (no verdicts yet).
 */
function queryRecentVerdicts(labDbPath: string, projectId: string): string | null {
	if (!existsSync(labDbPath)) return null;
	const safeProjectId = projectId.replace(/'/gu, "''");
	try {
		const output = execFileSync(
			"sqlite3",
			[
				"-json",
				labDbPath,
				`SELECT e.finding_id, e.old_status, e.new_status, e.actor, substr(e.note, 1, 120) AS note, e.created_at FROM finding_status_events e JOIN bug_findings b ON b.id = e.finding_id WHERE b.project_id = '${safeProjectId}' AND e.old_status IS NOT NULL ORDER BY e.created_at DESC LIMIT ${LOCAL_VERDICT_LIMIT};`,
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
 * Count open findings by severity for a given project_id. Same
 * exclusion as the orchestrator's listOpenFindings (status NOT IN
 * fixed/ignored/duplicate).
 *
 * Filtered by project_id: same reason as queryRecentVerdicts.
 */
function queryOpenFindingsSummary(
	labDbPath: string,
	projectId: string,
): string | null {
	if (!existsSync(labDbPath)) return null;
	try {
		const output = execFileSync(
			"sqlite3",
			[
				"-json",
				labDbPath,
				`SELECT severity, COUNT(*) as count FROM bug_findings WHERE project_id = '${projectId.replace(/'/gu, "''")}' AND status NOT IN ('fixed','ignored','duplicate') GROUP BY severity ORDER BY severity;`,
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

export type EngramQueryFn = (
	projectId: string,
	query: string,
	limit: number,
) => string | null;

/**
 * Build the supervisor's "previous context" block.
 *
 * Three sections, ordered by priority for the cold-start scenario
 * (engram is the inter-session bridge — keep its floor):
 *   1. Project narrative (from Engram)
 *   2. Recent verdicts (from finding_status_events)
 *   3. Open findings summary (from bug_findings)
 *
 * @returns compact text for prompt injection, or empty string when
 * all sources are empty/unavailable. The total length never exceeds
 * MEMORY_BUDGET_CHARS; each section is truncated independently with a
 * trailing ellipsis if needed.
 */
export function buildSupervisorMemory(input: {
	stateRoot: string;
	engramFn?: EngramQueryFn;
}): string {
	const segments = input.stateRoot
		.replace(/\\/gu, "/")
		.split("/")
		.filter(Boolean);
	const projectId = segments[segments.length - 1];
	if (!projectId) return "";

	const labDbPath = join(input.stateRoot, "lab.db");
	const engramFn = input.engramFn ?? defaultEngramQuery;

	// Section 1: Engram narrative (the inter-session bridge — has floor).
	const engramRaw = engramFn(
		projectId,
		"finding status decision verdict critical",
		3,
	);
	const engram = engramRaw
		? `## Project narrative (from Engram)\n${compactEngram(engramRaw)}`
		: null;

	// Section 2: recent verdicts
	const verdictsRaw = queryRecentVerdicts(labDbPath, projectId);
	const verdicts = verdictsRaw
		? `## Recent verdicts\n${verdictsRaw}`
		: null;

	// Section 3: open findings summary
	const openSummaryRaw = queryOpenFindingsSummary(labDbPath, projectId);
	const openSummary = openSummaryRaw
		? `## Open findings (excluding fixed/ignored)\n${openSummaryRaw}`
		: null;

	return joinSupervisorMemorySections([engram, verdicts, openSummary]);
}

/**
 * Join sections in priority order, truncating each to its allocation
 * with a trailing ellipsis if it overflows. Drops sections that
 * exceed their allocation entirely. Sections that fit survive intact.
 *
 * Allocation:
 *   - section[0] (Engram): up to ENGRAM_SECTION_CHARS (800)
 *   - section[1] (verdicts): up to VERDICTS_SECTION_CHARS (700)
 *   - section[2] (open): up to OPEN_FINDINGS_SECTION_CHARS (500)
 *
 * Total budget: 2000. Sum of allocations: 2000.
 */
export function joinSupervisorMemorySections(
	sections: Array<string | null>,
): string {
	const limits = [
		ENGRAM_SECTION_CHARS,
		VERDICTS_SECTION_CHARS,
		OPEN_FINDINGS_SECTION_CHARS,
	];
	const presentIndexes = sections
		.map((section, index) => (section ? index : -1))
		.filter((index) => index >= 0);
	const kept: string[] = [];
	for (let i = 0; i < sections.length; i++) {
		const s = sections[i];
		if (!s) continue;
		const isLastPresent = i === presentIndexes[presentIndexes.length - 1];
		const separatorChars = isLastPresent ? 0 : 2;
		const limit = Math.max(0, (limits[i] ?? 0) - separatorChars);
		kept.push(truncateSectionByLines(s, limit));
	}
	return kept.join("\n\n");
}

/**
 * Keep complete entries in source order and use an ellipsis as its own line.
 * Recent verdicts arrive newest-first from SQL, so dropping tail lines drops
 * the oldest evidence first. Headers are always preserved when a section is
 * present; callers own the per-section allocation policy.
 */
function truncateSectionByLines(section: string, maxChars: number): string {
	if (section.length <= maxChars) return section;
	const [header, ...entries] = section.split("\n");
	if (!header || maxChars <= 0) return "";
	if (header.length >= maxChars) {
		return header.substring(0, Math.max(0, maxChars - 1)) + "…";
	}

	const kept = [header];
	let used = header.length;
	for (const entry of entries) {
		// Reserve one newline plus a standalone ellipsis for truncation.
		if (used + 1 + entry.length + 2 > maxChars) break;
		kept.push(entry);
		used += 1 + entry.length;
	}
	kept.push("…");
	return kept.join("\n");
}
