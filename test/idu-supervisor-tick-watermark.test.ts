/**
 * idu-supervisor-tick-watermark.test.ts — watermark diff-base logic (issue
 * #484). Behavioral, not structural: each test runs the real tick script
 * against a controlled temp git repo and observes what the preflight
 * actually receives.
 *
 * Why a controlled git repo (not a fake `git`): the tick calls real `git`
 * (rev-parse, cat-file, merge-base --is-ancestor, merge-base, diff) and we
 * need those to behave realistically for both rows. `node` cannot be shimmed
 * with a `.cmd` (PATHEXT resolves `node` to node.EXE first), so the harness
 * instead places a real `dist/src/cli.js` in the fake root whose handler
 * records the CLI argv to a capture file. The preflight's changed-files list
 * is therefore observable verbatim — the exact range, not just a count.
 *
 * Rows (issue #484, operator audit 2026-08-09):
 *  - row 1: the watermark object is gone. `git diff --name-only <bad> HEAD`
 *    does NOT throw under $ErrorActionPreference='Stop' — it returns empty
 *    with exit 128, and the old code silently read that as "no changes",
 *    advanced the watermark and lost the range. The fix detects it with
 *    `git cat-file -e <sha>^{commit}` and does NOT advance.
 *  - row 2: the watermark resolves but is NOT an ancestor of HEAD (a
 *    pre-squash fix-branch SHA written into the watermark by a tick that ran
 *    from the operator's checkout). The fix recovers the FULL range via
 *    `git merge-base <sha> HEAD` instead of diffing from the orphan SHA.
 *
 * The weight-bearing test is row 2: it must prove the range comes out WHOLE
 * (both files changed in the recovered base..HEAD range), not partial.
 */

import assert from "node:assert/strict";
import {
	execFile as execFileCb,
	spawnSync,
} from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFile = promisify(execFileCb);

const SCRIPT_PATH = resolve("scripts/idu-supervisor-tick.ps1");

type ScriptResult = {
	stdout: string;
	code: number | null;
};

// git -C <cwd> <args...>. Returns status + stdout. On Windows, spawnSync
// with an argv array avoids the execSync shell-quoting minefield.
function git(
	cwd: string,
	...args: string[]
): { status: number; stdout: string } {
	const r = spawnSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: "pipe",
	});
	return { status: r.status ?? -1, stdout: (r.stdout ?? "").trim() };
}

type Root = {
	fakeRoot: string;
	stateRoot: string;
	capturePath: string;
	cleanup: () => void;
};

function buildWatermarkRoot(): Root {
	const fakeRoot = mkdtempSync(join(tmpdir(), "idu-supervisor-tick-wm-"));
	const scriptsDir = join(fakeRoot, "scripts");
	const distCliDir = join(fakeRoot, "dist", "src");
	const testBin = join(fakeRoot, "test-bin");
	const stateRoot = join(fakeRoot, "state");
	mkdirSync(scriptsDir, { recursive: true });
	mkdirSync(distCliDir, { recursive: true });
	mkdirSync(testBin, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });

	// corepack shim: `tsc -p tsconfig.json` "passes" deterministically.
	writeFileSync(
		join(testBin, "corepack.cmd"),
		"@exit /b 0\r\n",
		"utf8",
	);

	// Real node runs this controlled cli.js; it records every argv to the
	// capture file and exits 0, so Step 2 (automaticov1) and Step 2.5
	// (preflight) both succeed and their exact args are observable.
	const capturePath = join(fakeRoot, "captured-argv.txt");
	writeFileSync(
		join(distCliDir, "cli.js"),
		`require("fs").appendFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.exit(0);\n`,
		"utf8",
	);

	// Copy the real tick script into the fake root.
	writeFileSync(
		join(scriptsDir, "idu-supervisor-tick.ps1"),
		readFileSync(SCRIPT_PATH, "utf8"),
		"utf8",
	);

	return {
		fakeRoot,
		stateRoot,
		capturePath,
		cleanup: () => rmSync(fakeRoot, { recursive: true, force: true }),
	};
}

