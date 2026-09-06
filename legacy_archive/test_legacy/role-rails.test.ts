import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	autoTuneRoleRail,
	DEFAULT_EMERGENCY_TIMEOUT_MS,
	DEFAULT_MAX_TOKEN_BUDGET,
	DEFAULT_MIN_TOKEN_BUDGET,
	DEFAULT_INITIAL_TOKEN_BUDGET,
	defaultRailForRole,
	getRoleRail,
	isCooldownActive,
	loadRoleRails,
	recordRoleWake,
	roleRailsPath,
	saveRoleRails,
} from "../src/role-rails.js";
import { anyRailHasTokensAvailable } from "../src/role-rails.js";
import type { IduModelRoleId } from "../src/model-assignments.js";
import type { RoleRail } from "../src/role-rails.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-rails-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("defaultRailForRole returns expected defaults", () => {
	const rail = defaultRailForRole("supervisor-main");
	assert.equal(rail.role, "supervisor-main");
	assert.equal(rail.enabled, true);
	assert.equal(rail.tokenBudget, DEFAULT_INITIAL_TOKEN_BUDGET);
	assert.equal(rail.minTokenBudget, DEFAULT_MIN_TOKEN_BUDGET);
	assert.equal(rail.maxTokenBudget, DEFAULT_MAX_TOKEN_BUDGET);
	assert.equal(rail.cooldownMs, 30_000);
	assert.equal(rail.emergencyTimeoutMs, DEFAULT_EMERGENCY_TIMEOUT_MS);
	assert.equal(rail.wakeCount, 0);
	assert.equal(rail.successStreak, 0);
	assert.equal(rail.failureStreak, 0);
	assert.equal(rail.cooldownRemainingMs, 0);
});

test("loadRoleRails returns defaults when file is missing", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const rails = loadRoleRails(stateRoot);
		assert.ok(rails["supervisor-main"]);
		assert.equal(rails["supervisor-main"].tokenBudget, DEFAULT_INITIAL_TOKEN_BUDGET);
		assert.equal(rails["agentlab-ui-ux"].tokenBudget, DEFAULT_INITIAL_TOKEN_BUDGET);
		assert.equal(rails["agentlab-security"].tokenBudget, DEFAULT_INITIAL_TOKEN_BUDGET);
	} finally {
		cleanup();
	}
});

test("loadRoleRails merges partial on-disk config with defaults", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		writeFileSync(
			roleRailsPath(stateRoot),
			JSON.stringify({
				rails: {
					"supervisor-main": { tokenBudget: 1500, successStreak: 5 },
				},
			}),
			"utf8",
		);
		const rails = loadRoleRails(stateRoot);
		assert.equal(rails["supervisor-main"].tokenBudget, 1500);
		assert.equal(rails["supervisor-main"].successStreak, 5);
		assert.equal(rails["supervisor-main"].minTokenBudget, DEFAULT_MIN_TOKEN_BUDGET);
		assert.equal(rails["supervisor-main"].maxTokenBudget, DEFAULT_MAX_TOKEN_BUDGET);
		assert.equal(rails["agentlab-ui-ux"].tokenBudget, DEFAULT_INITIAL_TOKEN_BUDGET);
	} finally {
		cleanup();
	}
});

test("getRoleRail returns rail with computed cooldownRemainingMs", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const now = new Date("2026-06-15T12:00:00Z");
		recordRoleWake(stateRoot, "supervisor-main", new Date(now.getTime() - 5_000));
		const fetched = getRoleRail(stateRoot, "supervisor-main", now);
		assert.equal(fetched.cooldownRemainingMs, 25_000);
		assert.equal(fetched.wakeCount, 1);
	} finally {
		cleanup();
	}
});

test("getRoleRail returns cooldownRemainingMs=0 when no wake has happened", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const fetched = getRoleRail(stateRoot, "supervisor-main");
		assert.equal(fetched.cooldownRemainingMs, 0);
		assert.equal(fetched.wakeCount, 0);
	} finally {
		cleanup();
	}
});

