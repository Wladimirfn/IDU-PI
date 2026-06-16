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
import {
	categorizeFindings,
	formatCategorizedCounts,
	parseCategorizedCounts,
	writeSupervisorAdvisory,
	type FindingSummary,
	type SupervisorAdvisory,
} from "../src/supervisor-categorize.js";
import { roleEngineConfigPath } from "../src/role-engine-config.js";
import type { PromptForRoleResult } from "../src/agent-router.js";

function makeRoot(): { root: string; stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-supervisor-cat-"));
	const stateRoot = join(root, "state");
	mkdirSync(stateRoot, { recursive: true });
	return {
		root,
		stateRoot,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
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

function successPrompt(output: string) {
	return async (
		_role: string,
		_message: string,
		_options: unknown,
	): Promise<PromptForRoleResult> => ({
		ok: true,
		output,
		provider: "test-provider",
		model: "test-model",
		role: "supervisor-main" as never,
	});
}

test("parseCategorizedCounts parses 'N critical, M medium, K low' format", () => {
	assert.deepEqual(parseCategorizedCounts("4 critical, 2 medium, 1 low"), {
		critical: 4,
		medium: 2,
		low: 1,
	});
	assert.deepEqual(parseCategorizedCounts("0 critical, 0 medium, 0 low"), {
		critical: 0,
		medium: 0,
		low: 0,
	});
});

test("parseCategorizedCounts handles 'sin resolver' suffix", () => {
	assert.deepEqual(
		parseCategorizedCounts("3 critical unresolved, 1 medium resolved, 0 low"),
		{ critical: 3, medium: 1, low: 0 },
	);
});

test("parseCategorizedCounts returns null for malformed input", () => {
	// Returns null instead of zeros so the caller can decide to skip
	// writing an advisory. The previous version always returned zeros,
	// which made it impossible to distinguish "all zero findings" from
	// "the LLM is broken".
	assert.equal(parseCategorizedCounts("nada entendible"), null);
});

test("parseCategorizedCounts recovers from prose like 'I see 3 critical, 1 medium, 0 low'", () => {
	assert.deepEqual(
		parseCategorizedCounts("I see 3 critical, 1 medium, 0 low"),
		{ critical: 3, medium: 1, low: 0 },
	);
});

test("parseCategorizedCounts recovers from markdown code blocks", () => {
	assert.deepEqual(
		parseCategorizedCounts("```\n2 critical, 3 medium, 1 low\n```"),
		{ critical: 2, medium: 3, low: 1 },
	);
	assert.deepEqual(
		parseCategorizedCounts(
			'```json\n{"critical": 1, "medium": 2, "low": 3}\n```',
		),
		{ critical: 1, medium: 2, low: 3 },
	);
});

test("parseCategorizedCounts recovers from 'I need to investigate...' prose", () => {
	assert.deepEqual(
		parseCategorizedCounts(
			"I need to investigate. The findings show 1 critical issue and 2 medium. low: 0",
		),
		{ critical: 1, medium: 2, low: 0 },
	);
});

test("parseCategorizedCounts recovers from tool-call payloads", () => {
	// When the LLM makes a tool call instead of answering, the output is
	// the JSON payload. Look for the format inside the JSON.
	assert.deepEqual(
		parseCategorizedCounts(
			'{"tool":"bash","args":{"command":"echo 3 critical, 1 medium, 0 low"}}',
		),
		{ critical: 3, medium: 1, low: 0 },
	);
});

test("parseCategorizedCounts returns null when truly unparseable", () => {
	// Returns null instead of zeros so the caller can decide to skip
	// writing an advisory. The previous version always returned zeros,
	// which made it impossible to distinguish "all zero findings" from
	// "the LLM is broken".
	assert.equal(
		parseCategorizedCounts(
			"I am el Gentleman, let me check the model catalog...",
		),
		null,
	);
	assert.equal(parseCategorizedCounts(""), null);
	assert.equal(parseCategorizedCounts("[tool:read] reading file..."), null);
});

test("parseCategorizedCounts distinguishes zero findings from parse failure", () => {
	// "0 critical, 0 medium, 0 low" is a valid response (no findings).
	// It should return zeros (not null), so the supervisor can still
	// emit an informational advisory.
	assert.deepEqual(parseCategorizedCounts("0 critical, 0 medium, 0 low"), {
		critical: 0,
		medium: 0,
		low: 0,
	});
});

test("formatCategorizedCounts produces the expected text", () => {
	assert.equal(
		formatCategorizedCounts({ critical: 4, medium: 2, low: 1 }),
		"4 critical, 2 medium, 1 low",
	);
	assert.equal(
		formatCategorizedCounts({ critical: 0, medium: 0, low: 0 }),
		"0 critical, 0 medium, 0 low",
	);
});

test("categorizeFindings: returns null when no findings", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = await categorizeFindings({
			stateRoot,
			findings: [],
			promptForRole: successPrompt("anything"),
		});
		assert.equal(result, null);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: invokes supervisor-main and parses response", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const findings: FindingSummary[] = [
			{
				match: {
					file: "src/auth.ts",
					role: "agentlab-security",
					description: "Auth surface change",
				},
				ok: true,
				response: "Plaintext password in source",
			},
			{
				match: {
					file: "src/Button.tsx",
					role: "agentlab-ui-ux",
					description: "UI/UX change",
				},
				ok: true,
				response: "Missing aria-label",
			},
		];
		const result = await categorizeFindings({
			stateRoot,
			findings,
			promptForRole: successPrompt("2 critical, 1 medium, 0 low"),
		});
		assert.ok(result);
		assert.deepEqual(result?.counts, {
			critical: 2,
			medium: 1,
			low: 0,
		});
		assert.ok(result?.advisory);
		assert.equal(result?.advisory?.summary, "2 critical, 1 medium, 0 low");
	} finally {
		cleanup();
	}
});

