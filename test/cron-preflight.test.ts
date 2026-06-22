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
import { runCronPreflight } from "../src/cron-preflight.js";
import { roleEngineConfigPath } from "../src/role-engine-config.js";
import type { PromptForRoleResult } from "../src/agent-router.js";

function makeRoot(): {
	projectRoot: string;
	stateRoot: string;
	cleanup: () => void;
} {
	const projectRoot = mkdtempSync(join(tmpdir(), "idu-cron-preflight-"));
	const stateRoot = join(projectRoot, "state");
	mkdirSync(stateRoot, { recursive: true });
	return {
		projectRoot,
		stateRoot,
		cleanup: () => rmSync(projectRoot, { recursive: true, force: true }),
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

function successPrompt(output = "ok") {
	return async (
		_role: string,
		_message: string,
		_options: unknown,
	): Promise<PromptForRoleResult> => ({
		ok: true,
		output,
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