test("recordRoleWake increments wakeCount and updates lastWakeAt", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const t1 = new Date("2026-06-15T12:00:00Z");
		const t2 = new Date("2026-06-15T12:00:30Z");
		recordRoleWake(stateRoot, "supervisor-main", t1);
		recordRoleWake(stateRoot, "supervisor-main", t2);
		const rail = getRoleRail(stateRoot, "supervisor-main", t2);
		assert.equal(rail.wakeCount, 2);
		assert.equal(rail.lastWakeAt, t2.toISOString());
	} finally {
		cleanup();
	}
});

test("autoTuneRoleRail: 3 successes in a row reduces token budget", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		let result = autoTuneRoleRail(stateRoot, "supervisor-main", true);
		assert.equal(result.direction, "unchanged");
		result = autoTuneRoleRail(stateRoot, "supervisor-main", true);
		assert.equal(result.direction, "unchanged");
		result = autoTuneRoleRail(stateRoot, "supervisor-main", true);
		assert.equal(result.direction, "reduce");
		// 800 * 0.85 = 680
		assert.equal(result.newTokenBudget, 680);
	} finally {
		cleanup();
	}
});

test("autoTuneRoleRail: 3 failures in a row expands token budget", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		const result = autoTuneRoleRail(stateRoot, "supervisor-main", false);
		assert.equal(result.direction, "expand");
		// 800 * 1.3 = 1040
		assert.equal(result.newTokenBudget, 1040);
	} finally {
		cleanup();
	}
});

test("autoTuneRoleRail: budget respects minTokenBudget floor on reduce", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const rails = loadRoleRails(stateRoot);
		rails["supervisor-main"].tokenBudget = 110;
		saveRoleRails(stateRoot, rails);
		autoTuneRoleRail(stateRoot, "supervisor-main", true);
		autoTuneRoleRail(stateRoot, "supervisor-main", true);
		const result = autoTuneRoleRail(stateRoot, "supervisor-main", true);
		assert.equal(result.direction, "reduce");
		// 110 * 0.85 = 93.5 → floor 93, but minTokenBudget is 100
		assert.equal(result.newTokenBudget, DEFAULT_MIN_TOKEN_BUDGET);
	} finally {
		cleanup();
	}
});

test("autoTuneRoleRail: budget respects maxTokenBudget ceiling on expand", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const rails = loadRoleRails(stateRoot);
		rails["supervisor-main"].tokenBudget = 1900;
		saveRoleRails(stateRoot, rails);
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		const result = autoTuneRoleRail(stateRoot, "supervisor-main", false);
		assert.equal(result.direction, "expand");
		// 1900 * 1.3 = 2470, but maxTokenBudget is 2000
		assert.equal(result.newTokenBudget, DEFAULT_MAX_TOKEN_BUDGET);
	} finally {
		cleanup();
	}
});

test("autoTuneRoleRail: success resets failure streak", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		// success resets
		autoTuneRoleRail(stateRoot, "supervisor-main", true);
		// 2 more failures (fresh streak)
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		autoTuneRoleRail(stateRoot, "supervisor-main", false);
		// third failure triggers expand
		const result = autoTuneRoleRail(stateRoot, "supervisor-main", false);
		assert.equal(result.direction, "expand");
	} finally {
		cleanup();
	}
});

test("isCooldownActive returns true when remaining > 0", () => {
	const rail = {
		role: "supervisor-main" as const,
		enabled: true,
		tokenBudget: 800,
		minTokenBudget: 100,
		maxTokenBudget: 2000,
		cooldownMs: 30_000,
		cooldownRemainingMs: 15_000,
		wakeCount: 1,
		successStreak: 0,
		failureStreak: 0,
		emergencyTimeoutMs: 600_000,
	};
	assert.equal(isCooldownActive(rail), true);
});

