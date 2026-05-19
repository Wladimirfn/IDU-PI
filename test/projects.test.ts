import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	parseAddProjectArgs,
	setActiveProject,
	slugifyProjectId,
} from "../src/projects.js";

test("slugifyProjectId normalizes project ids", () => {
	assert.equal(slugifyProjectId("Pi Telegram Bridge"), "pi-telegram-bridge");
});

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-projects-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("parseAddProjectArgs splits id and Windows path", () => {
	assert.deepEqual(
		parseAddProjectArgs("bridge C:\\Users\\alice\\pi-telegram-bridge"),
		{
			id: "bridge",
			path: "C:\\Users\\alice\\pi-telegram-bridge",
		},
	);
});

test("setActiveProject rejects paths outside allowed roots", () => {
	const allowed = tempDir();
	const outside = tempDir();
	assert.throws(
		() =>
			setActiveProject(
				{
					activeProjectId: null,
					projects: [{ id: "bad", name: "bad", path: outside }],
				},
				"bad",
				[allowed],
			),
		/Ruta fuera de ALLOWED_ROOTS/,
	);
});
