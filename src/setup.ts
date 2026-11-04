/**
 * setup.ts — writes the idu-pi entry into Pi's MCP config (`~/.pi/agent/mcp.json`).
 *
 * `scripts/install.mjs` has called `cli.js setup mcp-init` since before v2.1.0. The
 * v2.1.0 rewrite (4f58c8d) archived the old setup module and nothing replaced it: the
 * CLI printed its usage, exited 0, and the installer reported success without
 * configuring anything. This restores the MCP half of the old command with the same
 * contract: merge without clobbering other servers, back up before writing, keep an
 * existing idu-pi entry unless --force, and --dry-run writes nothing.
 *
 * The old command also installed `.pi/extensions/idu-pi-commands.ts`. That extension
 * only registers /idu and /idu-off, which call CLI commands removed with the
 * supervisor plan, so it is deliberately not installed here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface PiMcpServerEntry {
	command: string;
	args: string[];
	cwd: string;
	lifecycle: "lazy";
	directTools: true;
}

export interface McpInitOptions {
	agentDir: string;
	mcpServerPath: string;
	force?: boolean;
	dryRun?: boolean;
	now?: () => Date;
}

export type McpInitStatus = "installed" | "updated" | "exists" | "dry_run";

export interface McpInitResult {
	status: McpInitStatus;
	mcpConfigPath: string;
	backupPath?: string;
	/** The config that was written, or would be written on dry-run, or is kept on exists. */
	config: Record<string, unknown>;
	summary: string;
}

/** Same resolution as scripts/install.mjs: PI_CODING_AGENT_DIR, else ~/.pi/agent. */
export function resolvePiAgentDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.PI_CODING_AGENT_DIR?.trim();
	const home = env.USERPROFILE || env.HOME || homedir();
	return resolve(override || join(home, ".pi", "agent"));
}

export function buildPiMcpEntry(mcpServerPath: string): PiMcpServerEntry {
	const serverPath = resolve(mcpServerPath);
	return {
		command: "node",
		args: [serverPath],
		// dist/src/mcp-server.js -> package root
		cwd: resolve(dirname(serverPath), "..", ".."),
		lifecycle: "lazy",
		directTools: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads mcp.json. A missing or unparsable file reads as empty; the caller backs it up before writing. */
function readMcpConfig(path: string): { config: Record<string, unknown>; servers: Record<string, unknown> } {
	if (!existsSync(path)) return { config: {}, servers: {} };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isRecord(parsed)) {
			return { config: parsed, servers: isRecord(parsed.mcpServers) ? parsed.mcpServers : {} };
		}
	} catch {
		// fall through: an invalid file is preserved by the backup, then replaced
	}
	return { config: {}, servers: {} };
}

function timestamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function installPiMcpConfig(options: McpInitOptions): McpInitResult {
	const agentDir = resolve(options.agentDir);
	const mcpConfigPath = join(agentDir, "mcp.json");
	const { config: existing, servers } = readMcpConfig(mcpConfigPath);
	const entry = buildPiMcpEntry(options.mcpServerPath);
	const hadEntry = Object.hasOwn(servers, "idu-pi");

	if (hadEntry && !options.force) {
		return {
			status: "exists",
			mcpConfigPath,
			config: existing,
			summary: `idu-pi ya está en ${mcpConfigPath}; no lo toqué (usa --force para reemplazarlo).`,
		};
	}

	const next = { ...existing, mcpServers: { ...servers, "idu-pi": entry } };
	if (options.dryRun) {
		return {
			status: "dry_run",
			mcpConfigPath,
			config: next,
			summary: `Dry-run: escribiría idu-pi en ${mcpConfigPath}. No escribí nada.`,
		};
	}

	mkdirSync(agentDir, { recursive: true });
	let backupPath: string | undefined;
	if (existsSync(mcpConfigPath)) {
		const now = options.now ?? (() => new Date());
		backupPath = join(agentDir, `mcp.backup-${timestamp(now())}.json`);
		writeFileSync(backupPath, readFileSync(mcpConfigPath, "utf8"), "utf8");
	}
	writeFileSync(mcpConfigPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return {
		status: hadEntry ? "updated" : "installed",
		mcpConfigPath,
		backupPath,
		config: next,
		summary: `${hadEntry ? "Reemplacé" : "Agregué"} idu-pi en ${mcpConfigPath}${backupPath ? ` (backup: ${backupPath})` : ""}.`,
	};
}
