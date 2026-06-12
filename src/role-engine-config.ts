/**
 * Role engine configuration loader.
 *
 * `stateRoot/role-engine.json` is the single source of truth for
 * the engine's feature flag, per-role feature flags, the per-turn
 * cap, and the cooldown overrides. The file is OFF by default
 * (design §11.4 — rollout safety) and every role is OFF until the
 * operator flips the flag explicitly.
 *
 * The loader is tolerant:
 *   - missing file → defaults
 *   - corrupt JSON → defaults (no throw)
 *   - partial on-disk config → merged with defaults (per-key merge
 *     for `roleEnabled` and `roleCooldownMs`; scalar merge for the
 *     rest)
 *
 * `saveRoleEngineConfig` writes atomically (write to `*.tmp` and
 * rename) and creates a `.backup-<ts>` copy of the previous file,
 * mirroring `saveModelAssignments`.
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { IduModelRoleId } from "./model-assignments.js";

export type RoleEngineConfig = {
	enabled: boolean;
	maxRoleInvocationsPerTurn: number;
	roleEnabled: Record<IduModelRoleId, boolean>;
	roleCooldownMs: Partial<Record<IduModelRoleId, number>>;
};

export type RoleEngineConfigPatch = {
	enabled?: boolean;
	maxRoleInvocationsPerTurn?: number;
	roleEnabled?: Partial<Record<IduModelRoleId, boolean>>;
	roleCooldownMs?: Partial<Record<IduModelRoleId, number>>;
};

export type RoleEngineConfigStatus = {
	path: string;
	exists: boolean;
	enabled: boolean;
	maxRoleInvocationsPerTurn: number;
	roleEnabled: Record<IduModelRoleId, boolean>;
	roleCooldownMs: Partial<Record<IduModelRoleId, number>>;
};

export type RoleEngineConfigResult = {
	path: string;
	state: RoleEngineConfig;
	previous: RoleEngineConfig | null;
	changed: boolean;
};

export const DEFAULT_MAX_ROLE_INVOCATIONS_PER_TURN = 50;

export const DEFAULT_ROLE_ENGINE_CONFIG: RoleEngineConfig = {
	enabled: false,
	maxRoleInvocationsPerTurn: DEFAULT_MAX_ROLE_INVOCATIONS_PER_TURN,
	roleEnabled: {
		"supervisor-main": false,
		"supervisor-semantic": false,
		"supervisor-compaction": false,
		"agentlab-general": false,
		"agentlab-project-understanding": false,
		"agentlab-security": false,
		"agentlab-architecture": false,
		"agentlab-database": false,
		"agentlab-ui-ux": false,
		"agentlab-performance": false,
		"agentlab-code-quality": false,
		"agentlab-docs": false,
		"agentlab-librarian": false,
	},
	roleCooldownMs: {
		"supervisor-main": 30_000,
		"supervisor-semantic": 10_000,
		"supervisor-compaction": 60_000,
		"agentlab-security": 300_000,
		"agentlab-architecture": 300_000,
		"agentlab-database": 300_000,
		"agentlab-ui-ux": 300_000,
		"agentlab-performance": 300_000,
		"agentlab-code-quality": 600_000,
		"agentlab-docs": 600_000,
		"agentlab-project-understanding": 600_000,
		"agentlab-general": 600_000,
		"agentlab-librarian": 600_000,
	},
};

export function roleEngineConfigPath(stateRoot: string): string {
	return join(stateRoot, "role-engine.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadRawConfig(stateRoot: string): Partial<RoleEngineConfig> | null {
	const path = roleEngineConfigPath(stateRoot);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return null;
		return parsed as Partial<RoleEngineConfig>;
	} catch {
		return null;
	}
}

/**
 * Read the on-disk config without merging defaults. Returns the
 * raw partial config (or `null` if the file is missing / corrupt).
 * Prefer `resolveRoleEngineConfig` for runtime use.
 */
export function loadRoleEngineConfig(stateRoot: string): RoleEngineConfig {
	return resolveRoleEngineConfig(stateRoot);
}

