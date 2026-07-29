import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	agentLabSpecialtyForSensorRole,
	computeSensorReportIdentity,
	runSensorImpulses,
	selectSensorMatches,
} from "../src/sensor-impulses.js";
import { roleEngineConfigPath } from "../src/role-engine-config.js";
import { flushSupervisorResponseHistory } from "../src/supervisor-response-history.js";
import type { PromptForRoleResult } from "../src/agent-router.js";
import { SENSORS, type SensorMatch } from "../src/sensors.js";
import type { IduModelRoleId } from "../src/model-assignments.js";
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

function enableRoles(stateRoot: string, roles: readonly string[]): void {
	const raw = {
		enabled: true,
		maxRoleInvocationsPerTurn: 50,
		roleEnabled: Object.fromEntries(roles.map((role) => [role, true])),
		roleCooldownMs: {},
	};
	writeFileSync(roleEngineConfigPath(stateRoot), JSON.stringify(raw), "utf8");
}

const validFinding = {
	title: "Missing validation",
	description: "The changed code accepts unvalidated input.",
	evidence: "src/Button.tsx:1",
	severity: "medium",
	confidence: "high",
	category: "code_quality",
	affectedFiles: ["src/Button.tsx"],
	affectedFlows: ["postflight"],
	relatedRules: [],
	controlPillars: ["quality"],
};

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

function emptyOkResponse(): PromptForRoleResult {
	return {
		ok: true,
		output: "[]",
		provider: "test-provider",
		model: "test-model",
		role: "supervisor-main" as never,
	};
}

