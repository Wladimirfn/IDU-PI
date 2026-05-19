import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { summarizeSessionFile } from "../src/session-summary.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-session-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("summarizeSessionFile extracts human title hint", () => {
	const file = join(tempDir(), "session.jsonl");
	writeFileSync(
		file,
		[
			JSON.stringify({ type: "session", cwd: "C:/p" }),
			JSON.stringify({
				message: { role: "user", content: [{ type: "text", text: "1" }] },
			}),
			JSON.stringify({
				message: {
					role: "user",
					content: [{ type: "text", text: "mantencion RCM" }],
				},
			}),
			JSON.stringify({
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Commit hecho." }],
				},
			}),
		].join("\n"),
	);

	const summary = summarizeSessionFile(file);
	assert.equal(summary.titleHint, "mantencion RCM");
	assert.equal(summary.lastAssistantText, "Commit hecho.");
});
