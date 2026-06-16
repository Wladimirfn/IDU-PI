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
import { dirname, join } from "node:path";
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

test("detectContractDrift emits a violation when data-retention contract is approved but retention.json is missing", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = detectContractDrift({
			stateRoot: root,
			plan: {
				approvedContracts: [
					{
						contractId: "data-retention",
						claim: "Stores must declare retention, backup, and cleanup",
						severity: "critical",
					},
				],
			},
		});
		assert.equal(result.scannedContracts, 1);
		assert.equal(result.violations.length, 1);
		const v = result.violations[0];
		assert.equal(v?.contractId, "data-retention");
		assert.equal(v?.severity, "critical");
		assert.ok(
			(v?.evidence ?? "").includes("retention.json"),
			"evidence must mention retention.json",
		);
	} finally {
		cleanup();
	}
});

test("detectContractDrift returns 0 violations when data-retention contract is approved and retention.json is valid", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(
			join(root, "retention.json"),
			JSON.stringify({
				version: 1,
				stores: {
					"events.jsonl": { maxAgeDays: 30, maxLines: 10000 },
					"lab.db": { maxAgeDays: 90, vacuumOnStartup: true },
				},
			}),
			"utf8",
		);
		const result = detectContractDrift({
			stateRoot: root,
			plan: {
				approvedContracts: [
					{
						contractId: "data-retention",
						claim: "Stores must declare retention",
						severity: "critical",
					},
				],
			},
		});
		assert.equal(result.scannedContracts, 1);
		assert.equal(result.violations.length, 0);
	} finally {
		cleanup();
	}
});

test("detectContractDrift emits a violation when retention.json has empty stores", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(
			join(root, "retention.json"),
			JSON.stringify({ version: 1, stores: {} }),
			"utf8",
		);
		const result = detectContractDrift({
			stateRoot: root,
			plan: {
				approvedContracts: [
					{
						contractId: "data-retention",
						claim: "Stores must declare retention",
						severity: "critical",
					},
				],
			},
		});
		assert.equal(result.violations.length, 1);
		assert.ok((result.violations[0]?.evidence ?? "").includes("empty"));
	} finally {
		cleanup();
	}
});

test("detectContractDrift skips unknown contractIds (no checker registered)", () => {
	const { root, cleanup } = makeRoot();
	try {
		const result = detectContractDrift({
			stateRoot: root,
			plan: {
				approvedContracts: [
					{
						contractId: "future-checker-not-yet-implemented",
						claim: "Future claim",
						severity: "warning",
					},
				],
			},
		});
		assert.equal(result.scannedContracts, 1);
		assert.equal(result.violations.length, 0);
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
		// Pass an explicit registryPath so the test does not pollute the
		// project's real data/projects.json (which is process.cwd()/data/projects.json
		// by default). The bug caused the live registry to be overwritten with
		// the temp project on every contract-drift test run.
		const registryPath = join(root, "data", "projects.json");
		mkdirSync(dirname(registryPath), { recursive: true });
		const result = runIduBootstrap({
			projectPath,
			config: makeConfig(root),
			registryPath,
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

test("runIduBootstrap with explicit registryPath does NOT write to process.cwd() (regression)", () => {
	// Guards against the registry-pollution bug. The previous version
	// of runIduBootstrap used process.cwd()/data/projects.json as the
	// default registry path. Tests that called bootstrap with a temp
	// projectPath would overwrite the project's real registry with
	// the temp project. This regression test ensures the explicit
	// registryPath is respected, not the cwd fallback.
	const { root, cleanup } = makeRoot();
	try {
		const projectPath = join(root, "project");
		mkdirSync(projectPath, { recursive: true });
		writeFileSync(join(projectPath, "package.json"), "{}", "utf8");
		const registryPath = join(root, "data", "projects.json");
		mkdirSync(dirname(registryPath), { recursive: true });
		// Snapshot the real registry (if it exists) to detect any pollution.
		const realRegistryPath = join(process.cwd(), "data", "projects.json");
		const realRegistryBefore = existsSync(realRegistryPath)
			? readFileSync(realRegistryPath, "utf8")
			: null;
		// Run with the EXPLICIT registryPath.
		runIduBootstrap({
			projectPath,
			config: makeConfig(root),
			registryPath,
		});
		// The TEMP registry should now exist.
		assert.ok(
			existsSync(registryPath),
			"temp registry file should be created at the explicit registryPath",
		);
		// The project's REAL registry (process.cwd()/data/projects.json)
		// should NOT have changed.
		if (realRegistryBefore !== null) {
			const realRegistryAfter = readFileSync(realRegistryPath, "utf8");
			assert.equal(
				realRegistryAfter,
				realRegistryBefore,
				"project's real registry was modified when an explicit registryPath was provided",
			);
		}
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
		writeFileSync(planPath, JSON.stringify({ status: "approved" }), "utf8");
		const plan = readPlan(planPath);
		assert.equal(plan, undefined);
	} finally {
		cleanup();
	}
});