test("runSensorImpulses: returns empty array when no files match sensors", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["random.xyz", "unknown.foo"],
			promptForRole: successPrompt(),
		});
		assert.deepEqual(result.impulses, []);
		assert.deepEqual(result.metrics, {
			totalMatches: 0,
			selectedMatches: 0,
			cappedOutMatches: 0,
			discardedByDepth: 0,
			discardedBySafetyCeiling: 0,
			completedCalls: 0,
			jsonValidCalls: 0,
			reportValidCalls: 0,
			totalValidatedFindings: 0,
			findingsRoutedByPillar: 0,
			findingsRoutedByFallback: 0,
			discards: [],
			perCall: [],
		});
		assert.deepEqual(result.discards, []);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: returns one impulse per sensor match", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux", "agentlab-architecture"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/Button.tsx", "styles.css", "src/cli.ts"],
			promptForRole: successPrompt(),
		});
		// Button.tsx → ui-ux, styles.css → ui-ux, src/cli.ts → architecture = 3 matches
		assert.equal(result.impulses.length, 3, "three sensor matches");
		const roles = result.impulses.map((r) => r.match.role);
		assert.equal(roles.filter((r) => r === "agentlab-ui-ux").length, 2);
		assert.equal(roles.filter((r) => r === "agentlab-architecture").length, 1);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: file content is read from projectRoot and passed as context", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux"]);
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
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: wrapper,
		});
		assert.ok(result2.impulses[0]?.fileContent);
		assert.ok(
			result2.impulses[0]?.fileContent?.includes("Button"),
			"file content should include Button",
		);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: missing file produces fileContent=undefined but still runs consult", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/does-not-exist.tsx"],
			promptForRole: successPrompt("ok despite missing file"),
		});
		assert.equal(result.impulses.length, 1);
		assert.equal(result.impulses[0]?.fileContent, undefined);
		assert.equal(result.impulses[0]?.consult.ok, true);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: failing model returns ok=false but still produces a result entry", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: failingPrompt(),
		});
		assert.equal(result.impulses.length, 1);
		assert.equal(result.impulses[0]?.consult.ok, false);
		assert.equal(result.impulses[0]?.consult.response, "model error");
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
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: successPrompt(),
		});
		assert.equal(result.impulses.length, 1);
		assert.equal(result.impulses[0]?.consult.ok, false);
		assert.equal(result.impulses[0]?.consult.reason, "role_not_enabled");
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: validates a local report from one JSON array response", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux"]);
		let prompt = "";
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-project",
			projectRoot: root,
			changedFiles: ["src/Button.tsx"],
			promptForRole: async (_role, message) => {
				prompt = message;
				return {
					ok: true,
					output: JSON.stringify([validFinding]),
					provider: "test-provider",
					model: "test-model",
					role: "supervisor-main" as never,
				};
			},
		});
		const impulse = result.impulses[0];
		assert.equal(impulse?.consult.response, JSON.stringify([validFinding]));
		assert.equal(impulse?.review.status, "valid");
		assert.equal(impulse?.review.report?.projectId, "sensor-project");
		assert.equal(impulse?.review.report?.specialty, "ui_ux");
		assert.deepEqual(impulse?.review.report?.qualityFindings, [validFinding]);
		assert.deepEqual(impulse?.review.report?.safetyFindings, []);
		assert.equal(impulse?.review.report?.requiresHumanApproval, true);
		assert.match(prompt, /Return ONLY a JSON array/u);
		assert.doesNotMatch(prompt, /requestId|projectId|qualityFindings/u);
		assert.deepEqual(result.metrics, {
			totalMatches: 1,
			selectedMatches: 1,
			cappedOutMatches: 0,
			discardedByDepth: 0,
			discardedBySafetyCeiling: 0,
			completedCalls: 1,
			jsonValidCalls: 1,
			reportValidCalls: 1,
			totalValidatedFindings: 1,
			findingsRoutedByPillar: 1,
			findingsRoutedByFallback: 0,
			discards: [],
			perCall: [
				{
					file: "src/Button.tsx",
					role: "agentlab-ui-ux",
					validJson: true,
					validatedReport: true,
					findingsCount: 1,
				},
			],
		});
		assert.equal(existsSync(join(stateRoot, "agentlab-reports")), false);
		assert.equal(existsSync(join(stateRoot, "agentlab-runs")), false);
		assert.equal(existsSync(join(stateRoot, "agentlab-workspaces")), false);
		assert.equal(existsSync(join(stateRoot, "lab.db")), false);
		assert.equal(existsSync(join(stateRoot, "bug_findings.jsonl")), false);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: returns local invalid results for malformed JSON and invalid findings", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-ui-ux", "agentlab-security"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/Button.tsx", "src/auth/login.ts"],
			promptForRole: async (role) => ({
				ok: true,
				output:
					role === "agentlab-ui-ux"
						? "[{"
						: JSON.stringify([{ title: "Missing required finding fields" }]),
				provider: "test-provider",
				model: "test-model",
				role: "supervisor-main" as never,
			}),
		});
		assert.equal(result.impulses[0]?.review.status, "invalid");
		assert.match(result.impulses[0]?.review.reason ?? "", /Invalid JSON array/u);
		assert.equal(result.impulses[1]?.review.status, "invalid");
		assert.match(
			result.impulses[1]?.review.reason ?? "",
			/Invalid AgentLab findings/u,
		);
		assert.equal(result.impulses[0]?.review.report, undefined);
		assert.equal(result.impulses[1]?.review.findingsCount, 0);
		assert.equal(result.metrics.totalMatches, 2);
		assert.equal(result.metrics.selectedMatches, 2);
		assert.equal(result.metrics.cappedOutMatches, 0);
		assert.equal(result.metrics.completedCalls, 2);
		assert.equal(result.metrics.jsonValidCalls, 1);
		assert.equal(result.metrics.reportValidCalls, 0);
		assert.deepEqual(
			result.metrics.perCall.map((measurement) => measurement.findingsCount),
			[0, 0],
		);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: per-role depth cap replaces global cap (no role silenced)", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		const sensorRoles = [...new Set(SENSORS.map((sensor) => sensor.role))];
		enableRoles(stateRoot, sensorRoles);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: [
				"src/cli.ts",
				"README.md",
				"package.json",
				"migrations/001.sql",
				"src/auth/login.ts",
				"src/ZButton.tsx",
				"test/sensor.test.ts",
				"docs/z.md",
			],
			promptForRole: async () => emptyOkResponse(),
		});
		// No global cap: all 8 selected (docs has 2 = depth max, others 1 each).
		assert.equal(result.metrics.totalMatches, 8);
		assert.equal(result.metrics.selectedMatches, 8);
		assert.equal(result.metrics.cappedOutMatches, 0);
		assert.equal(result.metrics.discardedByDepth, 0);
		assert.equal(result.metrics.discardedBySafetyCeiling, 0);
		// Every role present gets at least one slot (the old bug silenced roles).
		const rolesCalled = new Set(result.impulses.map((impulse) => impulse.match.role));
		for (const role of sensorRoles) {
			assert.ok(rolesCalled.has(role), `${role} must get a slot`);
		}
		// Round-robin order: pass 1 in SENSORS priority, docs 2nd in pass 2.
		// docs role sorted by normalized path: "docs/z.md" < "readme.md".
		assert.deepEqual(
			result.impulses.map((impulse) => impulse.match.file),
			[
				"test/sensor.test.ts", // code-quality (pass 1)
				"src/ZButton.tsx", // ui-ux (pass 1)
				"src/auth/login.ts", // security (pass 1)
				"migrations/001.sql", // database (pass 1)
				"package.json", // general (pass 1)
				"docs/z.md", // docs (pass 1)
				"src/cli.ts", // architecture (pass 1)
				"README.md", // docs (pass 2)
			],
		);
		assert.ok(
			sensorRoles.every((role) => agentLabSpecialtyForSensorRole(role) !== undefined),
		);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: accepts direct, fenced, and bracket-delimited schema-valid arrays", async () => {
	const direct = JSON.stringify([validFinding]);
	const responses = [
		direct,
		`\`\`\`json\n${direct}\n\`\`\``,
		`Findings follow: ${direct}`,
	];
	for (const response of responses) {
		const { root, stateRoot, cleanup } = makeRoot();
		try {
			enableRoles(stateRoot, ["agentlab-ui-ux"]);
			const result = await runSensorImpulses({
				stateRoot,
				projectId: "sensor-test",
				projectRoot: root,
				changedFiles: ["src/Button.tsx"],
				promptForRole: successPrompt(response),
			});
			assert.equal(result.impulses[0]?.review.status, "valid");
			assert.equal(result.metrics.jsonValidCalls, 1);
			assert.equal(result.metrics.reportValidCalls, 1);
		} finally {
			await cleanup();
		}
	}
});

