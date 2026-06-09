import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";
import {
	IDU_MODEL_ROLE_IDS,
	type IduModelRoleId,
	type ModelInvocationRecord,
} from "./model-invocation-log.js";

/**
 * One role group in the operator-facing status report.
 * Rows are sorted by `ts DESC` and trimmed to `limit`.
 */
export type ModelInvocationStatusGroup = {
	role: IduModelRoleId;
	totalCount: number;
	returnedCount: number;
	truncated: boolean;
	invocations: ModelInvocationRecord[];
};

export type ModelInvocationStatusReport = {
	generatedAt: string;
	projectId: string;
	stateRoot: string;
	labDbPath: string;
	filter?: { role: IduModelRoleId };
	limit: number;
	totalInvocations: number;
	roleCount: number;
	groups: ModelInvocationStatusGroup[];
};

export const DEFAULT_MODEL_INVOCATION_STATUS_LIMIT = 50;
const ERROR_MESSAGE_MAX = 80;
const ERROR_MESSAGE_TRUNCATION = "…";

export type BuildModelInvocationStatusOptions = {
	role?: string;
	limit?: number;
};

function isValidIduModelRoleId(value: string): value is IduModelRoleId {
	return (IDU_MODEL_ROLE_IDS as readonly string[]).includes(value);
}

function parseLimit(raw: unknown, fallback: number): number {
	if (raw === undefined || raw === null || raw === "") return fallback;
	const n = Number(raw);
	if (!Number.isSafeInteger(n) || n < 0) {
		throw new Error(
			`--limit inválido: "${String(raw)}". Usá un entero no-negativo.`,
		);
	}
	return n;
}

function parseRoleFilter(raw: string | undefined): IduModelRoleId | undefined {
	if (!raw) return undefined;
	if (!isValidIduModelRoleId(raw)) {
		throw new Error(
			`--role inválido: "${raw}". Roles válidos: ${IDU_MODEL_ROLE_IDS.join(", ")}.`,
		);
	}
	return raw;
}

/**
 * Build a status report. Reads `lab.db` via the repository and groups
 * rows by role in the canonical `IDU_MODEL_ROLES` order.
 *
 * Throws only on internal errors (e.g. `lab.db` unreadable). An empty
 * lab.db is a normal "no invocations yet" report, not an error.
 */
export function buildModelInvocationStatusReport(input: {
	projectId: string;
	stateRoot: string;
	labDbPath: string;
	options?: BuildModelInvocationStatusOptions;
}): ModelInvocationStatusReport {
	const { projectId, stateRoot, labDbPath } = input;
	const limit = parseLimit(
		input.options?.limit,
		DEFAULT_MODEL_INVOCATION_STATUS_LIMIT,
	);
	const role = parseRoleFilter(input.options?.role);
	const repository = new LabDbRepository(labDbPath, {
		modelInvocationLogProjectId: projectId,
	});
	const filterRoles: IduModelRoleId[] = role ? [role] : [...IDU_MODEL_ROLE_IDS];
	const groups: ModelInvocationStatusGroup[] = [];
	let totalInvocations = 0;
	for (const filterRole of filterRoles) {
		// For the per-role page we ask the repository for `limit`
		// rows so the operator sees the most-recent page. The
		// `totalCount` is approximated by the repository's slice
		// length (the CLI does not need an exact count beyond the
		// page).
		const invocations = repository.listRecentInvocations(limit, filterRole);
		const returnedCount = invocations.length;
		const truncated = returnedCount === limit;
		groups.push({
			role: filterRole,
			totalCount: returnedCount,
			returnedCount,
			truncated,
			invocations,
		});
		totalInvocations += returnedCount;
	}
	const report: ModelInvocationStatusReport = {
		generatedAt: new Date().toISOString(),
		projectId,
		stateRoot,
		labDbPath,
		limit,
		totalInvocations,
		roleCount: groups.filter((group) => group.returnedCount > 0).length,
		groups,
		...(role ? { filter: { role } } : {}),
	};
	return report;
}

/**
 * CLI-side probe: check that the `lab.db` file is parseable.
 *
 * This is intentionally separate from the repository so the CLI can
 * produce a clean error message ("lab.db unreadable / corrupt")
 * without surfacing a raw SQLite error from the `runSql` helper. A
 * missing lab.db is **not** an error — it just means "no invocations
 * yet" (the repository will create it lazily on first write).
 */
