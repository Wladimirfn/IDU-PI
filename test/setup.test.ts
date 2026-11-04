import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPiMcpEntry, installPiMcpConfig, resolvePiAgentDir } from "../src/setup.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "src", "cli.js");
const SERVER = join(here, "..", "src", "mcp-server.js");
const FIXED_NOW = () => new Date(2026, 10, 4, 12, 30, 0);

function withAgentDir(fn: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "idu-setup-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("mcp-init writes idu-pi into an empty agent dir", () => {
	withAgentDir((dir) => {
		const result = installPiMcpConfig({ agentDir: dir, mcpServerPath: SERVER });
		assert.equal(result.status, "installed");
		assert.equal(result.backupPath, undefined);
		const written = readJson(join(dir, "mcp.json"));
		assert.deepEqual(written.mcpServers["idu-pi"], buildPiMcpEntry(SERVER));
		assert.equal(written.mcpServers["idu-pi"].cwd, resolve(here, "..", ".."));
	});
});

test("mcp-init keeps other servers and top-level keys, and backs up first", () => {
	withAgentDir((dir) => {
		const original = { settings: { x: 1 }, mcpServers: { engram: { command: "engram", args: ["mcp"] } } };
		writeFileSync(join(dir, "mcp.json"), JSON.stringify(original));
		const result = installPiMcpConfig({ agentDir: dir, mcpServerPath: SERVER, now: FIXED_NOW });
		assert.equal(result.status, "installed");
		const written = readJson(join(dir, "mcp.json"));
		assert.deepEqual(written.settings, { x: 1 });
		assert.deepEqual(written.mcpServers.engram, original.mcpServers.engram);
		assert.ok(written.mcpServers["idu-pi"]);
		assert.equal(result.backupPath, join(dir, "mcp.backup-20261104-123000.json"));
		assert.deepEqual(readJson(result.backupPath!), original);
	});
});

test("mcp-init leaves an existing idu-pi entry alone unless --force", () => {
	withAgentDir((dir) => {
		const custom = { mcpServers: { "idu-pi": { command: "node", args: ["/elsewhere/mcp-server.js"] } } };
		writeFileSync(join(dir, "mcp.json"), JSON.stringify(custom));

		const kept = installPiMcpConfig({ agentDir: dir, mcpServerPath: SERVER });
		assert.equal(kept.status, "exists");
		assert.deepEqual(readJson(join(dir, "mcp.json")), custom);
		assert.deepEqual(readdirSync(dir), ["mcp.json"], "exists must not write a backup");

		const forced = installPiMcpConfig({ agentDir: dir, mcpServerPath: SERVER, force: true, now: FIXED_NOW });
		assert.equal(forced.status, "updated");
		assert.deepEqual(readJson(join(dir, "mcp.json")).mcpServers["idu-pi"], buildPiMcpEntry(SERVER));
		assert.deepEqual(readJson(forced.backupPath!), custom);
	});
});

test("mcp-init --dry-run writes nothing", () => {
	withAgentDir((dir) => {
		const target = join(dir, "nested");
		const result = installPiMcpConfig({ agentDir: target, mcpServerPath: SERVER, dryRun: true });
		assert.equal(result.status, "dry_run");
		assert.ok((result.config.mcpServers as Record<string, unknown>)["idu-pi"]);
		assert.equal(existsSync(target), false);
	});
});

test("mcp-init preserves an unparsable mcp.json in the backup before replacing it", () => {
	withAgentDir((dir) => {
		writeFileSync(join(dir, "mcp.json"), "{ not json");
		const result = installPiMcpConfig({ agentDir: dir, mcpServerPath: SERVER, now: FIXED_NOW });
		assert.equal(result.status, "installed");
		assert.equal(readFileSync(result.backupPath!, "utf8"), "{ not json");
		assert.ok(readJson(join(dir, "mcp.json")).mcpServers["idu-pi"]);
	});
});

test("resolvePiAgentDir honours PI_CODING_AGENT_DIR like scripts/install.mjs", () => {
	assert.equal(resolvePiAgentDir({ PI_CODING_AGENT_DIR: "/tmp/pi-x", HOME: "/home/u" }), resolve("/tmp/pi-x"));
	assert.equal(resolvePiAgentDir({ HOME: "/home/u" }), resolve("/home/u/.pi/agent"));
});

function runCli(cliArgs: string[], env: NodeJS.ProcessEnv = {}) {
	return spawnSync(process.execPath, [CLI, ...cliArgs], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		timeout: 20000,
	});
}

test("cli: an unknown command exits 1 instead of printing usage and exiting 0", () => {
	const r = runCli(["no-such-command"]);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /Comando desconocido: no-such-command/);
});

test("cli: help exits 0", () => {
	const r = runCli(["--help"]);
	assert.equal(r.status, 0);
	assert.match(r.stdout, /setup mcp-init/);
});

test("cli: `-- setup mcp-init`, exactly as scripts/install.mjs calls it, configures Pi", () => {
	withAgentDir((dir) => {
		const r = runCli(["--", "setup", "mcp-init"], { PI_CODING_AGENT_DIR: dir });
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readJson(join(dir, "mcp.json")).mcpServers["idu-pi"], buildPiMcpEntry(SERVER));
	});
});

test("cli: setup without a known subcommand exits 1", () => {
	const r = runCli(["setup", "wizard"]);
	assert.equal(r.status, 1);
});
