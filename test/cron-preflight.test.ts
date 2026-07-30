import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeTempDir } from "./helpers/temp.js";
import { runCronPreflight } from "../src/cron-preflight.js";
import type { CronPreflightResult } from "../src/cron-preflight.js";
import { handleRunCronPreflight } from "../src/cli/supervisor/handlers.js";
import type { CliRuntime } from "../src/cli.js";
import { roleEngineConfigPath } from "../src/role-engine-config.js";
import type { PromptForRoleResult } from "../src/agent-router.js";

function makeRoot(): {
	projectRoot: string;
	stateRoot: string;
	cleanup: () => void;
} {
	const projectRoot = makeTempDir("idu-cron-preflight-");
	const stateRoot = join(projectRoot, "state");
	mkdirSync(stateRoot, { recursive: true });
	return {
		projectRoot,
		stateRoot,
		// Same contract as test/supervisor-categorize.test.ts: best-effort
		// immediate removal, with `makeTempDir` tracking the directory for the
		// helper's async afterEach and its exit sweep. A raw sync rmSync on
		// Windows hits transient ENOTEMPTY right after the test's own writes
		// (see the measurement in test/helpers/temp.ts), and these calls sit in
		// `finally` blocks, so the throw would replace a passing result with a
		// teardown failure.
		cleanup: () => {
			try {
				rmSync(projectRoot, {
					recursive: true,
					force: true,
					maxRetries: 5,
					retryDelay: 50,
				});
			} catch {
				// Tracked by makeTempDir; afterEach and the exit sweep finish it.
			}
		},
	};
}

function enableRole(stateRoot: string, role: string): void {
	let existing: Record<string, unknown> = {};
	const path = roleEngineConfigPath(stateRoot);
	if (existsSync(path)) {
		existing = JSON.parse(readFileSync(path, "utf8"));
	}
	const raw = {
		...existing,
		enabled: true,
		maxRoleInvocationsPerTurn: 50,
		roleEnabled: {
			...(existing.roleEnabled as Record<string, boolean> | undefined),
			[role]: true,
		},
		roleCooldownMs: {},
	};
	writeFileSync(path, JSON.stringify(raw), "utf8");
}

// A valid JSON array of one AgentLabFinding. Sensors must return this shape
// (per the sensor prompt contract) for the review to be "valid" and findings
// to reach the categorizer via the structured pipeline.
const VALID_SENSOR_FINDINGS_JSON = JSON.stringify([
	{
		title: "Missing aria-label",
		description: "The button element lacks an accessible label.",
		evidence: "src/Button.tsx:1",
		severity: "critical",
		confidence: "high",
		category: "ui_ux",
		affectedFiles: ["src/Button.tsx"],
		affectedFlows: [],
		relatedRules: [],
		controlPillars: ["quality"],
	},
]);

function successPrompt(output = "ok") {
	return async (
		role: string,
		_message: string,
		_options: unknown,
	): Promise<PromptForRoleResult> => ({
		ok: true,
		// Sensor roles must return a valid JSON findings array so the review
		// is "valid" and structured findings flow to the categorizer. The
		// supervisor-main role returns the categorization count string.
		output:
			role === "supervisor-main"
				? output
				: VALID_SENSOR_FINDINGS_JSON,
		provider: "test-provider",
		model: "test-model",
		role: "agentlab-ui-ux" as never,
	});
}

test("runCronPreflight: returns empty sensorImpulses and null advisory when no files match", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: ["random.xyz"],
			promptForRole: successPrompt(),
		});
		assert.deepEqual(result.sensorImpulses, []);
		assert.equal(result.supervisorAdvisory, null);
		assert.deepEqual(result.changedFiles, ["random.xyz"]);
	} finally {
		cleanup();
	}
});

test("runCronPreflight: returns sensorImpulses for matching files", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: ["src/Button.tsx", "styles.css"],
			promptForRole: successPrompt("audit passed"),
		});
		assert.equal(result.sensorImpulses.length, 2);
		assert.equal(result.sensorImpulses[0]?.match.role, "agentlab-ui-ux");
	} finally {
		cleanup();
	}
});

