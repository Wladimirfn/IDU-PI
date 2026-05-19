import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatUiRequestForTelegram,
	isBlockingUiRequest,
	parseServerCommand,
	parseUiRequestAnswer,
} from "../src/telegram-ui.js";

test("parseServerCommand accepts run restart off and status", () => {
	assert.equal(parseServerCommand("/server"), "status");
	assert.equal(parseServerCommand("/server run"), "run");
	assert.equal(parseServerCommand("/server restart"), "restart");
	assert.equal(parseServerCommand("/server off"), "off");
	assert.equal(parseServerCommand("/server nope"), undefined);
});

test("formatUiRequestForTelegram shows confirm and select choices", () => {
	assert.match(
		formatUiRequestForTelegram({
			id: "u1",
			method: "confirm",
			title: "Allow guarded command?",
			message: "git push",
		}),
		/Respondé SI o NO/,
	);
	assert.match(
		formatUiRequestForTelegram({
			id: "u2",
			method: "select",
			title: "Pick",
			options: ["A", "B"],
		}),
		/U2\. B/,
	);
});

test("isBlockingUiRequest separates decisions from fire-and-forget events", () => {
	assert.equal(isBlockingUiRequest({ id: "c", method: "confirm" }), true);
	assert.equal(isBlockingUiRequest({ id: "s", method: "select" }), true);
	assert.equal(isBlockingUiRequest({ id: "n", method: "notify" }), false);
	assert.equal(isBlockingUiRequest({ id: "t", method: "setTitle" }), false);
	assert.equal(isBlockingUiRequest({ id: "w", method: "setWidget" }), false);
});

test("parseUiRequestAnswer builds extension UI responses", () => {
	assert.deepEqual(
		parseUiRequestAnswer(
			{ id: "confirm-1", method: "confirm", title: "Confirm" },
			"sí",
		),
		{ type: "extension_ui_response", id: "confirm-1", confirmed: true },
	);
	assert.deepEqual(
		parseUiRequestAnswer(
			{ id: "select-1", method: "select", title: "Pick", options: ["A", "B"] },
			"U2",
		),
		{ type: "extension_ui_response", id: "select-1", value: "B" },
	);
	assert.deepEqual(
		parseUiRequestAnswer(
			{ id: "input-1", method: "input", title: "Value" },
			"hello",
		),
		{ type: "extension_ui_response", id: "input-1", value: "hello" },
	);
});
