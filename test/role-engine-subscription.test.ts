import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { appendEvent, type Event } from "../src/event-bus.js";
import type { RoleEngineConfig } from "../src/role-engine-config.js";
import {
	rebindRoleEngineSubscription,
	unbindRoleEngineSubscription,
} from "../src/role-engine-subscription.js";
import type { IduModelRoleId } from "../src/model-assignments.js";
import type { Role, RoleAdvisory } from "../src/roles/index.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-role-engine-sub-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	unbindRoleEngineSubscription("test-project");
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function allDisabled(): Record<IduModelRoleId, boolean> {
	return {
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
	};
}

function config(enabled: boolean): RoleEngineConfig {
	return {
		enabled,
		maxRoleInvocationsPerTurn: 50,
		roleEnabled: { ...allDisabled(), "supervisor-main": true },
		roleCooldownMs: {},
	};
}

function event(ts: string): Event {
	return {
		ts,
		kind: "orchestrator_turn",
		projectId: "test-project",
		payload: { turn: ts },
		sourceRef: "test",
		evidenceRefs: [],
	};
}

function flushListeners(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("role-engine subscription stays unbound when global config is disabled", async () => {
	const root = freshRoot();
	let invocations = 0;
	const role: Role = {
		name: "supervisor-main-test",
		priority: 90,
		cooldownMs: 0,
		subscribesTo: () => ["orchestrator_turn"],
		shouldFire: () => true,
		invoke: async (): Promise<RoleAdvisory> => {
			invocations++;
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: "2026-01-01T00:00:00.000Z",
				advisory: "test",
				evidenceRefs: [],
			};
		},
	};

	const status = rebindRoleEngineSubscription({
		projectId: "test-project",
		stateRoot: root,
		router: {} as never,
		repository: {} as never,
		config: config(false),
		registry: { "supervisor-main": role },
	});

	assert.equal(status.enabled, false);
	assert.equal(status.subscriptionCount, 0);
	appendEvent(root, event("2026-01-01T00:00:00.000Z"));
	await flushListeners();
	assert.equal(invocations, 0);
});

test("role-engine subscription invokes enabled roles after rebind", async () => {
	const root = freshRoot();
	let invocations = 0;
	const role: Role = {
		name: "supervisor-main-test",
		priority: 90,
		cooldownMs: 0,
		subscribesTo: () => ["orchestrator_turn"],
		shouldFire: () => true,
		invoke: async (input): Promise<RoleAdvisory> => {
			invocations++;
			return {
				roleId: "supervisor-main",
				priority: 90,
				ts: input.context.now.toISOString(),
				advisory: "test",
				evidenceRefs: [],
			};
		},
	};

	const status = rebindRoleEngineSubscription({
		projectId: "test-project",
		stateRoot: root,
		router: {} as never,
		repository: {} as never,
		config: config(true),
		registry: { "supervisor-main": role },
		now: () => new Date("2026-01-01T00:00:00.000Z"),
	});

	assert.equal(status.enabled, true);
	assert.equal(status.subscriptionCount, 1);
	appendEvent(root, event("2026-01-01T00:00:01.000Z"));
	await flushListeners();
	assert.equal(invocations, 1);

	unbindRoleEngineSubscription("test-project");
	appendEvent(root, event("2026-01-01T00:00:02.000Z"));
	await flushListeners();
	assert.equal(invocations, 1);
});
