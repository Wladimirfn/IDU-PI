import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { BridgeConfig } from "./config.js";

const execFileAsync = promisify(execFile);

type ToolStatus = {
	name: string;
	installed: boolean;
	command: string;
	version?: string;
	installHint?: string;
	error?: string;
};

async function runVersion(
	command: string,
	args = ["--version"],
): Promise<string> {
	const result = await execFileAsync(command, args, {
		timeout: 3000,
		windowsHide: true,
	});
	return (
		(result.stdout || result.stderr).trim().split(/\r?\n/u)[0] || "detectado"
	);
}

async function detectCommand(
	name: string,
	command: string,
	installHint: string,
	args = ["--version"],
): Promise<ToolStatus> {
	try {
		return {
			name,
			installed: true,
			command,
			version: await runVersion(command, args),
			installHint,
		};
	} catch (error) {
		return {
			name,
			installed: false,
			command,
			installHint,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function configuredPiCliJs(config: BridgeConfig): string | undefined {
	return config.piArgs.find((arg) => arg.endsWith("cli.js"));
}

function isNodeBinary(command: string): boolean {
	return /^node(?:\.exe)?$/iu.test(basename(command));
}

function safePiCommand(config: BridgeConfig): string {
	const piCliJs = configuredPiCliJs(config);
	return piCliJs ? `${config.piBin} ${piCliJs}` : config.piBin || "pi";
}

export async function detectAgents(
	config: BridgeConfig,
): Promise<ToolStatus[]> {
	const piCliJs = configuredPiCliJs(config);
	let piStatus: ToolStatus;
	if (piCliJs) {
		piStatus = {
			name: "Pi",
			installed: existsSync(piCliJs),
			command: safePiCommand(config),
			version: existsSync(piCliJs) ? "CLI JS encontrado" : undefined,
			installHint: "npm install -g @earendil-works/pi-coding-agent",
			error: existsSync(piCliJs)
				? undefined
				: `No existe PI_CLI_JS: ${piCliJs}`,
		};
	} else if (isNodeBinary(config.piBin)) {
		piStatus = {
			name: "Pi",
			installed: false,
			command: "node <PI_CLI_JS>",
			installHint: "npm install -g @earendil-works/pi-coding-agent",
			error: "PI_BIN=node requiere PI_CLI_JS apuntando al cli.js de Pi.",
		};
	} else {
		piStatus = await detectCommand(
			"Pi",
			config.piBin || "pi",
			"npm install -g @earendil-works/pi-coding-agent",
		);
	}

	const opencode = await detectCommand(
		"OpenCode",
		"opencode",
		"pnpm add -g opencode-ai",
	);

	return [piStatus, opencode];
}

export function formatAgents(statuses: ToolStatus[]): string {
	return statuses
		.map((status) => {
			const marker = status.installed ? "✅" : "❌";
			const lines = [
				`${marker} ${status.name}`,
				`   comando: ${status.command}`,
			];
			if (status.version) lines.push(`   estado: ${status.version}`);
			if (!status.installed) lines.push(`   instalar: ${status.installHint}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

export async function formatDoctor(
	config: BridgeConfig,
	currentCwd: string,
): Promise<string> {
	const agents = await detectAgents(config);
	const roots = config.allowedRoots.map((root) => `- ${root}`).join("\n");
	const profiles = config.agentProfiles
		.map((profile, index) => `${index + 1}. ${profile.label} (${profile.id})`)
		.join("\n");
	return `Doctor bridge:\n\nConfiguración:\n- TELEGRAM_BOT_TOKEN: configurado, oculto\n- ALLOWED_USER_ID: ${config.allowedUserId}\n- DEFAULT/RPC CWD actual: ${currentCwd}\n- ALLOWED_ROOTS:\n${roots}\n- Pi launch: ${safePiCommand(config)} --mode rpc (+ flags extra ocultos)\n\nPerfiles Pi configurados:\n${profiles}\n\nAgentes:\n${formatAgents(agents)}\n\nSiguiente:\n- Si Pi figura OK, podés usar prompts normales.\n- Si OpenCode falta, instalalo solo cuando definamos integración multi-agent.`;
}
