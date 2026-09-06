import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, createChildEnv } from "../src/pi.js";
import { buildPromptCommand } from "../src/pi-rpc.js";

test("buildPrompt returns plain user text without mode", () => {
	assert.equal(buildPrompt("  hola  "), "hola");
});

test("buildPrompt prepends mode instruction when present", () => {
	assert.equal(
		buildPrompt("hacé esto", "modo auto"),
		"modo auto\n\nUser request:\nhacé esto",
	);
});

test("buildPromptCommand queues safely if Pi is still streaming", () => {
	assert.deepEqual(buildPromptCommand("req-1", "hacé esto"), {
		id: "req-1",
		type: "prompt",
		message: "hacé esto",
		streamingBehavior: "followUp",
	});
});

test("createChildEnv removes bridge secrets but keeps normal env", () => {
	const env = createChildEnv({
		TELEGRAM_BOT_TOKEN: "secret",
		ALLOWED_USER_ID: "123",
		DEFAULT_CWD: "C:/Users/alice",
		ALLOWED_ROOTS: "C:/Users/alice",
		OPENAI_API_KEY: "needed-by-pi",
	});

	assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
	assert.equal(env.ALLOWED_USER_ID, undefined);
	assert.equal(env.DEFAULT_CWD, undefined);
	assert.equal(env.ALLOWED_ROOTS, undefined);
	assert.equal(env.OPENAI_API_KEY, "needed-by-pi");
});
