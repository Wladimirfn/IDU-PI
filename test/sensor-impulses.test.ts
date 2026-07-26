import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runSensorImpulses } from "../src/sensor-impulses.js";
import { roleEngineConfigPath } from "../src/role-engine-config.js";
import { flushSupervisorResponseHistory } from "../src/supervisor-response-history.js";
import type { PromptForRoleResult } from "../src/agent-router.js";
import { makeTempDir } from "./helpers/temp.js";

function makeRoot(): {
	root: string;
	stateRoot: string;
	cleanup: () => Promise<void>;
} {
	const root = makeTempDir("idu-sensor-impulse-");
	const stateRoot = join(root, "state");
	mkdirSync(stateRoot, { recursive: true });
	return {
		root,
		stateRoot,
		// Await the deferred supervisor response writes before cleanup.
		// Without this, the fire-and-forget write from consultSupervisor
		// races with dir removal → ENOTEMPTY on Windows (issue #342).
		cleanup: async () => {
			await flushSupervisorResponseHistory(stateRoot);
		},
	};
}

function enableRole(stateRoot: string, role: string): void {
	const raw = {
		enabled: true,
		maxRoleInvocationsPerTurn: 50,
		roleEnabled: { [role]: true },
		roleCooldownMs: {},
	};
	writeFileSync(roleEngineConfigPath(stateRoot), JSON.stringify(raw), "utf8");
}

function successPrompt(
	output = "Audit passed",
): (
	role: string,
	message: string,
	options: unknown,
) => Promise<PromptForRoleResult> {
	return async () => ({
		ok: true,
		output,
		provider: "test-provider",
		model: "test-model",
		role: "supervisor-main" as never,
	});
}

function failingPrompt(): (
	role: string,
	message: string,
	options: unknown,
) => Promise<PromptForRoleResult> {
	return async () => ({
		ok: false,
		output: "model error",
		provider: "test-provider",
		model: "test-model",
		role: "supervisor-main" as never,
	});
}

test("runSensorImpulses: returns empty array when no files match sensors", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runSensorImpulses({
			stateRoot,
			projectRoot: root,
			changedFiles: ["random.xyz", "unknown.foo"],
			promptForRole: successPrompt(),
		});
		assert.deepEqual(result, []);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: returns one impulse per sensor match", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		enableRole(stateRoot, "agentlab-architecture");
		const result = await runSensorImpulses({
			stateRoot,
			projectRoot: root,
			changedFiles: ["src/Button.tsx", "styles.css", "src/cli.ts"],
			promptForRole: successPrompt(),
		});
		// Button.tsx → ui-ux, styles.css → ui-ux, src/cli.ts → architecture = 3 matches
		assert.equal(result.length, 3, "three sensor matches");
		const roles = result.map((r) => r.match.role);
		assert.equal(roles.filter((r) => r === "agentlab-ui-ux").length, 2);
		assert.equal(roles.filter((r) => r === "agentlab-architecture").length, 1);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: file content is read from projectRoot and passed as context", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		// Create a real file in the project root
		const filePath = join(root, "src/Button.tsx");
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(
			filePath,
			"export const Button = () => <button>Click</button>;",
			"utf8",
		);
		const wrapper = async (
			_role: string,
			_message: string,
			_options: unknown,
		): Promise<PromptForRoleResult> => ({
			ok: true,
			output: "ok",
			provider: "p",
			model: "m",
			role: "supervisor-main" as never,
		});
		const result2 = await runSensorImpulses({
			stateRoot,
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: wrapper,
		});
		assert.ok(result2[0]?.fileContent);
		assert.ok(
			result2[0]?.fileContent?.includes("Button"),
			"file content should include Button",
		);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: missing file produces fileContent=undefined but still runs consult", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runSensorImpulses({
			stateRoot,
			projectRoot: root,
			changedFiles: ["src/does-not-exist.tsx"],
			promptForRole: successPrompt("ok despite missing file"),
		});
		assert.equal(result.length, 1);
		assert.equal(result[0]?.fileContent, undefined);
		assert.equal(result[0]?.consult.ok, true);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: failing model returns ok=false but still produces a result entry", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "agentlab-ui-ux");
		const result = await runSensorImpulses({
			stateRoot,
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: failingPrompt(),
		});
		assert.equal(result.length, 1);
		assert.equal(result[0]?.consult.ok, false);
		assert.equal(result[0]?.consult.response, "model error");
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: role not enabled returns reason=role_not_enabled in result", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		// role-engine.json absent or role not enabled
		const result = await runSensorImpulses({
			stateRoot,
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: successPrompt(),
		});
		assert.equal(result.length, 1);
		assert.equal(result[0]?.consult.ok, false);
		assert.equal(result[0]?.consult.reason, "role_not_enabled");
	} finally {
		await cleanup();
	}
});
