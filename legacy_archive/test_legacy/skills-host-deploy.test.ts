/**
 * skills-host-deploy.test.ts — Etapa 3a contract tests.
 *
 * Asserts the 4 contracts spelled out in the Etapa 3 brief:
 *   1. Deploy copies the N idu-pi-owned skills from .idu/skills to the
 *      host dir (e.g. .agents/skills).
 *   2. Overwrites a stale version on the host.
 *   3. Does NOT delete host subdirs without SKILL.md (user skills).
 *   4. Idempotent — running twice yields the same observable state.
 *
 * Each assert carries an explicit intent message for the auditor.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { tmpdir, homedir } from "node:os";
import { test } from "node:test";
import {
	deploySkillsToHost,
	formatSkillsHostDeployResult,
	getSkillHostDir,
	listHostUserSkills,
	listIduPiOwnedSkills,
	parseSkillTarget,
	resolveSkillTarget,
	writeHostSkillIndex,
} from "../src/skills-host-deploy.js";

function makeFixture(): { repoPath: string; cleanup: () => void } {
	const repoPath = mkdtempSync(join(tmpdir(), "skills-host-deploy-"));
	return {
		repoPath,
		cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
	};
}

function makeIduSkill(repoPath: string, name: string, body = `# ${name}\n`): void {
	const dir = join(repoPath, ".idu", "skills", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), body, "utf8");
}

test("Etapa 3a — lists idu-pi-owned skills (subdir with SKILL.md) only", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		// 3 idu-pi-owned (have SKILL.md)
		makeIduSkill(repoPath, "alpha");
		makeIduSkill(repoPath, "beta");
		makeIduSkill(repoPath, "idu-pi-parent-protocol");
		// 1 user-owned subdir (no SKILL.md)
		mkdirSync(join(repoPath, ".idu", "skills", "user-thing"), { recursive: true });
		writeFileSync(
			join(repoPath, ".idu", "skills", "user-thing", "README.md"),
			"user keeps this",
			"utf8",
		);
		const source = join(repoPath, ".idu", "skills");
		const owned = listIduPiOwnedSkills(source);
		assert.deepEqual(
			owned.sort(),
			["alpha", "beta", "idu-pi-parent-protocol"],
			"only subdirs with SKILL.md count as idu-pi-owned",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3a contract 1 — deploy copies all idu-pi-owned skills to host dir", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		// Source: 4 idu-pi-owned skills
		for (const name of [
			"bug-hunter",
			"jq",
			"skill-check",
			"idu-pi-parent-protocol",
		]) {
			makeIduSkill(repoPath, name);
		}
		const sourceDir = join(repoPath, ".idu", "skills");
		const hostDir = join(repoPath, ".agents", "skills");

		const result = deploySkillsToHost({
			sourceDir,
			hostDir,
			projectPath: repoPath,
		});

		// Every idu-pi-owned skill lives at the host with SKILL.md.
		for (const name of [
			"bug-hunter",
			"jq",
			"skill-check",
			"idu-pi-parent-protocol",
		]) {
			assert.equal(
				existsSync(join(hostDir, name, "SKILL.md")),
				true,
				`${name}/SKILL.md must exist at host after deploy`,
			);
		}
		assert.deepEqual(
			result.copied.sort(),
			["bug-hunter", "idu-pi-parent-protocol", "jq", "skill-check"],
			"all 4 idu-pi-owned skills must be in result.copied (host dir was empty)",
		);
		assert.equal(
			result.overwritten.length,
			0,
			"first deploy overwrites nothing (host was empty)",
		);
		assert.equal(
			result.preservedUser.length,
			0,
			"no user skills to preserve in an empty host dir",
		);
		assert.match(
			readFileSync(result.indexPath, "utf8"),
			/idu-pi-parent-protocol/,
			"INDEX.md must list the deployed idu-pi-owned skills",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3a contract 2 — overwrites a stale version on the host", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		// Stale host: bug-hunter has an older SKILL.md
		const staleDir = join(repoPath, ".agents", "skills", "bug-hunter");
		mkdirSync(staleDir, { recursive: true });
		writeFileSync(
			join(staleDir, "SKILL.md"),
			"# OLD VERSION — out of date\n",
			"utf8",
		);
		// Source has a fresh bug-hunter
		makeIduSkill(repoPath, "bug-hunter", "# NEW VERSION — fresh from idu-pi\n");

		const result = deploySkillsToHost({
			sourceDir: join(repoPath, ".idu", "skills"),
			hostDir: join(repoPath, ".agents", "skills"),
			projectPath: repoPath,
		});

		const hostContent = readFileSync(
			join(repoPath, ".agents", "skills", "bug-hunter", "SKILL.md"),
			"utf8",
		);
		assert.equal(
			hostContent,
			"# NEW VERSION — fresh from idu-pi\n",
			"host SKILL.md must be overwritten by the source",
		);
		assert.deepEqual(
			result.overwritten,
			["bug-hunter"],
			"bug-hunter (pre-existing at host) must be in result.overwritten",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3a contract 3 — preserves host subdirs WITHOUT SKILL.md (user skills)", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		// Source: 1 idu-pi skill
		makeIduSkill(repoPath, "bug-hunter");
		// Host pre-exists with both: an idu-pi-owned subdir (bug-hunter)
		// AND a user subdir (user-keeps-this, no SKILL.md).
		const staleDir = join(repoPath, ".agents", "skills", "bug-hunter");
		mkdirSync(staleDir, { recursive: true });
		writeFileSync(
			join(staleDir, "SKILL.md"),
			"# OLD\n",
			"utf8",
		);
		const userDir = join(repoPath, ".agents", "skills", "user-keeps-this");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(
			join(userDir, "NOTES.md"),
			"this is the user's skill, must not be deleted\n",
			"utf8",
		);
		writeFileSync(
			join(userDir, "config.json"),
			"{ \"owner\": \"user\" }\n",
			"utf8",
		);

		const result = deploySkillsToHost({
			sourceDir: join(repoPath, ".idu", "skills"),
			hostDir: join(repoPath, ".agents", "skills"),
			projectPath: repoPath,
		});

		// The user's subdir survives untouched: same files, same content.
		assert.equal(
			existsSync(join(userDir, "NOTES.md")),
			true,
			"user skill NOTES.md must survive the deploy",
		);
		assert.equal(
			readFileSync(join(userDir, "NOTES.md"), "utf8"),
			"this is the user's skill, must not be deleted\n",
			"user NOTES.md content must be byte-for-byte unchanged",
		);
		assert.equal(
			existsSync(join(userDir, "config.json")),
			true,
			"user skill config.json must survive the deploy",
		);
		assert.equal(
			readFileSync(join(userDir, "config.json"), "utf8"),
			"{ \"owner\": \"user\" }\n",
			"user config.json content must be byte-for-byte unchanged",
		);
		assert.deepEqual(
			result.preservedUser,
			["user-keeps-this"],
			"preservedUser must list the user skill (no SKILL.md) untouched",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3a contract 4 — second deploy is idempotent and refreshes only idu-pi-owned", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		// Source and host both stable
		makeIduSkill(repoPath, "bug-hunter");
		makeIduSkill(repoPath, "jq");
		const userDir = join(repoPath, ".agents", "skills", "user-keeps-this");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(
			join(userDir, "README.md"),
			"original user notes, must survive 2 deploys\n",
			"utf8",
		);

		const input = {
			sourceDir: join(repoPath, ".idu", "skills"),
			hostDir: join(repoPath, ".agents", "skills"),
			projectPath: repoPath,
		};

		// First deploy
		const r1 = deploySkillsToHost(input);
		// Capture byte-for-byte state of user dir after first deploy
		const userReadmeAfterFirst = readFileSync(
			join(userDir, "README.md"),
			"utf8",
		);
		const indexAfterFirst = readFileSync(r1.indexPath, "utf8");
		const bugHunterAfterFirst = readFileSync(
			join(input.hostDir, "bug-hunter", "SKILL.md"),
			"utf8",
		);

		// Second deploy: must NOT destroy user dir, must overwrite idu
		// skills (no-op here since source hasn't changed — but the
		// idempotency check is: all named files still exist and same
		// content; user dir bytes unchanged).
		const r2 = deploySkillsToHost(input);

		assert.equal(
			readFileSync(join(userDir, "README.md"), "utf8"),
			userReadmeAfterFirst,
			"user README must be byte-identical after second deploy",
		);
		assert.equal(
			readFileSync(r2.indexPath, "utf8"),
			indexAfterFirst,
			"INDEX.md must be identical after a second deploy (deterministic)",
		);
		assert.equal(
			readFileSync(
				join(input.hostDir, "bug-hunter", "SKILL.md"),
				"utf8",
			),
			bugHunterAfterFirst,
			"bug-hunter SKILL.md must be identical after second deploy",
		);
		assert.equal(
			readFileSync(join(input.hostDir, "jq", "SKILL.md"), "utf8"),
			`# jq\n`,
			"jq SKILL.md must be identical after second deploy",
		);
		// In the second deploy both idu-pi skills were pre-existing
		// at the host, so both are in `overwritten`, not `copied`.
		assert.deepEqual(
			r2.copied,
			[],
			"second deploy creates nothing new",
		);
		assert.deepEqual(
			r2.overwritten.sort(),
			["bug-hunter", "jq"],
			"second deploy overwrites the same idu-pi-owned skills",
		);
		assert.deepEqual(
			r2.preservedUser,
			["user-keeps-this"],
			"preservedUser is stable across runs",
		);
	} finally {
		cleanup();
	}
});

test("listHostUserSkills returns subdirs WITHOUT SKILL.md, sorted", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		const hostDir = join(repoPath, ".agents", "skills");
		mkdirSync(join(hostDir, "idu-owned"), { recursive: true });
		writeFileSync(
			join(hostDir, "idu-owned", "SKILL.md"),
			"# idu\n",
			"utf8",
		);
		mkdirSync(join(hostDir, "userA"), { recursive: true });
		writeFileSync(
			join(hostDir, "userA", "some.md"),
			"a",
			"utf8",
		);
		mkdirSync(join(hostDir, "userB"), { recursive: true });
		writeFileSync(
			join(hostDir, "userB", "other.md"),
			"b",
			"utf8",
		);

		assert.deepEqual(
			listHostUserSkills(hostDir),
			["userA", "userB"],
			"only subdirs WITHOUT SKILL.md count as host-user skills",
		);
	} finally {
		cleanup();
	}
});

test("formatSkillsHostDeployResult shows copied/overwritten/preserved buckets", () => {
	const r = {
		projectPath: "/r",
		sourceDir: "/r/.idu/skills",
		hostDir: "/r/.agents/skills",
		missingInSource: ["missing-skill"],
		copied: ["new-skill"],
		overwritten: ["stale-skill"],
		preservedUser: ["user-skill"],
		indexPath: "/r/.agents/skills/INDEX.md",
	};
	const formatted = formatSkillsHostDeployResult(r);
	assert.match(formatted, /Source:\s+\/r\/\.idu\/skills/);
	assert.match(formatted, /Host:\s+\/r\/\.agents\/skills/);
	assert.match(formatted, /new-skill/);
	assert.match(formatted, /stale-skill/);
	assert.match(formatted, /user-skill/);
	assert.match(formatted, /missing-skill/);
});

test("writeHostSkillIndex regenerates INDEX.md with both idu and user buckets", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		const hostDir = join(repoPath, ".agents", "skills");
		mkdirSync(join(hostDir, "idu-alpha"), { recursive: true });
		writeFileSync(
			join(hostDir, "idu-alpha", "SKILL.md"),
			"# alpha\n",
			"utf8",
		);
		mkdirSync(join(hostDir, "user-keeps"), { recursive: true });
		writeFileSync(
			join(hostDir, "user-keeps", "stuff.txt"),
			"user stuff\n",
			"utf8",
		);
		const indexPath = writeHostSkillIndex(hostDir, repoPath);
		const content = readFileSync(indexPath, "utf8");
		assert.match(
			content,
			/idu-alpha/,
			"INDEX must list idu-pi-owned skill",
		);
		assert.match(
			content,
			/user-keeps/,
			"INDEX must list user skill (host subdir)",
		);
		assert.match(
			content,
			/\.agents\/skills\/idu-alpha\/SKILL\.md/,
			"INDEX path must be host-relative (.agents/skills/...), not hardcoded",
		);
	} finally {
		cleanup();
	}
});

test("writeHostSkillIndex: INDEX paths are HOST-relative, not hardcoded (Etapa 3a bug regression)", () => {
	// Without repoRoot the helper falls back to the host-dir basename.
	// This is for callers (tests, ad-hoc scripts) that don't know the
	// repo root. The fallback must NEVER produce ".agents/skills" as
	// the prefix — that was the Etapa 3a bug fixed in 3b.
	const { repoPath, cleanup } = makeFixture();
	try {
		const piHostDir = join(repoPath, ".pi", "skills");
		mkdirSync(join(piHostDir, "idu-bug-hunter"), { recursive: true });
		writeFileSync(
			join(piHostDir, "idu-bug-hunter", "SKILL.md"),
			"# bug-hunter\n",
			"utf8",
		);
		const indexPath = writeHostSkillIndex(piHostDir, repoPath);
		const content = readFileSync(indexPath, "utf8");
		assert.match(
			content,
			/\.pi\/skills\/idu-bug-hunter\/SKILL\.md/,
			"INDEX line must reference .pi/skills/ (the actual host dir)",
		);
		assert.doesNotMatch(
			content,
			/\.agents\/skills/,
			"INDEX must NEVER reference .agents/skills/ when hostDir is .pi/skills/",
		);
	} finally {
		cleanup();
	}
});

test("writeHostSkillIndex: with repoRoot undefined, falls back to host-dir basename", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		const hostDir = join(repoPath, ".claude", "skills");
		mkdirSync(hostDir, { recursive: true });
		mkdirSync(join(hostDir, "idu-x"), { recursive: true });
		writeFileSync(
			join(hostDir, "idu-x", "SKILL.md"),
			"# x\n",
			"utf8",
		);
		// No repoRoot passed → fallback must use host-dir basename ("skills").
		const indexPath = writeHostSkillIndex(hostDir);
		const content = readFileSync(indexPath, "utf8");
		assert.match(
			content,
			/skills\/idu-x\/SKILL\.md/,
			"INDEX without repoRoot must use host-dir basename as prefix",
		);
		assert.doesNotMatch(
			content,
			/\.agents\/skills/,
			"fallback must NEVER substitute .agents/skills",
		);
	} finally {
		cleanup();
	}
});

// =========================================================================
// Etapa 3b — skill-target-map (opencode | pi | claude, project + global)
// =========================================================================

test("resolveSkillTarget: opencode project-local -> <repo>/.agents/skills", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		const t = resolveSkillTarget({
			target: "opencode",
			scope: "project",
			repoRoot: repoPath,
		});
		assert.equal(t.id, "opencode");
		assert.equal(t.scope, "project");
		assert.equal(
			t.dir,
			join(repoPath, ".agents", "skills"),
			"opencode project-local must resolve to <repo>/.agents/skills",
		);
	} finally {
		cleanup();
	}
});

test("resolveSkillTarget: pi project-local -> <repo>/.pi/skills", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		const t = resolveSkillTarget({
			target: "pi",
			scope: "project",
			repoRoot: repoPath,
		});
		assert.equal(t.id, "pi");
		assert.equal(t.scope, "project");
		assert.equal(
			t.dir,
			join(repoPath, ".pi", "skills"),
			"pi project-local must resolve to <repo>/.pi/skills",
		);
	} finally {
		cleanup();
	}
});

test("resolveSkillTarget: claude project-local -> <repo>/.claude/skills", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		const t = resolveSkillTarget({
			target: "claude",
			scope: "project",
			repoRoot: repoPath,
		});
		assert.equal(t.id, "claude");
		assert.equal(t.scope, "project");
		assert.equal(
			t.dir,
			join(repoPath, ".claude", "skills"),
			"claude project-local must resolve to <repo>/.claude/skills",
		);
	} finally {
		cleanup();
	}
});

test("resolveSkillTarget: global scope resolves to homedir paths", () => {
	const home = homedir();
	const cases: Array<[Parameters<typeof resolveSkillTarget>[0]["target"], string]> = [
		["opencode", join(home, ".config", "opencode", "skills")],
		["pi", join(home, ".pi", "agent", "skills")],
		["claude", join(home, ".claude", "skills")],
	];
	for (const [target, expected] of cases) {
		const t = resolveSkillTarget({
			target,
			scope: "global",
			repoRoot: "x",
		});
		assert.equal(
			t.dir,
			expected,
			`global ${target} must resolve to ${expected}`,
		);
		assert.equal(t.scope, "global");
	}
});

test("getSkillHostDir: convenience wrapper returns the same as resolveSkillTarget.dir", () => {
	const { repoPath, cleanup } = makeFixture();
	try {
		for (const target of ["opencode", "pi", "claude"] as const) {
			const d = getSkillHostDir({
				target,
				scope: "project",
				repoRoot: repoPath,
			});
			// Use a path-separator-tolerant check: on POSIX we expect
			// `/`, on Windows `\` (or `/`). The trailing segment is
			// what matters: `skills` under a `<dot-name>` dir.
			const expectedTail = `${target === "opencode" ? ".agents" : target === "pi" ? ".pi" : ".claude"}${sep}skills`;
			assert.ok(
				d.endsWith(expectedTail),
				`${target} -> ${d} (must end with ${expectedTail})`,
			);
		}
	} finally {
		cleanup();
	}
});

test("parseSkillTarget: no --target defaults to opencode project-local", () => {
	const parsed = parseSkillTarget([]);
	assert.deepEqual(parsed, { target: "opencode", scope: "project" });
});

test("parseSkillTarget: --target pi project-local (default scope)", () => {
	const parsed = parseSkillTarget(["--target", "pi"]);
	assert.deepEqual(parsed, { target: "pi", scope: "project" });
});

test("parseSkillTarget: --target=claude --scope=global", () => {
	const parsed = parseSkillTarget(["--target=claude", "--scope=global"]);
	assert.deepEqual(parsed, { target: "claude", scope: "global" });
});

test("parseSkillTarget: unknown target throws with explicit message", () => {
	assert.throws(
		() => parseSkillTarget(["--target", "vim"]),
		/opencode\|pi\|claude/,
	);
});

// =========================================================================
// Etapa 3b — per-host deploy contracts
// =========================================================================

function makeIduSkillFixture(skillNames: string[]): {
	repoPath: string;
	sourceDir: string;
	cleanup: () => void;
} {
	const { repoPath, cleanup } = makeFixture();
	const sourceDir = join(repoPath, ".idu", "skills");
	for (const n of skillNames) {
		const skillDir = join(sourceDir, n);
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), `# ${n}\n`, "utf8");
	}
	return { repoPath, sourceDir, cleanup };
}

test("Etapa 3b — deploy to .pi/skills uses .pi/skills in INDEX paths", () => {
	const {
		repoPath,
		sourceDir,
		cleanup,
	} = makeIduSkillFixture(["bug-hunter", "idu-pi-parent-protocol", "jq"]);
	try {
		const hostDir = join(repoPath, ".pi", "skills");
		const result = deploySkillsToHost({
			sourceDir,
			hostDir,
			projectPath: repoPath,
			repoRoot: repoPath,
			hostLabel: "pi",
		});
		const indexContent = readFileSync(result.indexPath, "utf8");
		assert.match(
			indexContent,
			/\.pi\/skills\/bug-hunter\/SKILL\.md/,
			"INDEX line for bug-hunter must reference .pi/skills/...",
		);
		assert.match(
			indexContent,
			/\.pi\/skills\/idu-pi-parent-protocol\/SKILL\.md/,
			"INDEX line for parent-protocol must reference .pi/skills/...",
		);
		assert.doesNotMatch(
			indexContent,
			/\.agents\/skills/,
			"INDEX must NEVER reference .agents/skills/ when targeting .pi/skills/",
		);
		// hostLabel propagated to formatter output.
		assert.ok(
			formatSkillsHostDeployResult(result).includes("host mirror: pi"),
			"formatter banner must show 'pi' target label",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3b — deploy to .claude/skills uses .claude/skills in INDEX paths", () => {
	const { repoPath, sourceDir, cleanup } = makeIduSkillFixture(["skill-check"]);
	try {
		const hostDir = join(repoPath, ".claude", "skills");
		const result = deploySkillsToHost({
			sourceDir,
			hostDir,
			projectPath: repoPath,
			repoRoot: repoPath,
			hostLabel: "claude",
		});
		const indexContent = readFileSync(result.indexPath, "utf8");
		assert.match(
			indexContent,
			/\.claude\/skills\/skill-check\/SKILL\.md/,
			"INDEX line must reference .claude/skills/...",
		);
		assert.doesNotMatch(
			indexContent,
			/\.agents\/skills/,
			"INDEX must NEVER reference .agents/skills/ when targeting .claude/skills/",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3b — Pi deploy overwrites stale + preserves user subdirs", () => {
	const { repoPath, sourceDir, cleanup } = makeIduSkillFixture(["bug-hunter"]);
	try {
		const hostDir = join(repoPath, ".pi", "skills");
		// Stale host
		mkdirSync(join(hostDir, "bug-hunter"), { recursive: true });
		writeFileSync(
			join(hostDir, "bug-hunter", "SKILL.md"),
			"# STALE Pi\n",
			"utf8",
		);
		// User skill (no SKILL.md)
		mkdirSync(join(hostDir, "user-keeps"), { recursive: true });
		writeFileSync(
			join(hostDir, "user-keeps", "NOTES.md"),
			"user keeps this in .pi/skills\n",
			"utf8",
		);
		const result = deploySkillsToHost({
			sourceDir,
			hostDir,
			projectPath: repoPath,
			repoRoot: repoPath,
			hostLabel: "pi",
		});
		assert.deepEqual(
			result.overwritten,
			["bug-hunter"],
			"bug-hunter must be overwritten on Pi host",
		);
		assert.deepEqual(
			result.preservedUser,
			["user-keeps"],
			"user-keeps must be preserved",
		);
		assert.equal(
			readFileSync(join(hostDir, "user-keeps", "NOTES.md"), "utf8"),
			"user keeps this in .pi/skills\n",
			"user content must be byte-identical post-deploy",
		);
	} finally {
		cleanup();
	}
});

test("Etapa 3b — Pi deploy is idempotent (second run = no destructive changes)", () => {
	const { repoPath, sourceDir, cleanup } = makeIduSkillFixture([
		"bug-hunter",
		"jq",
	]);
	try {
		const hostDir = join(repoPath, ".pi", "skills");
		const userDir = join(hostDir, "user-keeps");
		mkdirSync(userDir, { recursive: true });
		writeFileSync(
			join(userDir, "README.md"),
			"pi-user-notes\n",
			"utf8",
		);
		const input = {
			sourceDir,
			hostDir,
			projectPath: repoPath as string,
			repoRoot: repoPath as string,
			hostLabel: "pi" as const,
		};
		const r1 = deploySkillsToHost(input);
		const userReadmeAfterFirst = readFileSync(
			join(userDir, "README.md"),
			"utf8",
		);
		const indexAfterFirst = readFileSync(r1.indexPath, "utf8");
		const r2 = deploySkillsToHost(input);
		assert.deepEqual(
			r2.copied,
			[],
			"second Pi deploy creates nothing new",
		);
		assert.deepEqual(
			r2.overwritten.sort(),
			["bug-hunter", "jq"],
			"second Pi deploy overwrites the same idu-pi-owned skills",
		);
		assert.deepEqual(
			r2.preservedUser,
			["user-keeps"],
			"preservedUser stable across runs",
		);
		assert.equal(
			readFileSync(join(userDir, "README.md"), "utf8"),
			userReadmeAfterFirst,
			"Pi user README must be byte-identical after second deploy",
		);
		assert.equal(
			readFileSync(r2.indexPath, "utf8"),
			indexAfterFirst,
			"Pi INDEX must be byte-identical after second deploy",
		);
	} finally {
		cleanup();
	}
});
