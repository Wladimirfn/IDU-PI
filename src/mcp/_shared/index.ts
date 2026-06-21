// src/mcp/_shared/index.ts
//
// Item 4 PR 1 (mcp-server god-file breakup): shared helpers that every
// cluster's handlers will import. The analog of cli.ts PR 1 (dispatch-glue
// in src/cli/dispatch-glue/index.ts).
//
// Locked contract (auditor-approved, mcp-work-discipline §1 + §3):
//   - envelope() is the universal contract. Every tool response goes
//     through it. 130 call sites in mcp-server.ts and 18 cluster
//     extractions will import it. NEVER re-define, NEVER duplicate.
//   - tool() + the 7 schema builders build the IduMcpToolDefinition
//     for the TOOLS catalog. Every cluster's handlers.ts will call
//     tool() to register its tools in catalog (analog of cli.ts's
//     optionalString etc. in dispatch-glue).
//   - The arg parsers (stringArg, booleanArg, requiredText, etc.) are
//     used in every case body. Imported, not redefined.
//
// This file is the single source of truth. mcp-server.ts re-exports
// the public surface so existing imports (mcp-server.js → IduMcpToolName,
// JsonObject, etc.) keep working without changes.

import { readPendingBlockingInjection } from "../../objective-injection.js";

// =====================================================================
// Types
// =====================================================================

export type JsonObject = Record<string, unknown>;

export type IduMcpToolName =
	| "idu_project_status"
	| "idu_project_enroll"
	| "idu_project_reset_state"
	| "idu_bootstrap_project"
	| "idu_start"
	| "idu_status"
	| "idu_objective_status"
	| "idu_activate"
	| "idu_deactivate"
	| "idu_prepare"
	| "idu_bibliotecario_init"
	| "idu_model_invocation_status"
	| "idu_skill_rating"
	| "idu_supervisor_trigger"
	| "idu_trigger_engine"
	| "idu_role_engine_control"
	| "idu_role_engine_status"
	| "idu_master_plan_status"
	| "idu_master_plan_create"
	| "idu_master_plan_review"
	| "idu_master_plan_approve"
	| "idu_master_plan_reject"
	| "idu_plan_snapshot"
	| "idu_next_advisory_action"
	| "idu_continuation_proposal"
	| "idu_task_package_create"
	| "idu_supervisor_context_pack"
	| "idu_orchestrator_procedure"
	| "idu_task_context"
	| "idu_preflight"
	| "idu_advisory"
	| "idu_postflight"
	| "idu_supervisor_tick"
	| "idu_supervisor_cron_plan"
	| "idu_supervisor_consult"
	| "idu_execution_director_tick"
	| "idu_proposal_outbox"
	| "idu_proposal_detail"
	| "idu_autonomous_alerts_status"
	| "idu_autonomous_alerts_tick"
	| "idu_autonomous_alerts_control"
	| "idu_supervisor_self_maintenance_advisory"
	| "idu_birth_status"
	| "idu_birth_existing_scan"
	| "idu_birth_bibliotecario_discovery"
	| "idu_birth_prototype_master"
	| "idu_birth_general_spec"
	| "idu_birth_general_spec_derive"
	| "idu_genesis_mission_draft"
	| "idu_genesis_mission_confirm"
	| "idu_skill_for_task"
	| "idu_birth_validate"
	| "idu_birth_repo_plan"
	| "idu_pending_injections"
	| "idu_hygiene_migrate"
	| "idu_hygiene_sweep"
	| "idu_ack_advisory"
	| "idu_outbox_prune"
	| "idu_subscribe_triggers"
	| "idu_architectural_pruning_plan"
	| "idu_context_pruning_advisory"
	| "idu_automaticov1_cycle"
	| "idu_bibliotecario_proactive_advisory"
	| "idu_external_intelligence_report"
	| "idu_external_source_recommend"
	| "idu_task"
	| "idu_queue_detail"
	| "idu_queue_complete"
	| "idu_semantic_audit_status"
	| "idu_source_status"
	| "idu_source_add"
	| "idu_source_remove"
	| "idu_source_read"
	| "idu_source_extract"
	| "idu_source_report"
	| "idu_source_research_report"
	| "idu_source_digest"
	| "idu_source_digest_status"
	| "idu_source_chunk_read"
	| "idu_source_recommend_for_task"
	| "idu_source_required_actions"
	| "idu_source_skill_candidates_create"
	| "idu_source_skill_candidates_review"
	| "idu_skill_draft_from_lessons"
	| "idu_source_refresh"
	| "idu_agentlab_request_create"
	| "idu_agentlab_review_run"
	| "idu_agentlab_review_status";