test("categorizeFindings: returns role_not_enabled when supervisor is off", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const findings: FindingSummary[] = [
			{
				match: {
					file: "src/Button.tsx",
					role: "agentlab-ui-ux",
					description: "UI/UX",
				},
				ok: true,
				response: "missing aria",
			},
		];
		const result = await categorizeFindings({
			stateRoot,
			findings,
			promptForRole: successPrompt("ok"),
		});
		assert.ok(result);
		assert.equal(result?.ok, false);
		assert.equal(result?.reason, "role_not_enabled");
	} finally {
		cleanup();
	}
});

test("writeSupervisorAdvisory: appends to injections.jsonl", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const advisory: SupervisorAdvisory = {
			ts: "2026-06-15T12:00:00.000Z",
			kind: "supervisor_advisory",
			summary: "2 critical, 1 medium, 0 low",
			counts: { critical: 2, medium: 1, low: 0 },
			advisoryId: "sa-test-1",
		};
		writeSupervisorAdvisory(stateRoot, advisory);
		const path = join(stateRoot, "injections.jsonl");
		assert.ok(readFileSync(path, "utf8").includes("supervisor_advisory"));
		assert.ok(
			readFileSync(path, "utf8").includes("2 critical, 1 medium, 0 low"),
		);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: skips advisory when LLM response is unparseable", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const findings: FindingSummary[] = [
			{
				match: {
					file: "src/Button.tsx",
					role: "agentlab-ui-ux",
					description: "UI/UX change",
				},
				ok: true,
				response: "missing aria",
			},
		];
		// LLM returns a tool-call-style response, not the requested format.
		const result = await categorizeFindings({
			stateRoot,
			findings,
			promptForRole: successPrompt("[tool:bash] reading file..."),
		});
		// Result should indicate parse failure, not write a 0/0/0 advisory.
		assert.ok(result);
		assert.equal(result?.ok, false);
		assert.equal(result?.reason, "parse_failed");
		assert.equal(result?.counts.critical, 0);
		assert.equal(result?.counts.medium, 0);
		assert.equal(result?.counts.low, 0);
		assert.equal(result?.advisory, undefined);
		// injections.jsonl should NOT contain a supervisor_advisory for this run.
		const path = join(stateRoot, "injections.jsonl");
		if (existsSync(path)) {
			const content = readFileSync(path, "utf8");
			assert.ok(
				!content.includes("supervisor_advisory"),
				"no supervisor_advisory should be written for unparseable responses",
			);
		}
	} finally {
		cleanup();
	}
});

test("categorizeFindings: writes advisory for 0/0/0 (no findings is a valid response)", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const findings: FindingSummary[] = [
			{
				match: {
					file: "src/Button.tsx",
					role: "agentlab-ui-ux",
					description: "UI/UX change",
				},
				ok: true,
				response: "missing aria",
			},
		];
		const result = await categorizeFindings({
			stateRoot,
			findings,
			promptForRole: successPrompt("0 critical, 0 medium, 0 low"),
		});
		assert.ok(result);
		assert.equal(result?.ok, true);
		// An advisory IS written because the LLM responded correctly
		// (no findings is a valid signal). Severity is info.
		assert.ok(result?.advisory);
		assert.equal(result?.advisory?.summary, "0 critical, 0 medium, 0 low");
	} finally {
		cleanup();
	}
});
