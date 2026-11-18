import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildAgentTuiSnapshot,
	createTuiState,
	extractRoleRank,
	getFilteredAgents,
	inferProfileRole,
	reduceTuiState,
	renderAgentsPlain,
	renderAgentTui,
} from "../src/tui.js";
import type { CapabilitiesResult, IduConfig } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function makeSampleFixtures(): { capabilities: CapabilitiesResult; config: IduConfig } {
	const config: IduConfig = {
		version: "2.3.0",
		oneOrchestratorRule: { enabled: true, allowRecursiveDelegation: false },
		clis: {
			pi: { command: "pi", argsTemplate: ["--mode", "json", "-p", "{task}"] },
			kimi: { command: "kimi", argsTemplate: ["-p", "{task}"] },
			antigravity: { command: "agy", argsTemplate: ["-p", "{task}"] },
		},
		defaultTimeoutMs: 300_000,
		maxConcurrentWorkers: 4,
	};
	const capabilities: CapabilitiesResult = {
		installedClis: [
			{ name: "pi", command: "/usr/bin/pi", available: true },
			{ name: "kimi", command: "/usr/bin/kimi", available: true },
			{ name: "antigravity", command: "agy", available: false },
		],
		profiles: {
			"audit-claude": {
				harness: "antigravity",
				model: "gemini-4-argon-high",
				permissions: "read-only",
				description: "ROL AUDITORÍA (2): adversarial.",
			},
			"audit-gemini": {
				harness: "pi",
				provider: "nan",
				model: "hy4",
				permissions: "read-only",
				description: "ROL AUDITORÍA (1): principal.",
			},
			"work-3": {
				harness: "kimi",
				model: "nan/hy4",
				permissions: "workspace",
				description: "ROL TRABAJO (3º): implementador hy4.",
			},
		},
		oneOrchestratorRule: { enabled: true, allowRecursiveDelegation: false, configurable: false },
	};
	return { capabilities, config };
}

test("inferProfileRole, extractRoleRank, and buildAgentTuiSnapshot sort roles and priorities accurately", () => {
	assert.equal(inferProfileRole("x", { description: "ROL DISEÑO VISUAL (principal): UI" }), "Diseño");
	assert.equal(inferProfileRole("work-abc", {}), "Trabajo");
	assert.equal(extractRoleRank("ROL TRABAJO (3º): impl"), 3);
	assert.equal(extractRoleRank("ROL DISEÑO VISUAL (principal): foo"), 1);
	assert.equal(extractRoleRank("ROL ICONOGRAFÍA: sets SVG"), 1);
	assert.equal(extractRoleRank("", "work-4"), 4);

	const { capabilities, config } = makeSampleFixtures();
	const snap = buildAgentTuiSnapshot({
		capabilities,
		config,
		replaceDefaults: true,
		profilesPath: "/home/u/.idu/profiles.json",
		version: "2.3.0",
		activeFleet: "perfil-1",
		fleetSource: "explicit",
	});

	assert.equal(snap.agents.length, 3);
	assert.equal(snap.activeFleet, "perfil-1");
	assert.equal(snap.roles[0].role, "Todos");
	assert.equal(snap.roles[0].count, 3);
	// Trabajo appears before Auditoría in canonical ROLE_ORDER; inside Auditoría, rank 1 precedes rank 2
	assert.equal(snap.agents[0].name, "work-3");
	assert.equal(snap.agents[0].cliAvailable, true);
	assert.equal(snap.agents[1].name, "audit-gemini");
	assert.equal(snap.agents[2].name, "audit-claude");
	assert.equal(snap.agents[2].cliAvailable, false);
});

test("reduceTuiState and renderAgentTui handle navigation, role filtering, reload, editor hotkeys, and quit cleanly", () => {
	const { capabilities, config } = makeSampleFixtures();
	const snap = buildAgentTuiSnapshot({
		capabilities,
		config,
		replaceDefaults: true,
		version: "2.3.0",
		activeFleet: "perfil-20",
	});

	let state = createTuiState();
	assert.equal(getFilteredAgents(snap, state).length, 3);

	state = reduceTuiState(state, snap, { name: "down" }).state;
	assert.equal(state.selectedIndex, 1);

	// Switch to next role tab (`Trabajo`, index 1)
	state = reduceTuiState(state, snap, { name: "tab" }).state;
	assert.equal(state.roleIndex, 1);
	assert.equal(getFilteredAgents(snap, state).map((a) => a.name).join(","), "work-3");

	const wideFrame = renderAgentTui(snap, state, { width: 110, height: 30, useColor: false });
	assert.match(wideFrame, /IDU-PI v2\.3\.0/);
	assert.match(wideFrame, /Flota: perfil-20/);
	assert.match(wideFrame, /work-3/);
	assert.match(wideFrame, /Comando real:/);

	const narrowFrame = renderAgentTui(snap, state, { width: 76, height: 24, useColor: false });
	assert.match(narrowFrame, /work-3/);

	const plain = renderAgentsPlain(snap);
	assert.match(plain, /Flota: perfil-20/);
	assert.match(plain, /Agentes \(3\)/);
	assert.match(plain, /audit-gemini/);

	assert.equal(reduceTuiState(state, snap, { name: "m" }).action, "edit-model");
	assert.equal(reduceTuiState(state, snap, { name: "return" }).action, "edit-model");
	assert.equal(reduceTuiState(state, snap, { name: "e" }).action, "edit-effort");
	assert.equal(reduceTuiState(state, snap, { name: "t" }).action, "test-terminals");
	assert.equal(reduceTuiState(state, snap, { name: "c" }).action, "edit-harness");
	assert.equal(reduceTuiState(state, snap, { name: "f" }).action, "manage-fleets");
	assert.equal(reduceTuiState(state, snap, { name: "n" }).action, "create-agent");
	assert.equal(reduceTuiState(state, snap, { name: "x" }).action, "delete-agent");
	assert.equal(reduceTuiState(state, snap, { name: "u" }).action, "migrate-slots");
	assert.equal(reduceTuiState(state, snap, { name: "r" }).action, "reload");
	assert.equal(reduceTuiState(state, snap, { name: "q" }).action, "quit");
	assert.equal(reduceTuiState(state, snap, { name: "escape" }).action, "quit");
	assert.equal(reduceTuiState(state, snap, { name: "c", ctrl: true }).action, "quit");
});