export function probeLabDbReadable(labDbPath: string): {
	ok: boolean;
	reason?: string;
} {
	if (!existsSync(labDbPath)) return { ok: true };
	try {
		// A trivial query: PRAGMA schema_version. Returns a single
		// integer in any valid SQLite database. Throws on a corrupt
		// header.
		execFileSync("sqlite3", ["-json", labDbPath, "PRAGMA schema_version;"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason:
				error instanceof Error
					? error.message
					: `lab.db unreadable: ${labDbPath}`,
		};
	}
}

function pad(value: string, width: number, alignRight = true): string {
	if (value.length >= width) return value;
	const fill = " ".repeat(width - value.length);
	return alignRight ? `${fill}${value}` : `${value}${fill}`;
}

function truncateError(message: string | undefined): string | undefined {
	if (!message) return undefined;
	if (message.length <= ERROR_MESSAGE_MAX) return message;
	return `${message.slice(0, ERROR_MESSAGE_MAX - 1)}${ERROR_MESSAGE_TRUNCATION}`;
}

function formatInvocationRow(invocation: ModelInvocationRecord): string {
	const ts = invocation.ts;
	const status = invocation.status;
	const providerModel = `${invocation.provider}/${invocation.model}`;
	if (status === "failure") {
		const err = truncateError(invocation.errorMessage) ?? "(no error message)";
		return `  ${ts}  ${pad(status, 8)}  ${pad(providerModel, 38, false)}  in=${pad(
			String(invocation.promptChars),
			6,
		)}  err="${err}"`;
	}
	return `  ${ts}  ${pad(status, 8)}  ${pad(providerModel, 38, false)}  in=${pad(
		String(invocation.promptChars),
		6,
	)}  out=${pad(String(invocation.responseChars), 6)}`;
}

/**
 * Operator-facing formatter. Per-role group with a "▸" prefix; per-row
 * columns: `ts, status, provider/model, in=…, out=…` (or
 * `err="…"` on failure rows).
 */
export function formatModelInvocationStatus(
	report: ModelInvocationStatusReport,
): string {
	const lines: string[] = [];
	const filterLabel = report.filter ? ` — role=${report.filter.role}` : "";
	lines.push(`Model Invocation Status — last ${report.limit}${filterLabel}`);
	lines.push(
		`Project: ${report.projectId} · StateRoot: ${report.stateRoot} · lab.db: ${report.labDbPath}`,
	);
	lines.push(`Generated at: ${report.generatedAt}`);
	lines.push("");
	if (report.totalInvocations === 0) {
		lines.push("no invocations yet");
		lines.push("");
		lines.push(
			`Total: 0 invocations across 0 roles. (filter: ${report.filter?.role ?? "all"}, limit: ${report.limit})`,
		);
		return lines.join("\n");
	}
	for (const group of report.groups) {
		if (group.returnedCount === 0) continue;
		const truncationLabel = group.truncated
			? ` (showing last ${group.returnedCount}, more may exist)`
			: "";
		lines.push(
			`▸ ${group.role} (${group.returnedCount} invocation${group.returnedCount === 1 ? "" : "s"}${truncationLabel})`,
		);
		for (const invocation of group.invocations) {
			lines.push(formatInvocationRow(invocation));
		}
		lines.push("");
	}
	lines.push(
		`Total: ${report.totalInvocations} invocations across ${report.roleCount} role${report.roleCount === 1 ? "" : "s"}.`,
	);
	return lines.join("\n");
}

/**
 * Probe-then-build helper. Returns either the report or a structured
 * error suitable for the CLI to fail with.
 */
export type BuildModelInvocationStatusResult =
	| { ok: true; report: ModelInvocationStatusReport }
	| { ok: false; error: string };

export function buildModelInvocationStatusOrError(input: {
	projectId: string;
	stateRoot: string;
	labDbPath: string;
	options?: BuildModelInvocationStatusOptions;
}): BuildModelInvocationStatusResult {
	const probe = probeLabDbReadable(input.labDbPath);
	if (!probe.ok) {
		return {
			ok: false,
			error: `lab.db unreadable o corrupto: ${input.labDbPath} (${probe.reason ?? "unknown error"}). Reparar o borrar el archivo para regenerarlo.`,
		};
	}
	try {
		const report = buildModelInvocationStatusReport(input);
		return { ok: true, report };
	} catch (error) {
		return {
			ok: false,
			error: `Error al leer lab.db (${input.labDbPath}): ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

export function resolveStateRootForLabDb(labDbPath: string): string {
	return dirname(labDbPath);
}

/**
 * Parse the positional/flag args accepted by `idu-model-invocation-status`.
 *
 * Accepted:
 *   --role <id>     filter by role (must be a valid IduModelRoleId)
 *   --limit <n>     limit rows per role (default 50)
 *
 * Unknown flags throw so the CLI surfaces a clear error.
 */
export function parseModelInvocationStatusArgs(
	rawArgs: readonly string[],
): BuildModelInvocationStatusOptions {
	const args = [...rawArgs];
	let role: string | undefined;
	let limit: number | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--role") {
			const value = args[i + 1];
			if (typeof value !== "string" || value.length === 0) {
				throw new Error("--role requiere un valor");
			}
			role = value;
			i++;
			continue;
		}
		if (arg === "--limit") {
			const value = args[i + 1];
			const parsed = Number.parseInt(value ?? "", 10);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				throw new Error(`--limit inválido: "${value}"`);
			}
			limit = parsed;
			i++;
			continue;
		}
		throw new Error(
			`Flag desconocido para idu-model-invocation-status: ${arg}`,
		);
	}
	const out: BuildModelInvocationStatusOptions = {};
	if (role !== undefined) out.role = role;
	if (limit !== undefined) out.limit = limit;
	return out;
}
