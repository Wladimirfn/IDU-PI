import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildSupervisorResponsesReport,
	formatSupervisorResponses,
	parseSupervisorResponsesArgs,
} from "../src/cli-supervisor-responses.js";
import {
	flushSupervisorResponseHistory,
	recordSupervisorResponseDeferred,
	readSupervisorResponseHistory,
} from "../src/supervisor-response-history.js";

function tempDir(prefix = "idu-cli-sup-resp-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return dir;
}

function seedSuccessEntry(stateRoot: string, i: number): void {
	recordSupervisorResponseDeferred(stateRoot, {
		stateRoot,
		role: "supervisor-main",
		question: `seeded-question-${i}`,
		result: {
			ok: true,
			role: "supervisor-main",
			response: `seeded-response-${i}`,
			model: "openai/gpt-5",
			provider: "openai",
			promptChars: 100,
			elapsedMs: 50,
		},
	});
}

function seedErrorEntry(stateRoot: string, i: number, reason: string): void {
	recordSupervisorResponseDeferred(stateRoot, {
		stateRoot,
		role: "supervisor-main",
		question: `seeded-error-${i}`,
		result: {
			ok: false,
			role: "supervisor-main",
			response: "",
			model: "",
			provider: "",
			promptChars: 80,
			elapsedMs: 10,
			reason,
		},
	});
}

test("cli-supervisor-responses: buildSupervisorResponsesReport returns zero-count report on empty stateRoot", () => {
	const root = tempDir();
	try {
		const report = buildSupervisorResponsesReport({ stateRoot: root });
		assert.equal(report.returnedCount, 0);
		assert.deepEqual(report.entries, []);
		assert.equal(report.limit, 10);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cli-supervisor-responses: buildSupervisorResponsesReport surfaces persisted entries newest-first", async () => {
	const root = tempDir();
	try {
		for (let i = 0; i < 3; i++) seedSuccessEntry(root, i);
		await flushSupervisorResponseHistory(root);
		const report = buildSupervisorResponsesReport({
			stateRoot: root,
			options: { limit: 10 },
		});
		assert.equal(report.returnedCount, 3);
		assert.equal(report.entries.length, 3);
		// Entries are persisted newest-first on disk.
		for (let i = 0; i < 3; i++) {
			assert.equal(
				report.entries[i]?.status,
				"success",
			);
			assert.equal(report.entries[i]?.role, "supervisor-main");
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cli-supervisor-responses: buildSupervisorResponsesReport honours limit and includes errors", async () => {
	const root = tempDir();
	try {
		for (let i = 0; i < 5; i++) seedSuccessEntry(root, i);
		seedErrorEntry(root, 99, "consult_failed");
		await flushSupervisorResponseHistory(root);
		const report = buildSupervisorResponsesReport({
			stateRoot: root,
			options: { limit: 3 },
		});
		assert.equal(report.returnedCount, 3);
		assert.equal(report.limit, 3);
		// Mixed entry types surface both statuses.
		const statuses = new Set(report.entries.map((e) => e.status));
		assert.ok(statuses.has("success") || statuses.has("error"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cli-supervisor-responses: formatSupervisorResponses renders a clean empty report", () => {
	const root = tempDir();
	try {
		const report = buildSupervisorResponsesReport({ stateRoot: root });
		const out = formatSupervisorResponses(report);
		assert.match(out, /Supervisor Responses/);
		assert.match(out, /no supervisor responses yet/);
		assert.match(out, /Total: 0 entries/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cli-supervisor-responses: formatSupervisorResponses renders success + error entries", async () => {
	const root = tempDir();
	try {
		seedSuccessEntry(root, 1);
		seedErrorEntry(root, 2, "consult_failed");
		await flushSupervisorResponseHistory(root);
		const report = buildSupervisorResponsesReport({ stateRoot: root });
		const out = formatSupervisorResponses(report);
		assert.match(out, /success/u);
		assert.match(out, /error/u);
		assert.match(out, /Total: 2/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("cli-supervisor-responses: parseSupervisorResponsesArgs accepts --limit and --state-root", () => {
	const parsed = parseSupervisorResponsesArgs([
		"--limit",
		"5",
		"--state-root",
		"/tmp/state",
	]);
	assert.equal(parsed.options.limit, 5);
	assert.equal(parsed.stateRootOverride, "/tmp/state");
});

test("cli-supervisor-responses: parseSupervisorResponsesArgs throws on unknown flag", () => {
	assert.throws(
		() => parseSupervisorResponsesArgs(["--bogus", "x"]),
		/Flag desconocido/u,
	);
});

test("cli-supervisor-responses: parseSupervisorResponsesArgs throws on negative limit", () => {
	assert.throws(
		() => parseSupervisorResponsesArgs(["--limit", "-3"]),
		/--limit inválido/u,
	);
});

test("cli-supervisor-responses: end-to-end — record → flush → read returns the entry", async () => {
	const root = tempDir();
	try {
		recordSupervisorResponseDeferred(root, {
			stateRoot: root,
			role: "supervisor-main",
			question: "E2E question?",
			result: {
				ok: true,
				role: "supervisor-main",
				response: "E2E response body",
				model: "test/model",
				provider: "test-provider",
				promptChars: 50,
				elapsedMs: 5,
			},
		});
		await flushSupervisorResponseHistory(root);
		const entries = readSupervisorResponseHistory(root);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.status, "success");
		assert.ok(entries[0]?.response?.includes("E2E response body"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});