test("TUI renders explicit effort, CLI config fallback effort, and inspector Esfuerzo line cleanly", () => {
	const cliHome = mkdtempSync(join(tmpdir(), "idu-tui-cli-home-"));
	try {
		mkdirSync(join(cliHome, ".pi", "agent"), { recursive: true });
		writeFileSync(join(cliHome, ".pi", "agent", "settings.json"), JSON.stringify({ defaultThinkingLevel: "medium" }), "utf8");

		const { config } = makeSampleFixtures();
		const capabilities: CapabilitiesResult = {
			installedClis: [
				{ name: "opencode", command: "opencode", available: true },
				{ name: "pi", command: "pi", available: true },
			],
			profiles: {
				"work-1": {
					harness: "opencode",
					model: "opencode-go/deepseek-v4.1-flash",
					effort: "max",
					permissions: "workspace",
					description: "ROL TRABAJO (1º): worker. opencode + opencode-go/deepseek-v4.1-flash · effort: max.",
				},
				"work-2": {
					harness: "pi",
					provider: "nan",
					model: "deepseek-v4-flash",
					permissions: "workspace",
					description: "ROL TRABAJO (2º): fast worker.",
				},
				"explore-3": {
					harness: "opencode",
					provider: "nan",
					model: "mimo-v2.6-flash#high",
					permissions: "read-only",
					description: "ROL EXPLORACIÓN (3º): explorer.",
				},
			},
			oneOrchestratorRule: { enabled: true, allowRecursiveDelegation: false, configurable: false },
		};

		const snap = buildAgentTuiSnapshot({
			capabilities,
			config,
			replaceDefaults: true,
			cliHomeDir: cliHome,
			version: "2.3.0",
			activeFleet: "default",
		});

		const state = createTuiState();
		const frame = renderAgentTui(snap, state, { width: 120, height: 32, useColor: false });
		assert.match(frame, /MAX/);
		assert.match(frame, /~med/);
		assert.match(frame, /HIGH/);
		assert.match(frame, /Esfuerzo:/);
		assert.match(frame, /e Esfuerzo/);
		assert.match(frame, /opencode-go\/deepseek-v4\.1-flash#max/);

		const plain = renderAgentsPlain(snap);
		assert.match(plain, /\[MAX\]/);
		assert.match(plain, /\[~med\]/);
		assert.match(plain, /\[HIGH\]/);
	} finally {
		rmSync(cliHome, { recursive: true, force: true });
	}
});

test("idupi binary entry renders configured agents in non-TTY --plain and --json modes using IDU_HOME", () => {
	const tmpIdu = mkdtempSync(join(tmpdir(), "idu-tui-bin-"));
	try {
		writeFileSync(
			join(tmpIdu, "profiles.json"),
			JSON.stringify({
				replaceDefaults: true,
				profiles: {
					"work-fast": {
						harness: "pi",
						provider: "nan",
						model: "deepseek-v4-flash",
						permissions: "workspace",
						description: "ROL TRABAJO (1º): fast worker",
					},
				},
			}),
			"utf8",
		);
		const binPath = join(repoRoot, "dist", "src", "idupi-bin.js");
		const plainRes = spawnSync(process.execPath, [binPath, "--plain"], {
			encoding: "utf8",
			env: { ...process.env, IDU_HOME: tmpIdu },
		});
		assert.equal(plainRes.status, 0, plainRes.stderr);
		assert.match(plainRes.stdout, /work-fast/);
		assert.match(plainRes.stdout, /nan\/deepseek-v4-flash/);

		const jsonRes = spawnSync(process.execPath, [binPath, "--json"], {
			encoding: "utf8",
			env: { ...process.env, IDU_HOME: tmpIdu },
		});
		assert.equal(jsonRes.status, 0, jsonRes.stderr);
		const parsed = JSON.parse(jsonRes.stdout) as { agents: Array<{ name: string }> };
		assert.deepEqual(
			parsed.agents.map((a) => a.name),
			["work-fast"],
		);
	} finally {
		rmSync(tmpIdu, { recursive: true, force: true });
	}
});
