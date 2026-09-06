import {
	existsSync,
	copyFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type EnvDraft = {
	lines: string[];
	values: Record<string, string>;
};

export type BridgeEnvStatusInput = {
	envPath: string;
	exists: boolean;
	values: Record<string, string | undefined>;
	packageRoot: string;
	startScriptExists: boolean;
	stopScriptExists: boolean;
	logPath: string;
	logExists: boolean;
	bridgeStatus?: string;
};

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;

export function packageEnvPath(packageRoot: string): string {
	return process.env.IDU_PI_ENV_PATH?.trim() || join(packageRoot, ".env");
}

export function readEnvDraft(path: string): EnvDraft {
	if (!existsSync(path)) return { lines: [], values: {} };
	const lines = readFileSync(path, "utf8").replace(/\r\n/gu, "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	const values: Record<string, string> = {};
	for (const line of lines) {
		const match = line.match(ENV_LINE);
		if (match) values[match[1]] = match[2] ?? "";
	}
	return { lines, values };
}

export function maskSecret(value?: string): string {
	const secret = value?.trim() ?? "";
	if (!secret) return "(missing)";
	if (secret.length <= 8) return "*".repeat(secret.length);
	return `${secret.slice(0, 4)}${"*".repeat(Math.max(4, secret.length - 8))}${secret.slice(-4)}`;
}

export function validateBridgeEnvDraft(
	values: Record<string, string | undefined>,
): string[] {
	const errors: string[] = [];
	if (!values.TELEGRAM_BOT_TOKEN?.trim())
		errors.push("TELEGRAM_BOT_TOKEN requerido");
	const userId = Number(values.ALLOWED_USER_ID?.trim());
	if (!Number.isInteger(userId) || userId <= 0)
		errors.push("ALLOWED_USER_ID debe ser entero positivo");
	return errors;
}

export function writeEnvDraftWithBackup(
	path: string,
	draft: EnvDraft,
	updates: Record<string, string>,
): { path: string; backupPath?: string } {
	mkdirSync(dirname(path), { recursive: true });
	const originalExists = existsSync(path);
	const backupPath = originalExists
		? `${path}.backup-${timestamp()}`
		: undefined;
	if (backupPath) copyFileSync(path, backupPath);
	const seen = new Set<string>();
	const lines = draft.lines.map((line) => {
		const match = line.match(ENV_LINE);
		if (!match) return line;
		const key = match[1];
		if (!(key in updates)) return line;
		seen.add(key);
		return `${key}=${updates[key] ?? ""}`;
	});
	for (const [key, value] of Object.entries(updates)) {
		if (!seen.has(key)) lines.push(`${key}=${value}`);
	}
	writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
	return { path, ...(backupPath ? { backupPath } : {}) };
}

export function formatBridgeEnvStatus(input: BridgeEnvStatusInput): string {
	return [
		"Telegram remoto",
		"",
		"Telegram replica el CLI/supervisor en remoto; no es otro core.",
		`package root: ${input.packageRoot}`,
		`env: ${input.exists ? "presente" : "ausente"} (${input.envPath})`,
		`TELEGRAM_BOT_TOKEN: ${maskSecret(input.values.TELEGRAM_BOT_TOKEN)}`,
		`ALLOWED_USER_ID: ${input.values.ALLOWED_USER_ID?.trim() ? "presente" : "ausente"}`,
		`start script: ${input.startScriptExists ? "presente" : "ausente"}`,
		`stop script: ${input.stopScriptExists ? "presente" : "ausente"}`,
		`logs: ${input.logExists ? "presente" : "ausente"} (${input.logPath})`,
		`bridge: ${input.bridgeStatus ?? "unknown"}`,
	].join("\n");
}

export function tailTextFile(path: string, maxLines = 80): string {
	if (!existsSync(path)) return `No existe log: ${path}`;
	const lines = readFileSync(path, "utf8").replace(/\r\n/gu, "\n").split("\n");
	return (
		lines
			.slice(Math.max(0, lines.length - maxLines))
			.join("\n")
			.trim() || "(log vacío)"
	);
}

function timestamp(): string {
	return new Date()
		.toISOString()
		.replace(/[-:T.]/gu, "")
		.slice(0, 14);
}