test("isCooldownActive returns false when remaining is 0", () => {
	const rail = {
		role: "supervisor-main" as const,
		enabled: true,
		tokenBudget: 800,
		minTokenBudget: 100,
		maxTokenBudget: 2000,
		cooldownMs: 30_000,
		cooldownRemainingMs: 0,
		wakeCount: 1,
		successStreak: 0,
		failureStreak: 0,
		emergencyTimeoutMs: 600_000,
	};
	assert.equal(isCooldownActive(rail), false);
});

test("roleRailsPath returns the canonical stateRoot path", () => {
	const path = roleRailsPath("C:/foo");
	// join normalizes path separators; just assert the suffix
	assert.ok(path.endsWith("role-rails.json"));
	assert.ok(path.includes("foo"));
});

test("saveRoleRails writes a file readable by loadRoleRails", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const rails = loadRoleRails(stateRoot);
		rails["supervisor-main"].tokenBudget = 1234;
		rails["supervisor-main"].wakeCount = 7;
		saveRoleRails(stateRoot, rails);
		const reloaded = loadRoleRails(stateRoot);
		assert.equal(reloaded["supervisor-main"].tokenBudget, 1234);
		assert.equal(reloaded["supervisor-main"].wakeCount, 7);
		// sanity: file exists and is valid JSON
		const raw = JSON.parse(readFileSync(roleRailsPath(stateRoot), "utf8")) as {
			rails: Record<string, unknown>;
		};
		assert.ok(raw.rails["supervisor-main"]);
	} finally {
		cleanup();
	}
});

// --- Block-1 point 6: rails enabled-by-default + one-pass migration ---

// Mirrors the 13 known roles from src/role-rails.ts so the migration
// fixtures exercise the real production shape, not a minimal subset.
const KNOWN_ROLES_FIXTURE: IduModelRoleId[] = [
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

// Build a legacy v1-shape payload mirroring the real production file:
// 13 roles, each enabled:false (the old default bleed), NO schemaVersion.
function legacyV1Payload(): {
	rails: Record<string, Partial<RoleRail>>;
} {
	const rails: Record<string, Partial<RoleRail>> = {};
	for (const role of KNOWN_ROLES_FIXTURE) {
		rails[role] = {
			role,
			enabled: false,
			tokenBudget: 800,
			minTokenBudget: 100,
			maxTokenBudget: 2000,
			cooldownMs: 30_000,
			cooldownRemainingMs: 0,
			wakeCount: 3,
			successStreak: 1,
			failureStreak: 0,
			emergencyTimeoutMs: 600_000,
		};
	}
	return { rails };
}

test("migration: v1 file with 13 rails enabled:false -> all enabled:true in-memory and schemaVersion:2 on disk", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		writeFileSync(
			roleRailsPath(stateRoot),
			JSON.stringify(legacyV1Payload()),
			"utf8",
		);
		const rails = loadRoleRails(stateRoot);
		// In-memory: all 13 flipped to enabled:true by the one-pass migration
		for (const role of KNOWN_ROLES_FIXTURE) {
			assert.equal(
				rails[role].enabled,
				true,
				`${role} should be enabled in-memory after migration`,
			);
		}
		// On disk: schemaVersion:2 stamped and all 13 persisted enabled:true
		const onDisk = JSON.parse(
			readFileSync(roleRailsPath(stateRoot), "utf8"),
		) as {
			schemaVersion?: number;
			rails: Record<string, { enabled: boolean }>;
		};
		assert.equal(onDisk.schemaVersion, 2);
		for (const role of KNOWN_ROLES_FIXTURE) {
			assert.equal(
				onDisk.rails[role].enabled,
				true,
				`${role} should be enabled on-disk after migration`,
			);
		}
	} finally {
		cleanup();
	}
});