test("runCronPreflight: writes supervisor_advisory to injections.jsonl when role is enabled", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		enableRole(stateRoot, "supervisor-main");
		const result = await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: ["src/Button.tsx"],
			promptForRole: successPrompt("1 critical, 0 medium, 0 low"),
		});
		assert.equal(result.sensorImpulses.length, 1);
		assert.ok(result.supervisorAdvisory);
		assert.equal(
			result.supervisorAdvisory?.advisory?.summary,
			"1 critical, 0 medium, 0 low",
		);
		// injections.jsonl should have the supervisor advisory
		const injectionsPath = join(stateRoot, "injections.jsonl");
		const content = readFileSync(injectionsPath, "utf8");
		assert.ok(content.includes("supervisor_advisory"));
	} finally {
		cleanup();
	}
});

test("runCronPreflight: returns null supervisorAdvisory when supervisor role is NOT enabled", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		// Only enable ui-ux, not supervisor-main
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: ["src/Button.tsx"],
			promptForRole: successPrompt("ok"),
		});
		assert.equal(result.sensorImpulses.length, 1);
		// categorizeFindings returns a non-null result with reason=role_not_enabled
		// when the supervisor role is disabled. The advisory itself is undefined.
		assert.equal(result.supervisorAdvisory?.ok, false);
		assert.equal(result.supervisorAdvisory?.reason, "role_not_enabled");
		assert.equal(result.supervisorAdvisory?.advisory, undefined);
	} finally {
		cleanup();
	}
});

test("runCronPreflight: handles no changedFiles (empty array)", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: [],
			promptForRole: successPrompt(),
		});
		assert.equal(result.sensorImpulses.length, 0);
		assert.equal(result.supervisorAdvisory, null);
	} finally {
		cleanup();
	}
});

// =========================================================================
// F-W2-1: supervisor_advisory must write `emitted` lifecycle event
// (REGRESSION: previously written to injections.jsonl without emitted)
// =========================================================================

test("F-W2-1 RED→GREEN: supervisor_advisory in injections.jsonl has matching `emitted` event in injection-telemetry.jsonl", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		enableRole(stateRoot, "supervisor-main");
		await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: ["src/Button.tsx"],
			promptForRole: successPrompt("1 critical, 0 medium, 0 low"),
		});
		// injections.jsonl should have the supervisor_advisory
		const injectionsPath = join(stateRoot, "injections.jsonl");
		const injectionsContent = readFileSync(injectionsPath, "utf8");
		const advisoryLines = injectionsContent
			.split("\n")
			.filter((l) => l.trim() && l.includes("supervisor_advisory"));
		assert.ok(
			advisoryLines.length > 0,
			"injections.jsonl should have at least one supervisor_advisory",
		);
		// Extract the injectionId from the first advisory
		const advisory = JSON.parse(advisoryLines[0]) as { injectionId: string };
		assert.ok(
			typeof advisory.injectionId === "string",
			"supervisor_advisory must have an injectionId",
		);
		// injection-telemetry.jsonl must have a matching `emitted` event
		const telemetryPath = join(stateRoot, "injection-telemetry.jsonl");
		const telemetryContent = existsSync(telemetryPath)
			? readFileSync(telemetryPath, "utf8")
			: "";
		const emittedForAdvisory = telemetryContent
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l) as { injectionId: string; phase: string })
			.find(
				(e) => e.injectionId === advisory.injectionId && e.phase === "emitted",
			);
		assert.ok(
			emittedForAdvisory,
			`expected an 'emitted' lifecycle event for supervisor_advisory ${advisory.injectionId}, got telemetry: ${telemetryContent}`,
		);
	} finally {
		cleanup();
	}
});

// =========================================================================
// INVARIANT: every injection in injections.jsonl has a matching
// `emitted` lifecycle event. Generalized to ALL kinds (not just
// supervisor_advisory). Catches any future kind that bypasses the
// `emitted` hook — the exact gap that hid the F-W2-1 bug.
// =========================================================================

