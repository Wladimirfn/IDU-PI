/**
 * sensor-impulses.ts — run sensor impulses for a set of changed files.
 *
 * For each changed file that matches a sensor pattern, this module:
 *   1. Reads the file content (truncated to 4000 chars to respect token budgets)
 *   2. Builds a context-rich question
 *   3. Calls `consultSupervisor` to fire an AgentLab role impulse
 *   4. Returns the results as a list of {match, consult, fileContent}
 *
 * This is the "wiring" half of the sensor architecture: postflight
 * (or any other entry point) calls this with the changedFiles list,
 * and the function emits one impulse per matching sensor.
 *
 * Selection model (owner-approved revision of the C6+E1 slice):
 *   - Per-role depth cap (MAX_PER_ROLE_DEPTH = 2). A role is never silenced
 *     just because another role has many matches. The prior global cap-of-6
 *     ordered by sensor priority silently dropped entire roles when one role
 *     had >=6 matches (e.g. 6+ code-quality tests left security at zero with
 *     all metrics green).
 *   - Round-robin flatten across roles in SENSORS declared order: pass 1 takes
 *     each role's 1st surviving match, pass 2 takes each role's 2nd, etc. This
 *     is both selection AND execution order.
 *   - Safety ceiling MAX_SENSOR_CALLS_SAFETY = 24 (non-binding today: 7 roles
 *     x 2 = 14). Exists only in case new sensors are added.
 *   - Every drop (depth or ceiling) is tracked per-file/per-role in `discards`
 *     and surfaced loudly on the run result so cron/MCP can echo it. No silent
 *     drops — the prior bug was invisibility.
 *
 * Finding routing:
 *   - Each finding is routed by its own `controlPillars` (primary): the FIRST
 *     pillar with a 1:1 bucket map wins. If none map (only reporting/learning,
 *     or empty), fall back to the sensor role's specialty.
 *
 * Report identity:
 *   - Deterministic (replaces crypto.randomUUID): identical content for the
 *     same file/role across ticks yields the same id/requestId, mirroring how
 *     computeFindingDedupeKey (src/agentlab-review-runner.ts) makes repeat
 *     findings collapse to a noop.
 *
 * Per-role cooldowns and token budgets are enforced by the rail
 * (consultSupervisor handles them). Failures (role not enabled,
 * cooldown active, model error) are recorded per-impulse so the
 * caller can see exactly which sensors fired and which didn't.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consultSupervisor, type ConsultResult, type PromptForRoleOptions } from "./supervisor-consult.js";
import { matchSensors, SENSORS, type SensorMatch } from "./sensors.js";
import type { PromptForRoleResult } from "./agent-router.js";
import type { IduModelRoleId } from "./model-assignments.js";
import {
	validateAgentLabReviewReport,
	type AgentLabFinding,
	type AgentLabReviewReport,
	type AgentLabSpecialty,
} from "./agentlab-supervisor-contract.js";

const MAX_FILE_CONTENT_CHARS = 4_000;
/** Per-role depth cap: each role keeps at most this many matches. */
const MAX_PER_ROLE_DEPTH = 2;
/** Safety ceiling on total selected matches. Non-binding today (7 roles x 2 = 14). */
const MAX_SENSOR_CALLS_SAFETY = 24;
const MAX_SENSOR_RESPONSE_CHARS = 16_000;

export type SensorImpulseInput = {
	stateRoot: string;
	projectId: string;
	projectRoot: string;
	changedFiles: readonly string[];
	promptForRole: (
		role: IduModelRoleId,
		message: string,
		options: PromptForRoleOptions,
	) => Promise<PromptForRoleResult>;
};

export const SENSOR_ROLE_SPECIALTIES = {
	"agentlab-code-quality": "code_quality",
	"agentlab-ui-ux": "ui_ux",
	"agentlab-security": "security",
	"agentlab-database": "database",
	"agentlab-general": "general",
	"agentlab-docs": "docs",
	"agentlab-architecture": "architecture",
} as const satisfies Partial<Record<IduModelRoleId, AgentLabSpecialty>>;

export function agentLabSpecialtyForSensorRole(
	role: IduModelRoleId,
): AgentLabSpecialty | undefined {
	return isSensorRole(role) ? SENSOR_ROLE_SPECIALTIES[role] : undefined;
}

function isSensorRole(
	role: IduModelRoleId,
): role is keyof typeof SENSOR_ROLE_SPECIALTIES {
	return Object.hasOwn(SENSOR_ROLE_SPECIALTIES, role);
}