export type IduMcpToolResult = {
	ok: boolean;
	tool: IduMcpToolName;
	projectId: string | null;
	projectPath: string | null;
	summary: string;
	data: JsonObject;
	safeNotes: string[];
	errors: string[];
	// PISO gate (PR-A of objective-injection). When non-null, every
	// orchestrator that consumes this response sees a blocking banner.
	// The PISO is host-agnostic: it is part of the response surface,
	// not a host-specific hook.
	blocking: import("../../objective-injection.js").BlockingInjection | null;
};

export type IduMcpToolDefinition = {
	name: IduMcpToolName;
	description: string;
	inputSchema: JsonObject;
};

// =====================================================================
// Safe notes (shared constant)
// =====================================================================

const SAFE_BASE_NOTES = [
	"MCP expone Idu-pi al orquestador; no reemplaza el núcleo supervisor.",
	"No ejecuté Telegram.",
	"No hice commit ni push.",
];

// =====================================================================
// Low-level utilities (used by envelope, tool, arg parsers)
// =====================================================================

function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonObject {
	return isRecord(value) ? value : {};
}

function dedupe(items: string[]): string[] {
	return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function redactSecrets(input: string): string {
	return input
		.replace(
			/(token|secret|password|api[_-]?key)(\s*[:=]\s*)[^\s,;}]+/giu,
			"$1$2[REDACTED]",
		)
		.replace(/Bearer\s+[A-Za-z0-9._~-]+/gu, "Bearer [REDACTED]");
}

function redactObject<T>(value: T): T {
	return JSON.parse(
		JSON.stringify(value, (_key, inner) => {
			if (typeof inner === "string") return redactSecrets(inner);
			return inner as unknown;
		}),
	) as T;
}

// =====================================================================
// envelope() — the universal contract.
//
// Every tool response goes through this. It is the MCP analog of
// recordCliUsage (cli.ts PR 7b) and pisoBannerLine (cli.ts PR 7k):
// imported, never re-defined, shape byte-identical.
//
// 130 call sites in mcp-server.ts today; 18 cluster extractions will
// import this. A drift here silently breaks every orchestrator.
// =====================================================================

function envelope(input: {
	ok: boolean;
	tool: IduMcpToolName;
	projectId: string | null;
	projectPath: string | null;
	summary: string;
	data: JsonObject;
	safeNotes?: string[];
	errors?: string[];
	stateRoot?: string;
}): IduMcpToolResult {
	// PR-A.2 + PR-B: when `stateRoot` is undefined, callers fall back to
	// `runtime.workspaceRoot`. After PR-B's `resolveMcpProjectContext`
	// fix, the registered/active paths always set stateRoot, so this
	// fallback only fires in the early error path (unregistered_project).
	// In that case the gate is null, which is correct because the
	// orchestrator needs to enroll the project first.
	const stateRoot = input.stateRoot ?? "";
	const blocking = stateRoot ? readPendingBlockingInjection(stateRoot) : null;
	return {
		ok: input.ok,
		tool: input.tool,
		projectId: input.projectId,
		projectPath: input.projectPath,
		summary: redactSecrets(input.summary),
		data: redactObject(input.data),
		safeNotes: dedupe([...SAFE_BASE_NOTES, ...(input.safeNotes ?? [])]),
		errors: (input.errors ?? []).map(redactSecrets),
		blocking,
	};
}

// PR-A.2: removed the module-level envelopeCurrentStateRoot (race fix).
// The PISO gate is now threaded explicitly per envelope() call via
// input.stateRoot. See PR #138 follow-up.

// =====================================================================
// tool() + schema builders — the TOOLS catalog constructor.
//
// Each `tool("idu_X", "description", {properties})` call produces an
// IduMcpToolDefinition. The 88 tool() calls in the TOOLS array use
// these builders. After PR 1, every cluster's handlers.ts will use
// the same builders to construct its catalog entries.
// =====================================================================

