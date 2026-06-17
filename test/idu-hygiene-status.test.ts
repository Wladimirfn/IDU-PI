import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatHygieneStatus,
	readHygieneStatus,
	runHygieneStatusCli,
} from "../src/hygiene-status.js";

function makeRoot(): { root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-hygiene-status-"));
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("readHygieneStatus: returns null lastRun when sensor has never run", () => {
	const { root, cleanup } = makeRoot();
	try {
		// No hygiene-sensor-last.json written
		const result = readHygieneStatus(root);
		assert.equal(result.lastRun, null);
		// patterns are always populated (canonical defaults)
		assert.ok(Array.isArray(result.patterns.canonical));
		assert.equal(result.patterns.canonical.length >= 8, true);
		// pendingInjections is 0 (empty injections.jsonl or none)
		assert.equal(result.pendingInjections, 0);
	} finally {
		cleanup();
	}
});

test("readHygieneStatus: reads sensor snapshot from hygiene-sensor-last.json", () => {
	const { root, cleanup } = makeRoot();
	try {
		const snapshot = {
			ts: "2026-06-17T10:00:00Z",
			scannedPaths: 100,
			matchedPaths: 2,
			truncated: false,
			findings: [
				{
					path: "/repo/.DS_Store",
					pattern: ".DS_Store",
					severity: "info",
					fingerprint: "abc123",
				},
				{
					path: "/repo/tmp-debug.mjs",
					pattern: "tmp-*.mjs",
					severity: "info",
					fingerprint: "def456",
				},
			],
		};
		writeFileSync(
			join(root, "hygiene-sensor-last.json"),
			JSON.stringify(snapshot),
			"utf8",
		);

		const result = readHygieneStatus(root);
		assert.ok(result.lastRun);
		assert.equal(result.lastRun.ts, "2026-06-17T10:00:00Z");
		assert.equal(result.lastRun.scannedPaths, 100);
		assert.equal(result.lastRun.matchedPaths, 2);
		assert.equal(result.lastRun.findings.length, 2);
	} finally {
		cleanup();
	}
});

test("readHygieneStatus: returns effective patterns (canonical + blocklist - allowlist)", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(
			join(root, "hygiene-patterns.json"),
			JSON.stringify({ blocklist: ["*.pyc"], allowlist: ["tmp-keep/"] }),
			"utf8",
		);
		const result = readHygieneStatus(root);
		assert.ok(result.patterns.canonical.length >= 8);
		assert.ok(result.patterns.blocklist.includes("*.pyc"));
		assert.ok(result.patterns.allowlist.includes("tmp-keep/"));
	} finally {
		cleanup();
	}
});

test("readHygieneStatus: counts un-acked hygiene_junk_file injections", () => {
	const { root, cleanup } = makeRoot();
	try {
		const injections = [
			{
				injectionId: "hyg-1",
				kind: "hygiene_junk_file",
				acked: false,
				ts: "2026-06-17T10:00:00Z",
				decisionEnvelope: {
					severity: "info",
					summary: "Junk: .DS_Store",
					options: ["ack"],
					evidenceRefs: [],
					orchestratorDecisionRequired: false,
				},
			},
			{
				injectionId: "hyg-2",
				kind: "hygiene_junk_file",
				acked: false,
				ts: "2026-06-17T10:01:00Z",
				decisionEnvelope: {
					severity: "warning",
					summary: "Junk: tmp-debug.mjs",
					options: ["ack"],
					evidenceRefs: [],
					orchestratorDecisionRequired: true,
				},
			},
			{
				injectionId: "obj-1",
				kind: "objective_reminder",
				acked: false,
				ts: "2026-06-17T10:02:00Z",
				decisionEnvelope: {
					severity: "info",
					summary: "obj",
					options: ["ack"],
					evidenceRefs: [],
					orchestratorDecisionRequired: false,
				},
			},
			{
				injectionId: "hyg-3",
				kind: "hygiene_junk_file",
				acked: true, // acked, shouldn't count
				ts: "2026-06-17T09:00:00Z",
				decisionEnvelope: {
					severity: "info",
					summary: "old",
					options: ["ack"],
					evidenceRefs: [],
					orchestratorDecisionRequired: false,
				},
			},
		];
		writeFileSync(
			join(root, "injections.jsonl"),
			injections.map((i) => JSON.stringify(i)).join("\n"),
			"utf8",
		);

		const result = readHygieneStatus(root);
		assert.equal(result.pendingInjections, 2); // only un-acked hygiene
	} finally {
		cleanup();
	}
});

test("readHygieneStatus: malformed hygiene-sensor-last.json falls back to null lastRun", () => {
	const { root, cleanup } = makeRoot();
	try {
		writeFileSync(
			join(root, "hygiene-sensor-last.json"),
			"not json {{{",
			"utf8",
		);
		const result = readHygieneStatus(root);
		assert.equal(result.lastRun, null);
	} finally {
		cleanup();
	}
});

test("formatHygieneStatus: includes Last run, Patterns, Pending lines", () => {
	const { root, cleanup } = makeRoot();
	try {
		const snapshot = {
			ts: "2026-06-17T10:00:00Z",
			scannedPaths: 50,
			matchedPaths: 1,
			truncated: false,
			findings: [
				{
					path: "/x/.DS_Store",
					pattern: ".DS_Store",
					severity: "info",
					fingerprint: "a",
				},
			],
		};
		writeFileSync(
			join(root, "hygiene-sensor-last.json"),
			JSON.stringify(snapshot),
			"utf8",
		);
		const status = readHygieneStatus(root);
		const formatted = formatHygieneStatus(status);
		assert.ok(formatted.includes("idu-pi hygiene status"));
		assert.ok(formatted.includes("Last run"));
		assert.ok(formatted.includes("scanned 50"));
		assert.ok(formatted.includes("matched 1"));
		assert.ok(formatted.includes("Patterns:"));
		assert.ok(formatted.includes(".DS_Store"));
	} finally {
		cleanup();
	}
});

test("formatHygieneStatus: handles null lastRun gracefully", () => {
	const { root, cleanup } = makeRoot();
	try {
		const status = readHygieneStatus(root);
		const formatted = formatHygieneStatus(status);
		assert.ok(formatted.includes("idu-pi hygiene status"));
		assert.ok(formatted.includes("never run"));
	} finally {
		cleanup();
	}
});

test("CLI idu-hygiene-status: prints status and exits 0", () => {
	const { root: stateRoot, cleanup: stateCleanup } = makeRoot();
	const { root: repoRoot, cleanup: repoCleanup } = makeRoot();
	try {
		// Seed sensor snapshot
		const snapshot = {
			ts: "2026-06-17T10:00:00Z",
			scannedPaths: 10,
			matchedPaths: 1,
			truncated: false,
			findings: [
				{
					path: join(repoRoot, ".DS_Store"),
					pattern: ".DS_Store",
					severity: "info",
					fingerprint: "x",
				},
			],
		};
		writeFileSync(
			join(stateRoot, "hygiene-sensor-last.json"),
			JSON.stringify(snapshot),
			"utf8",
		);

		const out = runHygieneStatusCli(stateRoot, repoRoot);
		assert.equal(out.exitCode, 0);
		assert.ok(out.stdout.includes("idu-pi hygiene status"));
		assert.ok(out.stdout.includes(".DS_Store"));
	} finally {
		stateCleanup();
		repoCleanup();
	}
});