/**
 * SENSORS declared role priority order (first occurrence wins). Drives the
 * round-robin flatten so selection AND execution order follow the sensor
 * declaration order in src/sensors.ts.
 */
const SENSOR_ROLE_PRIORITY: readonly IduModelRoleId[] = (() => {
	const seen = new Set<IduModelRoleId>();
	const out: IduModelRoleId[] = [];
	for (const sensor of SENSORS) {
		if (!seen.has(sensor.role)) {
			seen.add(sensor.role);
			out.push(sensor.role);
		}
	}
	return out;
})();

export type SensorDiscard = {
	file: string;
	role: IduModelRoleId;
	reason: "depth_cap" | "safety_ceiling";
};

export type SensorSelectionOptions = {
	maxPerRoleDepth?: number;
	maxSafetyCeiling?: number;
};

export type SensorSelection = {
	selected: SensorMatch[];
	discards: SensorDiscard[];
};

export type SensorImpulseReview =
	| {
		status: "valid";
		report: AgentLabReviewReport;
		findingsCount: number;
	}
	| {
		status: "invalid";
		report: undefined;
		findingsCount: 0;
		reason: string;
	};

export type SensorImpulseResult = {
	match: SensorMatch;
	consult: ConsultResult;
	fileContent: string | undefined;
	review: SensorImpulseReview;
};

export type SensorImpulseCallMeasurement = {
	file: string;
	role: IduModelRoleId;
	validJson: boolean;
	validatedReport: boolean;
	findingsCount: number;
};

export type SensorImpulseMetrics = {
	totalMatches: number;
	selectedMatches: number;
	/** Total discards (depth cap + safety ceiling). Kept for back-compat. */
	cappedOutMatches: number;
	/** Matches dropped because a role exceeded MAX_PER_ROLE_DEPTH. */
	discardedByDepth: number;
	/** Matches dropped because the total exceeded MAX_SENSOR_CALLS_SAFETY. */
	discardedBySafetyCeiling: number;
	completedCalls: number;
	jsonValidCalls: number;
	reportValidCalls: number;
	/**
	 * Total validated findings across all impulses (the sum of every valid
	 * report's 6 finding buckets). Lets a live tick report how much signal
	 * actually crossed the contract gate.
	 */
	totalValidatedFindings: number;
	/**
	 * Findings whose controlPillars included at least one 1:1-mappable pillar
	 * (quality/safety/architecture_consistency/token_cost/time/resources), so
	 * routing landed on the primary pillar path. Mirrors bucketForFinding's
	 * pillar-first decision.
	 */
	findingsRoutedByPillar: number;
	/**
	 * Findings whose controlPillars were only reporting/learning (or empty),
	 * so the specialty fallback path fired. Reconciles with
	 * findingsRoutedByPillar: total == pillar + fallback.
	 */
	findingsRoutedByFallback: number;
	/** Per-file/per-role discard records so advisory can echo them loudly. */
	discards: SensorDiscard[];
	perCall: SensorImpulseCallMeasurement[];
};

export type SensorImpulseRunResult = {
	impulses: SensorImpulseResult[];
	metrics: SensorImpulseMetrics;
	/**
	 * Loud discard surface (same array reference as metrics.discards). Present
	 * at the top level so cron/MCP output can echo "X files discarded" without
	 * digging into metrics.
	 */
	discards: SensorDiscard[];
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
): Promise<SensorImpulseRunResult> {
	const matches = matchSensors(input.changedFiles);
	const { selected: selectedMatches, discards } = selectSensorMatches(matches);
	const out: SensorImpulseResult[] = [];
	for (const match of selectedMatches) {
		const filePath = join(input.projectRoot, match.file);
		const fileContent = readFileCapped(filePath);
		const question = [
			`Audit this change: ${match.file} (${match.description}).`,
			"Return ONLY a JSON array of AgentLabFinding objects. Do not return a report envelope, markdown, prose, or code fences.",
			"Every finding must contain title, description, evidence, severity (info|low|medium|high|critical), confidence (low|medium|high), category, affectedFiles, affectedFlows, relatedRules, and controlPillars (quality|time|token_cost|safety|reporting|resources|architecture_consistency|learning).",
		].join(" ");
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
		out.push({
			match,
			consult,
			fileContent,
			review: buildSensorImpulseReview(input.projectId, match, consult),
		});
	}
	return {
		impulses: out,
		metrics: measureSensorImpulses(matches.length, selectedMatches.length, out, discards),
		discards,
	};
}