function tool(
	name: IduMcpToolName,
	description: string,
	properties: JsonObject,
): IduMcpToolDefinition {
	const required = Object.entries(properties)
		.filter(([, value]) => isRecord(value) && value.__required === true)
		.map(([key]) => key);
	const cleanProperties = Object.fromEntries(
		Object.entries(properties).map(([key, value]) => {
			if (!isRecord(value)) return [key, value];
			const { __required: _ignored, ...rest } = value;
			return [key, rest];
		}),
	);
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties: cleanProperties,
			additionalProperties: false,
			...(required.length ? { required } : {}),
		},
	};
}

function optionalString(description: string): JsonObject {
	return { type: "string", description };
}

function requiredString(description: string): JsonObject {
	return { ...optionalString(description), __required: true };
}

function optionalBoolean(description: string): JsonObject {
	return { type: "boolean", description };
}

function optionalStringArray(description: string): JsonObject {
	return { type: "array", items: { type: "string" }, description };
}

function optionalObject(description: string): JsonObject {
	return { type: "object", description, additionalProperties: true };
}

function optionalEnum(description: string, values: string[]): JsonObject {
	return { type: "string", enum: values, description };
}

function requiredEnum(description: string, values: string[]): JsonObject {
	return { type: "string", enum: values, description, __required: true };
}

// =====================================================================
// Arg parsers — used by every case body to read `args.X`.
//
// Generic across all clusters. Domain-specific parsers (e.g.
// agentLabSpecialtiesArg) stay in their cluster's helpers.
// =====================================================================

function stringArg(args: JsonObject, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanArg(args: JsonObject, key: string, fallback: boolean): boolean {
	const value = args[key];
	return typeof value === "boolean" ? value : fallback;
}

function stringListArg(args: JsonObject, key: string): string[] {
	const value = args[key];
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseGeneralSpecSectionsArg(
	value: unknown,
): {
	navigation: string[];
	baseComponents: string[];
	pageStructureRules: string[];
	dataRules: string[];
	interactionRules: string[];
	motionRules: string[];
	accessibilityCriteria: string[];
	performanceCriteria: string[];
} {
	const sections = asRecord(value);
	return {
		navigation: requiredJsonStringArray(sections, "navigation"),
		baseComponents: requiredJsonStringArray(sections, "baseComponents"),
		pageStructureRules: requiredJsonStringArray(sections, "pageStructureRules"),
		dataRules: requiredJsonStringArray(sections, "dataRules"),
		interactionRules: requiredJsonStringArray(sections, "interactionRules"),
		motionRules: requiredJsonStringArray(sections, "motionRules"),
		accessibilityCriteria: requiredJsonStringArray(
			sections,
			"accessibilityCriteria",
		),
		performanceCriteria: requiredJsonStringArray(
			sections,
			"performanceCriteria",
		),
	};
}

function requiredJsonStringArray(args: JsonObject, key: string): string[] {
	const value = args[key];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`General Spec field '${key}' must be an array of strings.`);
	}
	return value as string[];
}

function positiveIntegerArg(args: JsonObject, key: string): number | undefined {
	const value = args[key];
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value.trim());
		if (Number.isInteger(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

function requiredText(args: JsonObject, key: string): string {
	const value = stringArg(args, key);
	if (!value) throw new Error(`Missing required argument: ${key}`);
	return value;
}

function requiredOneOf(
	args: JsonObject,
	key: string,
	allowedValues: string[],
): string {
	const value = requiredText(args, key);
	if (!allowedValues.includes(value)) {
		throw new Error(
			`Invalid argument ${key}: expected one of ${allowedValues.join(", ")}`,
		);
	}
	return value;
}

// =====================================================================
// Re-exports — preserve mcp-server.ts's existing public surface so
// external imports keep working without changes. After all cluster
// extractions (PRs 2-20), the public surface of mcp-server.ts will
// be reduced to the dispatch shell only (callIduMcpTool, listIduMcpTools,
// resolveMcpProjectContext, handleProjectLifecycleTool, dispatchTool).
// =====================================================================

export {
	SAFE_BASE_NOTES,
	isRecord,
	asRecord,
	dedupe,
	redactSecrets,
	redactObject,
	envelope,
	tool,
	optionalString,
	requiredString,
	optionalBoolean,
	optionalStringArray,
	optionalObject,
	optionalEnum,
	requiredEnum,
	stringArg,
	booleanArg,
	stringListArg,
	parseGeneralSpecSectionsArg,
	requiredJsonStringArray,
	positiveIntegerArg,
	requiredText,
	requiredOneOf,
};
