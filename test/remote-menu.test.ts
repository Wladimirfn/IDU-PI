import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildIduRemoteMenuKeyboard,
	buildIduRemoteMenuText,
	buildIduRemoteProjectKeyboard,
	formatIduRemoteProjectList,
	parseIduRemoteCallback,
} from "../src/remote-menu.js";
import type { ProjectRegistry } from "../src/projects.js";

test("remote menu explains Telegram as a guided CLI control surface", () => {
	const text = buildIduRemoteMenuText("sistema");
	const keyboard = buildIduRemoteMenuKeyboard();

	assert.match(text, /control remoto del CLI\/supervisor/iu);
	assert.match(text, /Proyecto activo:\s*sistema/iu);
	assert.match(text, /texto libre/iu);
	assert.deepEqual(keyboard.inline_keyboard[0], [
		{ text: "🚦 Activar supervisor", callback_data: "idu-remote:run:idu" },
		{ text: "📊 Estado", callback_data: "idu-remote:run:idu_status" },
	]);
	assert.ok(
		keyboard.inline_keyboard
			.flat()
			.some((button) => button.text === "📁 Cambiar proyecto"),
	);
});

test("remote project keyboard lists enrolled projects without auto-enroll", () => {
	const registry: ProjectRegistry = {
		activeProjectId: "sistema",
		projects: [
			{ id: "sistema", name: "Sistema", path: "C:/Sistema" },
			{ id: "idu-pi", name: "IDU-Pi", path: "C:/IDU-PI" },
		],
	};

	const text = formatIduRemoteProjectList(registry);
	const keyboard = buildIduRemoteProjectKeyboard(registry);

	assert.match(text, /Proyectos enrolados/iu);
	assert.match(text, /▸ sistema/iu);
	assert.match(text, /idu-pi/iu);
	assert.deepEqual(keyboard.inline_keyboard[0], [
		{ text: "✅ Sistema", callback_data: "idu-remote:project:sistema" },
	]);
	assert.deepEqual(keyboard.inline_keyboard[1], [
		{ text: "IDU-Pi", callback_data: "idu-remote:project:idu-pi" },
	]);
});

test("remote callback parser accepts only Idu remote callbacks", () => {
	assert.deepEqual(parseIduRemoteCallback("idu-remote:menu"), {
		type: "menu",
	});
	assert.deepEqual(parseIduRemoteCallback("idu-remote:projects"), {
		type: "projects",
	});
	assert.deepEqual(parseIduRemoteCallback("idu-remote:run:queue_detail"), {
		type: "run",
		command: "queue_detail",
	});
	assert.deepEqual(parseIduRemoteCallback("idu-remote:project:sistema"), {
		type: "project",
		projectId: "sistema",
	});
	assert.equal(parseIduRemoteCallback("ui:abc:yes"), undefined);
	assert.equal(parseIduRemoteCallback("idu-remote:run:rm -rf"), undefined);
});
