import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	consultSupervisor,
	type ConsultInput,
	type ConsultResult,
} from "../src/supervisor-consult.js";
import {
	roleEngineConfigPath,
} from "../src/role-engine-config.js";
import { roleRailsPath } from "../src/role-rails.js";
import type { PromptForRoleResult } from "../src/agent-router.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-consult-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function enableRole(stateRoot: string, role: string): void {
	const raw = {
		enabled: true,
		maxRoleInvocationsPerTurn: 50,
		roleEnabled: { [role]: true },
		roleCooldownMs: {},
	};
	writeFileSync(roleEngineConfigPath(stateRoot), JSON.stringify(raw), "utf8");
}

function mockSuccess(output = "Supervisor response text"): ConsultInput["promptForRole"] {
	return async (role, _message, _options): Promise<PromptForRoleResult> => ({
		ok: true,
		output,
		provider: "test-provider",
		model: "test-model",
		role,
	});
}

function mockFailure(reason = "model returned error"): ConsultInput["promptForRole"] {
	return async (role, _message, _options): Promise<PromptForRoleResult> => ({
		ok: false,
		output: reason,
		provider: "test-provider",
		model: "test-model",
		role,
	});
}

test("consultSupervisor: returns role_not_enabled when role-engine.json says role is off", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		// role-engine.json absent or role not enabled
		const result = await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "Should I proceed?",
			promptForRole: mockSuccess(),
		});
		assert.equal(result.ok, false);
		assert.equal(result.reason, "role_not_enabled");
	} finally {
		cleanup();
	}
});

test("consultSupervisor: returns role_not_enabled when role-engine.json is missing", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "test",
			promptForRole: mockSuccess(),
		});
		assert.equal(result.ok, false);
		assert.equal(result.reason, "role_not_enabled");
	} finally {
		cleanup();
	}
});

test("consultSupervisor: succeeds when role is enabled and returns model response", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const result = await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "Should I proceed?",
			context: "auth refactor",
			promptForRole: mockSuccess("Yes, proceed with caution."),
		});
		assert.equal(result.ok, true);
		assert.equal(result.role, "supervisor-main");
		assert.equal(result.response, "Yes, proceed with caution.");
		assert.equal(result.model, "test-model");
		assert.equal(result.provider, "test-provider");
		assert.equal(result.reason, undefined);
	} finally {
		cleanup();
	}
});

test("consultSupervisor: returns cooldown_active when role is in cooldown", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		// Pre-populate rail with a recent wake
		const now = new Date("2026-06-15T12:00:00Z");
		writeFileSync(
			roleRailsPath(stateRoot),
			JSON.stringify({
				rails: {
					"supervisor-main": {
						role: "supervisor-main",
						enabled: true,
						tokenBudget: 800,
						minTokenBudget: 100,
						maxTokenBudget: 2000,
						cooldownMs: 30_000,
						cooldownRemainingMs: 0,
						lastWakeAt: new Date(now.getTime() - 5_000).toISOString(),
						wakeCount: 1,
						successStreak: 0,
						failureStreak: 0,
						emergencyTimeoutMs: 600_000,
					},
				},
			}),
			"utf8",
		);
		const result = await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "test",
			promptForRole: mockSuccess(),
			now,
		});
		assert.equal(result.ok, false);
		assert.equal(result.reason, "cooldown_active");
		assert.ok((result.cooldownRemainingMs ?? 0) > 0);
	} finally {
		cleanup();
	}
});

test("consultSupervisor: successful wake records in rail and autoTune success streak", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const now = new Date("2026-06-15T12:00:00Z");
		const result = await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "test",
			promptForRole: mockSuccess(),
			now,
		});
		assert.equal(result.ok, true);
		assert.equal(result.rail.wakeCount, 1);
		// After 1 success, no expand/reduce yet (need 3 streak)
		assert.equal(result.rail.successStreak, 1);
		assert.equal(result.rail.failureStreak, 0);
		assert.equal(result.rail.tokenBudget, 800);
		// Verify the rail was persisted
		const persisted = JSON.parse(
			readFileSync(roleRailsPath(stateRoot), "utf8"),
		) as { rails: Record<string, { wakeCount: number; successStreak: number }> };
		assert.equal(persisted.rails["supervisor-main"].wakeCount, 1);
		assert.equal(persisted.rails["supervisor-main"].successStreak, 1);
	} finally {
		cleanup();
	}
});

test("consultSupervisor: failed wake increments failure streak", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const now = new Date("2026-06-15T12:00:00Z");
		const result = await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "test",
			promptForRole: mockFailure(),
			now,
		});
		// Failed consult still returns ok=false but rail is updated
		assert.equal(result.ok, false);
		assert.equal(result.rail.wakeCount, 1);
		assert.equal(result.rail.failureStreak, 1);
		assert.equal(result.rail.successStreak, 0);
	} finally {
		cleanup();
	}
});

test("consultSupervisor: build prompt with token budget instruction", async () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		let captured = "";
		const capture = async (
			_role: string,
			message: string,
			_options: unknown,
		): Promise<PromptForRoleResult> => {
			captured = message;
			return {
				ok: true,
				output: "ok",
				provider: "p",
				model: "m",
				role: "supervisor-main",
			};
		};
		await consultSupervisor({
			stateRoot,
			role: "supervisor-main",
			question: "Should I refactor?",
			context: "PR-101 about to be merged",
			promptForRole: capture,
		});
		assert.ok(captured.includes("supervisor-main"), "prompt mentions role");
		assert.ok(captured.includes("Should I refactor?"), "prompt has question");
		assert.ok(
			captured.includes("PR-101 about to be merged"),
			"prompt has context",
		);
		assert.ok(
			captured.includes("token budget") || captured.includes("Token budget"),
			"prompt mentions budget",
		);
	} finally {
		cleanup();
	}
});
