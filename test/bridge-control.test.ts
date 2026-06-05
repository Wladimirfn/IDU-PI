import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildBridgeControlCommand,
	consumeBridgeControlIntent,
	formatBridgeStartupStatus,
	writeBridgeControlIntent,
} from "../src/bridge-control.js";

test("bridge control intent is written and consumed once", () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-control-"));
	try {
		const path = join(dir, "intent.json");
		writeBridgeControlIntent(path, {
			type: "restart",
			origin: "telegram",
			chatId: 123,
			reason: "/reset",
			notifyOnStartup: true,
			requestedAt: "2026-06-05T00:00:00.000Z",
		});
		assert.match(readFileSync(path, "utf8"), /"chatId": 123/);
		assert.deepEqual(consumeBridgeControlIntent(path), {
			type: "restart",
			origin: "telegram",
			chatId: 123,
			reason: "/reset",
			notifyOnStartup: true,
			requestedAt: "2026-06-05T00:00:00.000Z",
		});
		assert.equal(consumeBridgeControlIntent(path), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("startup status contains service evidence without destructive reset claims", () => {
	const text = formatBridgeStartupStatus({
		origin: "reset",
		pid: 42,
		projectLabel: "idu-pi",
		currentCwd: "C:/repo",
		agentLabel: "openai-codex",
		rpcRunning: false,
		iduActive: true,
		telegramCommandCount: 88,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});
	assert.match(text, /Bridge iniciado/i);
	assert.match(text, /Origen: reset/i);
	assert.match(text, /PID: 42/i);
	assert.match(text, /Proyecto: idu-pi/i);
	assert.match(text, /Idu-pi: activo/i);
	assert.match(text, /Comandos Telegram: 88/i);
	assert.doesNotMatch(text, /stateRoot borrado/i);
});

test("bridge control command launches deterministic helper", () => {
	const command = buildBridgeControlCommand("restart", "C:\\bridge");
	assert.equal(command.file, "cmd.exe");
	assert.deepEqual(command.args, [
		"/c",
		"start",
		'"pi-telegram-bridge-control"',
		"cmd.exe",
		"/c",
		"powershell",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		"C:\\bridge\\scripts\\bridge-control.ps1",
		"restart",
	]);
	assert.equal(command.cwd, "C:\\bridge");
});
