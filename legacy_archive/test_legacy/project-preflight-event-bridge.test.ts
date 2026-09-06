import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emitIntentionRegisteredEvent } from "../src/project-preflight-event-bridge.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-ppeb-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

const FIXED_TS = "2026-06-08T10:00:00.000Z";

test("emitIntentionRegisteredEvent con risk=high emite 1 línea", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitIntentionRegisteredEvent({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: {
				risk: "high",
				request: "modify auth.ts",
				affectedAreas: ["auth", "security"],
			},
		});
		assert.equal(result.emittedCount, 1);
		const lines = readFileSync(join(stateRoot, "events.jsonl"), "utf8").trim().split("\n");
		assert.equal(lines.length, 1);
		const ev = JSON.parse(lines[0] ?? "{}");
		assert.equal(ev.kind, "intention_registered");
		assert.equal(ev.payload.risk, "high");
	} finally {
		cleanup();
	}
});

test("emitIntentionRegisteredEvent con risk=medium emite", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitIntentionRegisteredEvent({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: { risk: "medium", request: "tweak db", affectedAreas: ["db"] },
		});
		assert.equal(result.emittedCount, 1);
	} finally {
		cleanup();
	}
});

test("emitIntentionRegisteredEvent con risk=low NO emite", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitIntentionRegisteredEvent({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: { risk: "low", request: "tweak copy", affectedAreas: [] },
		});
		assert.equal(result.emittedCount, 0);
		assert.equal(existsSync(join(stateRoot, "events.jsonl")), false);
	} finally {
		cleanup();
	}
});

test("emitIntentionRegisteredEvent con risk=blocker emite", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = emitIntentionRegisteredEvent({
			stateRoot,
			projectId: "idu-pi",
			now: new Date(FIXED_TS),
			report: { risk: "blocker", request: "drop prod", affectedAreas: ["db"] },
		});
		assert.equal(result.emittedCount, 1);
	} finally {
		cleanup();
	}
});