test("migration is idempotent: a v2 file is not rewritten and an explicit enabled:false survives", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const v2Payload = {
			schemaVersion: 2,
			rails: {
				"supervisor-main": {
					role: "supervisor-main",
					// Explicit user disable in an already-migrated v2 file —
					// this is a deliberate choice, NOT legacy default bleed.
					enabled: false,
					tokenBudget: 800,
					minTokenBudget: 100,
					maxTokenBudget: 2000,
					cooldownMs: 30_000,
					cooldownRemainingMs: 0,
					wakeCount: 0,
					successStreak: 0,
					failureStreak: 0,
					emergencyTimeoutMs: 600_000,
				},
			},
		};
		writeFileSync(roleRailsPath(stateRoot), JSON.stringify(v2Payload), "utf8");
		const before = readFileSync(roleRailsPath(stateRoot), "utf8");
		const rails = loadRoleRails(stateRoot);
		const after = readFileSync(roleRailsPath(stateRoot), "utf8");
		// Explicit user disable survives (v2 file is not migrated)
		assert.equal(rails["supervisor-main"].enabled, false);
		// No write on a v2 load (idempotent — bytes unchanged)
		assert.equal(before, after);
	} finally {
		cleanup();
	}
});

test("fresh stateRoot (no file): loadRoleRails returns all rails enabled:true and writes no file", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const rails = loadRoleRails(stateRoot);
		for (const role of KNOWN_ROLES_FIXTURE) {
			assert.equal(
				rails[role].enabled,
				true,
				`${role} should default to enabled`,
			);
		}
		// No file created — fresh state must not trigger a write
		assert.equal(existsSync(roleRailsPath(stateRoot)), false);
	} finally {
		cleanup();
	}
});

test("anyRailHasTokensAvailable returns true after migrating a v1 file (bypass unblocked)", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		writeFileSync(
			roleRailsPath(stateRoot),
			JSON.stringify(legacyV1Payload()),
			"utf8",
		);
		// Before the fix this was permanently false: every rail had
		// enabled:false so anyRailHasTokensAvailable could never return true.
		// After migration rails are enabled:true with tokenBudget(800) >
		// minTokenBudget(100) and no cooldown -> the bypass path is reachable.
		assert.equal(anyRailHasTokensAvailable(stateRoot), true);
	} finally {
		cleanup();
	}
});

test("saveRoleRails writes schemaVersion in the payload (marker survives a post-migration save)", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const rails = loadRoleRails(stateRoot);
		rails["supervisor-main"].tokenBudget = 4321;
		saveRoleRails(stateRoot, rails);
		const raw = JSON.parse(
			readFileSync(roleRailsPath(stateRoot), "utf8"),
		) as {
			schemaVersion?: number;
			rails: Record<string, unknown>;
		};
		assert.equal(raw.schemaVersion, 2);
		assert.ok(raw.rails["supervisor-main"]);
	} finally {
		cleanup();
	}
});

test("a rail explicitly disabled in a v2 file stays disabled across loads (user choice respected)", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const v2Payload = {
			schemaVersion: 2,
			rails: {
				"agentlab-security": {
					role: "agentlab-security",
					enabled: false,
					tokenBudget: 800,
					minTokenBudget: 100,
					maxTokenBudget: 2000,
					cooldownMs: 30_000,
					cooldownRemainingMs: 0,
					wakeCount: 0,
					successStreak: 0,
					failureStreak: 0,
					emergencyTimeoutMs: 600_000,
				},
			},
		};
		writeFileSync(roleRailsPath(stateRoot), JSON.stringify(v2Payload), "utf8");
		const first = loadRoleRails(stateRoot);
		assert.equal(first["agentlab-security"].enabled, false);
		// A second load must still respect the explicit disable and must
		// not have re-migrated it to true.
		const second = loadRoleRails(stateRoot);
		assert.equal(second["agentlab-security"].enabled, false);
	} finally {
		cleanup();
	}
});
