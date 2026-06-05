import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	buildPromptContextSnapshot,
	canUseExtensionUi,
} from "../.pi/extensions/idu-pi-commands.js";

const extensionSource = readFileSync(".pi/extensions/idu-pi-commands.ts", "utf8");

test("Pi extension records mode-aware UI guards", () => {
	assert.match(
		extensionSource,
		/type\s+PiRunMode\s*=\s*"tui"\s*\|\s*"rpc"\s*\|\s*"json"\s*\|\s*"print"/u,
	);
	assert.match(extensionSource, /mode\?:\s*PiRunMode/u);
	assert.match(extensionSource, /hasUI\?:\s*boolean/u);
	assert.match(extensionSource, /function\s+notifyIfUi\(/u);
	assert.match(extensionSource, /function\s+setStatusIfUi\(/u);
	assert.match(extensionSource, /ctx\.mode\s*===\s*"json"/u);
	assert.match(extensionSource, /ctx\.mode\s*===\s*"print"/u);
});

test("Pi extension suppresses UI in non-UI modes", () => {
	const ui = {
		notify: () => undefined,
		setStatus: () => undefined,
	};
	assert.equal(canUseExtensionUi({ mode: "tui", hasUI: true, ui }), true);
	assert.equal(canUseExtensionUi({ mode: "rpc", hasUI: true, ui }), true);
	assert.equal(canUseExtensionUi({ mode: "json", hasUI: false, ui }), false);
	assert.equal(canUseExtensionUi({ mode: "print", hasUI: false, ui }), false);
	assert.equal(canUseExtensionUi({ mode: "tui", hasUI: false, ui }), false);
	assert.equal(canUseExtensionUi({ mode: "tui", hasUI: true }), false);
});

test("Pi extension snapshots prompt context without raw prompt content", () => {
	const snapshot = buildPromptContextSnapshot(
		{
			contextFiles: [
				{ path: "AGENTS.md", content: "SECRET_RAW_CONTEXT" },
				{ filePath: "context.md", text: "SECOND_RAW_CONTEXT" },
			],
			loadedSkills: [{ name: "skill-a", content: "RAW_SKILL" }],
			activeTools: ["read", "bash"],
			systemPrompt: "RAW_SYSTEM_PROMPT",
		},
		"tui",
	);

	const serialized = JSON.stringify(snapshot);
	assert.equal(snapshot.rawContentIncluded, false);
	assert.equal(snapshot.contextFiles.count, 2);
	assert.deepEqual(snapshot.contextFiles.paths, ["AGENTS.md", "context.md"]);
	assert.equal(snapshot.contextFiles.totalChars, 36);
	assert.equal(snapshot.skills.count, 1);
	assert.deepEqual(snapshot.skills.names, ["skill-a"]);
	assert.equal(snapshot.tools.count, 2);
	assert.doesNotMatch(serialized, /SECRET_RAW_CONTEXT/u);
	assert.doesNotMatch(serialized, /SECOND_RAW_CONTEXT/u);
	assert.doesNotMatch(serialized, /RAW_SKILL/u);
	assert.doesNotMatch(serialized, /RAW_SYSTEM_PROMPT/u);
});

test("Pi extension refreshes prompt context snapshot before CLI commands", () => {
	assert.match(extensionSource, /getSystemPromptOptions\?\(\):\s*unknown/u);
	assert.match(extensionSource, /await\s+refreshPiPromptContextSnapshot\(ctx\)/u);
	assert.match(extensionSource, /prompt-context-snapshot\.json/u);
});
