import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveWindowsShim } from "../src/cmdline.js";

// These cases build their own PATH entry instead of trusting whichever npm
// shims happen to be installed on the machine running the suite.
function withPathEntry<T>(dir: string, run: () => T): T {
	const original = process.env.PATH ?? "";
	process.env.PATH = `${dir}${delimiter}${original}`;
	try {
		return run();
	} finally {
		process.env.PATH = original;
	}
}

// `where` can answer with an 8.3 short path (RUNNER~1) while mkdtemp returns the
// long one, so compare canonical paths instead of raw strings.
function assertSamePath(actual: string | null, expected: string): void {
	assert.ok(actual, "expected a shim to be resolved");
	assert.equal(realpathSync.native(actual), realpathSync.native(expected));
}

test("resolveWindowsShim finds the .cmd shim a bare CLI name resolves to", async () => {
	if (process.platform !== "win32") return;
	const dir = mkdtempSync(join(tmpdir(), "idu-shim-cmd-"));
	try {
		const shim = join(dir, "fake-cli.cmd");
		writeFileSync(shim, "@ECHO off\r\n", "utf8");
		withPathEntry(dir, () => {
			assertSamePath(resolveWindowsShim("fake-cli"), shim);
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveWindowsShim falls back to a .bat shim", async () => {
	if (process.platform !== "win32") return;
	const dir = mkdtempSync(join(tmpdir(), "idu-shim-bat-"));
	try {
		const shim = join(dir, "legacy-cli.bat");
		writeFileSync(shim, "@ECHO off\r\n", "utf8");
		withPathEntry(dir, () => {
			assertSamePath(resolveWindowsShim("legacy-cli"), shim);
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveWindowsShim returns null when no shim exists", () => {
	if (process.platform !== "win32") return;
	assert.equal(resolveWindowsShim("idu-definitely-not-a-real-cli-xyz"), null);
});

test("resolveWindowsShim never lets shell metacharacters run", async () => {
	if (process.platform !== "win32") return;
	const dir = mkdtempSync(join(tmpdir(), "idu-shim-inject-"));
	const originalCwd = process.cwd();
	// The function appends ".cmd" to the whole string, so a shell redirect would
	// create exactly this file in the current directory.
	const marker = join(dir, "idu-marker.txt.cmd");
	try {
		process.chdir(dir);
		// No separator anywhere in the name, so the early "already a path" return
		// cannot mask the shell question.
		assert.equal(resolveWindowsShim("nope&echo injected>idu-marker.txt"), null);
		assert.equal(existsSync(marker), false, "the name was interpreted by a shell");
	} finally {
		process.chdir(originalCwd);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveWindowsShim ignores names that are already paths", () => {
	// Cross-platform: a separator means "not a bare name", so this returns
	// before touching PATH or spawning anything.
	assert.equal(resolveWindowsShim("tools/cli"), null);
	assert.equal(resolveWindowsShim("C:\\tools\\cli"), null);
});