test("INVARIANT: every injection in injections.jsonl has a matching `emitted` lifecycle event (any kind)", async () => {
	const { projectRoot, stateRoot, cleanup } = makeRoot();
	try {
		// Drive the cron with enough surface to produce advisories of
		// multiple kinds: supervisor_advisory (via supervisor-main role)
		// and an objective_reminder (via plan-objective). Hygiene is
		// sensor-driven, not cron-driven here, so we cover 2 of the 3
		// known kinds; the assertion is per-kind, so the test holds
		// for any kind we add a cron emit hook to.
		enableRole(stateRoot, "agentlab-ui-ux");
		enableRole(stateRoot, "supervisor-main");
		await runCronPreflight({
			projectPath: projectRoot,
			stateRoot,
			changedFiles: ["src/Button.tsx"],
			promptForRole: successPrompt("1 critical, 0 medium, 0 low"),
		});
		const injectionsPath = join(stateRoot, "injections.jsonl");
		if (!existsSync(injectionsPath)) {
			// No advisories emitted this run (no sensor match). The
			// invariant vacuously holds.
			return;
		}
		const injectionLines = readFileSync(injectionsPath, "utf8")
			.split("\n")
			.filter((l) => l.trim());
		const injections = injectionLines.map((l) => {
			const obj = JSON.parse(l) as { injectionId: string; kind: string };
			return obj;
		});
		const telemetryPath = join(stateRoot, "injection-telemetry.jsonl");
		const telemetryContent = existsSync(telemetryPath)
			? readFileSync(telemetryPath, "utf8")
			: "";
		const telemetryEvents = telemetryContent
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l) as { injectionId: string; phase: string });
		const emittedIds = new Set(
			telemetryEvents
				.filter((e) => e.phase === "emitted")
				.map((e) => e.injectionId),
		);
		const missing = injections.filter(
			(inj) => !emittedIds.has(inj.injectionId),
		);
		assert.equal(
			missing.length,
			0,
			`invariant violated: ${missing.length} injection(s) in injections.jsonl have NO matching 'emitted' event in injection-telemetry.jsonl. Kinds: ${missing.map((m) => m.kind).join(", ")}`,
		);
	} finally {
		cleanup();
	}
});

// =========================================================================
// handleRunCronPreflight --json: surface structured metrics that the
// default one-line human summary discards. Opt-in and additive; the
// default path stays byte-identical.
// =========================================================================

// Minimal fake runtime: the handler only touches `runCronPreflight`, so we
// stub it to capture the changedFiles it received and return a controlled
// CronPreflightResult. Cast through unknown to satisfy the full CliRuntime
// type (the codebase convention for handler unit tests).
function makeStubRuntime(capture: { changedFiles?: string[] }, result: CronPreflightResult): CliRuntime {
	return {
		runCronPreflight: async (input: { changedFiles: readonly string[] }) => {
			capture.changedFiles = [...input.changedFiles];
			return result;
		},
	} as unknown as CliRuntime;
}

const STUB_METRICS = {
	totalMatches: 3,
	selectedMatches: 2,
	cappedOutMatches: 1,
	discardedByDepth: 1,
	discardedBySafetyCeiling: 0,
	completedCalls: 2,
	jsonValidCalls: 2,
	reportValidCalls: 2,
	totalValidatedFindings: 4,
	findingsRoutedByPillar: 3,
	findingsRoutedByFallback: 1,
	discards: [],
	perCall: [],
};

test("handleRunCronPreflight: default (no --json) emits the existing human line unchanged", async () => {
	const capture: { changedFiles?: string[] } = {};
	const runtime = makeStubRuntime(capture, {
		report: null,
		sensorImpulses: [
			{ match: {} } as never,
			{ match: {} } as never,
		],
		sensorImpulseMetrics: STUB_METRICS as never,
		supervisorAdvisory: {
			ok: true,
			counts: { critical: 1, medium: 0, low: 0 },
			advisory: {
				ts: "2026-01-01T00:00:00.000Z",
				kind: "supervisor_advisory",
				summary: "1 critical, 0 medium, 0 low",
				counts: { critical: 1, medium: 0, low: 0 },
				advisoryId: "adv-1",
				discardsCount: 0,
				discardsSummary: "",
			},
		},
		changedFiles: ["src/Button.tsx"],
	});
	const res = await handleRunCronPreflight(runtime, ["src/Button.tsx"]);
	assert.equal(res.exitCode, 0);
	assert.equal(
		res.stdout,
		"Cron preflight: sensorImpulses=2 supervisorAdvisory=1 critical, 0 medium, 0 low\n",
	);
	// No filtering: changedFiles passed through verbatim.
	assert.deepEqual(capture.changedFiles, ["src/Button.tsx"]);
});

