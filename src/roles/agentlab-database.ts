/**
 * agentlab-database role — T3.2.
 *
 * Monitors database changes: SQL files, migrations, raw SQL queries.
 * Produces data integrity advisories with migration safety assessments.
 *
 * REQ-LRV2-15: Priority 60, Cooldown 5 minutes, subscribes to
 * file_changed (sql/migrations), migration_added, raw_sql_seen.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_DATABASE_PRIORITY = 60;
const AGENTLAB_DATABASE_COOLDOWN_MS = 300_000; // 5 minutes
const AGENTLAB_DATABASE_SUBSCRIBES: readonly EventKind[] = [
	"file_changed",
	"migration_added",
	"raw_sql_seen",
];

// Database-related file patterns
const DATABASE_PATH_RE = /(\.(sql|prisma)$|migrations|\.db|schema)/i;

const MAX_INTEGRITY_RISKS = 6;

type IntegrityRisk = {
	description: string;
	table?: string;
	column?: string;
};

type MigrationSafety = "safe" | "caution" | "unsafe";

type DatabaseMeta = {
	integrityRisks: IntegrityRisk[];
	migrationSafety: MigrationSafety;
	recommendedAction?: string;
	summary: string;
};

type LLMResponse = {
	integrityRisks?: Array<{
		description?: string;
		table?: string;
		column?: string;
	}>;
	migrationSafety?: string;
	recommendedAction?: string;
	recommended_action?: string;
	summary?: string;
};

function parseLLMResponse(raw: string): {
	parsed: LLMResponse | null;
	error?: string;
} {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return { parsed: parsed as LLMResponse };
		}
		return { parsed: null, error: "Response is not an object" };
	} catch (e) {
		return { parsed: null, error: `JSON parse error: ${e}` };
	}
}

function normalizeMigrationSafety(
	safety: string | undefined,
): MigrationSafety {
	if (!safety) return "caution";
	const lower = safety.toLowerCase();
	if (lower === "safe") return "safe";
	if (lower === "unsafe") return "unsafe";
	return "caution";
}

function capArray<T>(items: T[] | undefined, max: number): T[] {
	if (!Array.isArray(items)) return [];
	return items.slice(0, max);
}

function buildAgentLabDatabasePrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the database analyst for the IDU orchestrator.",
		"Your role is to review database changes and identify data integrity risks and migration safety issues.",
		"",
	];

	const event = input.event;

	if (event.kind === "file_changed") {
		const path = event.payload.path as string;
		lines.push("Database-related file changed:");
		lines.push(`  Path: ${path}`);
		lines.push("");
		lines.push("Analyze the change for database issues:");
		lines.push("  - Schema changes (ALTER TABLE, CREATE INDEX)");
		lines.push("  - Data integrity constraints");
		lines.push("  - Foreign key relationships");
		lines.push("  - Index coverage for queries");
	} else if (event.kind === "migration_added") {
		const path = event.payload.path as string;
		lines.push("New migration added:");
		lines.push(`  Path: ${path}`);
		lines.push("");
		lines.push("Analyze the migration for safety:");
		lines.push("  - Is it reversible?");
		lines.push("  - Does it lock tables?");
		lines.push("  - Does it change column types?");
		lines.push("  - Does it drop constraints?");
	} else if (event.kind === "raw_sql_seen") {
		const query = event.payload.query as string;
		lines.push("Raw SQL query detected:");
		lines.push(`  Query: ${query}`);
		lines.push("");
		lines.push("Analyze the query for issues:");
		lines.push("  - SQL injection risks");
		lines.push("  - Missing indexes");
		lines.push("  - Performance regressions");
		lines.push("  - Data integrity violations");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "integrityRisks": [');
	lines.push("    {");
	lines.push('      "description": "<risk description>",');
	lines.push('      "table": "<table name (optional)>",');
	lines.push('      "column": "<column name (optional)>"');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "migrationSafety": "safe|caution|unsafe",');
	lines.push('  "recommendedAction": "<actionable recommendation>",');
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap integrityRisks at 6 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabDatabaseRole(): Role {
	return {
		name: "AgentLab de base de datos",
		priority: AGENTLAB_DATABASE_PRIORITY,
		cooldownMs: AGENTLAB_DATABASE_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_DATABASE_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_DATABASE_COOLDOWN_MS) {
					return false;
				}
			}

			// For file_changed events, check if path matches database patterns
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				return DATABASE_PATH_RE.test(path);
			}

			// For migration_added and raw_sql_seen, always fire (after cooldown check)
			if (
				input.event.kind === "migration_added" ||
				input.event.kind === "raw_sql_seen"
			) {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabDatabasePrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-database",
				prompt,
				{
					projectId: ctx.projectId,
					stateRoot: ctx.stateRoot,
					invocationSink: (record) => {
						ctx.repository.appendInvocation(record);
					},
				},
			);

			const { parsed, error: parseError } = parseLLMResponse(result.output);

			// Build evidence refs
			const evidenceRefs: string[] = [`events.jsonl:${input.event.ts}`];
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "migration_added") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(`migration:${path}`);
			} else if (input.event.kind === "raw_sql_seen") {
				evidenceRefs.push("raw-sql");
			}

			if (!parsed) {
				// Malformed response — fallback to empty risks with caution safety
				const meta: DatabaseMeta = {
					integrityRisks: [],
					migrationSafety: "caution",
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-database",
					priority: AGENTLAB_DATABASE_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize integrity risks
			const rawRisks = parsed.integrityRisks || [];
			const integrityRisks: IntegrityRisk[] = capArray(rawRisks, MAX_INTEGRITY_RISKS)
				.filter(
					(r) =>
						r &&
						typeof r === "object" &&
						typeof r.description === "string",
				)
				.map((r) => ({
					description: r.description || "",
					table: r.table,
					column: r.column,
				}));

			const migrationSafety = normalizeMigrationSafety(parsed.migrationSafety);
			const recommendedAction = parsed.recommendedAction || parsed.recommended_action;
			const summary = parsed.summary || "Database review completed";

			const meta: DatabaseMeta = {
				integrityRisks,
				migrationSafety,
				recommendedAction,
				summary,
			};

			const riskCount = integrityRisks.length;

			let advisoryText = summary;
			if (riskCount > 0) {
				advisoryText = `${riskCount} integrity risk${riskCount > 1 ? "s" : ""} (${migrationSafety}): ${summary}`;
			} else {
				advisoryText = `No integrity risks (${migrationSafety}): ${summary}`;
			}

			return {
				roleId: "agentlab-database",
				priority: AGENTLAB_DATABASE_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
