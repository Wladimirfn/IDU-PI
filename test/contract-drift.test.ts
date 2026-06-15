import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BridgeConfig } from "../src/config.js";
import { detectContractDrift } from "../src/contract-drift.js";
import { readEvents } from "../src/event-bus.js";
import { runIduBootstrap } from "../src/idu-bootstrap.js";
import { runMcpContextPackAutoRefreshTick } from "../src/mcp-context-pack-auto-refresh-invocation.js";
import { readPlan } from "../src/master-plan.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-drift-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

function makeConfig(root: string): BridgeConfig {
	return {
		telegramBotToken: "test-token",
		allowedUserId: 1,
		defaultCwd: root,
		allowedRoots: [root],
		piBin: "pi",
		piArgs: [],
		agentProfiles: [],
		agentWorkspaceRoot: join(root, ".idu-state"),
		agentWorkspaceMode: "direct",
		iduGovernance: {
			mcpAuthorityMode: "advisory",
			agentLabMode: "audit_only",
			workspaceOwner: "orchestrator",
			autoRefreshLabProfiles: false,
		},
	};
}

test("detectContractDrift returns 0 violations and 0 scannedContracts for plan with no approved contracts", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = detectContractDrift({
			stateRoot: root,
			plan: { approvedContracts: [] },
		});
		assert.equal(result.violations.length, 0);
		assert.equal(result.scannedContracts, 0);
	} finally {
		cleanup();
	}
});

test("detectContractDrift returns 0 violations for a plan with no approvedContracts key", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = detectContractDrift({
			stateRoot: root,
			plan: { status: "approved" },
		});
		assert.equal(result.violations.length, 0);
		assert.equal(result.scannedContracts, 0);
	} finally {
		cleanup();
	}
});

test("detectContractDrift returns 0 violations even when approvedContracts is non-empty (placeholder behavior)", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = detectContractDrift({
			stateRoot: root,
			plan: {
				approvedContracts: [
					{
						contractId: "auth-no-secrets",
						claim: "Password and tokens must never be logged",
						severity: "critical",
					},
				],
			},
		});
		assert.equal(result.violations.length, 0);
		assert.equal(result.scannedContracts, 1);
	} finally {
		cleanup();
	}
});

test("detectContractDrift handles null plan without throwing", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = detectContractDrift({ stateRoot: root, plan: null });
		assert.equal(result.violations.length, 0);
		assert.equal(result.scannedContracts, 0);
	} finally {
		cleanup();
	}
});

test("runIduBootstrap writes idu-ready.json to the stateRoot", () => {
	const { root, cleanup } = makeRoot();
	try {
		const projectPath = join(root, "project");
		mkdirSync(projectPath, { recursive: true });
		writeFileSync(join(projectPath, "package.json"), "{}", "utf8");
		const result = runIduBootstrap({
			projectPath,
			config: makeConfig(root),
		});
		const readyPath = join(result.statePaths.stateRoot, "idu-ready.json");
		assert.ok(existsSync(readyPath), "idu-ready.json must exist");
		const ready = JSON.parse(readFileSync(readyPath, "utf8")) as {
			version?: number;
			projectId?: string;
			readyAt?: string;
			gitHead?: string;
		};
		assert.equal(ready.version, 1);
		assert.equal(ready.projectId, result.project.id);
		assert.ok(typeof ready.readyAt === "string");
	} finally {
		cleanup();
	}
});

test("runMcpContextPackAutoRefreshTick runs without crashing when no plan exists yet", () => {
	const { root, cleanup } = makeRoot();
	try {
		// No master-plan.json in stateRoot: readPlan returns undefined,
		// detectContractDrift handles null, tick must complete cleanly.
		const result = runMcpContextPackAutoRefreshTick({
			stateRoot: root,
			projectId: "demo",
			iduActive: true,
			now: new Date("2026-06-15T00:00:00Z"),
		});
		assert.ok(result.ran || !result.ran); // either branch is fine; no throw
	} finally {
		cleanup();
	}
});

test("runMcpContextPackAutoRefreshTick does not emit contract_drift_violation when approvedContracts is empty", () => {
	const { root, cleanup } = makeRoot();
	try {
		// Seed: master-plan.json with no approved contracts
		const planPath = join(root, "master-plan.json");
		writeFileSync(
			planPath,
			JSON.stringify({
				version: "1.0.0",
				schemaVersion: 2,
				projectId: "demo",
				projectPath: root,
				gitHead: "abc",
				generatedAt: new Date().toISOString(),
				status: "approved",
				approvedContracts: [],
			}),
			"utf8",
		);
		// Seed: a stale event so the auto-refresh decision is "stale_and_ready"
		const eventsPath = join(root, "events.jsonl");
		writeFileSync(
			eventsPath,
			`${JSON.stringify({
				ts: "2026-06-14T20:00:00.000Z",
				kind: "mcp_context_pack_refreshed",
				projectId: "demo",
				payload: {},
				sourceRef: "seed",
				evidenceRefs: [],
			})}\n`,
			"utf8",
		);
		runMcpContextPackAutoRefreshTick({
			stateRoot: root,
			projectId: "demo",
			iduActive: true,
			now: new Date("2026-06-15T00:30:00Z"),
		});
		const events = readEvents(root, {});
		const driftEvents = events.filter(
			(e) => e.kind === "contract_drift_violation",
		);
		assert.equal(
			driftEvents.length,
			0,
			"no contract_drift_violation events when approvedContracts is empty",
		);
	} finally {
		cleanup();
	}
});

test("readPlan returns undefined for an incompatible plan shape", () => {
	const { root, cleanup } = makeRoot();
	try {
		const planPath = join(root, "master-plan.json");
		// Minimal seed that fails compatibility: schemaVersion 0
		writeFileSync(
			planPath,
			JSON.stringify({ status: "approved" }),
			"utf8",
		);
		const plan = readPlan(planPath);
		assert.equal(plan, undefined);
	} finally {
		cleanup();
	}
});