test("handleRunCronPreflight: --json emits valid JSON with sensorImpulseMetrics routing fields", async () => {
	const capture: { changedFiles?: string[] } = {};
	const runtime = makeStubRuntime(capture, {
		report: null,
		sensorImpulses: [{ match: {} } as never],
		sensorImpulseMetrics: STUB_METRICS as never,
		supervisorAdvisory: {
			ok: true,
			counts: { critical: 1, medium: 0, low: 0 },
			advisory: {
				ts: "2026-01-01T00:00:00.000Z",
				kind: "supervisor_advisory",
				summary: "1 critical, 0 medium, 0 low",
				counts: { critical: 1, medium: 0, low: 0 },
				advisoryId: "adv-1",
				discardsCount: 2,
				discardsSummary: "2 discarded (depth_cap: agentlab-ui-ux=2)",
			},
		},
		changedFiles: ["src/Button.tsx"],
	});
	const res = await handleRunCronPreflight(runtime, ["--json", "src/Button.tsx"]);
	assert.equal(res.exitCode, 0);
	// Strip the trailing newline before parsing.
	const parsed = JSON.parse(res.stdout.replace(/\n$/, "")) as Record<string, unknown>;
	assert.equal(parsed.sensorImpulses, 1);
	const metrics = parsed.sensorImpulseMetrics as Record<string, unknown>;
	assert.equal(metrics.totalValidatedFindings, 4);
	assert.equal(metrics.findingsRoutedByPillar, 3);
	assert.equal(metrics.findingsRoutedByFallback, 1);
	const advisory = parsed.supervisorAdvisory as Record<string, unknown>;
	assert.equal(advisory.ok, true);
	assert.equal(advisory.summary, "1 critical, 0 medium, 0 low");
	assert.deepEqual(advisory.counts, { critical: 1, medium: 0, low: 0 });
	assert.equal(advisory.discardsCount, 2);
	assert.equal(advisory.discardsSummary, "2 discarded (depth_cap: agentlab-ui-ux=2)");
});

test("handleRunCronPreflight: --json is filtered out of changedFiles (not passed to runCronPreflight)", async () => {
	const capture: { changedFiles?: string[] } = {};
	const runtime = makeStubRuntime(capture, {
		report: null,
		sensorImpulses: [],
		sensorImpulseMetrics: STUB_METRICS as never,
		supervisorAdvisory: null,
		changedFiles: [],
	});
	await handleRunCronPreflight(runtime, ["--json", "src/A.ts", "src/B.ts"]);
	// --json must NOT appear in changedFiles; only the real file args.
	assert.deepEqual(capture.changedFiles, ["src/A.ts", "src/B.ts"]);
	assert.ok(
		!capture.changedFiles?.includes("--json"),
		"--json leaked into changedFiles",
	);
});

test("handleRunCronPreflight: --json with null supervisorAdvisory emits null", async () => {
	const runtime = makeStubRuntime(
		{},
		{
			report: null,
			sensorImpulses: [],
			sensorImpulseMetrics: STUB_METRICS as never,
			supervisorAdvisory: null,
			changedFiles: [],
		},
	);
	const res = await handleRunCronPreflight(runtime, ["--json"]);
	const parsed = JSON.parse(res.stdout.replace(/\n$/, "")) as Record<string, unknown>;
	assert.equal(parsed.supervisorAdvisory, null);
	assert.equal(parsed.sensorImpulses, 0);
});
