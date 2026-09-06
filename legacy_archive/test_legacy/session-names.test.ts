import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	getSessionName,
	loadSessionNames,
	saveSessionNames,
	setSessionName,
} from "../src/session-names.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-session-names-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("session names persist by session id", () => {
	const file = join(tempDir(), "data", "session-names.json");
	const names = setSessionName({}, "019e3804", "  mantencion   RCM  ");
	saveSessionNames(names, file);

	const loaded = loadSessionNames(file);
	assert.equal(getSessionName(loaded, "019e3804"), "mantencion RCM");
});
