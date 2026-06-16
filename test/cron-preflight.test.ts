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
			promptForRole: successPrompt("ok"),
		});
		assert.equal(result.sensorImpulses.length, 1);
		assert.ok(result.supervisorAdvisory);
		assert.equal(
			result.supervisorAdvisory?.advisory?.summary,
			"0 critical, 0 medium, 0 low",
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