async function runScript(
	scriptPath: string,
	env: Record<string, string | undefined>,
): Promise<ScriptResult> {
	const childEnv = { ...process.env, ...env };
	const pathKey =
		Object.keys(childEnv).find((k) => k.toLowerCase() === "path") ?? "PATH";
	const fakeBin = join(dirname(dirname(scriptPath)), "test-bin");
	childEnv[pathKey] = `${fakeBin}${delimiter}${childEnv[pathKey] ?? ""}`;
	try {
		const { stdout } = await execFile(
			"pwsh",
			["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
			{ env: childEnv, timeout: 30_000, windowsHide: true },
		);
		return { stdout, code: 0 };
	} catch (err) {
		const e = err as { stdout?: string; code?: number };
		return { stdout: e.stdout ?? "", code: typeof e.code === "number" ? e.code : null };
	}
}

// Seed the watermark file in the stateRoot.
function seedWatermark(root: Root, sha: string): void {
	writeFileSync(
		join(root.stateRoot, "cron-last-sha.txt"),
		sha,
		"utf8",
	);
}

function readWatermark(root: Root): string | null {
	const p = join(root.stateRoot, "cron-last-sha.txt");
	if (!existsSync(p)) return null;
	return readFileSync(p, "utf8").trim();
}

function logContents(root: Root): string {
	const p = join(root.fakeRoot, "logs", "supervisor-tick.log");
	return existsSync(p) ? readFileSync(p, "utf8") : "";
}

// The file list the preflight received, parsed from the captured argv.
function preflightFiles(root: Root): string[] {
	if (!existsSync(root.capturePath)) return [];
	const lines = readFileSync(root.capturePath, "utf8").trim().split("\n");
	for (const line of lines) {
		try {
			const argv = JSON.parse(line) as string[];
			if (argv[0] === "idu-run-cron-preflight") {
				return argv.slice(1); // files after the subcommand
			}
		} catch {
			// not a JSON line; skip
		}
	}
	return [];
}

async function runTick(root: Root): Promise<ScriptResult> {
	return runScript(join(root.fakeRoot, "scripts", "idu-supervisor-tick.ps1"), {
		IDU_PI_TICK_FORCE: "1",
		IDU_PI_TICK_STATE_ROOT: root.stateRoot,
	});
}

test("row 2: orphan watermark diffs the FULL merge-base..HEAD range, not partial", async () => {
	const root = buildWatermarkRoot();
	try {
		const repo = root.fakeRoot;
		git(repo, "-c", "init.defaultBranch=main", "init");
		git(repo, "config", "user.name", "test");
		git(repo, "config", "user.email", "test@test");
		// base B on main
		writeFileSync(join(repo, "base.txt"), "b", "utf8");
		git(repo, "add", "base.txt");
		git(repo, "commit", "-m", "base");
		const baseSha = git(repo, "rev-parse", "HEAD").stdout;
		const baseFile = "base.txt";
		// orphan commit X on a side branch (exists, never merged)
		git(repo, "checkout", "-b", "side");
		writeFileSync(join(repo, "side.txt"), "x", "utf8");
		git(repo, "add", "side.txt");
		git(repo, "commit", "-m", "side");
		const orphanSha = git(repo, "rev-parse", "HEAD").stdout;
		// back to main; two commits after base: c.txt, d.txt
		git(repo, "checkout", "main");
		writeFileSync(join(repo, "c.txt"), "c", "utf8");
		git(repo, "add", "c.txt");
		git(repo, "commit", "-m", "c");
		writeFileSync(join(repo, "d.txt"), "d", "utf8");
		git(repo, "add", "d.txt");
		git(repo, "commit", "-m", "d");

		// sanity: orphan is NOT an ancestor of HEAD
		const anc = git(repo, "merge-base", "--is-ancestor", orphanSha, "HEAD");
		assert.notEqual(anc.status, 0, "test setup: orphan must not be an ancestor");

		seedWatermark(root, orphanSha);
		const result = await runTick(root);

		assert.equal(result.code, 0, `tick must exit 0, got ${result.code}; ${result.stdout}`);
		// merge-base(orphan, HEAD) == baseSha
		const mb = git(repo, "merge-base", orphanSha, "HEAD").stdout;
		assert.equal(mb, baseSha, "merge-base must be the base commit");

		// WEIGHT-BEARING: the preflight received BOTH c.txt and d.txt (the
		// full recovered range), not a partial set. A broken implementation
		// diffing from the orphan SHA would yield wrong/empty files.
		const files = preflightFiles(root);
		assert.deepEqual(
			[...files].sort(),
			["c.txt", "d.txt"],
			`row 2 must recover the FULL range, got: ${JSON.stringify(files)}`,
		);
		// base.txt is BEFORE merge-base, so it must NOT be in the range.
		assert.ok(
			!files.includes(baseFile),
			`file before merge-base must not be in the range, got: ${JSON.stringify(files)}`,
		);

		const log = logContents(root);
		assert.match(log, /watermark_ORPHAN/u, `expected watermark_ORPHAN, log: ${log}`);
		assert.match(
			log,
			new RegExp(`watermark_base=${mb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"),
			`expected watermark_base=<merge-base> in log, log: ${log}`,
		);
		assert.match(log, /changed_files=2/u, `expected changed_files=2, log: ${log}`);
	} finally {
		root.cleanup();
	}
});

test("row 1: missing watermark object does NOT advance and logs firmly", async () => {
	const root = buildWatermarkRoot();
	try {
		const repo = root.fakeRoot;
		git(repo, "-c", "init.defaultBranch=main", "init");
		git(repo, "config", "user.name", "test");
		git(repo, "config", "user.email", "test@test");
		writeFileSync(join(repo, "a.txt"), "a", "utf8");
		git(repo, "add", "a.txt");
		git(repo, "commit", "-m", "a");
		const headSha = git(repo, "rev-parse", "HEAD").stdout;

		// A realistic-looking SHA that does not exist in the repo.
		const missingSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
		seedWatermark(root, missingSha);

		const result = await runTick(root);
		assert.equal(result.code, 0, `tick must exit 0, got ${result.code}; ${result.stdout}`);

		// The watermark must NOT have advanced — still the missing SHA.
		assert.equal(
			readWatermark(root),
			missingSha,
			"row 1 must NOT advance the watermark (base unrecoverable)",
		);
		// And it must not be silently rewritten to HEAD either.
		assert.notEqual(readWatermark(root), headSha, "watermark must not jump to HEAD");

		const log = logContents(root);
		assert.match(
			log,
			/watermark_OBJECT_MISSING/u,
			`expected watermark_OBJECT_MISSING, log: ${log}`,
		);
		// The preflight ran but with an EMPTY change list (no fabricated base).
		assert.deepEqual(preflightFiles(root), [], "row 1 must not fabricate a diff base");
	} finally {
		root.cleanup();
	}
});

test("healthy: ancestor watermark is logged per tick and advances to HEAD", async () => {
	const root = buildWatermarkRoot();
	try {
		const repo = root.fakeRoot;
		git(repo, "-c", "init.defaultBranch=main", "init");
		git(repo, "config", "user.name", "test");
		git(repo, "config", "user.email", "test@test");
		writeFileSync(join(repo, "base.txt"), "b", "utf8");
		git(repo, "add", "base.txt");
		git(repo, "commit", "-m", "base");
		const baseSha = git(repo, "rev-parse", "HEAD").stdout;
		// one more commit
		writeFileSync(join(repo, "next.txt"), "n", "utf8");
		git(repo, "add", "next.txt");
		git(repo, "commit", "-m", "next");
		const headSha = git(repo, "rev-parse", "HEAD").stdout;

		seedWatermark(root, baseSha);
		const result = await runTick(root);
		assert.equal(result.code, 0, `tick must exit 0, got ${result.code}; ${result.stdout}`);

		// The watermark SHA is logged every tick (the #484 auditability fix).
		const log = logContents(root);
		assert.match(
			log,
			new RegExp(`watermark_sha=${baseSha}`, "u"),
			`watermark_sha must be logged each tick, log: ${log}`,
		);
		assert.match(log, /changed_files=1/u, `expected changed_files=1, log: ${log}`);
		assert.deepEqual(preflightFiles(root), ["next.txt"], "healthy range must be next.txt");

		// Watermark advanced to HEAD on success.
		assert.equal(readWatermark(root), headSha, "watermark must advance to HEAD");
	} finally {
		root.cleanup();
	}
});