test("runSensorImpulses: rejects schema-invalid arrays in every accepted format", async () => {
	const invalid = JSON.stringify([{ title: "Missing required finding fields" }]);
	const responses = [
		invalid,
		`\`\`\`json\n${invalid}\n\`\`\``,
		`Findings follow: ${invalid}`,
	];
	for (const response of responses) {
		const { root, stateRoot, cleanup } = makeRoot();
		try {
			enableRoles(stateRoot, ["agentlab-ui-ux"]);
			const result = await runSensorImpulses({
				stateRoot,
				projectId: "sensor-test",
				projectRoot: root,
				changedFiles: ["src/Button.tsx"],
				promptForRole: successPrompt(response),
			});
			assert.equal(result.impulses[0]?.review.status, "invalid");
			assert.equal(result.metrics.jsonValidCalls, 1);
			assert.equal(result.metrics.reportValidCalls, 0);
		} finally {
			await cleanup();
		}
	}
});

test("runSensorImpulses: rejects malformed, prose, ambiguous, oversized, and partial responses without retries", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, [
			"agentlab-code-quality",
			"agentlab-ui-ux",
			"agentlab-security",
			"agentlab-database",
			"agentlab-general",
		]);
		const responses = new Map([
			["agentlab-code-quality", "["],
			["agentlab-ui-ux", "No findings were returned."],
			[
				"agentlab-security",
				`${JSON.stringify([validFinding])}\n${JSON.stringify([validFinding])}`,
			],
			["agentlab-database", `${JSON.stringify([validFinding])}${" ".repeat(20_000)}`],
			["agentlab-general", JSON.stringify([validFinding]).slice(0, -1)],
		]);
		let promptCalls = 0;
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: [
				"test/sensor.test.ts",
				"src/Button.tsx",
				"src/auth/login.ts",
				"migrations/001.sql",
				"package.json",
			],
			promptForRole: async (role) => {
				promptCalls += 1;
				return {
					ok: true,
					output: responses.get(role) ?? "",
					provider: "test-provider",
					model: "test-model",
					role: "supervisor-main" as never,
				};
			},
		});
		assert.equal(promptCalls, 5);
		assert.ok(result.impulses.every((impulse) => impulse.review.status === "invalid"));
		assert.deepEqual(result.metrics, {
			totalMatches: 5,
			selectedMatches: 5,
			cappedOutMatches: 0,
			discardedByDepth: 0,
			discardedBySafetyCeiling: 0,
			completedCalls: 5,
			jsonValidCalls: 0,
			reportValidCalls: 0,
			totalValidatedFindings: 0,
			findingsRoutedByPillar: 0,
			findingsRoutedByFallback: 0,
			discards: [],
			perCall: [
				{
					file: "test/sensor.test.ts",
					role: "agentlab-code-quality",
					validJson: false,
					validatedReport: false,
					findingsCount: 0,
				},
				{
					file: "src/Button.tsx",
					role: "agentlab-ui-ux",
					validJson: false,
					validatedReport: false,
					findingsCount: 0,
				},
				{
					file: "src/auth/login.ts",
					role: "agentlab-security",
					validJson: false,
					validatedReport: false,
					findingsCount: 0,
				},
				{
					file: "migrations/001.sql",
					role: "agentlab-database",
					validJson: false,
					validatedReport: false,
					findingsCount: 0,
				},
				{
					file: "package.json",
					role: "agentlab-general",
					validJson: false,
					validatedReport: false,
					findingsCount: 0,
				},
			],
		});
	} finally {
		await cleanup();
	}
});

