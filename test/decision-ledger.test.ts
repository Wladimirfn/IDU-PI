import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync, spawn } from "node:child_process";

/**
 * The decision ledger is a shared log under IDU_HOME, written by whoever is
 * working: an orchestrator, its workers, and any other CLI sharing the home.
 * These tests cover the collisions that produce, because the happy path was
 * never the one that lost data.
 *
 * Every case runs in a child process. `IDU_HOME` is a module constant and
 * `config.js` stays in the ESM cache for the life of the test process, so a
 * test that set the variable in its own body would keep resolving the real home.
 */

const LEDGER_MODULE = pathToFileURL(join(process.cwd(), "dist", "src", "decision-ledger.js")).href;

function inChild(home: string, code: string): { status: number | null; stdout: string; stderr: string } {
	const res = spawnSync(
		process.execPath,
		["--input-type=module", "-e", `import { recordDecision, listDecisions } from ${JSON.stringify(LEDGER_MODULE)};\n${code}`],
		{ env: { ...process.env, IDU_HOME: home }, encoding: "utf8" },
	);
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function freshHome(): string {
	return mkdtempSync(join(tmpdir(), "idu-ledger-"));
}

/** Seeds the NEW format: one JSON object per line. */
function seedJsonl(home: string, count: number): void {
	const lines = Array.from({ length: count }, (_, i) =>
		JSON.stringify({
			id: i + 1,
			projectId: "quality-gate",
			decidedAt: "2026-09-01T00:00:00.000Z",
			decidedBy: "agent",
			decision: `decision real ${i + 1}`,
			targetKind: "module",
			targetId: `src/mod-${i + 1}.ts`,
		}),
	);
	writeFileSync(join(home, "decisions.jsonl"), lines.join("\n") + "\n", "utf8");
}

test("an unreadable ledger is never replaced by an empty one", () => {
	const home = freshHome();
	try {
		// The legacy single-file format, left half-written by a dead process.
		const legacy = join(home, "decision_ledger.json");
		const healthy = JSON.stringify(
			Array.from({ length: 14 }, (_, i) => ({
				id: i + 1, projectId: "quality-gate", decidedBy: "agent",
				decision: `decision real ${i + 1}`, targetKind: "module", targetId: `t${i + 1}`,
			})),
			null,
			2,
		);
		writeFileSync(legacy, healthy.slice(0, Math.floor(healthy.length / 2)), "utf8");
		const torn = readFileSync(legacy, "utf8");

		const res = inChild(
			home,
			`recordDecision({ projectId: "p", decidedBy: "a", decision: "d", targetKind: "module", targetId: "t" });
const after = listDecisions({ limit: 1000 });
console.log(JSON.stringify(after.map((d) => d.decision)));`,
		);

		assert.equal(res.status, 0, res.stderr);
		const decisions = JSON.parse(res.stdout.trim()) as string[];
		assert.deepEqual(
			decisions,
			["d"],
			"only the new decision may exist: a torn legacy file is never treated as an empty ledger",
		);
		assert.equal(
			readFileSync(legacy, "utf8"),
			torn,
			"an unreadable legacy file must be left exactly as found, recoverable by hand",
		);
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("recording past 20 entries does not drop the oldest", () => {
	const home = freshHome();
	try {
		// listDecisions() has a display limit of 20. The old recordDecision()
		// rebuilt the file from that limited list, so every write erased the
		// oldest entries one at a time.
		seedJsonl(home, 25);

		const res = inChild(
			home,
			`recordDecision({ projectId: "p", decidedBy: "a", decision: "la 26", targetKind: "module", targetId: "t" });
console.log(JSON.stringify(listDecisions({ limit: 1000 }).map((d) => d.decision)));`,
		);

		assert.equal(res.status, 0, res.stderr);
		const decisions = JSON.parse(res.stdout.trim()) as string[];
		assert.equal(decisions.length, 26, "all 25 previous decisions plus the new one");
		assert.equal(decisions[0], "la 26", "newest first");
		assert.ok(
			decisions.includes("decision real 1"),
			"the oldest decision must still be there; the old code dropped it on the first write past 20",
		);
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("concurrent writers never lose a decision", async () => {
	const home = freshHome();
	try {
		// A fat log and 16 overlapping processes. A small one writes in under a
		// millisecond and the collision never happens, which would let this test
		// pass even with a read-modify-write implementation underneath.
		seedJsonl(home, 400);
		const writers = 16;

		const results = await Promise.all(
			Array.from({ length: writers }, (_, i) =>
				new Promise<{ ok: boolean; err: string }>((resolve, reject) => {
					const child = spawn(
						process.execPath,
						[
							"--input-type=module",
							"-e",
							`import { recordDecision } from ${JSON.stringify(LEDGER_MODULE)};
recordDecision({ projectId: "concurrencia", decidedBy: "w${i}", decision: "decision ${i}", targetKind: "module", targetId: "src/x.ts" });`,
						],
						{ env: { ...process.env, IDU_HOME: home }, stdio: ["ignore", "pipe", "pipe"] },
					);
					let err = "";
					child.stdout.resume();
					child.stderr.on("data", (c) => { err += c; });
					child.on("error", reject);
					child.on("close", (code) => resolve({ ok: code === 0, err }));
				}),
			),
		);

		const failed = results.filter((r) => !r.ok);
		assert.equal(failed.length, 0, `every writer must succeed; failures: ${failed.map((f) => f.err).join(" | ")}`);

		const res = inChild(home, `console.log(JSON.stringify(listDecisions({ limit: 1000 }).map((d) => d.decision)));`);
		assert.equal(res.status, 0, res.stderr);
		const onDisk = JSON.parse(res.stdout.trim()) as string[];

		assert.equal(
			onDisk.length,
			400 + writers,
			`no writer may be lost to another writer; got ${onDisk.length}, expected ${400 + writers}`,
		);
		for (let i = 0; i < writers; i++) {
			assert.ok(onDisk.includes(`decision ${i}`), `writer ${i} landed nowhere`);
		}
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("the log on disk is parseable after every single write", () => {
	const home = freshHome();
	try {
		seedJsonl(home, 3);
		for (let i = 0; i < 6; i++) {
			const res = inChild(
				home,
				`recordDecision({ projectId: "p", decidedBy: "a", decision: "d${i}", targetKind: "module", targetId: "t" });`,
			);
			assert.equal(res.status, 0, res.stderr);
			const raw = readFileSync(join(home, "decisions.jsonl"), "utf8");
			// What a reader that is not this process would find, right now.
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				assert.doesNotThrow(() => JSON.parse(line), `iteration ${i} left invalid JSON on disk`);
			}
		}
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("a legacy JSON ledger is migrated once, keeping every entry", () => {
	const home = freshHome();
	try {
		const legacyEntries = Array.from({ length: 9 }, (_, i) => ({
			id: i + 1, projectId: "quality-gate", decidedAt: "2026-09-01T00:00:00.000Z",
			decidedBy: "agent", decision: `vieja ${i + 1}`, targetKind: "module", targetId: `t${i + 1}`,
		}));
		writeFileSync(join(home, "decision_ledger.json"), JSON.stringify(legacyEntries, null, 2), "utf8");

		const res = inChild(
			home,
			`const d = recordDecision({ projectId: "p", decidedBy: "a", decision: "nueva", targetKind: "module", targetId: "t" });
console.log(JSON.stringify(listDecisions({ limit: 1000 }).map((x) => x.decision)));`,
		);

		assert.equal(res.status, 0, res.stderr);
		const decisions = JSON.parse(res.stdout.trim()) as string[];
		assert.equal(decisions.length, 10, "nine migrated plus the new one");
		for (let i = 1; i <= 9; i++) {
			assert.ok(decisions.includes(`vieja ${i}`), `migrated entry ${i} was lost`);
		}
		assert.equal(decisions[0], "nueva", "newest first");

		// The old file is renamed, not destroyed.
		const leftovers = readdirSync(home).filter((f) => f.startsWith("decision_ledger.json"));
		assert.equal(leftovers.length, 1, `expected exactly one renamed legacy file, found ${leftovers.join(",")}`);
		assert.match(leftovers[0], /\.migrated-/);
		assert.equal(existsSync(join(home, "decisions.jsonl")), true);
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});
