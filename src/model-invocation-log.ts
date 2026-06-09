import { randomUUID } from "node:crypto";
import { IDU_MODEL_ROLES } from "./model-assignments.js";

/**
 * Single source of truth for the model_invocation_log record shape.
 *
 * The router (T2.1) imports `ModelInvocationRecord` from here. The
 * repository (T1.3) imports both the type and the SQL composers.
 * Tests import the same shape.
 */
export type ModelInvocationStatus = "success" | "failure" | "skipped";

export type IduModelRoleId =
	| "supervisor-main"
	| "supervisor-semantic"
	| "supervisor-compaction"
	| "agentlab-general"
	| "agentlab-project-understanding"
	| "agentlab-security"
	| "agentlab-architecture"
	| "agentlab-database"
	| "agentlab-ui-ux"
	| "agentlab-performance"
	| "agentlab-code-quality"
	| "agentlab-docs"
	| "agentlab-librarian";

export type ModelInvocationRecord = {
	id?: string;
	ts?: string;
	role: IduModelRoleId;
	provider: string;
	model: string;
	status: ModelInvocationStatus;
	promptChars: number;
	responseChars: number;
	errorMessage?: string;
};

export const IDU_MODEL_ROLE_IDS: readonly IduModelRoleId[] = IDU_MODEL_ROLES.map(
	(role) => role.id,
) as readonly IduModelRoleId[];

export const DEFAULT_MODEL_INVOCATION_LOG_ID_PREFIX = "mil";

export function newInvocationId(): string {
	return `${DEFAULT_MODEL_INVOCATION_LOG_ID_PREFIX}-${randomUUID()}`;
}

function escapeSql(value: string): string {
	return value.replace(/'/gu, "''");
}

function quoteSql(value: string): string {
	return `'${escapeSql(value)}'`;
}

function sqlInteger(value: number, fieldName: string): string {
	if (!Number.isSafeInteger(value)) {
		throw new TypeError(`${fieldName} must be a safe integer`);
	}
	return value.toString();
}

/**
 * Pure SQL helper. Composes the `INSERT` statement used by the
 * repository. Pinned by the repository round-trip test so the schema
 * contract is regression-proof.
 */
export function insertInvocationSql(record: {
	id: string;
	ts: string;
	role: IduModelRoleId;
	provider: string;
	model: string;
	status: ModelInvocationStatus;
	promptChars: number;
	responseChars: number;
	errorMessage?: string | null;
}): string {
	return `
INSERT INTO model_invocation_log (
  id, ts, role, provider, model, status, prompt_chars, response_chars, error_message
) VALUES (
  ${quoteSql(record.id)},
  ${quoteSql(record.ts)},
  ${quoteSql(record.role)},
  ${quoteSql(record.provider)},
  ${quoteSql(record.model)},
  ${quoteSql(record.status)},
  ${sqlInteger(record.promptChars, "promptChars")},
  ${sqlInteger(record.responseChars, "responseChars")},
  ${record.errorMessage == null ? "NULL" : quoteSql(record.errorMessage)}
);`;
}

export function selectInvocationSql(
	limit: number,
	role?: IduModelRoleId,
): string {
	const safeLimit = Math.max(0, Math.floor(limit));
	const where = role ? ` WHERE role = ${quoteSql(role)}` : "";
	return `SELECT id, ts, role, provider, model, status, prompt_chars, response_chars, COALESCE(error_message, '') AS error_message FROM model_invocation_log${where} ORDER BY ts DESC LIMIT ${safeLimit};`;
}

export type NormalizedInvocationRecord = {
	id: string;
	ts: string;
	role: IduModelRoleId;
	provider: string;
	model: string;
	status: ModelInvocationStatus;
	promptChars: number;
	responseChars: number;
	errorMessage: string | null;
};

/**
 * Pure normalizer. Validates required fields, generates `id`/`ts` if
 * absent, caps `errorMessage` at 4 KiB. No I/O.
 */
export function normalizeInvocationRecord(
	record: ModelInvocationRecord,
): NormalizedInvocationRecord {
	if (!record.role) throw new Error("role is required");
	if (!record.provider) throw new Error("provider is required");
	if (!record.model) throw new Error("model is required");
	if (!record.status) throw new Error("status is required");
	if (!Number.isSafeInteger(record.promptChars) || record.promptChars < 0) {
		throw new RangeError("promptChars must be a non-negative safe integer");
	}
	if (!Number.isSafeInteger(record.responseChars) || record.responseChars < 0) {
		throw new RangeError("responseChars must be a non-negative safe integer");
	}
	return {
		id: record.id ?? newInvocationId(),
		ts: record.ts ?? new Date().toISOString(),
		role: record.role,
		provider: record.provider,
		model: record.model,
		status: record.status,
		promptChars: record.promptChars,
		responseChars: record.responseChars,
		errorMessage: record.errorMessage?.slice(0, 4096) ?? null,
	};
}

export function isValidModelInvocationStatus(
	value: string,
): value is ModelInvocationStatus {
	return value === "success" || value === "failure" || value === "skipped";
}
