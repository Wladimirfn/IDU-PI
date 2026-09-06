import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	canonicalDirectory,
	isAllowedCwd,
	parseAgentProfiles,
} from "../src/config.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-bridge-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("canonicalDirectory rejects files", () => {
	const root = tempDir();
	const file = join(root, "not-a-directory.txt");
	writeFileSync(file, "x");

	assert.throws(() => canonicalDirectory(file), /not a directory/);
});

test("isAllowedCwd accepts directories inside allowed roots", async () => {
	const root = tempDir();
	const canonicalRoot = await realpath(root);

	assert.equal(isAllowedCwd(root, [canonicalRoot]), true);
});

test("isAllowedCwd rejects sibling prefix paths", () => {
	const root = tempDir();
	const sibling = `${root}-sibling`;
	mkdtempSync(sibling);
	tempRoots.push(sibling);

	assert.equal(isAllowedCwd(sibling, [root]), false);
});

test("parseAgentProfiles returns Pi default when env is absent", () => {
	assert.deepEqual(parseAgentProfiles(undefined), [
		{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
	]);
});

test("parseAgentProfiles parses labels and extra args", () => {
	assert.deepEqual(
		parseAgentProfiles("default|Pi default;codex|GPT Codex|--model codex"),
		[
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{
				id: "codex",
				label: "GPT Codex",
				provider: "pi",
				piArgs: ["--model", "codex"],
			},
		],
	);
});

test("parseAgentProfiles rejects duplicate ids", () => {
	assert.throws(
		() => parseAgentProfiles("codex|One;codex|Two"),
		/Duplicate PI_AGENT_PROFILES id/,
	);
});
