/**
 * agentlab-database role tests — T3.2.
 *
 * Locks the agentlab-database role contract:
 * - subscribes to file_changed, migration_added, raw_sql_seen
 * - priority 60, cooldownMs 300000 (5 minutes)
 * - shouldFire logic: file_changed with path matching SQL/migration patterns
 * - invoke calls agentRouter.promptForRole with correct role id
 * - invoke parses LLM response into RoleAdvisory with integrityRisks, migrationSafety, summary, priority, evidenceRefs
 * - invoke handles malformed LLM response with fallback
 * - shouldFire respects cooldown
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event, EventKind } from "../../src/event-bus.js";
import type { RoleInput, RoleContext } from "../../src/roles/index.js";
import { createAgentLabDatabaseRole } from "../../src/roles/agentlab-database.js";
import type { AgentRouter } from "../../src/agent-router.js";
import type { LabDbRepository } from "../../src/lab-db-repository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
	kind: EventKind,
	payload: Record<string, unknown> = {},
	ts = "2026-01-01T00:00:00.000Z",
): Event {
	return {
		ts,
		kind,
		projectId: "test",
		payload,
		sourceRef: "test-source",
		evidenceRefs: [],
	};
}

function makeInput(event: Event, signature = "sig-db-123"): RoleInput {
	return {
		event,
		inputSignature: signature,
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router: {} as AgentRouter,
			repository: {} as LabDbRepository,
		},
	};
}

type PromptForRoleCall = {
	role: string;
	message: string;
};

function makeFakeAgentRouter(response: string): {
	router: AgentRouter;
	calls: PromptForRoleCall[];
} {
	const calls: PromptForRoleCall[] = [];
	const router = {
		promptForRole: async (role: string, message: string, _options: unknown) => {
			calls.push({ role, message });
			return {
				ok: true,
				output: response,
				provider: "minimax",
				model: "MiniMax-M3",
				role,
			};
		},
	} as unknown as AgentRouter;
	return { router, calls };
}

function makeFakeRepository(): {
	repository: LabDbRepository;
	invocations: unknown[];
} {
	const invocations: unknown[] = [];
	const repository = {
		appendInvocation: (record: unknown) => {
			invocations.push(record);
			return record;
		},
	} as unknown as LabDbRepository;
	return { repository, invocations };
}

// ---------------------------------------------------------------------------
// 1. subscribes to file_changed, migration_added, raw_sql_seen
// ---------------------------------------------------------------------------

test("agentlab-database subscribes to file_changed, migration_added, raw_sql_seen", () => {
	const role = createAgentLabDatabaseRole();
	const subs = role.subscribesTo();
	assert.equal(subs.length, 3);
	assert.ok(subs.includes("file_changed"));
	assert.ok(subs.includes("migration_added"));
	assert.ok(subs.includes("raw_sql_seen"));
});

// ---------------------------------------------------------------------------
// 2. priority 60
// ---------------------------------------------------------------------------

test("agentlab-database has priority 60", () => {
	const role = createAgentLabDatabaseRole();
	assert.equal(role.priority, 60);
});

// ---------------------------------------------------------------------------
// 3. cooldownMs 300000 (5 minutes)
// ---------------------------------------------------------------------------

test("agentlab-database has cooldownMs 300000", () => {
	const role = createAgentLabDatabaseRole();
	assert.equal(role.cooldownMs, 300_000);
});

// ---------------------------------------------------------------------------
// 4. shouldFire returns true for file_changed with SQL/migration paths
// ---------------------------------------------------------------------------

test("shouldFire returns true for file_changed with .sql path", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("file_changed", { path: "migrations/001_init.sql" });
	const input = makeInput(event, "sig-db-sql-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .sql files");
});

test("shouldFire returns true for file_changed with .prisma path", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("file_changed", { path: "prisma/schema.prisma" });
	const input = makeInput(event, "sig-db-prisma-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for .prisma files");
});

test("shouldFire returns true for file_changed with migrations/ in path", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("file_changed", { path: "db/migrations/add-users.ts" });
	const input = makeInput(event, "sig-db-migpath-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true, "shouldFire must return true for paths containing migrations/");
});

test("shouldFire returns true for migration_added", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("migration_added", { path: "migrations/002_add_table.sql" });
	const input = makeInput(event, "sig-db-mig-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true);
});

test("shouldFire returns true for raw_sql_seen", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("raw_sql_seen", { query: "SELECT * FROM users" });
	const input = makeInput(event, "sig-db-rawsql-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, true);
});

// ---------------------------------------------------------------------------
// 5. shouldFire returns false for file_changed with non-SQL paths
// ---------------------------------------------------------------------------

test("shouldFire returns false for file_changed with non-SQL path", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("file_changed", { path: "src/utils.ts" });
	const input = makeInput(event, "sig-db-nosql-1");
	const result = role.shouldFire(
		input,
		undefined,
		new Date("2026-01-01T00:00:00.000Z"),
	);
	assert.equal(result, false, "shouldFire must return false for non-SQL paths");
});

// ---------------------------------------------------------------------------
// 6. invoke calls promptForRole with role="agentlab-database"
// ---------------------------------------------------------------------------

test("invoke calls agentRouter.promptForRole with role='agentlab-database'", async () => {
	const role = createAgentLabDatabaseRole();
	const llmResponse = JSON.stringify({
		integrityRisks: [
			{
				description: "Missing NOT NULL constraint",
				table: "users",
				column: "email",
			},
		],
		migrationSafety: "caution",
		recommendedAction: "Add NOT NULL constraint with default value",
		summary: "Database review: 1 integrity risk found",
	});
	const { router, calls } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("migration_added", { path: "migrations/001_init.sql" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-invoke-db",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	await role.invoke(input, input.context);

	assert.equal(calls.length, 1);
	assert.equal(calls[0]!.role, "agentlab-database");
	assert.ok(calls[0]!.message.length > 0);
});

// ---------------------------------------------------------------------------
// 7. invoke parses LLM response into RoleAdvisory with findings, summary, priority, evidenceRefs
// ---------------------------------------------------------------------------

test("invoke parses LLM response into RoleAdvisory with integrityRisks, migrationSafety, summary, priority, evidenceRefs", async () => {
	const role = createAgentLabDatabaseRole();
	const llmResponse = JSON.stringify({
		integrityRisks: [
			{
				description: "Foreign key missing index",
				table: "orders",
				column: "user_id",
			},
		],
		migrationSafety: "caution",
		recommendedAction: "Add index on foreign key column",
		summary: "1 integrity risk in migration",
	});
	const { router } = makeFakeAgentRouter(llmResponse);
	const { repository } = makeFakeRepository();

	const event = makeEvent("migration_added", { path: "migrations/002_orders.sql" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-parse-db",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-database");
	assert.equal(advisory.priority, 60);
	assert.ok(typeof advisory.ts === "string");
	assert.ok(typeof advisory.advisory === "string");
	assert.ok(Array.isArray(advisory.evidenceRefs));
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.integrityRisks), "integrityRisks must be an array");
	assert.equal(advisory.meta!.integrityRisks.length, 1);
	assert.equal(advisory.meta!.migrationSafety, "caution");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 8. invoke handles malformed LLM response with fallback
// ---------------------------------------------------------------------------

test("invoke handles a malformed LLM response by returning a fallback advisory with empty risks", async () => {
	const role = createAgentLabDatabaseRole();
	const { router } = makeFakeAgentRouter("NOT VALID JSON !!!");
	const { repository } = makeFakeRepository();

	const event = makeEvent("raw_sql_seen", { query: "DROP TABLE users" });
	const input: RoleInput = {
		event,
		inputSignature: "sig-malformed-db",
		context: {
			stateRoot: "/tmp/test",
			projectId: "test",
			now: new Date("2026-01-01T00:00:00.000Z"),
			router,
			repository,
		},
	};

	const advisory = await role.invoke(input, input.context);

	assert.equal(advisory.roleId, "agentlab-database");
	assert.equal(advisory.priority, 60);
	assert.ok(advisory.meta, "meta must be present");
	assert.ok(Array.isArray(advisory.meta!.integrityRisks), "integrityRisks must be an array");
	assert.equal(advisory.meta!.integrityRisks.length, 0, "integrityRisks must be empty for malformed response");
	assert.equal(advisory.meta!.migrationSafety, "caution", "malformed response defaults to caution");
	assert.ok(typeof advisory.meta!.summary === "string");
});

// ---------------------------------------------------------------------------
// 9. shouldFire respects cooldown
// ---------------------------------------------------------------------------

test("shouldFire respects the cooldown (same event within 5 min → skip)", () => {
	const role = createAgentLabDatabaseRole();
	const event = makeEvent("migration_added", { path: "migrations/003_test.sql" });
	const input = makeInput(event, "sig-cooldown-db");

	const lastFireAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date("2026-01-01T00:04:00.000Z"); // 4 min later, within 5 min cooldown

	const result = role.shouldFire(input, lastFireAt, now);
	assert.equal(result, false, "shouldFire must return false within cooldown window");

	const afterCooldown = new Date("2026-01-01T00:06:00.000Z"); // 6 min later
	const resultAfter = role.shouldFire(input, lastFireAt, afterCooldown);
	assert.equal(resultAfter, true, "shouldFire must return true after cooldown expires");
});
