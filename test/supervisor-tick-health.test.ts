import { deepStrictEqual, match, strictEqual } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
	SUPERVISOR_TICK_POWERSHELL_ARGS,
	SUPERVISOR_TICK_POWERSHELL_COMMAND,
	SUPERVISOR_TICK_TASK_NAME,
	SupervisorTickHealthMonitor,
	classifySupervisorTickSnapshot,
	parseSupervisorTickSnapshot,
	querySupervisorTickHealth,
	type SupervisorTickHealthObservation,
	type SupervisorTickSnapshot,
} from "../src/supervisor-tick-health.js";
import { makeTempDir } from "./helpers/temp.js";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const HEALTHY: SupervisorTickSnapshot = {
	exists: true,
	state: "Ready",
	lastRunTime: "2026-08-09T11:00:00.000Z",
	nextRunTime: "2026-08-09T13:00:00.000Z",
	lastTaskResult: 0,
	numberOfMissedRuns: 0,
};
const DOWN: SupervisorTickSnapshot = {
	exists: true,
	state: "Disabled",
	lastRunTime: "2026-08-09T11:00:00.000Z",
	nextRunTime: "2026-08-09T13:00:00.000Z",
	lastTaskResult: 1,
	numberOfMissedRuns: 2,
};

function observation(
	health: "HEALTHY" | "DOWN",
	snapshot: SupervisorTickSnapshot = health === "HEALTHY" ? HEALTHY : DOWN,
): SupervisorTickHealthObservation {
	return { health, reason: health === "HEALTHY" ? "scheduled" : "task disabled", snapshot };
}

function harness(initial: SupervisorTickHealthObservation) {
	const stateRoot = makeTempDir("supervisor-tick-health-");
	let current = initial;
	let allowed = true;
	let successfulMessages = 0;
	const messages: string[] = [];
	let failNextSend = false;
	const monitor = new SupervisorTickHealthMonitor({
		query: async () => current,
		canSend: () => allowed,
		onMessageSent: () => successfulMessages++,
		sendMessage: async (text) => {
			messages.push(text);
			if (failNextSend) {
				failNextSend = false;
				throw new Error("telegram unavailable");
			}
		},
	});
	return {
		stateRoot,
		monitor,
		messages,
		get successfulMessages() {
			return successfulMessages;
		},
		setObservation(value: SupervisorTickHealthObservation) {
			current = value;
		},
		setAllowed(value: boolean) {
			allowed = value;
		},
		failNextSend() {
			failNextSend = true;
		},
	};
}

describe("Supervisor Tick health classification", () => {
	test("missing NextRunTime is DOWN", () => {
		const result = classifySupervisorTickSnapshot({ ...HEALTHY, nextRunTime: undefined }, NOW);
		strictEqual(result.health, "DOWN");
		match(result.reason, /NextRunTime/u);
	});

	test("Running with a valid future NextRunTime is HEALTHY", () => {
		const result = classifySupervisorTickSnapshot({ ...HEALTHY, state: "Running" }, NOW);
		strictEqual(result.health, "HEALTHY");
	});

	test("Queued with a valid future NextRunTime is HEALTHY", () => {
		// Queued is the normal state between a trigger firing and execution
		// starting. It must be treated as healthy, never DOWN.
		const result = classifySupervisorTickSnapshot({ ...HEALTHY, state: "Queued" }, NOW);
		strictEqual(result.health, "HEALTHY");
	});

	test("missing task is DOWN", () => {
		const result = classifySupervisorTickSnapshot({ exists: false }, NOW);
		strictEqual(result.health, "DOWN");
		match(result.reason, /no existe/u);
	});
});

