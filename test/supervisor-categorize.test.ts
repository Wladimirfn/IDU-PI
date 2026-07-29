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
	formatDiscardsSummary,
	parseCategorizedCounts,
	writeSupervisorAdvisory,
	type FindingSummary,
	type SupervisorAdvisory,
	type SupervisorAdvisoryDiscard,
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

// ---------------------------------------------------------------------------
// Discards surface deterministically in the advisory (C6+E1 Fix 1)
//
// The owner's lesson: invisibility is the bug. Discards must appear in the
// advisory summary in CODE — never trusting the LLM to mention them — even
// when the categorizer returns zero findings, fails, or is unparseable.
// ---------------------------------------------------------------------------

const depthDiscards: SupervisorAdvisoryDiscard[] = [
	{ file: "test/a.test.ts", role: "agentlab-code-quality", reason: "depth_cap" },
	{ file: "test/b.test.ts", role: "agentlab-code-quality", reason: "depth_cap" },
];

function finding(file = "src/Button.tsx"): FindingSummary {
	return {
		match: { file, role: "agentlab-ui-ux", description: "UI/UX change" },
		ok: true,
		response: "missing aria",
	};
}

test("categorizeFindings: discards surface in advisory summary even with zero findings (no LLM call)", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const result = await categorizeFindings({
			stateRoot,
			findings: [],
			discards: depthDiscards,
			promptForRole: successPrompt("should not be called"),
		});
		assert.ok(result, "must return a result when discards are present");
		assert.ok(result?.advisory, "an advisory must be written for discards");
		assert.equal(result?.advisory?.discardsCount, 2);
		assert.match(result?.advisory?.summary ?? "", /2 discarded/u);
		assert.match(result?.advisory?.summary ?? "", /depth_cap: agentlab-code-quality=2/u);
		// Zero findings path keeps counts at 0/0/0 and prepends them.
		assert.equal(result?.advisory?.summary, "0 critical, 0 medium, 0 low; 2 discarded (depth_cap: agentlab-code-quality=2)");
		// Injection written with discard evidence.
		const path = join(stateRoot, "injections.jsonl");
		const content = readFileSync(path, "utf8");
		assert.ok(content.includes("sensor:discards"), "evidence must mark discards");
	} finally {
		cleanup();
	}
});