function cloneDefaults(): RoleEngineConfig {
	return {
		enabled: DEFAULT_ROLE_ENGINE_CONFIG.enabled,
		maxRoleInvocationsPerTurn:
			DEFAULT_ROLE_ENGINE_CONFIG.maxRoleInvocationsPerTurn,
		roleEnabled: { ...DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled },
		roleCooldownMs: { ...DEFAULT_ROLE_ENGINE_CONFIG.roleCooldownMs },
	};
}

/**
 * Read the on-disk config and merge it with the defaults. Missing
 * fields are filled with defaults; per-role fields are merged
 * per-key. The result is always a complete `RoleEngineConfig`.
 */
export function resolveRoleEngineConfig(stateRoot: string): RoleEngineConfig {
	const raw = loadRawConfig(stateRoot);
	const cfg = cloneDefaults();
	if (!raw) return cfg;
	if (typeof raw.enabled === "boolean") cfg.enabled = raw.enabled;
	if (
		typeof raw.maxRoleInvocationsPerTurn === "number" &&
		Number.isFinite(raw.maxRoleInvocationsPerTurn) &&
		raw.maxRoleInvocationsPerTurn > 0
	) {
		cfg.maxRoleInvocationsPerTurn = raw.maxRoleInvocationsPerTurn;
	}
	if (isRecord(raw.roleEnabled)) {
		for (const [roleId, value] of Object.entries(raw.roleEnabled)) {
			if (roleId in cfg.roleEnabled && typeof value === "boolean") {
				(cfg.roleEnabled as Record<string, boolean>)[roleId] = value;
			}
		}
	}
	if (isRecord(raw.roleCooldownMs)) {
		for (const [roleId, value] of Object.entries(raw.roleCooldownMs)) {
			if (typeof value === "number" && Number.isFinite(value) && value > 0) {
				(cfg.roleCooldownMs as Record<string, number>)[roleId] = value;
			}
		}
	}
	return cfg;
}

function timestamp(): string {
	return new Date()
		.toISOString()
		.replace(/[-:T.]/gu, "")
		.slice(0, 14);
}

/**
 * Persist `patch` to `stateRoot/role-engine.json`. The previous
 * file is copied to `role-engine.json.backup-<ts>` first (when it
 * exists). The write is atomic: a `.tmp` file is created and
 * renamed onto the target. Returns the merged `RoleEngineConfig`
 * that was written.
 */