describe("Supervisor Tick health transitions", () => {
	test("healthy baseline plans and sends nothing", async () => {
		const h = harness(observation("HEALTHY"));
		const result = await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		strictEqual(result.action, "baseline");
		deepStrictEqual(h.messages, []);
	});

	test("single DOWN observation does not alert (debounce)", async () => {
		const h = harness(observation("DOWN"));
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		deepStrictEqual(h.messages, []);
	});

	test("initial DOWN alerts on the second consecutive observation", async () => {
		const h = harness(observation("DOWN"));
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		strictEqual(h.messages.length, 0);
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "sent");
		strictEqual(h.messages.length, 1);
		match(h.messages[0], new RegExp(SUPERVISOR_TICK_TASK_NAME, "u"));
		match(h.messages[0], /State: Disabled/u);
		match(h.messages[0], /NextRunTime: 2026-08-09T13:00:00.000Z/u);
		match(h.messages[0], /LastTaskResult: 1/u);
		match(h.messages[0], /MissedRuns: 2/u);
	});

	test("HEALTHY to DOWN alerts on the second consecutive DOWN observation", async () => {
		const h = harness(observation("HEALTHY"));
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		h.setObservation(observation("DOWN"));
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		strictEqual(h.messages.length, 0);
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "sent");
		strictEqual(h.messages.length, 1);
	});

	test("repeated DOWN sends nothing after successful delivery", async () => {
		const h = harness(observation("DOWN"));
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		strictEqual(h.messages.length, 1);
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "none");
		strictEqual(h.messages.length, 1);
	});

	test("DOWN to HEALTHY sends one recovery once DOWN was delivered", async () => {
		const h = harness(observation("DOWN"));
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		h.setObservation(observation("HEALTHY"));
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "sent");
		strictEqual(h.messages.length, 2);
		match(h.messages[1], /recuperada/u);
	});

	test("repeated HEALTHY sends nothing", async () => {
		const h = harness(observation("HEALTHY"));
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "none");
		deepStrictEqual(h.messages, []);
	});

	test("failed send leaves the debounced DOWN transition retryable", async () => {
		const h = harness(observation("DOWN"));
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		h.failNextSend();
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "sent");
		strictEqual(h.messages.length, 2);
		strictEqual(h.successfulMessages, 1);
	});

	test("shared throttle leaves the debounced DOWN transition pending", async () => {
		const h = harness(observation("DOWN"));
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		h.setAllowed(false);
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "pending");
		deepStrictEqual(h.messages, []);
		h.setAllowed(true);
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "sent");
		strictEqual(h.messages.length, 1);
	});

	test("UNKNOWN does not alert or mutate persisted state", async () => {
		const h = harness(observation("HEALTHY"));
		await h.monitor.check({ stateRoot: h.stateRoot, now: NOW });
		const statePath = join(h.stateRoot, "supervisor-tick-health.json");
		const before = readFileSync(statePath, "utf8");
		h.setObservation({ health: "UNKNOWN", reason: "malformed JSON" });
		strictEqual((await h.monitor.check({ stateRoot: h.stateRoot, now: NOW })).action, "unknown");
		strictEqual(readFileSync(statePath, "utf8"), before);
		deepStrictEqual(h.messages, []);
	});

	test("post-send persistence failure disables only this monitor", async () => {
		const stateRoot = makeTempDir("supervisor-tick-health-write-failure-");
		let writes = 0;
		const messages: string[] = [];
		const monitor = new SupervisorTickHealthMonitor({
			query: async () => observation("DOWN"),
			canSend: () => true,
			onMessageSent: () => {},
			sendMessage: async (text) => {
				messages.push(text);
			},
			writeState: (path, value) => {
				writes++;
				// write #1 = observation 1, #2 = observation 2, #3 = post-send ack.
				if (writes === 3) throw new Error("disk full");
				// Persist for real so readState sees the debounce counter advance
				// (mirrors atomicWriteJson's contract).
				writeFileSync(path, JSON.stringify(value));
			},
		});
		strictEqual((await monitor.check({ stateRoot, now: NOW })).action, "pending");
		strictEqual((await monitor.check({ stateRoot, now: NOW })).action, "disabled");
		strictEqual((await monitor.check({ stateRoot, now: NOW })).action, "disabled");
		strictEqual(messages.length, 1);
	});
});

test("query errors are UNKNOWN and the PowerShell command is fixed", async () => {
	strictEqual(SUPERVISOR_TICK_POWERSHELL_COMMAND, "powershell.exe");
	deepStrictEqual(SUPERVISOR_TICK_POWERSHELL_ARGS.slice(0, 3), [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
	]);
	strictEqual(SUPERVISOR_TICK_POWERSHELL_ARGS.length, 4);
	strictEqual(SUPERVISOR_TICK_POWERSHELL_ARGS[3].includes(SUPERVISOR_TICK_TASK_NAME), true);

	const nonWindows = await querySupervisorTickHealth(NOW, { platform: "linux" });
	strictEqual(nonWindows.health, "UNKNOWN");

	const failed = await querySupervisorTickHealth(NOW, {
		platform: "win32",
		execFile: async () => {
			throw new Error("timeout");
		},
	});
	strictEqual(failed.health, "UNKNOWN");
	strictEqual(parseSupervisorTickSnapshot("not json"), undefined);
});

test("PowerShell JSON parser normalizes blank and DateTime.MinValue fields", () => {
	const parsed = parseSupervisorTickSnapshot(JSON.stringify({
		exists: true,
		state: "Ready",
		lastRunTime: "0001-01-01T00:00:00",
		nextRunTime: " ",
		lastTaskResult: 0,
		numberOfMissedRuns: 0,
	}));
	deepStrictEqual(parsed, {
		exists: true,
		state: "Ready",
		lastTaskResult: 0,
		numberOfMissedRuns: 0,
	});
	strictEqual(existsSync(join(makeTempDir("supervisor-no-state-"), "supervisor-tick-health.json")), false);
});
