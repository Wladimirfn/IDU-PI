import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	DEFAULT_MAX_ROLE_INVOCATIONS_PER_TURN,
	DEFAULT_ROLE_ENGINE_CONFIG,
	disableRoleEngineConfig,
	enableRoleEngineConfig,
	getRoleEngineConfigStatus,
	loadRoleEngineConfig,
	resolveRoleEngineConfig,
	roleEngineConfigPath,
	saveRoleEngineConfig,
} from "../src/role-engine-config.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-role-engine-cfg-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

test("resolveRoleEngineConfig returns DEFAULT when stateRoot/role-engine.json is missing", () => {
	const root = freshRoot();
	assert.equal(existsSync(roleEngineConfigPath(root)), false);
	const cfg = resolveRoleEngineConfig(root);
	assert.equal(cfg.enabled, DEFAULT_ROLE_ENGINE_CONFIG.enabled);
	assert.equal(
		cfg.maxRoleInvocationsPerTurn,
		DEFAULT_MAX_ROLE_INVOCATIONS_PER_TURN,
	);
	assert.equal(
		cfg.roleEnabled["supervisor-main"],
		false,
		"feature flag is OFF by default (REQ: rollout safety)",
	);
	// All 13 roles explicitly off
	const allRoleIds = Object.keys(DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled);
	assert.equal(allRoleIds.length, 13);
	for (const id of allRoleIds) {
		assert.equal(cfg.roleEnabled[id as keyof typeof cfg.roleEnabled], false);
	}
});

test("resolveRoleEngineConfig merges partial on-disk config with defaults", () => {
	const root = freshRoot();
	writeFileSync(
		roleEngineConfigPath(root),
		`${JSON.stringify(
			{
				enabled: true,
				roleEnabled: { "supervisor-main": true },
				roleCooldownMs: { "supervisor-main": 12_345 },
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	const cfg = resolveRoleEngineConfig(root);
	assert.equal(cfg.enabled, true);
	assert.equal(cfg.roleEnabled["supervisor-main"], true);
	// Other roles stay off (the merge keeps defaults for missing keys).
	assert.equal(cfg.roleEnabled["agentlab-security"], false);
	// Cooldown override is honored.
	assert.equal(cfg.roleCooldownMs["supervisor-main"], 12_345);
	// Other cooldowns keep their defaults.
	assert.equal(
		cfg.roleCooldownMs["agentlab-security"],
		DEFAULT_ROLE_ENGINE_CONFIG.roleCooldownMs["agentlab-security"],
	);
});

test("loadRoleEngineConfig returns defaults when file is missing", () => {
	const root = freshRoot();
	const cfg = loadRoleEngineConfig(root);
	assert.deepEqual(cfg, DEFAULT_ROLE_ENGINE_CONFIG);
});

test("loadRoleEngineConfig falls back to defaults on corrupt JSON", () => {
	const root = freshRoot();
	writeFileSync(roleEngineConfigPath(root), "{not valid json", "utf8");
	const cfg = loadRoleEngineConfig(root);
	assert.deepEqual(cfg, DEFAULT_ROLE_ENGINE_CONFIG);
});

test("saveRoleEngineConfig writes atomically and creates a backup file", () => {
	const root = freshRoot();
	// First save creates the file (no backup yet).
	const first = saveRoleEngineConfig(root, {
		enabled: true,
		roleEnabled: { "supervisor-main": true },
	});
	assert.equal(existsSync(roleEngineConfigPath(root)), true);
	assert.deepEqual(first, {
		...DEFAULT_ROLE_ENGINE_CONFIG,
		enabled: true,
		roleEnabled: {
			...DEFAULT_ROLE_ENGINE_CONFIG.roleEnabled,
			"supervisor-main": true,
		},
	});
	// Second save creates a backup of the previous file.
	saveRoleEngineConfig(root, {
		enabled: false,
	});
	assert.equal(existsSync(roleEngineConfigPath(root)), true);
	const files = readdirSync(root);
	const backups = files.filter((f) => f.startsWith("role-engine.json.backup-"));
	assert.ok(backups.length >= 1, "at least one backup file should exist");
	// The on-disk file now contains the second save (enabled: false).
	const reloaded = resolveRoleEngineConfig(root);
	assert.equal(reloaded.enabled, false);
});

test("saveRoleEngineConfig preserves all 13 roleEnabled keys even when patch is partial", () => {
	const root = freshRoot();
	const cfg = saveRoleEngineConfig(root, {
		roleEnabled: { "agentlab-security": true },
	});
	assert.equal(cfg.roleEnabled["agentlab-security"], true);
	assert.equal(cfg.roleEnabled["supervisor-main"], false);
	assert.equal(Object.keys(cfg.roleEnabled).length, 13);
});

test("role engine control helpers toggle global and per-role flags", () => {
	const root = freshRoot();
	assert.equal(getRoleEngineConfigStatus(root).enabled, false);

	const enabled = enableRoleEngineConfig(root);
	assert.equal(enabled.state.enabled, true);
	assert.equal(resolveRoleEngineConfig(root).enabled, true);

	const roleEnabled = enableRoleEngineConfig(root, "supervisor-main");
	assert.equal(roleEnabled.state.roleEnabled["supervisor-main"], true);
	assert.equal(
		resolveRoleEngineConfig(root).roleEnabled["supervisor-main"],
		true,
	);

	const disabled = disableRoleEngineConfig(root);
	assert.equal(disabled.state.enabled, false);
	assert.equal(resolveRoleEngineConfig(root).enabled, false);
});
