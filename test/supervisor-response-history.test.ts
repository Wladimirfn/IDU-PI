import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

// ---------------------------------------------------------------------------
// WU-2 Phase 2 — cross-process file lock integration
// (spec #3098 rev4, design #3099 rev3, tasks #3100 rev7 WU-2 Phase 2)
// ---------------------------------------------------------------------------
//
// persistWithRetention now wraps its read-modify-write in
// acquireExclusiveFileLock(path) -> try -> finally releaseExclusiveFileLock,
// so two MCP processes writing to the same stateRoot are serialized at the
// filesystem level (O_EXCL lockfile) and no entry is lost. The in-process
// writeChain is kept (it still serializes concurrent calls within ONE process).

/**
 * Resolve the absolute path to the compiled supervisor-response-history module.
 * Walks up from this test file to the `dist` root, then into `src`. Robust to
 * where `node --test` is invoked from because it derives from import.meta.url.
 */
function distSupervisorHistoryModulePath(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	while (basename(dir) !== "dist") {
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error("could not locate dist root from test file location");
		}
		dir = parent;
	}
	return join(dir, "src", "supervisor-response-history.js");
}

/** Spawns a child node process that writes `count` entries starting at index `start`. */
function spawnWriterChild(
	modulePath: string,
	stateRoot: string,
	start: number,
	count: number,
): Promise<number> {
	// On Windows, dynamic import() requires a file:// URL, not a bare path.
	const moduleUrl = pathToFileURL(modulePath).href;
	// ESM child: dynamic-import the compiled module and loop writes. Wrapped in
	// an async IIFE so `return` is legal (top-level return is not allowed in ESM).
	const script = [
		"(async () => {",
		"  const mod = await import(process.argv[1]);",
		"  const stateRoot = process.argv[2];",
		"  const start = Number(process.argv[3]);",
		"  const count = Number(process.argv[4]);",
		"  for (let i = 0; i < count; i++) {",
		"    const entry = mod.buildSupervisorResponseHistoryEntryFromConsult(",
		"      {",
		"        stateRoot: stateRoot,",
		"        role: \"supervisor-main\",",
		"        question: \"proc-q-\" + start + \"-\" + i,",
		"        result: {",
		"          ok: true,",
		"          role: \"supervisor-main\",",
		"          response: \"r-\" + start + \"-\" + i,",
		"          model: \"m\",",
		"          provider: \"p\",",
		"          promptChars: 1,",
		"          elapsedMs: 1,",
		"        },",
		"      },",
		"      new Date(Date.UTC(2026, 6, 11, 12, start, i)),",
		"    );",
		"    const res = await mod.recordSupervisorResponse(stateRoot, entry);",
		"    if (!res.ok) { process.exitCode = 2; return; }",
		"  }",
		"})();",
	].join("\n");
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				script,
				moduleUrl,
				stateRoot,
				String(start),
				String(count),
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let stderr = "";
		child.stdout?.on("data", () => undefined);
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`writer child start=${start} exited ${code}: ${stderr}`));
			} else {
				resolve(code);
			}
		});
	});
}

