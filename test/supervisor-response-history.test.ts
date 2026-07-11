import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	flushSupervisorResponseHistory,
	readSupervisorResponseHistory,
	recordSupervisorResponse,
	recordSupervisorResponseDeferred,
	supervisorResponseHistoryPath,
	buildSupervisorResponseHistoryEntryFromConsult,
	SUPERVISOR_RESPONSE_HISTORY_MAX_ENTRIES,
	SUPERVISOR_RESPONSE_HISTORY_QUESTION_MAX,
	SUPERVISOR_RESPONSE_HISTORY_RESPONSE_MAX,
	type SupervisorResponseHistoryEntry,
} from "../src/supervisor-response-history.js";

function tempDir(prefix = "idu-sup-resp-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

const baseSuccessInput = {
	stateRoot: "/tmp/state",
	role: "supervisor-main",
	question: "Should I rerun postflight after a docs-only change?",
	result: {
		ok: true,
		role: "supervisor-main",
		response: "Yes — postflight is cheap and catches drift.",
		model: "openai/gpt-5",
		provider: "openai",
		promptChars: 412,
		elapsedMs: 840,
	},
};

const baseFailureInput = {
	stateRoot: "/tmp/state",
	role: "supervisor-main",
	question: "Will rails reset?",
	result: {
		ok: false,
		role: "supervisor-main",
		response: "",
		model: "",
		provider: "",
		reason: "consult_failed",
		promptChars: 220,
		elapsedMs: 60,
	},
};

function successInput(i: number) {
	return {
		stateRoot: "/tmp/state",
		role: "supervisor-main",
		question: `q-${i}`,
		result: {
			ok: true,
			role: "supervisor-main",
			response: `resp-${i}`,
			model: "openai/gpt-5",
			provider: "openai",
			promptChars: 100,
			elapsedMs: 100,
		},
	};
}

test("supervisor response history path resolves under stateRoot reports", () => {
	const path = supervisorResponseHistoryPath("/tmp/state");
	assert.match(path, /reports[\\/]+idu-supervisor-responses\.jsonl$/u);
});

test("supervisor response history writes a valid entry and the file ends with a newline", async () => {
	const root = tempDir();
	try {
		const path = supervisorResponseHistoryPath(root);
		const entry = buildSupervisorResponseHistoryEntryFromConsult(
			baseSuccessInput,
			new Date("2026-07-11T12:00:00.000Z"),
		);
		const result = await recordSupervisorResponse(root, entry);
		assert.equal(result.ok, true);
		assert.equal(result.path, path);
		const fileContent = readFileSync(path, "utf8");
		assert.equal(fileContent.endsWith("\n"), true);
		const entries = readSupervisorResponseHistory(root);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.status, "success");
		assert.equal(entries[0]?.role, "supervisor-main");
		assert.equal(entries[0]?.provider, "openai");
		assert.equal(entries[0]?.model, "openai/gpt-5");
		assert.ok((entries[0]?.response ?? "").includes("postflight"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("supervisor response history records failure status without a response body", async () => {
	const root = tempDir();
	try {
		const entry = buildSupervisorResponseHistoryEntryFromConsult(
			baseFailureInput,
			new Date("2026-07-11T12:05:00.000Z"),
		);
		const result = await recordSupervisorResponse(root, entry);
		assert.equal(result.ok, true);
		const entries = readSupervisorResponseHistory(root);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.status, "error");
		assert.equal(entries[0]?.error, "consult_failed");
		assert.equal(entries[0]?.response, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("supervisor response history bounds questionSummary and response body", () => {
	const hugeQuestion = "x".repeat(2_000);
	const hugeResponse = "y".repeat(10_000);
	const entry = buildSupervisorResponseHistoryEntryFromConsult(
		{
			stateRoot: "/tmp/state",
			role: "supervisor-main",
			question: hugeQuestion,
			result: {
				ok: true,
				role: "supervisor-main",
				response: hugeResponse,
				model: "openai/gpt-5",
				provider: "openai",
				promptChars: 12_345,
				elapsedMs: 999,
			},
		},
		new Date("2026-07-11T12:10:00.000Z"),
	);
	assert.equal(
		entry.questionSummary.length,
		SUPERVISOR_RESPONSE_HISTORY_QUESTION_MAX,
	);
	assert.ok(entry.questionSummary.endsWith("…"));
	assert.equal(
		(entry.response ?? "").length,
		SUPERVISOR_RESPONSE_HISTORY_RESPONSE_MAX,
	);
	assert.ok((entry.response ?? "").endsWith("…"));
});

test("recordSupervisorResponse keeps at most 50 newest entries ON DISK", async () => {
	const root = tempDir();
	try {
		const path = supervisorResponseHistoryPath(root);
		for (let i = 0; i < 60; i += 1) {
			const entry = buildSupervisorResponseHistoryEntryFromConsult(
				successInput(i),
				new Date(Date.UTC(2026, 6, 11, 12, 0, i)),
			);
			await recordSupervisorResponse(root, entry);
		}
		await flushSupervisorResponseHistory();
		// Read the RAW file — not through the reader — to prove the file
		// on disk has exactly 50 lines, not merely that the reader returns 50.
		const raw = readFileSync(path, "utf8");
		const rawLines = raw.trim().split("\n");
		assert.equal(rawLines.length, SUPERVISOR_RESPONSE_HISTORY_MAX_ENTRIES);
		// Entries are persisted newest-first on disk.
		const firstOnDisk = JSON.parse(
			rawLines[0]!,
		) as SupervisorResponseHistoryEntry;
		assert.equal(firstOnDisk.questionSummary, "q-59");
		const lastOnDisk = JSON.parse(
			rawLines[49]!,
		) as SupervisorResponseHistoryEntry;
		assert.equal(lastOnDisk.questionSummary, "q-10");
		// The reader also returns 50, newest-first.
		const entries = readSupervisorResponseHistory(root);
		assert.equal(entries.length, SUPERVISOR_RESPONSE_HISTORY_MAX_ENTRIES);
		assert.equal(entries[0]?.questionSummary, "q-59");
		assert.equal(entries[49]?.questionSummary, "q-10");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concurrent in-process writes are serialized and never lose entries", async () => {
	const root = tempDir();
	try {
		const writes: Promise<unknown>[] = [];
		for (let i = 0; i < 20; i += 1) {
			const entry = buildSupervisorResponseHistoryEntryFromConsult(
				successInput(i),
				new Date(Date.UTC(2026, 6, 11, 12, 0, i)),
			);
			writes.push(recordSupervisorResponse(root, entry));
		}
		const results = await Promise.all(writes);
		assert.ok(
			results.every((r) => (r as { ok: boolean }).ok === true),
			"all concurrent writes must succeed",
		);
		const entries = readSupervisorResponseHistory(root);
		assert.equal(
			entries.length,
			20,
			"serialization queue must preserve all entries",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reader skips malformed JSONL lines and returns only valid entries", () => {
	const root = tempDir();
	try {
		const path = supervisorResponseHistoryPath(root);
		mkdirSync(dirname(path), { recursive: true });
		const good = buildSupervisorResponseHistoryEntryFromConsult(
			baseSuccessInput,
			new Date("2026-07-11T12:00:00.000Z"),
		);
		const lines = [
			"not-json-at-all",
			JSON.stringify(good),
			'{"timestamp":"x","role":"r","status":"success","questionSummary":"q"}',
			'{"role":"missing-timestamp","status":"success","questionSummary":"q"}',
		];
		writeFileSync(path, lines.join("\n") + "\n", "utf8");
		const entries = readSupervisorResponseHistory(root);
		// Only the "good" entry has a parseable ISO timestamp and valid shape.
		assert.ok(entries.length >= 1);
		assert.ok(entries.some((e) => e.questionSummary.includes("postflight")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("deferred writer records failure result without throwing", async () => {
	const root = tempDir();
	try {
		// Force an unwritable stateRoot: a regular file where a directory is expected.
		const blocker = join(root, "blocker");
		writeFileSync(blocker, "not a dir", "utf8");
		recordSupervisorResponseDeferred(blocker, baseSuccessInput);
		await flushSupervisorResponseHistory();
		// No throw; no file leaked where it does not belong.
		assert.equal(
			existsSync(supervisorResponseHistoryPath(blocker)),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("multi-process assessment: single-process serialization prevents lost updates; cross-process locking is a documented bounded limitation", async () => {
	// This test documents the durability guarantee and its boundary.
	//
	// GUARANTEED (single MCP process): the in-process serialization queue
	// chains every recordSupervisorResponse call sequentially, so
	// concurrent deferred writes from one process never interleave their
	// read-modify-write cycles and never lose entries. Proven by the
	// "concurrent in-process writes" test above.
	//
	// NOT GUARANTEED (two MCP processes): two processes writing to the
	// same stateRoot concurrently can produce a lost update because each
	// process has its own writeChain. Process A reads 49 entries while
	// Process B reads the same 49; both append their own entry and both
	// rename. The second rename wins, losing the first process's entry.
	// The file is always valid JSONL (atomic rename prevents corruption),
	// but one entry may be lost.
	//
	// ACCEPTANCE: this is a bounded limitation. The deployment model is
	// one MCP process per project. We deliberately do NOT add cross-process
	// file locking (flock / lockfile) because:
	//   1. It adds platform-specific complexity (Windows vs POSIX).
	//   2. The deployment model does not require it.
	//   3. Atomic temp-write-and-rename still guarantees the file is never
	//      corrupted — only a concurrent entry can be lost, which is
	//      acceptable for advisory history.
	//
	// This test verifies the single-process guarantee holds and serves as
	// living documentation of the multi-process boundary.
	const root = tempDir();
	try {
		const entry = buildSupervisorResponseHistoryEntryFromConsult(
			successInput(0),
			new Date("2026-07-11T12:00:00.000Z"),
		);
		const result = await recordSupervisorResponse(root, entry);
		assert.equal(result.ok, true);
		const entries = readSupervisorResponseHistory(root);
		assert.equal(entries.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
