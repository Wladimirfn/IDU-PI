import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	disableTriggerEngineConfig,
	enableTriggerEngineConfig,
	formatTriggerEngineConfigResult,
	formatTriggerEngineConfigStatus,
	getTriggerEngineConfigStatus,
	readTriggerEngineConfig,
	saveTriggerEngineConfig,
	triggerEngineConfigPath,
} from "../src/trigger-engine-config.js";

function withStateRoot(fn: (stateRoot: string) => void): void {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-trigger-config-"));
	try {
		fn(stateRoot);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
}

test("readTriggerEngineConfig returns disabled default when file is absent", () => {
	withStateRoot((stateRoot) => {
		const config = readTriggerEngineConfig(stateRoot);

		assert.equal(existsSync(triggerEngineConfigPath(stateRoot)), false);
		assert.equal(config.version, 1);
		assert.equal(config.enabled, false);
		assert.equal(config.updatedAt, "1970-01-01T00:00:00.000Z");
		assert.equal(config.source, undefined);
	});
});

test("saveTriggerEngineConfig writes enabled config under stateRoot", () => {
	withStateRoot((stateRoot) => {
		const result = saveTriggerEngineConfig(stateRoot, {
			enabled: true,
			updatedAt: "2026-06-11T16:00:00.000Z",
			source: "cli",
		});

		assert.equal(result.path, triggerEngineConfigPath(stateRoot));
		assert.equal(result.config.enabled, true);
		assert.equal(result.config.version, 1);
		assert.equal(result.config.updatedAt, "2026-06-11T16:00:00.000Z");
		assert.equal(result.config.source, "cli");
		assert.deepEqual(readTriggerEngineConfig(stateRoot), result.config);
		assert.match(readFileSync(result.path, "utf8"), /"enabled": true/u);
	});
});

test("readTriggerEngineConfig is lenient for malformed files", () => {
	withStateRoot((stateRoot) => {
		writeFileSync(triggerEngineConfigPath(stateRoot), "not-json", "utf8");

		const config = readTriggerEngineConfig(stateRoot);

		assert.equal(config.version, 1);
		assert.equal(config.enabled, false);
		assert.equal(config.updatedAt, "1970-01-01T00:00:00.000Z");
	});
});

test("readTriggerEngineConfig preserves disabled file state", () => {
	withStateRoot((stateRoot) => {
		saveTriggerEngineConfig(stateRoot, {
			enabled: false,
			updatedAt: "2026-06-11T17:00:00.000Z",
			source: "tui",
		});

		const config = readTriggerEngineConfig(stateRoot);

		assert.equal(config.enabled, false);
		assert.equal(config.updatedAt, "2026-06-11T17:00:00.000Z");
		assert.equal(config.source, "tui");
	});
});

test("readTriggerEngineConfig defaults missing metadata on valid files", () => {
	withStateRoot((stateRoot) => {
		writeFileSync(
			triggerEngineConfigPath(stateRoot),
			JSON.stringify({ enabled: true }),
			"utf8",
		);

		const config = readTriggerEngineConfig(stateRoot);

		assert.equal(config.enabled, true);
		assert.equal(config.updatedAt, "1970-01-01T00:00:00.000Z");
		assert.equal(config.source, undefined);
	});
});

test("getTriggerEngineConfigStatus reports default disabled state", () => {
	withStateRoot((stateRoot) => {
		const status = getTriggerEngineConfigStatus(stateRoot);

		assert.equal(status.path, triggerEngineConfigPath(stateRoot));
		assert.equal(status.exists, false);
		assert.equal(status.enabled, false);
		assert.match(
			formatTriggerEngineConfigStatus(status),
			/disabled \(default/u,
		);
	});
});

test("enableTriggerEngineConfig and disableTriggerEngineConfig toggle persisted state", () => {
	withStateRoot((stateRoot) => {
		const enabled = enableTriggerEngineConfig(stateRoot, {
			now: new Date("2026-06-11T18:00:00.000Z"),
			source: "cli",
		});

		assert.equal(enabled.state.enabled, true);
		assert.equal(readTriggerEngineConfig(stateRoot).enabled, true);
		assert.match(formatTriggerEngineConfigResult(enabled), /enabled/u);

		const disabled = disableTriggerEngineConfig(stateRoot, {
			now: new Date("2026-06-11T18:05:00.000Z"),
			source: "cli",
		});

		assert.equal(disabled.previous?.enabled, true);
		assert.equal(disabled.state.enabled, false);
		assert.equal(readTriggerEngineConfig(stateRoot).enabled, false);
	});
});
