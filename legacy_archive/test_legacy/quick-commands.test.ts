import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildDashboardText,
	buildQuickCommandPrompt,
	type DashboardState,
} from "../src/quick-commands.js";

const dashboard: DashboardState = {
	bridgePid: 123,
	projectLabel: "idu-pi (C:/repo)",
	currentCwd: "C:/repo",
	agentLabel: "Pi default",
	agentId: "default",
	workspace: "C:/repo",
	workspaceKind: "direct",
	rpcRunning: true,
	busy: false,
	modePrefix: "",
	lastSessionCount: 2,
};

test("buildDashboardText summarizes operational state", () => {
	const text = buildDashboardText(dashboard);

	assert.match(text, /Dashboard Idu-pi/);
	assert.match(text, /Bridge PID: 123/);
	assert.match(text, /RPC: iniciado/);
	assert.match(text, /Trabajos recientes: 2/);
	assert.match(text, /Sugeridos:/);
});

test("buildQuickCommandPrompt returns focused prompts", () => {
	assert.match(buildQuickCommandPrompt("review") ?? "", /review/i);
	assert.match(buildQuickCommandPrompt("fix_tests") ?? "", /fix.*tests/i);
	assert.match(buildQuickCommandPrompt("audit") ?? "", /audit/i);
	assert.match(buildQuickCommandPrompt("safe_push") ?? "", /safe push/i);
	assert.equal(buildQuickCommandPrompt("missing"), undefined);
});