// ---------------------------------------------------------------------------
// New tests for the owner-approved C6+E1 revision
// ---------------------------------------------------------------------------

test("runSensorImpulses: per-role depth cap keeps security slot when code-quality dominates (owner failure case)", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-code-quality", "agentlab-security"]);
		const calledRoles: string[] = [];
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			// 8 test files (code-quality) + 1 security file = 9 inputs,
			// >=6 map to ONE role (code-quality) AND one maps to security.
			// The prior global cap-of-6 by sensor priority would take 6
			// code-quality matches and leave security at zero.
			changedFiles: [
				"test/a.test.ts",
				"test/b.test.ts",
				"test/c.test.ts",
				"test/d.test.ts",
				"test/e.test.ts",
				"test/f.test.ts",
				"test/g.test.ts",
				"test/h.test.ts",
				"src/auth/login.ts",
			],
			promptForRole: async (role) => {
				calledRoles.push(role);
				return emptyOkResponse();
			},
		});
		// Security MUST get a slot despite code-quality having 8 matches.
		assert.ok(
			calledRoles.includes("agentlab-security"),
			"security role must be called",
		);
		assert.ok(
			result.impulses.some(
				(impulse) =>
					impulse.match.role === "agentlab-security" &&
					impulse.match.file === "src/auth/login.ts",
			),
			"security match must be selected",
		);
		// code-quality capped to depth 2.
		assert.equal(
			result.impulses.filter((impulse) => impulse.match.role === "agentlab-code-quality").length,
			2,
		);
		assert.equal(result.metrics.selectedMatches, 3); // 2 code-quality + 1 security
		assert.equal(result.metrics.discardedByDepth, 6); // 8 - 2
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: round-robin order interleaves by role in SENSORS priority, depth-1 before depth-2", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		const sensorRoles = [...new Set(SENSORS.map((sensor) => sensor.role))];
		enableRoles(stateRoot, sensorRoles);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			// Two files per role across three roles.
			changedFiles: [
				"test/a.test.ts",
				"test/b.test.ts", // code-quality x2
				"src/a.tsx",
				"src/b.tsx", // ui-ux x2
				"src/auth/a.ts",
				"src/auth/b.ts", // security x2
			],
			// Assert on impulses order (selection+execution order), not on the
			// prompt callback: per-role cooldowns can suppress the 2nd call
			// before it reaches promptForRole, but the impulse entry is always
			// emitted in round-robin order.
			promptForRole: async () => emptyOkResponse(),
		});
		assert.equal(result.impulses.length, 6);
		// Pass 1: 1st of each role in SENSORS order (code-quality, ui-ux, security).
		// Pass 2: 2nd of each role. Within a role, sorted by normalized path: a before b.
		assert.deepEqual(
			result.impulses.map((impulse) => ({
				role: impulse.match.role,
				file: impulse.match.file,
			})),
			[
				{ role: "agentlab-code-quality", file: "test/a.test.ts" },
				{ role: "agentlab-ui-ux", file: "src/a.tsx" },
				{ role: "agentlab-security", file: "src/auth/a.ts" },
				{ role: "agentlab-code-quality", file: "test/b.test.ts" },
				{ role: "agentlab-ui-ux", file: "src/b.tsx" },
				{ role: "agentlab-security", file: "src/auth/b.ts" },
			],
		);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: depth cap keeps 2 per role, rest are discardedByDepth", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-code-quality"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: [
				"test/a.test.ts",
				"test/b.test.ts",
				"test/c.test.ts",
				"test/d.test.ts",
				"test/e.test.ts",
			],
			promptForRole: successPrompt("[]"),
		});
		assert.equal(result.impulses.length, 2);
		assert.equal(result.metrics.discardedByDepth, 3);
		assert.equal(result.metrics.discardedBySafetyCeiling, 0);
		// Kept: a, b (sorted). Discarded: c, d, e.
		assert.deepEqual(
			result.impulses.map((impulse) => impulse.match.file),
			["test/a.test.ts", "test/b.test.ts"],
		);
		assert.equal(result.metrics.discards.length, 3);
		assert.ok(
			result.metrics.discards.every(
				(discard) =>
					discard.role === "agentlab-code-quality" && discard.reason === "depth_cap",
			),
		);
		assert.deepEqual(
			result.metrics.discards.map((d) => d.file).sort(),
			["test/c.test.ts", "test/d.test.ts", "test/e.test.ts"],
		);
	} finally {
		await cleanup();
	}
});

