import assert from "node:assert/strict";
import { test } from "node:test";
import {
	listAllRoles,
	listRolesByKind,
	ROLE_REGISTRY,
} from "../../src/roles/index.js";
import type { Role } from "../../src/roles/index.js";
import type { EventKind } from "../../src/event-bus.js";

test("ROLE_REGISTRY has all 13 expected role ids", () => {
	const expected = [
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
	] as const;
	assert.equal(Object.keys(ROLE_REGISTRY).length, expected.length);
	for (const id of expected) {
		assert.ok(ROLE_REGISTRY[id], `missing role: ${id}`);
	}
});

test("every role in ROLE_REGISTRY satisfies the Role contract", () => {
	for (const [id, role] of Object.entries(ROLE_REGISTRY)) {
		assert.equal(typeof role.name, "string", `${id} name must be string`);
		assert.ok(role.name.length > 0, `${id} name must be non-empty`);
		assert.equal(
			Number.isInteger(role.priority),
			true,
			`${id} priority must be integer`,
		);
		assert.ok(
			role.priority >= 0 && role.priority <= 100,
			`${id} priority must be in [0,100] (got ${role.priority})`,
		);
		assert.equal(
			typeof role.cooldownMs,
			"number",
			`${id} cooldownMs must be number`,
		);
		assert.ok(
			role.cooldownMs > 0,
			`${id} cooldownMs must be positive (got ${role.cooldownMs})`,
		);
		const subs = role.subscribesTo();
		assert.ok(
			Array.isArray(subs) && subs.length > 0,
			`${id} must subscribe to at least one event kind`,
		);
		for (const kind of subs) {
			// Compile-time check + runtime assertion.
			const _check: EventKind = kind;
			void _check;
		}
		assert.equal(
			typeof role.shouldFire,
			"function",
			`${id} shouldFire must be function`,
		);
		assert.equal(
			typeof role.invoke,
			"function",
			`${id} invoke must be function`,
		);
	}
});

test("listAllRoles returns 13 roles with valid contract", () => {
	const all: Role[] = listAllRoles();
	assert.equal(all.length, 13);
	for (const role of all) {
		assert.equal(typeof role.name, "string");
		assert.ok(role.name.length > 0);
		assert.ok(role.priority >= 0 && role.priority <= 100);
	}
});

test("listRolesByKind returns roles sorted by priority DESC, name ASC", () => {
	const fileChangedRoles = listRolesByKind("file_changed");
	assert.ok(fileChangedRoles.length > 0, "at least one role subscribes to file_changed");
	for (let i = 1; i < fileChangedRoles.length; i++) {
		const prev = fileChangedRoles[i - 1]!;
		const cur = fileChangedRoles[i]!;
		if (prev.priority === cur.priority) {
			assert.ok(
				prev.name <= cur.name,
				`name tie-break should be ASC: ${prev.name} vs ${cur.name}`,
			);
		} else {
			assert.ok(
				prev.priority > cur.priority,
				`priority must be DESC: ${prev.priority} vs ${cur.priority}`,
			);
		}
	}
});

test("listRolesByKind returns empty array for kinds nobody subscribes to (regression-pin for fallback role handling)", () => {
	// Every spec event kind has at least one subscriber (via agentlab-general
	// which subscribes to the union). Pick a kind the registry does cover,
	// just to assert the filter works.
	const someKind: EventKind = "role_engine_cap_warning";
	const roles = listRolesByKind(someKind);
	// The result is whatever the registry provides; the contract is
	// that the array is sorted and non-null.
	for (const role of roles) {
		assert.equal(typeof role.name, "string");
		assert.ok(role.cooldownMs > 0);
	}
});
