import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	findRecentSessionsForCwd,
	isActiveSessionChoice,
	resolveSessionPick,
	sessionDirNameForCwd,
	type SessionPick,
} from "../src/sessions.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-sessions-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("sessionDirNameForCwd matches Pi session folder encoding", () => {
	assert.equal(sessionDirNameForCwd("C:\\Users\\alice"), "--C--Users-alice--");
});

test("resolveSessionPick accepts explicit work-session choices", () => {
	const picks = [
		{ index: 1, id: "a" },
		{ index: 2, id: "b" },
	] as SessionPick[];

	assert.equal(resolveSessionPick(picks, "T1")?.id, "a");
	assert.equal(resolveSessionPick(picks, "trabajo 2")?.id, "b");
	assert.equal(resolveSessionPick(picks, "sesión 1")?.id, "a");
	assert.equal(resolveSessionPick(picks, "ver T2")?.id, "b");
	assert.equal(resolveSessionPick(picks, "resume 1")?.id, "a");
	assert.equal(resolveSessionPick(picks, "2")?.id, "b");
	assert.equal(resolveSessionPick(picks, "A"), undefined);
});

test("isActiveSessionChoice accepts explicit active-session phrases", () => {
	assert.equal(isActiveSessionChoice("A"), true);
	assert.equal(isActiveSessionChoice("activo"), true);
	assert.equal(isActiveSessionChoice("esta sesión"), true);
	assert.equal(isActiveSessionChoice("usar esta sesion"), true);
	assert.equal(isActiveSessionChoice("T1"), false);
});

test("findRecentSessionsForCwd scans exact cwd directory", () => {
	const home = tempDir();
	const cwd = "C:\\Users\\alice";
	const sessionDir = join(
		home,
		".pi",
		"agent",
		"sessions",
		sessionDirNameForCwd(cwd),
	);
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(
		join(sessionDir, "session.jsonl"),
		`${JSON.stringify({ type: "session", id: "abc", cwd })}\n`,
	);

	const sessions = findRecentSessionsForCwd(home, cwd, 8);
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].id, "abc");
});