test("selectSensorMatches: safety ceiling drops lowest-priority excess as safety_ceiling", () => {
	// Synthetic matches across three roles, each at depth 2 -> total selected = 6.
	// Override ceiling to 3 -> 3 dropped as safety_ceiling (lowest priority tail).
	const matches: SensorMatch[] = [
		{ file: "test/a.test.ts", role: "agentlab-code-quality", description: "Test file change" },
		{ file: "test/b.test.ts", role: "agentlab-code-quality", description: "Test file change" },
		{ file: "src/a.tsx", role: "agentlab-ui-ux", description: "UI/UX surface file change" },
		{ file: "src/b.tsx", role: "agentlab-ui-ux", description: "UI/UX surface file change" },
		{ file: "src/auth/a.ts", role: "agentlab-security", description: "Auth/security surface file change" },
		{ file: "src/auth/b.ts", role: "agentlab-security", description: "Auth/security surface file change" },
	];
	const { selected, discards } = selectSensorMatches(matches, { maxSafetyCeiling: 3 });
	assert.equal(selected.length, 3);
	// Round-robin order: pass 1 takes 1st of each role before any 2nd.
	assert.deepEqual(
		selected.map((match) => `${match.role}:${match.file}`),
		[
			"agentlab-code-quality:test/a.test.ts",
			"agentlab-ui-ux:src/a.tsx",
			"agentlab-security:src/auth/a.ts",
		],
	);
	const ceiling = discards.filter((discard) => discard.reason === "safety_ceiling");
	assert.equal(ceiling.length, 3);
	assert.deepEqual(
		ceiling.map((discard) => `${discard.role}:${discard.file}`),
		[
			"agentlab-code-quality:test/b.test.ts",
			"agentlab-ui-ux:src/b.tsx",
			"agentlab-security:src/auth/b.ts",
		],
	);
});

