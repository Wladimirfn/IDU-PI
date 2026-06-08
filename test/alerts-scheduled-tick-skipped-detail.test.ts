import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatScheduledTickSkippedDetail } from "../src/alerts-scheduled-tick-skipped-detail.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-skip-"));
	return { stateRoot: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("formatScheduledTickSkippedDetail muestra lock activo con expiresAt", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		const lockPath = join(stateRoot, "reports", "autonomous-alert-scheduler-state.json");
		const ts = new Date("2026-06-08T18:00:00Z");
		const expiresAt = new Date(ts.getTime() + 5 * 60_000).toISOString();
		writeFileSync(
			lockPath,
			JSON.stringify({
				version: 1,
				createdTaskIds: {},
				updatedAt: ts.toISOString(),
				lastRunAt: ts.toISOString(),
				lastStatus: "ran",
				lock: {
					ownerId: "other-pid:123",
					acquiredAt: ts.toISOString(),
					expiresAt,
				},
			}),
			"utf8",
		);
		const out = formatScheduledTickSkippedDetail({ stateRoot, now: ts });
		assert.match(out, /lock activo/);
		assert.match(out, /owner=other-pid:123/);
		assert.match(out, /expiresAt=2026-06-08T18:05/);
		assert.match(out, /force=true/);
	} finally {
		cleanup();
	}
});

test("formatScheduledTickSkippedDetail retorna cadena vacía sin lock ni state", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const out = formatScheduledTickSkippedDetail({ stateRoot, now: new Date() });
		assert.equal(out, "");
	} finally {
		cleanup();
	}
});

test("formatScheduledTickSkippedDetail ignora lock expirado", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		const lockPath = join(stateRoot, "reports", "autonomous-alert-scheduler-state.json");
		const ts = new Date("2026-06-08T18:00:00Z");
		const pastAcquire = new Date(ts.getTime() - 10 * 60_000).toISOString();
		const pastExpires = new Date(ts.getTime() - 5 * 60_000).toISOString();
		writeFileSync(
			lockPath,
			JSON.stringify({
				version: 1,
				createdTaskIds: {},
				updatedAt: pastAcquire,
				lastRunAt: pastAcquire,
				lastStatus: "ran",
				lock: {
					ownerId: "other-pid:999",
					acquiredAt: pastAcquire,
					expiresAt: pastExpires,
				},
			}),
			"utf8",
		);
		const out = formatScheduledTickSkippedDetail({ stateRoot, now: ts });
		assert.equal(out, "");
	} finally {
		cleanup();
	}
});
