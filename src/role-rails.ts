/**
 * role-rails.ts — per-role token budgets, cooldowns, and self-tuning
 * (the "carriles" / rails pattern from the idu-pi impulse architecture).
 *
 * Each supervisor / AgentLab role has a `RoleRail`:
 *
 *   - **enabled**: master switch; when false, the role cannot be woken
 *   - **tokenBudget**: current per-wake text budget. Initial 800, can be
 *     reduced to `minTokenBudget` (default 100) on success streaks, or
 *     expanded to `maxTokenBudget` (default 2000) on failure streaks.
 *   - **cooldownMs**: minimum time between wakes. Configurable per role.
 *   - **emergencyTimeoutMs**: hard time cap per wake (default 10 min).
 *
 * The rail is NOT time-bound in normal operation. The orchestrator / sensor
 * invokes `getRoleRail()` to check if a wake is allowed, and the consult
 * tool respects the rail's `tokenBudget` as a soft cap by passing it in
 * the prompt. After each wake, `autoTuneRoleRail()` adjusts the budget:
 *
 *   - 3 consecutive successes → reduce budget by 15% (down to floor)
 *   - 3 consecutive failures → expand budget by 30% (up to ceiling)
 *   - 1 success resets failure streak; 1 failure resets success streak
 *
 * State: `stateRoot/role-rails.json` — atomic write (`.tmp` + rename).
 *
 * This module is the *carriles* layer of the impulse architecture. The
 * bypass in `automaticov1-cycle.ts` consults rails before allowing
 * self-repair tasks; the consult MCP tool consults rails before firing
 * a model; and the sensor→AgentLab wiring (PR-102) will consult rails
 * per role per sensor impulse.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IduModelRoleId } from "./model-assignments.js";

export type RoleRail = {
	role: IduModelRoleId;
	enabled: boolean;
	tokenBudget: number;
	minTokenBudget: number;
	maxTokenBudget: number;
	cooldownMs: number;
	cooldownRemainingMs: number;
	lastWakeAt?: string;
	wakeCount: number;
	successStreak: number;
	failureStreak: number;
	emergencyTimeoutMs: number;
};

export const DEFAULT_INITIAL_TOKEN_BUDGET = 800;
export const DEFAULT_MIN_TOKEN_BUDGET = 100;
export const DEFAULT_MAX_TOKEN_BUDGET = 2000;
export const DEFAULT_EMERGENCY_TIMEOUT_MS = 10 * 60_000; // 10 min
export const SUCCESS_STREAK_FOR_REDUCE = 3;
export const FAILURE_STREAK_FOR_EXPAND = 3;
export const TOKEN_BUDGET_REDUCE_FACTOR = 0.85;
export const TOKEN_BUDGET_EXPAND_FACTOR = 1.3;

const RAIL_FILENAME = "role-rails.json";

const KNOWN_ROLES: readonly IduModelRoleId[] = [
	"supervisor-main",
	"supervisor-semantic",
	"supervisor-compaction",
	"agentlab-general",
	"agentlab-project-understanding",
	"agentlab-security",
	"agentlab-architecture",
	"agentlab-database",
	"agentlab-ui-ux",
	"agentlab-performance",
	"agentlab-code-quality",
	"agentlab-docs",
	"agentlab-librarian",
];

export function roleRailsPath(stateRoot: string): string {
	return join(stateRoot, RAIL_FILENAME);
}

export function defaultRailForRole(role: IduModelRoleId): RoleRail {
	return {
		role,
		enabled: false,
		tokenBudget: DEFAULT_INITIAL_TOKEN_BUDGET,
		minTokenBudget: DEFAULT_MIN_TOKEN_BUDGET,
		maxTokenBudget: DEFAULT_MAX_TOKEN_BUDGET,
		cooldownMs: 30_000,
		cooldownRemainingMs: 0,
		wakeCount: 0,
		successStreak: 0,
		failureStreak: 0,
		emergencyTimeoutMs: DEFAULT_EMERGENCY_TIMEOUT_MS,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRoleId(value: string): value is IduModelRoleId {
	return (KNOWN_ROLES as readonly string[]).includes(value);
}

export function loadRoleRails(
	stateRoot: string,
): Record<IduModelRoleId, RoleRail> {
	const result: Record<string, RoleRail> = {};
	for (const role of KNOWN_ROLES) {
		result[role] = defaultRailForRole(role);
	}
	const path = roleRailsPath(stateRoot);
	if (!existsSync(path)) {
		return result as Record<IduModelRoleId, RoleRail>;
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as {
			rails?: Record<string, Partial<RoleRail>>;
		};
		if (raw.rails) {
			for (const [role, partial] of Object.entries(raw.rails)) {
				if (!isRoleId(role)) continue;
				const def = defaultRailForRole(role);
				result[role] = { ...def, ...partial, role };
			}
		}
	} catch {
		// corrupt JSON → defaults
	}
	return result as Record<IduModelRoleId, RoleRail>;
}

export function getRoleRail(
	stateRoot: string,
	role: IduModelRoleId,
	now: Date = new Date(),
): RoleRail {
	const all = loadRoleRails(stateRoot);
	const rail = all[role] ?? defaultRailForRole(role);
	if (rail.lastWakeAt) {
		const lastMs = Date.parse(rail.lastWakeAt);
		if (Number.isFinite(lastMs)) {
			const elapsed = now.getTime() - lastMs;
			rail.cooldownRemainingMs = Math.max(0, rail.cooldownMs - elapsed);
		} else {
			rail.cooldownRemainingMs = 0;
		}
	} else {
		rail.cooldownRemainingMs = 0;
	}
	return rail;
}

export function saveRoleRails(
	stateRoot: string,
	rails: Record<IduModelRoleId, RoleRail>,
): void {
	mkdirSync(stateRoot, { recursive: true });
	const path = roleRailsPath(stateRoot);
	const tmp = `${path}.tmp`;
	const payload = JSON.stringify({ rails }, null, 2);
	writeFileSync(tmp, payload, "utf8");
	// Atomic-ish write: copy tmp to target then unlink tmp.
	writeFileSync(path, readFileSync(tmp, "utf8"), "utf8");
	try {
		// best-effort cleanup
		const { unlinkSync } = require("node:fs") as typeof import("node:fs");
		unlinkSync(tmp);
	} catch {
		// ignore
	}
}

export type AutoTuneDirection = "expand" | "reduce" | "unchanged";

export type AutoTuneResult = {
	role: IduModelRoleId;
	newTokenBudget: number;
	successStreak: number;
	failureStreak: number;
	direction: AutoTuneDirection;
};

export function autoTuneRoleRail(
	stateRoot: string,
	role: IduModelRoleId,
	success: boolean,
	now: Date = new Date(),
): AutoTuneResult {
	const rails = loadRoleRails(stateRoot);
	const rail = rails[role] ?? defaultRailForRole(role);
	if (success) {
		rail.failureStreak = 0;
		rail.successStreak += 1;
		if (
			rail.successStreak >= SUCCESS_STREAK_FOR_REDUCE &&
			rail.tokenBudget > rail.minTokenBudget
		) {
			const reduced = Math.max(
				rail.minTokenBudget,
				Math.floor(rail.tokenBudget * TOKEN_BUDGET_REDUCE_FACTOR),
			);
			rail.tokenBudget = reduced;
			rail.successStreak = 0;
			// refresh lastWakeAt so cooldown applies to next attempt
			rail.lastWakeAt = now.toISOString();
			saveRoleRails(stateRoot, rails);
			return {
				role,
				newTokenBudget: reduced,
				successStreak: 0,
				failureStreak: 0,
				direction: "reduce",
			};
		}
	} else {
		rail.successStreak = 0;
		rail.failureStreak += 1;
		if (
			rail.failureStreak >= FAILURE_STREAK_FOR_EXPAND &&
			rail.tokenBudget < rail.maxTokenBudget
		) {
			const expanded = Math.min(
				rail.maxTokenBudget,
				Math.ceil(rail.tokenBudget * TOKEN_BUDGET_EXPAND_FACTOR),
			);
			rail.tokenBudget = expanded;
			rail.failureStreak = 0;
			rail.lastWakeAt = now.toISOString();
			saveRoleRails(stateRoot, rails);
			return {
				role,
				newTokenBudget: expanded,
				successStreak: 0,
				failureStreak: 0,
				direction: "expand",
			};
		}
	}
	rail.lastWakeAt = now.toISOString();
	saveRoleRails(stateRoot, rails);
	return {
		role,
		newTokenBudget: rail.tokenBudget,
		successStreak: rail.successStreak,
		failureStreak: rail.failureStreak,
		direction: "unchanged",
	};
}

export function recordRoleWake(
	stateRoot: string,
	role: IduModelRoleId,
	now: Date = new Date(),
): RoleRail {
	const rails = loadRoleRails(stateRoot);
	const rail = rails[role] ?? defaultRailForRole(role);
	rail.lastWakeAt = now.toISOString();
	rail.wakeCount += 1;
	saveRoleRails(stateRoot, rails);
	return rail;
}

export function isCooldownActive(rail: RoleRail): boolean {
	return rail.cooldownRemainingMs > 0;
}

/**
 * Returns true if at least one role has tokens remaining above
 * the minimum budget. Used by the automaticov1 cycle to decide
 * whether the self-repair bypass can fire (Layer 2).
 */
export function anyRailHasTokensAvailable(
	stateRoot: string,
	now: Date = new Date(),
): boolean {
	const rails = loadRoleRails(stateRoot);
	for (const role of KNOWN_ROLES) {
		const rail = rails[role];
		if (!rail) continue;
		// A rail is "available" if the role is enabled, the
		// budget is above the floor, and not in cooldown.
		if (rail.enabled && rail.tokenBudget > rail.minTokenBudget) {
			// Compute live cooldown
			if (rail.lastWakeAt) {
				const lastMs = Date.parse(rail.lastWakeAt);
				if (Number.isFinite(lastMs)) {
					const elapsed = now.getTime() - lastMs;
					const remaining = Math.max(0, rail.cooldownMs - elapsed);
					if (remaining > 0) continue;
				}
			}
			return true;
		}
	}
	return false;
}
