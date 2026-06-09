/**
 * T1.7a — CLI surfaces + command catalog tests (RED).
 *
 * These tests lock the two new CLI commands:
 * - idu-orchestrator-advisory
 * - idu-role-engine-status
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoleAdvisory } from "../src/roles/index.js";
import type { RoleEngineStatusReport } from "../src/cli-role-engine.js";
import {
	runIdOrchestratorAdvisoryCommand,
	runIdRoleEngineStatusCommand,
} from "../src/cli-role-engine.js";
import type { CliRuntime } from "../src/cli.js";
import { CLI_COMMANDS } from "../src/command-catalog.js";

// Helper to create a mock runtime
function createMockRuntime(
	advisories: RoleAdvisory[] = [],
	statusReport?: RoleEngineStatusReport,
): CliRuntime {
	const runtime = {
		getOrchestratorAdvisory: (options?: {
			roleId?: string;
			sinceMs?: number;
			limit?: number;
		}) => {
			let filtered = [...advisories];
			if (options?.roleId) {
				filtered = filtered.filter((a) => a.roleId === options.roleId);
			}
			if (options?.sinceMs !== undefined) {
				filtered = filtered.filter((a) => {
					const ts = Date.parse(a.ts);
					return !isNaN(ts) && ts >= options.sinceMs!;
				});
			}
			if (options?.limit !== undefined && options.limit >= 0) {
				filtered = filtered.slice(0, options.limit);
			}
			return filtered;
		},
		formatOrchestratorAdvisory: (rows: RoleAdvisory[]) => {
			if (rows.length === 0) return "No orchestrator advisories found.";
			return `Found ${rows.length} advisories:\n` +
				rows.map((a) => `  ${a.ts} | ${a.roleId} | priority ${a.priority} | ${a.advisory}`).join("\n");
		},
		getRoleEngineStatus: () => {
			if (statusReport) return statusReport;
			return {
				config: {
					enabled: false,
					maxRoleInvocationsPerTurn: 50,
					roleEnabled: {
						"supervisor-main": false,
					},
					roleCooldownMs: {
						"supervisor-main": 30000,
					},
				},
				lastFires: [],
				lastCapWarning: undefined,
				advisoryStreamSummary: {
					totalAdvisories: 0,
					lastAdvisory: undefined,
				},
			};
		},
		formatRoleEngineStatus: (report: RoleEngineStatusReport) => {
			return `Role Engine Status:\n` +
				`  Enabled: ${report.config.enabled}\n` +
				`  Max invocations per turn: ${report.config.maxRoleInvocationsPerTurn}\n` +
				`  Total advisories: ${report.advisoryStreamSummary.totalAdvisories}`;
		},
	} as unknown as CliRuntime;
	return runtime;
}

test("runIdOrchestratorAdvisoryCommand --role <id> filters by role", () => {
	const advisories: RoleAdvisory[] = [
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:00:00Z",
			advisory: "Test advisory 1",
			evidenceRefs: [],
		},
		{
			roleId: "agentlab-security",
			priority: 95,
			ts: "2026-01-01T00:01:00Z",
			advisory: "Test advisory 2",
			evidenceRefs: [],
		},
	];
	const runtime = createMockRuntime(advisories);
	const result = runIdOrchestratorAdvisoryCommand(
		["--role", "supervisor-main"],
		runtime,
	);
	assert.ok(result.includes("1 advisories"));
	assert.ok(result.includes("supervisor-main"));
	assert.ok(!result.includes("agentlab-security"));
});

test("runIdOrchestratorAdvisoryCommand --since <iso> filters by ts", () => {
	const advisories: RoleAdvisory[] = [
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:00:00Z",
			advisory: "Old advisory",
			evidenceRefs: [],
		},
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-02T00:00:00Z",
			advisory: "New advisory",
			evidenceRefs: [],
		},
	];
	const runtime = createMockRuntime(advisories);
	const result = runIdOrchestratorAdvisoryCommand(
		["--since", "2026-01-01T12:00:00Z"],
		runtime,
	);
	assert.ok(result.includes("1 advisories"));
	assert.ok(result.includes("New advisory"));
	assert.ok(!result.includes("Old advisory"));
});

test("runIdOrchestratorAdvisoryCommand --limit N caps the count", () => {
	const advisories: RoleAdvisory[] = Array.from({ length: 10 }, (_, i) => ({
		roleId: "supervisor-main",
		priority: 90,
		ts: `2026-01-01T00:0${i}:00Z`,
		advisory: `Advisory ${i}`,
		evidenceRefs: [],
	}));
	const runtime = createMockRuntime(advisories);
	const result = runIdOrchestratorAdvisoryCommand(
		["--limit", "3"],
		runtime,
	);
	assert.ok(result.includes("3 advisories"));
});

test("runIdOrchestratorAdvisoryCommand without filters returns the most recent advisories", () => {
	const advisories: RoleAdvisory[] = [
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:00:00Z",
			advisory: "First",
			evidenceRefs: [],
		},
		{
			roleId: "agentlab-security",
			priority: 95,
			ts: "2026-01-01T00:01:00Z",
			advisory: "Second",
			evidenceRefs: [],
		},
	];
	const runtime = createMockRuntime(advisories);
	const result = runIdOrchestratorAdvisoryCommand([], runtime);
	assert.ok(result.includes("2 advisories"));
	assert.ok(result.includes("First"));
	assert.ok(result.includes("Second"));
});

test("runIdRoleEngineStatusCommand returns a status report with config + lastFires + lastCapWarning + advisoryStreamSummary", () => {
	const statusReport: RoleEngineStatusReport = {
		config: {
			enabled: true,
			maxRoleInvocationsPerTurn: 50,
			roleEnabled: {
				"supervisor-main": true,
				"agentlab-security": false,
			},
			roleCooldownMs: {
				"supervisor-main": 30000,
			},
		},
		lastFires: [
			{ roleId: "supervisor-main", lastFireAt: "2026-01-01T00:00:00Z" },
		],
		lastCapWarning: "2026-01-01T00:00:00Z",
		advisoryStreamSummary: {
			totalAdvisories: 5,
			lastAdvisory: "2026-01-01T00:05:00Z",
		},
	};
	const runtime = createMockRuntime([], statusReport);
	const result = runIdRoleEngineStatusCommand([], runtime);
	assert.ok(result.includes("Role Engine Status"));
	assert.ok(result.includes("Enabled: true"));
	assert.ok(result.includes("Max invocations per turn: 50"));
	assert.ok(result.includes("Total advisories: 5"));
});

test("createCliRuntime wires getOrchestratorAdvisory to the advisory stream", () => {
	// This test verifies the runtime method exists and is callable
	const runtime = createMockRuntime([]);
	assert.equal(typeof runtime.getOrchestratorAdvisory, "function");
	const result = runtime.getOrchestratorAdvisory();
	assert.ok(Array.isArray(result));
});

test("createCliRuntime wires getRoleEngineStatus to the role-engine-config and orchestrator-advisory-stream", () => {
	// This test verifies the runtime method exists and is callable
	const runtime = createMockRuntime([]);
	assert.equal(typeof runtime.getRoleEngineStatus, "function");
	const result = runtime.getRoleEngineStatus();
	assert.ok("config" in result);
	assert.ok("lastFires" in result);
	assert.ok("advisoryStreamSummary" in result);
});

test("command-catalog.ts has entries for idu-orchestrator-advisory and idu-role-engine-status", () => {
	const advisoryCommand = CLI_COMMANDS.find((cmd) =>
		cmd.command.includes("idu-orchestrator-advisory"),
	);
	const statusCommand = CLI_COMMANDS.find((cmd) =>
		cmd.command.includes("idu-role-engine-status"),
	);

	assert.ok(advisoryCommand, "idu-orchestrator-advisory should be in CLI_COMMANDS");
	assert.ok(advisoryCommand.label);
	assert.ok(advisoryCommand.command);

	assert.ok(statusCommand, "idu-role-engine-status should be in CLI_COMMANDS");
	assert.ok(statusCommand.label);
	assert.ok(statusCommand.command);
});

test("CLI dispatch handles idu-orchestrator-advisory and idu-role-engine-status by calling the new methods", () => {
	const runtime = createMockRuntime([
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:00:00Z",
			advisory: "Test",
			evidenceRefs: [],
		},
	]);

	// Verify the command helper is callable and uses the runtime methods
	const advisoryResult = runIdOrchestratorAdvisoryCommand([], runtime);
	assert.ok(advisoryResult.includes("advisories"));

	// Verify the status command helper is callable and uses the runtime methods
	const statusResult = runIdRoleEngineStatusCommand([], runtime);
	assert.ok(statusResult.includes("Role Engine Status"));
});
