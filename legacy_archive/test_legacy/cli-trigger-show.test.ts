import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCliCommand, createCliRuntime } from "../src/cli.js";

// Set up a hermetic environment
const HERMETIC_ROOT = mkdtempSync(join(tmpdir(), "idu-cli-trigger-show-env-"));
const HERMETIC_PROJECT = join(HERMETIC_ROOT, "project");
const HERMETIC_WORKSPACE = join(HERMETIC_ROOT, "workspace");
mkdirSync(HERMETIC_PROJECT, { recursive: true });
mkdirSync(HERMETIC_WORKSPACE, { recursive: true });
process.env.DEFAULT_CWD = HERMETIC_PROJECT;
process.env.ALLOWED_ROOTS = HERMETIC_ROOT;
process.env.AGENT_WORKSPACE_ROOT = HERMETIC_WORKSPACE;
process.env.IDU_PI_REGISTRY_PATH = join(
	HERMETIC_ROOT,
	"registry",
	"projects.json",
);
process.env.TELEGRAM_BOT_TOKEN = "cli-trigger-show-test-token";
process.env.ALLOWED_USER_ID = "12345";

test("idu-trigger-show objective_reminder_hourly exits 0 and contains cadence", async () => {
	const runtime = createCliRuntime();
	const result = await runCliCommand(
		["idu-trigger-show", "objective_reminder_hourly"],
		runtime,
	);

	assert.equal(result.exitCode, 0, "Should exit with code 0");
	assert.ok(
		result.stdout.includes("objective_reminder_hourly"),
		"Should contain trigger id",
	);
	assert.ok(result.stdout.includes("1h"), "Should contain cadence string '1h'");
});

test("idu-trigger-show unknown trigger exits non-zero", async () => {
	const runtime = createCliRuntime();
	const result = await runCliCommand(
		["idu-trigger-show", "unknown_trigger_xyz"],
		runtime,
	);

	assert.notEqual(result.exitCode, 0, "Should exit with non-zero code");
	assert.ok(
		result.stderr.includes("not found") || result.stdout.includes("not found"),
		"Should indicate trigger not found",
	);
});