test("categorizeFindings: discards surface in advisory summary when categorizer consult fails", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		// supervisor-main NOT enabled -> consult.ok=false (role_not_enabled).
		const result = await categorizeFindings({
			stateRoot,
			findings: [finding()],
			discards: depthDiscards,
			promptForRole: successPrompt("anything"),
		});
		assert.ok(result);
		assert.equal(result?.ok, false);
		assert.equal(result?.reason, "role_not_enabled");
		// Despite the failure, the advisory surfaces the discards.
		assert.ok(result?.advisory, "advisory must still be written for discards on failure");
		assert.equal(result?.advisory?.discardsCount, 2);
		assert.match(result?.advisory?.summary ?? "", /2 discarded/u);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: discards surface in advisory summary when categorizer is unparseable", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const result = await categorizeFindings({
			stateRoot,
			findings: [finding()],
			discards: depthDiscards,
			promptForRole: successPrompt("[tool:bash] reading file..."),
		});
		assert.ok(result);
		assert.equal(result?.ok, false);
		assert.equal(result?.reason, "parse_failed");
		assert.ok(result?.advisory, "advisory must still be written for discards on parse_failed");
		assert.equal(result?.advisory?.discardsCount, 2);
		assert.match(result?.advisory?.summary ?? "", /2 discarded/u);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: discards appended to counts when categorizer succeeds", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const result = await categorizeFindings({
			stateRoot,
			findings: [finding()],
			discards: depthDiscards,
			promptForRole: successPrompt("1 critical, 0 medium, 0 low"),
		});
		assert.ok(result?.advisory);
		// Counts prefix intact; discard text appended after '; '.
		assert.equal(
			result?.advisory?.summary,
			"1 critical, 0 medium, 0 low; 2 discarded (depth_cap: agentlab-code-quality=2)",
		);
		assert.equal(result?.advisory?.discardsCount, 2);
		assert.equal(result?.advisory?.counts.critical, 1);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: discards grouped by reason+role in summary text", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		enableRole(stateRoot, "supervisor-main");
		const mixedDiscards: SupervisorAdvisoryDiscard[] = [
			{ file: "test/a.test.ts", role: "agentlab-code-quality", reason: "depth_cap" },
			{ file: "test/b.test.ts", role: "agentlab-code-quality", reason: "depth_cap" },
			{ file: "src/auth/a.ts", role: "agentlab-security", reason: "depth_cap" },
			{ file: "src/cli.ts", role: "agentlab-architecture", reason: "safety_ceiling" },
		];
		const result = await categorizeFindings({
			stateRoot,
			findings: [finding()],
			discards: mixedDiscards,
			promptForRole: successPrompt("0 critical, 0 medium, 0 low"),
		});
		assert.ok(result?.advisory);
		// Total first, then reasons sorted alphabetically, roles sorted within.
		assert.equal(result?.advisory?.discardsCount, 4);
		assert.equal(
			result?.advisory?.discardsSummary,
			"4 discarded (depth_cap: agentlab-code-quality=2, agentlab-security=1; safety_ceiling: agentlab-architecture=1)",
		);
		assert.ok(
			result?.advisory?.summary.includes(result?.advisory?.discardsSummary ?? "__missing__"),
			"summary must carry the discard breakdown",
		);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: discardsCount matches input length", async () => {
	const { stateRoot, cleanup } = makeRoot();
	try {
		const many: SupervisorAdvisoryDiscard[] = Array.from({ length: 38 }, (_, i) => ({
			file: `test/${i}.test.ts`,
			role: "agentlab-code-quality",
			reason: "depth_cap" as const,
		}));
		const result = await categorizeFindings({
			stateRoot,
			findings: [],
			discards: many,
			promptForRole: successPrompt("x"),
		});
		assert.equal(result?.advisory?.discardsCount, 38);
		assert.match(result?.advisory?.summary ?? "", /38 discarded/u);
		assert.match(result?.advisory?.summary ?? "", /depth_cap: agentlab-code-quality=38/u);
	} finally {
		cleanup();
	}
});

test("categorizeFindings: backward-compatible when discards omitted (existing callers still work)", async () => {
	// Scenario A: no findings and no discards -> null (prior behavior).
	const a = makeRoot();
	try {
		const result = await categorizeFindings({
			stateRoot: a.stateRoot,
			findings: [],
			promptForRole: successPrompt("anything"),
		});
		assert.equal(result, null);
	} finally {
		a.cleanup();
	}

	// Scenario B: parse_failed with no discards -> no advisory (prior behavior).
	const b = makeRoot();
	try {
		enableRole(b.stateRoot, "supervisor-main");
		const result = await categorizeFindings({
			stateRoot: b.stateRoot,
			findings: [finding()],
			promptForRole: successPrompt("[tool:bash] reading file..."),
		});
		assert.equal(result?.ok, false);
		assert.equal(result?.reason, "parse_failed");
		assert.equal(result?.advisory, undefined);
	} finally {
		b.cleanup();
	}
});

test("formatDiscardsSummary: empty input returns empty string", () => {
	assert.equal(formatDiscardsSummary([]), "");
});

test("formatDiscardsSummary: groups, counts, and sorts deterministically", () => {
	const discards: SupervisorAdvisoryDiscard[] = [
		{ file: "b", role: "agentlab-code-quality", reason: "depth_cap" },
		{ file: "a", role: "agentlab-code-quality", reason: "depth_cap" },
		{ file: "c", role: "agentlab-security", reason: "depth_cap" },
		{ file: "d", role: "agentlab-architecture", reason: "safety_ceiling" },
	];
	// Reasons sorted (depth_cap before safety_ceiling); roles sorted within.
	assert.equal(
		formatDiscardsSummary(discards),
		"4 discarded (depth_cap: agentlab-code-quality=2, agentlab-security=1; safety_ceiling: agentlab-architecture=1)",
	);
});