test("runSensorImpulses: discards surfaced in metrics AND run result", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-code-quality"]);
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: [
				"test/a.test.ts",
				"test/b.test.ts",
				"test/c.test.ts",
				"test/d.test.ts",
			],
			promptForRole: successPrompt("[]"),
		});
		// depth 2 -> 2 kept, 2 discarded by depth.
		assert.equal(result.metrics.discardedByDepth, 2);
		assert.equal(result.metrics.discards.length, 2);
		// Top-level run-result discards (loud surface).
		assert.equal(result.discards.length, 2);
		assert.strictEqual(
			result.discards,
			result.metrics.discards,
			"same array reference for loud visibility",
		);
		assert.ok(result.discards.every((discard) => discard.reason === "depth_cap"));
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: routes findings by controlPillars (primary) then specialty (fallback)", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-architecture", "agentlab-database", "agentlab-docs"]);
		const archFinding = { ...validFinding, controlPillars: ["architecture_consistency"] };
		const reportingOnlyFinding = { ...validFinding, controlPillars: ["reporting"] };
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/cli.ts", "migrations/001.sql", "docs/guide.md"],
			promptForRole: async (role) => ({
				ok: true,
				output: JSON.stringify([reportingOnlyFinding]),
				provider: "test-provider",
				model: "test-model",
				role: "supervisor-main" as never,
			}),
		});
		const byRole = new Map(
			result.impulses.map((impulse) => [impulse.match.role, impulse.review]),
		);
		// architecture_consistency -> architectureFindings, NOT qualityFindings.
		const arch = byRole.get("agentlab-architecture");
		assert.equal(arch?.status, "valid");
		assert.equal(arch?.report?.architectureFindings.length, 1);
		assert.equal(arch?.report?.qualityFindings.length, 0);
		// docs specialty + reporting-only pillar -> qualityFindings (specialty fallback).
		const docs = byRole.get("agentlab-docs");
		assert.equal(docs?.status, "valid");
		assert.equal(docs?.report?.qualityFindings.length, 1);
		// database specialty + reporting-only pillar -> safetyFindings.
		const db = byRole.get("agentlab-database");
		assert.equal(db?.status, "valid");
		assert.equal(db?.report?.safetyFindings.length, 1);
		// Suppress unused-var: archFinding documents the primary-path case.
		void archFinding;
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: routes architecture_consistency finding away from qualityFindings", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-architecture"]);
		const archFinding = { ...validFinding, controlPillars: ["architecture_consistency"] };
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/cli.ts"],
			promptForRole: async () => ({
				ok: true,
				output: JSON.stringify([archFinding]),
				provider: "test-provider",
				model: "test-model",
				role: "supervisor-main" as never,
			}),
		});
		const report = result.impulses[0]?.review.report;
		assert.deepEqual(report?.architectureFindings, [archFinding]);
		assert.deepEqual(report?.qualityFindings, []);
		assert.deepEqual(report?.safetyFindings, []);
	} finally {
		await cleanup();
	}
});