/**
 * Select sensor matches using round-robin per role with a depth cap.
 *
 * 1. Group matches by role. Within each role, sort by normalized file path
 *    (NFC, lowercase, backslash -> forward) for stability, then keep the first
 *    `maxPerRoleDepth`. The rest are `discardedByDepth`.
 * 2. Flatten in round-robin order across roles (SENSORS declared order): pass
 *    1 takes each role's 1st surviving match, pass 2 the 2nd, etc.
 * 3. Safety ceiling: if the total exceeds `maxSafetyCeiling`, drop the
 *    lowest-priority excess (the tail of the round-robin order) and mark it
 *    `discardedBySafetyCeiling`.
 */
export function selectSensorMatches(
	matches: readonly SensorMatch[],
	options?: SensorSelectionOptions,
): SensorSelection {
	const maxPerRoleDepth = options?.maxPerRoleDepth ?? MAX_PER_ROLE_DEPTH;
	const maxSafetyCeiling = options?.maxSafetyCeiling ?? MAX_SENSOR_CALLS_SAFETY;
	const discards: SensorDiscard[] = [];

	const grouped = new Map<IduModelRoleId, SensorMatch[]>();
	for (const role of SENSOR_ROLE_PRIORITY) grouped.set(role, []);
	for (const match of matches) {
		const list = grouped.get(match.role);
		if (list) {
			list.push(match);
		} else {
			grouped.set(match.role, [match]);
		}
	}

	const survivingByRole = new Map<IduModelRoleId, SensorMatch[]>();
	for (const [role, list] of grouped) {
		const sorted = [...list].sort((left, right) =>
			compareLexically(normalizedFilePath(left.file), normalizedFilePath(right.file)),
		);
		survivingByRole.set(role, sorted.slice(0, maxPerRoleDepth));
		for (const dropped of sorted.slice(maxPerRoleDepth)) {
			discards.push({ file: dropped.file, role, reason: "depth_cap" });
		}
	}

	const roleOrder = [...survivingByRole.keys()];
	const selected: SensorMatch[] = [];
	for (let depth = 0; ; depth += 1) {
		let addedAny = false;
		for (const role of roleOrder) {
			const match = (survivingByRole.get(role) ?? [])[depth];
			if (match) {
				selected.push(match);
				addedAny = true;
			}
		}
		if (!addedAny) break;
	}

	if (selected.length > maxSafetyCeiling) {
		const excess = selected.splice(maxSafetyCeiling);
		for (const match of excess) {
			discards.push({ file: match.file, role: match.role, reason: "safety_ceiling" });
		}
	}

	return { selected, discards };
}

function normalizedFilePath(file: string): string {
	return file.replaceAll("\\", "/").normalize("NFC").toLowerCase();
}

