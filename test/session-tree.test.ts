import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

/**
 * The session tree is shared state written by every finished worker, and
 * `idu_delegate_parallel` finishes several on purpose at the same moment. These
 * tests cover that overlap, because the happy path was never the one that lost
 * sessions.
 *
 * Every case runs in a child process: IDU_HOME is a module constant and
 * config.js stays in the ESM cache for the life of the test process.
 */

const PM = pathToFileURL(join(process.cwd(), "dist", "src", "process-manager.js")).href;

function inChild(home: string, code: string): { status: number | null; stdout: string; stderr: string } {
	return spawnSync(
		process.execPath,
		["--input-type=module", "-e", `import { loadSessionTree, upsertSessionTreeEntry } from ${JSON.stringify(PM)};\n${code}`],
		{ env: { ...process.env, IDU_HOME: home }, encoding: "utf8" },
	);
}

function freshHome(): string {
	return mkdtempSync(join(tmpdir(), "idu-tree-"));
}

function makeEntry(sessionId: string, turns: number) {
	return {
		sessionId,
		parentSessionId: undefined,
		profile: "coding",
		harness: "pi",
		workingDir: "C:\\work",
		createdAt: "2026-09-01T00:00:00.000Z",
		lastActiveAt: "2026-09-01T00:10:00.000Z",
		turnCount: turns,
		runs: [`run-${sessionId}`],
	};
}

test("a tree that will not parse is never replaced by an empty one", () => {
	const home = freshHome();
	try {
		// Legacy tree.json, half written by a process that died.
		mkdirSync(join(home, "sessions"), { recursive: true });
		const legacy = join(home, "sessions", "tree.json");
		const healthy = JSON.stringify(
			Object.fromEntries(
				Array.from({ length: 12 }, (_, i) => [`C:\\work::s${i}`, makeEntry(`s${i}`, 3)]),
			),
			null,
			2,
		);
		writeFileSync(legacy, healthy.slice(0, Math.floor(healthy.length / 2)), "utf8");
		const torn = readFileSync(legacy, "utf8");

		const res = inChild(
			home,
			`const key = "C:\\\\work::new";
const entry = ${JSON.stringify(makeEntry("new", 1))};
upsertSessionTreeEntry(key, entry);
const tree = loadSessionTree();
console.log(JSON.stringify(Object.keys(tree)));`,
		);

		assert.equal(res.status, 0, res.stderr);
		const keys = JSON.parse(res.stdout.trim()) as string[];
		assert.ok(keys.includes("C:\\work::new"), "the new session must be readable");
		assert.equal(
			keys.length,
			1,
			"a torn legacy tree must never be read as empty and then written back over",
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

test("a legacy tree.json is migrated once, keeping every session", () => {
	const home = freshHome();
	try {
		const sessionsDir = join(home, "sessions");
		// ensureIduDirectories runs on load, but the file must exist before it.
		mkdirSync(sessionsDir, { recursive: true });
		writeFileSync(
			join(sessionsDir, "tree.json"),
			JSON.stringify(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`C:\\work::s${i}`, makeEntry(`s${i}`, 2)])), null, 2),
			"utf8",
		);

		const res = inChild(home, `console.log(JSON.stringify(Object.keys(loadSessionTree()).sort()));`);
		assert.equal(res.status, 0, res.stderr);
		const keys = JSON.parse(res.stdout.trim()) as string[];
		assert.equal(keys.length, 7, "every migrated session must survive");
		assert.ok(keys.includes("C:\\work::s0"));

		const leftovers = readdirSync(sessionsDir).filter((f) => f.startsWith("tree.json.") && !f.startsWith("tree.jsonl"));
		assert.equal(leftovers.length, 1, `expected one renamed legacy file, found ${leftovers.join(",")}`);
		assert.match(leftovers[0], /\.migrated-/);
		assert.equal(existsSync(join(sessionsDir, "tree.jsonl")), true);
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("concurrent runs never lose a session", async () => {
	const home = freshHome();
	try {
		mkdirSync(join(home, "sessions"), { recursive: true });
		// A populated tree so every writer reads real state and the overwrite
		// window is wide enough for a collision to actually happen.
		writeFileSync(
			join(home, "sessions", "tree.jsonl"),
			Array.from({ length: 400 }, (_, i) =>
				JSON.stringify({ key: `C:\\work::old-${i}`, entry: makeEntry(`old-${i}`, 1) }),
			).join("\n") + "\n",
			"utf8",
		);

		const writers = 16;
		const results = await Promise.all(
			Array.from({ length: writers }, (_, i) =>
				new Promise<{ ok: boolean; err: string }>((resolve, reject) => {
					const child = spawn(
						process.execPath,
						[
							"--input-type=module",
							"-e",
							`import { loadSessionTree, upsertSessionTreeEntry } from ${JSON.stringify(PM)};
const key = "C:\\\\work::new-${i}";
const tree = loadSessionTree();
upsertSessionTreeEntry(key, ${JSON.stringify(makeEntry(`new-${i}`, 1))});`,
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
		assert.equal(failed.length, 0, `every run must record itself; failures: ${failed.map((f) => f.err).join(" | ")}`);

		const res = inChild(home, `console.log(JSON.stringify(Object.keys(loadSessionTree())));`);
		assert.equal(res.status, 0, res.stderr);
		const keys = JSON.parse(res.stdout.trim()) as string[];

		assert.equal(
			keys.length,
			400 + writers,
			`no run may be lost to another; got ${keys.length}, expected ${400 + writers}`,
		);
		for (let i = 0; i < writers; i++) {
			assert.ok(keys.includes(`C:\\work::new-${i}`), `run ${i} landed nowhere`);
		}
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("the log on disk is parseable after every append", () => {
	const home = freshHome();
	try {
		for (let i = 0; i < 8; i++) {
			const res = inChild(
				home,
				`upsertSessionTreeEntry("C:\\\\work::s${i}", ${JSON.stringify(makeEntry(`s${i}`, i + 1))});`,
			);
			assert.equal(res.status, 0, res.stderr);
			const raw = readFileSync(join(home, "sessions", "tree.jsonl"), "utf8");
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				assert.doesNotThrow(() => JSON.parse(line), `append ${i} left invalid JSON on disk`);
			}
		}
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});

test("upserting the same session twice keeps the later record", () => {
	const home = freshHome();
	try {
		const res = inChild(
			home,
			`const key = "C:\\\\work::s";
upsertSessionTreeEntry(key, ${JSON.stringify(makeEntry("s", 1))});
upsertSessionTreeEntry(key, ${JSON.stringify(makeEntry("s", 7))});
console.log(JSON.stringify(loadSessionTree()[key]));`,
		);
		assert.equal(res.status, 0, res.stderr);
		const entry = JSON.parse(res.stdout.trim()) as { turnCount: number };
		assert.equal(entry.turnCount, 7, "the last write for a key wins");
	} finally {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	}
});
