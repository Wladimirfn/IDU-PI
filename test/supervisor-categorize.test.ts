import assert from "node:assert/strict";
import {
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

test("parseCategorizedCounts returns zeros for malformed input", () => {
	assert.deepEqual(parseCategorizedCounts("nada entendible"), {
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
		assert.ok(readFileSync(path, "utf8").includes("2 critical, 1 medium, 0 low"));
	} finally {
		cleanup();
	}
});