function compareLexically(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

// ---------------------------------------------------------------------------
// Finding routing: by controlPillars (primary), specialty (fallback)
// ---------------------------------------------------------------------------

type FindingBucketKey =
	| "qualityFindings"
	| "safetyFindings"
	| "architectureFindings"
	| "tokenCostFindings"
	| "timeFindings"
	| "resourceFindings";

/**
 * Pillar -> bucket map. 6 of 8 SupervisorControlPillars map 1:1.
 * `reporting` and `learning` have NO 1:1 map and fall through to specialty.
 */
function pillarToBucket(pillar: string): FindingBucketKey | undefined {
	switch (pillar) {
		case "quality":
			return "qualityFindings";
		case "safety":
			return "safetyFindings";
		case "architecture_consistency":
			return "architectureFindings";
		case "token_cost":
			return "tokenCostFindings";
		case "time":
			return "timeFindings";
		case "resources":
			return "resourceFindings";
		default:
			return undefined;
	}
}

/**
 * The 6 control pillars that map 1:1 to a finding bucket (see pillarToBucket).
 * `reporting` and `learning` are intentionally absent: they have no 1:1 map and
 * fall through to the specialty fallback. Used by the routing metric to count
 * primary-path vs specialty-fallback findings. MUST stay in sync with
 * pillarToBucket's cases.
 */
const MAPPABLE_CONTROL_PILLARS: ReadonlySet<string> = new Set([
	"quality",
	"safety",
	"architecture_consistency",
	"token_cost",
	"time",
	"resources",
]);

/**
 * Specialty fallback map (documented as correctable).
 * NOTE: `database` -> safetyFindings because data integrity/loss is treated as
 * a safety concern; `resources` is CPU/mem/disk, not schema. Correctable
 * one-liner if the owner disagrees.
 */
function specialtyToBucket(specialty: AgentLabSpecialty): FindingBucketKey {
	switch (specialty) {
		case "security":
		case "database":
			return "safetyFindings";
		case "architecture":
			return "architectureFindings";
		case "code_quality":
		case "ui_ux":
		case "docs":
		case "general":
			return "qualityFindings";
		default:
			return "qualityFindings";
	}
}

function emptyFindingBuckets(): Record<FindingBucketKey, unknown[]> {
	return {
		qualityFindings: [],
		safetyFindings: [],
		architectureFindings: [],
		tokenCostFindings: [],
		timeFindings: [],
		resourceFindings: [],
	};
}

function routeFindingsToBuckets(
	findings: unknown[],
	specialty: AgentLabSpecialty,
): Record<FindingBucketKey, unknown[]> {
	const buckets = emptyFindingBuckets();
	for (const finding of findings) {
		buckets[bucketForFinding(finding, specialty)].push(finding);
	}
	return buckets;
}

function bucketForFinding(
	finding: unknown,
	specialty: AgentLabSpecialty,
): FindingBucketKey {
	for (const pillar of readControlPillars(finding)) {
		const bucket = pillarToBucket(pillar);
		if (bucket) return bucket;
	}
	return specialtyToBucket(specialty);
}

function readControlPillars(finding: unknown): string[] {
	if (!finding || typeof finding !== "object" || Array.isArray(finding)) return [];
	const raw = (finding as Record<string, unknown>).controlPillars;
	if (!Array.isArray(raw)) return [];
	return raw.filter((pillar): pillar is string => typeof pillar === "string");
}

// ---------------------------------------------------------------------------
// Deterministic report identity
// ---------------------------------------------------------------------------

/**
 * Deterministic report identity (replaces crypto.randomUUID). Identical content
 * for the same file/role across ticks yields the same id/requestId, mirroring
 * how computeFindingDedupeKey makes repeat findings collapse to a noop.
 */
export function computeSensorReportIdentity(
	projectId: string,
	file: string,
	role: IduModelRoleId,
	response: string,
): { id: string; requestId: string } {
	const contentHash = createHash("sha256")
		.update(response.trim())
		.digest("hex")
		.slice(0, 16);
	const normalizedFile = normalizedFilePath(file);
	const suffix = `${projectId}-${role}-${normalizedFile}-${contentHash}`;
	return {
		id: `sensor-report-${suffix}`,
		requestId: `sensor-req-${suffix}`,
	};
}

function buildSensorImpulseReview(
	projectId: string,
	match: SensorMatch,
	consult: ConsultResult,
): SensorImpulseReview {
	const specialty = agentLabSpecialtyForSensorRole(match.role);
	if (!specialty) {
		return {
			status: "invalid",
			report: undefined,
			findingsCount: 0,
			reason: `No AgentLab specialty mapping for sensor role: ${match.role}`,
		};
	}

	const findings = parseSensorFindings(consult.response);
	if (!findings) {
		return {
			status: "invalid",
			report: undefined,
			findingsCount: 0,
			reason: "Invalid JSON array response",
		};
	}

	const buckets = routeFindingsToBuckets(findings, specialty);
	const { id, requestId } = computeSensorReportIdentity(
		projectId,
		match.file,
		match.role,
		consult.response,
	);
	const validation = validateAgentLabReviewReport({
		id,
		requestId,
		projectId,
		specialty,
		status: "completed",
		summary: `Sensor audit for ${match.file} returned ${findings.length} finding(s).`,
		qualityFindings: buckets.qualityFindings,
		safetyFindings: buckets.safetyFindings,
		architectureFindings: buckets.architectureFindings,
		tokenCostFindings: buckets.tokenCostFindings,
		timeFindings: buckets.timeFindings,
		resourceFindings: buckets.resourceFindings,
		testsSuggested: [],
		testsExecuted: [],
		evidence: [match.file],
		recommendations: [],
		proposedSupervisorActions: [],
		suggestedSkillUpdates: [],
		suggestedRuleUpdates: [],
		suggestedAgentTasks: [],
		confidence: "medium",
		requiresHumanApproval: true,
		createdAt: new Date().toISOString(),
	});
	if (!validation.ok) {
		return {
			status: "invalid",
			report: undefined,
			findingsCount: 0,
			reason: `Invalid AgentLab findings: ${validation.errors.join("; ")}`,
		};
	}
	return {
		status: "valid",
		report: validation.report,
		findingsCount: findings.length,
	};
}

/**
 * Flatten a validated report's 6 finding buckets into one array. Mirrors the
 * private allFindings helpers in agentlab-supervisor-contract.ts and
 * agentlab-effectiveness-events.ts, kept local so this module owns its metric.
 */
function flattenReportFindings(report: AgentLabReviewReport): AgentLabFinding[] {
	return [
		...report.qualityFindings,
		...report.safetyFindings,
		...report.architectureFindings,
		...report.tokenCostFindings,
		...report.timeFindings,
		...report.resourceFindings,
	];
}

function measureSensorImpulses(
	totalMatches: number,
	selectedMatches: number,
	impulses: SensorImpulseResult[],
	discards: SensorDiscard[],
): SensorImpulseMetrics {
	const perCall = impulses.map((impulse) => ({
		file: impulse.match.file,
		role: impulse.match.role,
		validJson: parseSensorFindings(impulse.consult.response) !== undefined,
		validatedReport: impulse.review.status === "valid",
		findingsCount: impulse.review.findingsCount,
	}));
	const discardedByDepth = discards.filter((d) => d.reason === "depth_cap").length;
	const discardedBySafetyCeiling = discards.filter(
		(d) => d.reason === "safety_ceiling",
	).length;

	// controlPillars routing metric: for each validated report, count how many
	// findings landed on the primary pillar path vs the specialty fallback.
	// This mirrors bucketForFinding's pillar-first / specialty-fallback decision
	// WITHOUT re-routing — it only reads the already-validated findings.
	let totalValidatedFindings = 0;
	let findingsRoutedByPillar = 0;
	let findingsRoutedByFallback = 0;
	for (const impulse of impulses) {
		if (impulse.review.status !== "valid") continue;
		for (const finding of flattenReportFindings(impulse.review.report)) {
			totalValidatedFindings += 1;
			if (finding.controlPillars.some((pillar) => MAPPABLE_CONTROL_PILLARS.has(pillar))) {
				findingsRoutedByPillar += 1;
			} else {
				findingsRoutedByFallback += 1;
			}
		}
	}

	return {
		totalMatches,
		selectedMatches,
		cappedOutMatches: discards.length,
		discardedByDepth,
		discardedBySafetyCeiling,
		completedCalls: impulses.length,
		jsonValidCalls: perCall.filter((measurement) => measurement.validJson).length,
		reportValidCalls: perCall.filter(
			(measurement) => measurement.validatedReport,
		).length,
		totalValidatedFindings,
		findingsRoutedByPillar,
		findingsRoutedByFallback,
		discards,
		perCall,
	};
}

function parseSensorFindings(response: string): unknown[] | undefined {
	if (response.length > MAX_SENSOR_RESPONSE_CHARS) return undefined;
	const direct = parseJsonArray(response.trim());
	if (direct) return direct;
	if (response.includes("```")) return parseFencedJsonArray(response);
	return parseBracketDelimitedJsonArray(response);
}

function parseJsonArray(value: string): unknown[] | undefined {
	if (!value || value.length > MAX_SENSOR_RESPONSE_CHARS) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function parseFencedJsonArray(response: string): unknown[] | undefined {
	const candidates = [
		...response.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/giu),
	];
	if (candidates.length !== 1) return undefined;
	return parseJsonArray(candidates[0]?.[1]?.trim() ?? "");
}

function parseBracketDelimitedJsonArray(response: string): unknown[] | undefined {
	const candidates: unknown[][] = [];
	for (let index = 0; index < response.length; index += 1) {
		if (response[index] !== "[") continue;
		const end = balancedArrayEnd(response, index);
		if (end === undefined) return undefined;
		const candidate = parseJsonArray(response.slice(index, end + 1));
		if (!candidate) return undefined;
		candidates.push(candidate);
		if (candidates.length > 1) return undefined;
		index = end;
	}
	return candidates.length === 1 ? candidates[0] : undefined;
}

function balancedArrayEnd(value: string, start: number): number | undefined {
	let depth = 0;
	let quote: '"' | "'" | undefined;
	let escaped = false;
	for (let index = start; index < value.length; index += 1) {
		const character = value[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
		} else if (character === "[") {
			depth += 1;
		} else if (character === "]") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return undefined;
}
