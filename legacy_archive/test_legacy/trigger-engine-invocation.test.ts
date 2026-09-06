import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	runTriggerEngineTickOptIn,
	isTriggerEngineOptIn,
} from "../src/trigger-engine-invocation.js";
import { saveTriggerEngineConfig } from "../src/trigger-engine-config.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-trigger-inv-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("isTriggerEngineOptIn returns false by default", () => {
	const original = process.env.IDU_PI_TRIGGER_ENGINE;
	delete process.env.IDU_PI_TRIGGER_ENGINE;
	try {
		assert.equal(isTriggerEngineOptIn(), false);
	} finally {
		if (original !== undefined) process.env.IDU_PI_TRIGGER_ENGINE = original;
	}
});

test("isTriggerEngineOptIn returns true when IDU_PI_TRIGGER_ENGINE=1", () => {
	const original = process.env.IDU_PI_TRIGGER_ENGINE;
	process.env.IDU_PI_TRIGGER_ENGINE = "1";
	try {
		assert.equal(isTriggerEngineOptIn(), true);
	} finally {
		if (original !== undefined) process.env.IDU_PI_TRIGGER_ENGINE = original;
		else delete process.env.IDU_PI_TRIGGER_ENGINE;
	}
});

test("runTriggerEngineTickOptIn no corre sin opt-in", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	const original = process.env.IDU_PI_TRIGGER_ENGINE;
	try {
		delete process.env.IDU_PI_TRIGGER_ENGINE;
		const r = runTriggerEngineTickOptIn({ stateRoot, projectId: "idu-pi" });
		assert.equal(r.ran, false);
		assert.equal(r.injectedCount, 0);
	} finally {
		if (original !== undefined) process.env.IDU_PI_TRIGGER_ENGINE = original;
		else delete process.env.IDU_PI_TRIGGER_ENGINE;
		cleanup();
	}
});

test("runTriggerEngineTickOptIn corre con opt-in", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	const original = process.env.IDU_PI_TRIGGER_ENGINE;
	try {
		process.env.IDU_PI_TRIGGER_ENGINE = "1";
		const r = runTriggerEngineTickOptIn({ stateRoot, projectId: "idu-pi" });
		assert.equal(r.ran, true);
		// 0 inyecciones porque no hay eventos pero el engine sí corrió
		assert.equal(typeof r.injectedCount, "number");
	} finally {
		if (original !== undefined) process.env.IDU_PI_TRIGGER_ENGINE = original;
		else delete process.env.IDU_PI_TRIGGER_ENGINE;
		cleanup();
	}
});

test("runTriggerEngineTickOptIn corre con env unset y config enabled", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	const original = process.env.IDU_PI_TRIGGER_ENGINE;
	try {
		delete process.env.IDU_PI_TRIGGER_ENGINE;
		saveTriggerEngineConfig(stateRoot, {
			enabled: true,
			updatedAt: "2026-06-11T16:00:00.000Z",
			source: "cli",
		});

		const r = runTriggerEngineTickOptIn({ stateRoot, projectId: "idu-pi" });

		assert.equal(r.ran, true);
		assert.equal(typeof r.injectedCount, "number");
	} finally {
		if (original !== undefined) process.env.IDU_PI_TRIGGER_ENGINE = original;
		else delete process.env.IDU_PI_TRIGGER_ENGINE;
		cleanup();
	}
});

test("runTriggerEngineTickOptIn env=1 overrides disabled config", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	const original = process.env.IDU_PI_TRIGGER_ENGINE;
	try {
		process.env.IDU_PI_TRIGGER_ENGINE = "1";
		saveTriggerEngineConfig(stateRoot, {
			enabled: false,
			updatedAt: "2026-06-11T16:00:00.000Z",
			source: "cli",
		});

		const r = runTriggerEngineTickOptIn({ stateRoot, projectId: "idu-pi" });

		assert.equal(r.ran, true);
		assert.equal(typeof r.injectedCount, "number");
	} finally {
		if (original !== undefined) process.env.IDU_PI_TRIGGER_ENGINE = original;
		else delete process.env.IDU_PI_TRIGGER_ENGINE;
		cleanup();
	}
});