test("computeSensorReportIdentity: deterministic id/requestId, varies by content/file/role", () => {
	const role: IduModelRoleId = "agentlab-security";
	const a = computeSensorReportIdentity("proj", "src/auth/login.ts", role, "response body");
	const a2 = computeSensorReportIdentity("proj", "src/auth/login.ts", role, "response body");
	assert.equal(a.id, a2.id);
	assert.equal(a.requestId, a2.requestId);
	// id and requestId share the suffix; only the prefix differs.
	assert.equal(a.id.replace("sensor-report-", "sensor-req-"), a.requestId);
	// Different content -> different id.
	const b = computeSensorReportIdentity("proj", "src/auth/login.ts", role, "different body");
	assert.notEqual(a.id, b.id);
	// Normalization: backslash -> forward, case-insensitive -> same id.
	const c = computeSensorReportIdentity("proj", "SRC\\Auth\\Login.ts", role, "response body");
	assert.equal(a.id, c.id);
	// Different role -> different id.
	const d = computeSensorReportIdentity("proj", "src/auth/login.ts", "agentlab-database", "response body");
	assert.notEqual(a.id, d.id);
});

// ---------------------------------------------------------------------------
// controlPillars routing metric (C6+E1 Fix 2)
// ---------------------------------------------------------------------------

test("runSensorImpulses: routes architecture_consistency finding to findingsRoutedByPillar", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-architecture"]);
		const archFinding = { ...validFinding, controlPillars: ["architecture_consistency"] };
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/cli.ts"],
			promptForRole: async () => ({
				ok: true,
				output: JSON.stringify([archFinding]),
				provider: "test-provider",
				model: "test-model",
				role: "supervisor-main" as never,
			}),
		});
		// architecture_consistency is a 1:1-mappable pillar.
		assert.equal(result.metrics.totalValidatedFindings, 1);
		assert.equal(result.metrics.findingsRoutedByPillar, 1);
		assert.equal(result.metrics.findingsRoutedByFallback, 0);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: routes reporting-only finding to findingsRoutedByFallback", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-architecture"]);
		// reporting has no 1:1 bucket map -> specialty fallback fires.
		const reportingOnly = { ...validFinding, controlPillars: ["reporting"] };
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/cli.ts"],
			promptForRole: async () => ({
				ok: true,
				output: JSON.stringify([reportingOnly]),
				provider: "test-provider",
				model: "test-model",
				role: "supervisor-main" as never,
			}),
		});
		assert.equal(result.metrics.totalValidatedFindings, 1);
		assert.equal(result.metrics.findingsRoutedByPillar, 0);
		assert.equal(result.metrics.findingsRoutedByFallback, 1);
	} finally {
		await cleanup();
	}
});

test("runSensorImpulses: routing metrics reconcile (total == pillar + fallback) across mixed findings", async () => {
	const { root, stateRoot, cleanup } = makeRoot();
	try {
		enableRoles(stateRoot, ["agentlab-architecture", "agentlab-security"]);
		// Two findings in one report: one mappable pillar, one fallback-only.
		const archFinding = { ...validFinding, controlPillars: ["architecture_consistency"] };
		const reportingFinding = { ...validFinding, controlPillars: ["reporting"] };
		// learning-only is also a fallback path (not in the mappable set).
		const learningFinding = { ...validFinding, controlPillars: ["learning"] };
		const result = await runSensorImpulses({
			stateRoot,
			projectId: "sensor-test",
			projectRoot: root,
			changedFiles: ["src/cli.ts", "src/auth/login.ts"],
			promptForRole: async () => ({
				ok: true,
				output: JSON.stringify([archFinding, reportingFinding, learningFinding]),
				provider: "test-provider",
				model: "test-model",
				role: "supervisor-main" as never,
			}),
		});
		// 2 impulses x 3 findings each = 6 validated findings.
		assert.equal(result.metrics.totalValidatedFindings, 6);
		assert.equal(result.metrics.findingsRoutedByPillar, 2); // archFinding x2
		assert.equal(result.metrics.findingsRoutedByFallback, 4); // reporting+learning x2
		// Reconciliation invariant.
		assert.equal(
			result.metrics.totalValidatedFindings,
			result.metrics.findingsRoutedByPillar + result.metrics.findingsRoutedByFallback,
		);
	} finally {
		await cleanup();
	}
});
