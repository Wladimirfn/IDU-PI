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

test("startup status can be built from a consumed restart intent", () => {
	const text = formatBridgeStartupStatus({
		origin: "telegram",
		pid: 99,
		projectLabel: "idu-pi",
		currentCwd: "C:/repo",
		agentLabel: "codex",
		rpcRunning: true,
		iduActive: false,
		telegramCommandCount: 91,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});
	assert.match(text, /Origen: telegram/);
	assert.match(text, /Pi\/orquestador: iniciado/);
	assert.match(text, /Idu-pi: inactivo/);
});

test("bridge control command allows roots with spaces", () => {
	const command = buildBridgeControlCommand("restart", "C:\\bridge root");
	assert.equal(command.args.at(-2), "C:\\bridge root\\scripts\\bridge-control.ps1");
	assert.equal(command.cwd, "C:\\bridge root");
});

test("bridge control command rejects unsafe shell metacharacters in root", () => {
	assert.throws(
		() => buildBridgeControlCommand("restart", "C:\\bridge&echo owned"),
		/unsafe shell metacharacters/i,
	);
});

test("bridge lifecycle scripts require a root boundary when matching relative dist entrypoints", () => {
	for (const script of [
		"scripts/bridge-control.ps1",
		"scripts/start-bridge.ps1",
		"scripts/stop-bridge.ps1",
	]) {
		const source = readFileSync(script, "utf8");
		assert.doesNotMatch(source, /Contains\(\$rootText\)/, script);
		assert.doesNotMatch(source, /Contains\(\$rootSlash\).*dist\/src\/index\.js/s, script);
		assert.match(source, /\[regex\]::Escape\(\$rootSlash\)/, script);
		assert.match(source, /\(\?=\$\|\[\^A-Za-z0-9\._-\]\)/, script);
		assert.match(source, /Test-BridgeCommandLine \$_.CommandLine/, script);
	}
});