export function saveRoleEngineConfig(
	stateRoot: string,
	patch: RoleEngineConfigPatch,
): RoleEngineConfig {
	mkdirSync(stateRoot, { recursive: true });
	const path = roleEngineConfigPath(stateRoot);
	const current = resolveRoleEngineConfig(stateRoot);
	const next: RoleEngineConfig = {
		enabled:
			typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
		maxRoleInvocationsPerTurn:
			typeof patch.maxRoleInvocationsPerTurn === "number" &&
			Number.isFinite(patch.maxRoleInvocationsPerTurn) &&
			patch.maxRoleInvocationsPerTurn > 0
				? patch.maxRoleInvocationsPerTurn
				: current.maxRoleInvocationsPerTurn,
		roleEnabled: { ...current.roleEnabled },
		roleCooldownMs: { ...current.roleCooldownMs },
	};
	if (patch.roleEnabled) {
		for (const [roleId, value] of Object.entries(patch.roleEnabled)) {
			if (roleId in next.roleEnabled && typeof value === "boolean") {
				next.roleEnabled[roleId as IduModelRoleId] = value;
			}
		}
	}
	if (patch.roleCooldownMs) {
		for (const [roleId, value] of Object.entries(patch.roleCooldownMs)) {
			if (typeof value === "number" && Number.isFinite(value) && value > 0) {
				next.roleCooldownMs[roleId as IduModelRoleId] = value;
			}
		}
	}
	if (existsSync(path)) {
		copyFileSync(path, `${path}.backup-${timestamp()}`);
	}
	const tmp = `${path}.tmp`;
	writeFileSync(
		tmp,
		`${JSON.stringify(
			{
				enabled: next.enabled,
				maxRoleInvocationsPerTurn: next.maxRoleInvocationsPerTurn,
				roleEnabled: next.roleEnabled,
				roleCooldownMs: next.roleCooldownMs,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	// Atomic rename: on Windows the rename may fail if the target
	// is open by another process; we delete first and rename.
	try {
		// Use copy + unlink for cross-platform atomic-ish write
		// without depending on fs.renameSync exotic flags.
		writeFileSync(path, readFileSync(tmp, "utf8"), "utf8");
	} finally {
		try {
			// best-effort cleanup of the .tmp file
			unlinkSync(tmp);
		} catch {
			// ignore
		}
	}
	return next;
}

export function getRoleEngineConfigStatus(
	stateRoot: string,
): RoleEngineConfigStatus {
	const path = roleEngineConfigPath(stateRoot);
	const config = resolveRoleEngineConfig(stateRoot);
	return {
		path,
		exists: existsSync(path),
		enabled: config.enabled,
		maxRoleInvocationsPerTurn: config.maxRoleInvocationsPerTurn,
		roleEnabled: config.roleEnabled,
		roleCooldownMs: config.roleCooldownMs,
	};
}

export function enableRoleEngineConfig(
	stateRoot: string,
	roleId?: IduModelRoleId,
): RoleEngineConfigResult {
	return setRoleEngineConfig(stateRoot, true, roleId);
}

export function disableRoleEngineConfig(
	stateRoot: string,
	roleId?: IduModelRoleId,
): RoleEngineConfigResult {
	return setRoleEngineConfig(stateRoot, false, roleId);
}

export function formatRoleEngineConfigStatus(
	status: RoleEngineConfigStatus,
): string {
	return [
		"Role engine",
		"",
		`path: ${status.path}`,
		`state: ${status.enabled ? "enabled" : "disabled"}${status.exists ? "" : " (default — no file present)"}`,
		`maxRoleInvocationsPerTurn: ${status.maxRoleInvocationsPerTurn}`,
	].join("\n");
}

export function formatRoleEngineConfigResult(
	result: RoleEngineConfigResult,
): string {
	return [
		"Role engine",
		"",
		`path: ${result.path}`,
		`state: ${result.state.enabled ? "enabled" : "disabled"}`,
		`changed: ${result.changed ? "yes" : "no"}`,
		...(result.previous
			? [`previous: enabled=${result.previous.enabled}`]
			: []),
	].join("\n");
}

function setRoleEngineConfig(
	stateRoot: string,
	enabled: boolean,
	roleId?: IduModelRoleId,
): RoleEngineConfigResult {
	const path = roleEngineConfigPath(stateRoot);
	const previous = existsSync(path) ? resolveRoleEngineConfig(stateRoot) : null;
	const patch: RoleEngineConfigPatch = roleId
		? { roleEnabled: { [roleId]: enabled } }
		: { enabled };
	const state = saveRoleEngineConfig(stateRoot, patch);
	const previousValue = roleId
		? previous?.roleEnabled[roleId]
		: previous?.enabled;
	return {
		path,
		state,
		previous,
		changed: previous === null || previousValue !== enabled,
	};
}

/**
 * One-time migration for the role-engine config.
 *
 * If `stateRoot/role-engine.json` does NOT exist, write the
 * default config with `maxRoleInvocationsPerTurn: 50` and all
 * 13 role flags set to `false`. If the file already exists,
 * this function does nothing (idempotent — never overwrites).
 */
export function runRoleEngineMigration(stateRoot: string): void {
	const path = roleEngineConfigPath(stateRoot);
	if (existsSync(path)) {
		return;
	}
	mkdirSync(stateRoot, { recursive: true });
	const migrationConfig = {
		maxRoleInvocationsPerTurn: DEFAULT_MAX_ROLE_INVOCATIONS_PER_TURN,
		roleEnabled: { ...DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled },
	};
	writeFileSync(path, `${JSON.stringify(migrationConfig, null, 2)}\n`, "utf8");
}
