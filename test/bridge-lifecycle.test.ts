import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildBridgeLifecycleCommand,
	bridgeLifecycleReply,
} from "../src/bridge-lifecycle.js";

test("buildBridgeLifecycleCommand opens a persistent cmd window for run and restart", () => {
	for (const action of ["run", "restart"] as const) {
		const command = buildBridgeLifecycleCommand(action, "C:\\bridge");

		assert.equal(command.file, "cmd.exe");
		assert.deepEqual(command.args, [
			"/c",
			"start",
			'"pi-telegram-bridge"',
			"cmd.exe",
			"/k",
			"powershell",
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			"C:\\bridge\\scripts\\start-bridge.ps1",
		]);
		assert.equal(command.cwd, "C:\\bridge");
	}
});

test("buildBridgeLifecycleCommand opens a stop script for off", () => {
	const command = buildBridgeLifecycleCommand("off", "C:\\bridge");

	assert.equal(command.file, "cmd.exe");
	assert.deepEqual(command.args, [
		"/c",
		"start",
		'"pi-telegram-bridge-stop"',
		"cmd.exe",
		"/c",
		"powershell",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		"C:\\bridge\\scripts\\stop-bridge.ps1",
	]);
});

test("bridgeLifecycleReply explains that off will disconnect the bot", () => {
	assert.match(bridgeLifecycleReply("run"), /Abriendo bridge/i);
	assert.match(bridgeLifecycleReply("restart"), /Reiniciando bridge/i);
	assert.match(bridgeLifecycleReply("off"), /Apagando bridge/i);
	assert.match(bridgeLifecycleReply("off"), /bot va a quedar offline/i);
});
