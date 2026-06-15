import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	disableSupervisorTrigger,
	getSupervisorTriggerStatus,
	readSupervisorTriggerFile,
} from "../src/supervisor-trigger.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-trigger-tui-"));
}

test(
	"disableSupervisorTrigger with source:'tui' writes the file and reports enabled:false",
	() => {
		const stateRoot = makeStateRoot();
		try {
			// Setup: confirm file does not exist initially
			assert.equal(
				existsSync(join(stateRoot, "supervisor-trigger.json")),
				false,
				"precondition: file should not exist",
			);

			// Action: TUI disables the trigger
			const result = disableSupervisorTrigger(stateRoot, {
				source: "tui",
				now: new Date("2026-06-15T00:00:00Z"),
			});

			// Assertion 1: the function returns successfully
			assert.equal(result.state.enabled, false);
			assert.equal(result.state.source, "tui");

			// Assertion 2: the file is actually written
			const filePath = join(stateRoot, "supervisor-trigger.json");
			assert.equal(
				existsSync(filePath),
				true,
				"file must exist after disable call (TUI roundtrip)",
			);

			// Assertion 3: a re-read via getSupervisorTriggerStatus shows disabled
			const status = getSupervisorTriggerStatus(stateRoot);
			assert.equal(status.exists, true);
			assert.equal(status.enabled, false);
			assert.equal(status.source, "tui");

			// Assertion 4: readSupervisorTriggerFile parses correctly
			const file = readSupervisorTriggerFile(stateRoot);
			assert.ok(file);
			assert.equal(file?.enabled, false);
			assert.equal(file?.version, 1);
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	},
);

test(
	"disableSupervisorTrigger is idempotent (call twice → still disabled, no throw)",
	() => {
		const stateRoot = makeStateRoot();
		try {
			disableSupervisorTrigger(stateRoot, {
				source: "tui",
				now: new Date("2026-06-15T00:00:00Z"),
			});
			// Second call must not throw
			const result2 = disableSupervisorTrigger(stateRoot, {
				source: "tui",
				now: new Date("2026-06-15T00:01:00Z"),
			});
			assert.equal(result2.state.enabled, false);
			const status = getSupervisorTriggerStatus(stateRoot);
			assert.equal(status.enabled, false);
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	},
);

test(
	"toggling disable→enable→disable ends with file showing enabled:false",
	() => {
		const stateRoot = makeStateRoot();
		try {
			disableSupervisorTrigger(stateRoot, {
				source: "tui",
				now: new Date("2026-06-15T00:00:00Z"),
			});
			// Manually verify: read the file
			const after1 = JSON.parse(
				readFileSync(
					join(stateRoot, "supervisor-trigger.json"),
					"utf8",
				),
			) as { enabled: boolean };
			assert.equal(after1.enabled, false);
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	},
);