test("cross-process fork contention: two children x 5 entries preserves all 10 entries via the file lock (no lost updates)", async () => {
	const root = tempDir("idu-fork-");
	try {
		const modulePath = distSupervisorHistoryModulePath();
		// Spawn both children as close together as possible so their writes overlap.
		const [a, b] = await Promise.all([
			spawnWriterChild(modulePath, root, 0, 5),
			spawnWriterChild(modulePath, root, 1, 5),
		]);
		assert.equal(a, 0);
		assert.equal(b, 0);
		const entries = readSupervisorResponseHistory(root);
		// All 10 entries must survive — the cross-process file lock serializes
		// the read-modify-write cycles between the two children.
		assert.equal(
			entries.length,
			10,
			"cross-process file lock must serialize writes so no entry is lost",
		);
		// Every entry id is unique and present.
		const questions = entries
			.map((e) => e.questionSummary)
			.sort();
		assert.ok(questions.includes("proc-q-0-0"));
		assert.ok(questions.includes("proc-q-1-4"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("lock-acquire failure surfaces {ok:false, error:'LOCK_TIMEOUT', lockDiagnostics} and leaves the JSONL file unchanged", async () => {
	const root = tempDir("idu-lockfail-");
	const prevTimeout = process.env.IDU_LOCK_TIMEOUT_MS;
	try {
		const path = supervisorResponseHistoryPath(root);
		const lockPath = `${path}.lock`;
		mkdirSync(dirname(path), { recursive: true });
		// Pre-create a lockfile "held" by another actor (token differs from ours).
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				startedAt: new Date().toISOString(),
				token: "someone-else-token",
				host: hostname(),
			}),
			"utf8",
		);
		// Pre-existing JSONL that must be left untouched.
		const existingEntry = buildSupervisorResponseHistoryEntryFromConsult(
			successInput(99),
			new Date("2026-07-11T12:00:00.000Z"),
		);
		const originalJsonl = `${JSON.stringify(existingEntry)}\n`;
		writeFileSync(path, originalJsonl, "utf8");

		// Force a very short lock-acquire timeout so the held lockfile times out fast.
		process.env.IDU_LOCK_TIMEOUT_MS = "100";
		const entry = buildSupervisorResponseHistoryEntryFromConsult(
			successInput(0),
			new Date("2026-07-11T12:00:01.000Z"),
		);
		const result = await recordSupervisorResponse(root, entry);

		assert.equal(result.ok, false);
		assert.equal(result.error, "LOCK_TIMEOUT");
		assert.ok(result.lockDiagnostics, "lockDiagnostics must be surfaced");
		assert.equal(result.lockDiagnostics!.lockPath, lockPath);
		// The JSONL must be byte-for-byte unchanged — we never acquired the lock.
		assert.equal(readFileSync(path, "utf8"), originalJsonl);
		// The pre-existing lockfile is still there (no-reclaim invariant).
		assert.equal(existsSync(lockPath), true);
	} finally {
		if (prevTimeout === undefined) {
			delete process.env.IDU_LOCK_TIMEOUT_MS;
		} else {
			process.env.IDU_LOCK_TIMEOUT_MS = prevTimeout;
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("lockfile cleanup on success, write-throw, and lock-fail outcomes", async () => {
	const prevTimeout = process.env.IDU_LOCK_TIMEOUT_MS;
	try {
		// --- Outcome 1: success → lockfile cleaned up after release. ---
		{
			const root = tempDir("idu-clean-ok-");
			try {
				const path = supervisorResponseHistoryPath(root);
				const entry = buildSupervisorResponseHistoryEntryFromConsult(
					successInput(1),
					new Date("2026-07-11T12:00:00.000Z"),
				);
				const result = await recordSupervisorResponse(root, entry);
				assert.equal(result.ok, true);
				assert.equal(
					existsSync(`${path}.lock`),
					false,
					"lockfile must be cleaned up after a successful write",
				);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}

		// --- Outcome 2: write throws inside the lock → finally still releases. ---
		{
			const root = tempDir("idu-clean-throw-");
			try {
				const path = supervisorResponseHistoryPath(root);
				mkdirSync(dirname(path), { recursive: true });
				// Make the history path a NON-EMPTY directory → rename(target=dir)
				// fails on both Windows and POSIX, inducing a write error AFTER
				// the lock was acquired.
				mkdirSync(path, { recursive: true });
				writeFileSync(join(path, "blocker"), "x", "utf8");
				const entry = buildSupervisorResponseHistoryEntryFromConsult(
					successInput(2),
					new Date("2026-07-11T12:00:00.000Z"),
				);
				const result = await recordSupervisorResponse(root, entry);
				assert.equal(result.ok, false, "write must fail because target is a directory");
				assert.equal(
					existsSync(`${path}.lock`),
					false,
					"lockfile must be cleaned up even when the write throws",
				);
				// Remove the blocker dir so the outer rmSync succeeds cleanly.
				rmSync(path, { recursive: true, force: true });
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}

		// --- Outcome 3: lock-fail → no new lockfile from us; pre-existing untouched. ---
		{
			const root = tempDir("idu-clean-lockfail-");
			try {
				const path = supervisorResponseHistoryPath(root);
				const lockPath = `${path}.lock`;
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(
					lockPath,
					JSON.stringify({
						pid: process.pid,
						startedAt: new Date().toISOString(),
						token: "other-token",
						host: hostname(),
					}),
					"utf8",
				);
				process.env.IDU_LOCK_TIMEOUT_MS = "100";
				const entry = buildSupervisorResponseHistoryEntryFromConsult(
					successInput(3),
					new Date("2026-07-11T12:00:00.000Z"),
				);
				const result = await recordSupervisorResponse(root, entry);
				assert.equal(result.ok, false);
				assert.equal(result.error, "LOCK_TIMEOUT");
				// The pre-existing lockfile is still there (we never acquired it,
				// so we have nothing of ours to clean up).
				assert.equal(existsSync(lockPath), true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	} finally {
		if (prevTimeout === undefined) {
			delete process.env.IDU_LOCK_TIMEOUT_MS;
		} else {
			process.env.IDU_LOCK_TIMEOUT_MS = prevTimeout;
		}
	}
});

// ---------------------------------------------------------------------------
// Phase 3 — flushSupervisorResponseHistory typed aggregate (spec #3098 rev4, design #3099 rev3, tasks #3100 rev7 WU-2)
// ---------------------------------------------------------------------------
//
// flushSupervisorResponseHistory MUST return a typed aggregate without throwing for any
// deferred-log state (missing, empty, unreadable, malformed). The deferred-persistence failure log lives at
// `${stateRoot}/reports/idu-supervisor-responses.deferred.jsonl` and is read non-destructively.
// Each deferred line shape: { entryId, timestamp, role, errorCode, diagnostics }.

function deferredLogPath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-supervisor-responses.deferred.jsonl");
}

test("flushSupervisorResponseHistory aggregates deferred persistence failures from the deferred log (task 3.1)", async () => {
	const root = tempDir();
	try {
		const path = deferredLogPath(root);
		mkdirSync(dirname(path), { recursive: true });
		const diagnostics = {
			lockPath: `${supervisorResponseHistoryPath(root)}.lock`,
			holderPid: 4321,
			holderHost: "test-host",
			holderStartedAt: "2026-07-11T12:00:00.000Z",
			holderState: "alive",
		};
		const lines: string[] = [];
		for (let i = 0; i < 3; i += 1) {
			lines.push(
				JSON.stringify({
					entryId: `entry-${i}`,
					timestamp: new Date(Date.UTC(2026, 6, 11, 12, 0, i)).toISOString(),
					role: "supervisor-main",
					errorCode: i % 2 === 0 ? "LOCK_TIMEOUT" : "LOCK_IO_ERROR",
					diagnostics,
				}),
			);
		}
		writeFileSync(path, lines.join("\n") + "\n", "utf8");
		const result = await flushSupervisorResponseHistory(root);
		// RED signal: flush currently returns void (undefined).
		assert.notEqual(result, undefined);
		assert.equal(result.ok, true);
		assert.equal(result.deferredCount, 3);
		assert.equal(result.failures.length, 3);
		assert.equal(result.failures[0]?.entryId, "entry-0");
		assert.equal(result.failures[0]?.errorCode, "LOCK_TIMEOUT");
		assert.equal(result.failures[1]?.errorCode, "LOCK_IO_ERROR");
		assert.deepEqual(result.failures[0]?.diagnostics, diagnostics);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flushSupervisorResponseHistory returns zero-count success when the deferred log is missing or empty (task 3.2)", async () => {
	// Missing log → { ok: true, deferredCount: 0, failures: [] }.
	const rootMissing = tempDir();
	try {
		const resultMissing = await flushSupervisorResponseHistory(rootMissing);
		assert.notEqual(resultMissing, undefined);
		assert.equal(resultMissing.ok, true);
		assert.equal(resultMissing.deferredCount, 0);
		assert.equal(resultMissing.failures.length, 0);
	} finally {
		rmSync(rootMissing, { recursive: true, force: true });
	}
	// Empty log → { ok: true, deferredCount: 0, failures: [] }.
	const rootEmpty = tempDir();
	try {
		const path = deferredLogPath(rootEmpty);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "", "utf8");
		const resultEmpty = await flushSupervisorResponseHistory(rootEmpty);
		assert.notEqual(resultEmpty, undefined);
		assert.equal(resultEmpty.ok, true);
		assert.equal(resultEmpty.deferredCount, 0);
		assert.equal(resultEmpty.failures.length, 0);
	} finally {
		rmSync(rootEmpty, { recursive: true, force: true });
	}
});

test("flushSupervisorResponseHistory returns typed FLUSH_PARSE_ERROR for a malformed deferred log without throwing (task 3.3)", async () => {
	const root = tempDir();
	try {
		const path = deferredLogPath(root);
		mkdirSync(dirname(path), { recursive: true });
		// A line that is not valid JSON → parse error.
		writeFileSync(path, "this is not json\n", "utf8");
		const result = await flushSupervisorResponseHistory(root);
		assert.notEqual(result, undefined);
		assert.equal(result.ok, false);
		assert.equal(result.errorCode, "FLUSH_PARSE_ERROR");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flushSupervisorResponseHistory returns typed FLUSH_IO_ERROR when the deferred log is unreadable without throwing (task 3.3)", async () => {
	const root = tempDir();
	try {
		// Make the deferred-log PATH itself a directory. readFileSync on a directory
		// fails with EISDIR on both POSIX and Windows — a real I/O failure distinct from a
		// missing file's ENOENT.
		const path = deferredLogPath(root);
		mkdirSync(path, { recursive: true });
		const result = await flushSupervisorResponseHistory(root);
		assert.notEqual(result, undefined);
		assert.equal(result.ok, false);
		assert.equal(result.errorCode, "FLUSH_IO_ERROR");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flushSupervisorResponseHistory awaits pending supervisor response writes before reading the deferred log (task 3.4 ordering invariant)", async () => {
	const root = tempDir();
	try {
		// Schedule a deferred write; flush must await it before returning so the
		// aggregate reflects all in-flight writes (the deferred-log append path lands in a later WU).
		recordSupervisorResponseDeferred(root, successInput(42));
		const flushResult = await flushSupervisorResponseHistory(root);
		assert.notEqual(flushResult, undefined);
		// The pending write MUST have settled (history file now holds the entry)
		// before flush returned — proving flush awaits pending writes first.
		const entries = readSupervisorResponseHistory(root);
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.questionSummary, "q-42");
		// No deferred failures for this root → ok: true, zero-count.
		assert.equal(flushResult.ok, true);
		assert.equal(flushResult.deferredCount, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// WU-2 Phase 2 task 2.4 — deferred-log append on lock-acquire failure
// (spec #3098 rev4, design #3099 rev3, tasks #3100 rev7 WU-2 Phase 2)
// ---------------------------------------------------------------------------
//
// When persistWithRetention fails with LOCK_TIMEOUT / LOCK_IO_ERROR (i.e. result.ok === false
// AND result.lockDiagnostics is present), recordSupervisorResponseDeferred MUST append a deferred-failure line to
// `${stateRoot}/reports/idu-supervisor-responses.deferred.jsonl`. The deferred write tracker (the
// pendingSupervisorResponseWrites set) MUST await this append too, so flush — which awaits pending writes before
// reading the log — observes the appended line in the same cycle.

test("recordSupervisorResponseDeferred appends a deferred-failure line to the deferred log on LOCK_TIMEOUT (task 2.4)", async () => {
	const root = tempDir("idu-deferred-append-");
	const prevTimeout = process.env.IDU_LOCK_TIMEOUT_MS;
	try {
		const path = supervisorResponseHistoryPath(root);
		const lockPath = `${path}.lock`;
		mkdirSync(dirname(path), { recursive: true });
		// Pre-create a lockfile "held" by another actor (token differs from ours) so acquire fails.
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				startedAt: new Date().toISOString(),
				token: "someone-else-token",
				host: hostname(),
			}),
			"utf8",
		);
		process.env.IDU_LOCK_TIMEOUT_MS = "100";
		// Deterministic timestamp so the entryId is reproducible in the assertion.
		const fixedDate = new Date("2026-07-11T12:00:00.000Z");
		const input = { ...successInput(0), stateRoot: root, now: fixedDate };
		recordSupervisorResponseDeferred(root, input);
		const result = await flushSupervisorResponseHistory(root);
		// The flush read is clean → ok: true; one deferred line appended.
		assert.notEqual(result, undefined);
		assert.equal(result.ok, true, "flush aggregate must be ok:true (the read is clean)");
		assert.equal(result.deferredCount, 1, "exactly one deferred failure must be aggregated");
		assert.equal(result.failures.length, 1);
		assert.equal(result.failures[0]?.errorCode, "LOCK_TIMEOUT");
		assert.equal(
			result.failures[0]?.diagnostics.lockPath,
			lockPath,
			"diagnostics.lockPath must be the history lock path",
		);
		// The deferred-failure log file MUST exist on disk under stateRoot.
		assert.equal(
			existsSync(deferredLogPath(root)),
			true,
			"deferred-failure log file must be created by the append path",
		);
		// entryId is deterministic and derivable from the entry that was attempted.
		const expectedEntry =
			buildSupervisorResponseHistoryEntryFromConsult(input);
		assert.equal(
			result.failures[0]?.entryId,
			`${expectedEntry.timestamp}#${expectedEntry.role}`,
		);
	} finally {
		if (prevTimeout === undefined) {
			delete process.env.IDU_LOCK_TIMEOUT_MS;
		} else {
			process.env.IDU_LOCK_TIMEOUT_MS = prevTimeout;
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("recordSupervisorResponseDeferred does NOT append a deferred line when the write fails for a non-lock reason (task 2.4 — no false positives)", async () => {
	const root = tempDir();
	try {
		// blocker is a regular FILE where a directory is expected → mkdir fails with ENOTDIR,
		// which is NOT a lock-acquire failure (no lockDiagnostics) → no deferred append.
		const blocker = join(root, "blocker");
		writeFileSync(blocker, "not a dir", "utf8");
		const input = { ...successInput(7), stateRoot: blocker };
		recordSupervisorResponseDeferred(blocker, input);
		const result = await flushSupervisorResponseHistory(blocker);
		// No deferred line appended → ok:true, zero-count.
		assert.equal(result.ok, true);
		assert.equal(result.deferredCount, 0);
		assert.equal(result.failures.length, 0);
		assert.equal(
			existsSync(deferredLogPath(blocker)),
			false,
			"no deferred log must be created for a non-lock failure",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// WU-2 Phase 3 task e — the deferred log is consumed (truncated) after a successful flush
// ---------------------------------------------------------------------------

test("flushSupervisorResponseHistory consumes the deferred log after a successful aggregate so a second flush returns zero (task e)", async () => {
	const root = tempDir();
	try {
		const path = deferredLogPath(root);
		mkdirSync(dirname(path), { recursive: true });
		const diagnostics = {
			lockPath: `${supervisorResponseHistoryPath(root)}.lock`,
			holderPid: 1111,
			holderHost: "test-host",
			holderStartedAt: "2026-07-11T12:00:00.000Z",
			holderState: "alive",
		};
		writeFileSync(
			path,
			JSON.stringify({
				entryId: "e-1",
				timestamp: "2026-07-11T12:00:00.000Z",
				role: "supervisor-main",
				errorCode: "LOCK_TIMEOUT",
				diagnostics,
			}) + "\n",
			"utf8",
		);
		const r1 = await flushSupervisorResponseHistory(root);
		assert.equal(r1.ok, true);
		assert.equal(r1.deferredCount, 1);
		// A second flush MUST observe an empty log — the first flush consumed it.
		const r2 = await flushSupervisorResponseHistory(root);
		assert.equal(r2.ok, true);
		assert.equal(r2.deferredCount, 0);
		assert.equal(r2.failures.length, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flushSupervisorResponseHistory does NOT consume the deferred log on a FLUSH_PARSE_ERROR so the malformed line is not lost (task e — non-destructive on error)", async () => {
	const root = tempDir();
	try {
		const path = deferredLogPath(root);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "this is not json\n", "utf8");
		const r1 = await flushSupervisorResponseHistory(root);
		assert.equal(r1.ok, false);
		assert.equal(r1.errorCode, "FLUSH_PARSE_ERROR");
		// On error the log MUST be left intact — a retry re-flush still sees the malformed line.
		const r2 = await flushSupervisorResponseHistory(root);
		assert.equal(r2.ok, false);
		assert.equal(r2.errorCode, "FLUSH_PARSE_ERROR");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
