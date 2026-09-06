import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	disableSupervisorTrigger,
	enableSupervisorTrigger,
	formatSupervisorTriggerResult,
	formatSupervisorTriggerStatus,
	getSupervisorTriggerStatus,
	readSupervisorTriggerFile,
	SUPERVISOR_TRIGGER_FILENAME,
	supervisorTriggerPath,
} from "../src/supervisor-trigger.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "supervisor-trigger-"));
}

test("supervisorTriggerPath joins the filename under the stateRoot", () => {
	const root = tempRoot();
	try {
		assert.equal(
			supervisorTriggerPath(root),
			join(root, SUPERVISOR_TRIGGER_FILENAME),
		);
		assert.equal(
			SUPERVISOR_TRIGGER_FILENAME,
			"supervisor-trigger.json",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("getSupervisorTriggerStatus returns the default-enabled state when no file exists", () => {
	const root = tempRoot();
	try {
		const status = getSupervisorTriggerStatus(root);
		assert.equal(status.exists, false);
		assert.equal(status.enabled, true);
		assert.equal(status.path, supervisorTriggerPath(root));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readSupervisorTriggerFile returns null when no file exists", () => {
	const root = tempRoot();
	try {
		assert.equal(readSupervisorTriggerFile(root), null);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("enableSupervisorTrigger writes a file with enabled=true and updatedAt", () => {
	const root = tempRoot();
	try {
		const result = enableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:00.000Z"),
			source: "tui",
		});
		assert.equal(result.state.enabled, true);
		assert.equal(result.state.version, 1);
		assert.equal(result.state.updatedAt, "2026-06-10T10:00:00.000Z");
		assert.equal(result.state.source, "tui");
		assert.equal(result.previous, null);
		assert.equal(result.changed, true);
		assert.equal(existsSync(result.path), true);
		const onDisk = JSON.parse(readFileSync(result.path, "utf8"));
		assert.equal(onDisk.enabled, true);
		assert.equal(onDisk.version, 1);
		assert.equal(onDisk.updatedAt, "2026-06-10T10:00:00.000Z");
		assert.equal(onDisk.source, "tui");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("disableSupervisorTrigger writes a file with enabled=false", () => {
	const root = tempRoot();
	try {
		const result = disableSupervisorTrigger(root, {
			now: new Date("2026-06-10T11:00:00.000Z"),
			source: "cli",
			note: "test disable",
		});
		assert.equal(result.state.enabled, false);
		assert.equal(result.state.note, "test disable");
		assert.equal(result.state.source, "cli");
		assert.equal(result.changed, true);
		const onDisk = JSON.parse(readFileSync(result.path, "utf8"));
		assert.equal(onDisk.enabled, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("enable -> disable -> enable is idempotent in shape but the changed flag tracks the last call", () => {
	const root = tempRoot();
	try {
		const first = enableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:00.000Z"),
		});
		assert.equal(first.changed, true);
		const reEnable = enableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:01.000Z"),
		});
		// re-enabling the same value with a fresh updatedAt is a write
		// (the timestamp changed) — `changed` reflects the file diff,
		// not the boolean.
		assert.equal(reEnable.state.enabled, true);
		assert.equal(reEnable.changed, true);

		const disable = disableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:02.000Z"),
		});
		assert.equal(disable.state.enabled, false);
		assert.equal(disable.changed, true);
		assert.equal(disable.previous?.enabled, true);

		const reDisable = disableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:03.000Z"),
		});
		assert.equal(reDisable.state.enabled, false);
		assert.equal(reDisable.changed, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("getSupervisorTriggerStatus reflects the on-disk state after writes", () => {
	const root = tempRoot();
	try {
		disableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:00.000Z"),
		});
		const status = getSupervisorTriggerStatus(root);
		assert.equal(status.exists, true);
		assert.equal(status.enabled, false);
		assert.equal(status.updatedAt, "2026-06-10T10:00:00.000Z");

		enableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:05.000Z"),
		});
		const reEnabled = getSupervisorTriggerStatus(root);
		assert.equal(reEnabled.exists, true);
		assert.equal(reEnabled.enabled, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("formatSupervisorTriggerStatus handles the default-enabled and disabled cases", () => {
	const root = tempRoot();
	try {
		const def = formatSupervisorTriggerStatus(
			getSupervisorTriggerStatus(root),
		);
		assert.match(def, /enabled \(default/u);
		assert.match(def, /no file present/u);

		disableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:00.000Z"),
			source: "cli",
			note: "offline maintenance",
		});
		const off = formatSupervisorTriggerStatus(
			getSupervisorTriggerStatus(root),
		);
		assert.match(off, /state: disabled/u);
		assert.match(off, /source: cli/u);
		assert.match(off, /offline maintenance/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("formatSupervisorTriggerResult renders the result envelope", () => {
	const root = tempRoot();
	try {
		const result = enableSupervisorTrigger(root, {
			now: new Date("2026-06-10T10:00:00.000Z"),
		});
		const text = formatSupervisorTriggerResult(result);
		assert.match(text, /state: enabled/u);
		assert.match(text, /updatedAt: 2026-06-10T10:00:00.000Z/u);
		assert.match(text, /changed: yes/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readSupervisorTriggerFile returns null when the file is malformed JSON", () => {
	const root = tempRoot();
	try {
		const path = supervisorTriggerPath(root);
		mkdirSync(root, { recursive: true });
		writeFileSync(path, "{ not valid json", "utf8");
		assert.equal(readSupervisorTriggerFile(root), null);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readSupervisorTriggerFile rejects a payload without an `enabled` boolean", () => {
	const root = tempRoot();
	try {
		const path = supervisorTriggerPath(root);
		mkdirSync(root, { recursive: true });
		writeFileSync(
			path,
			`${JSON.stringify({ version: 1, updatedAt: "2026-06-10T10:00:00.000Z" })}\n`,
			"utf8",
		);
		assert.equal(readSupervisorTriggerFile(root), null);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
