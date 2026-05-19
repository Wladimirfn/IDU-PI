import { config as loadDotenv } from "dotenv";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

loadDotenv();

export type AgentProfile = {
	id: string;
	label: string;
	provider: "pi";
	piArgs: string[];
};

export type AgentWorkspaceMode = "direct" | "clone";

export type BridgeConfig = {
	telegramBotToken: string;
	allowedUserId: number;
	defaultCwd: string;
	allowedRoots: string[];
	piBin: string;
	piArgs: string[];
	agentProfiles: AgentProfile[];
	agentWorkspaceRoot: string;
	agentWorkspaceMode: AgentWorkspaceMode;
};

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

function parseRequiredPositiveInteger(name: string): number {
	const raw = required(name);
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0)
		throw new Error(`Env var ${name} must be a positive integer`);
	return value;
}

function normalizeForCompare(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function splitArgs(input: string): string[] {
	return input.trim().split(/\s+/u).filter(Boolean);
}

export function parseAgentProfiles(raw?: string): AgentProfile[] {
	const source = raw?.trim();
	if (!source) {
		return [{ id: "default", label: "Pi default", provider: "pi", piArgs: [] }];
	}

	const seen = new Set<string>();
	return source.split(";").map((entry) => {
		const [rawId, rawLabel, rawArgs = ""] = entry.split("|");
		const id = rawId?.trim();
		if (!id || !/^[a-z0-9_-]+$/iu.test(id))
			throw new Error(`Invalid PI_AGENT_PROFILES id: ${rawId ?? ""}`);
		if (seen.has(id)) throw new Error(`Duplicate PI_AGENT_PROFILES id: ${id}`);
		seen.add(id);
		return {
			id,
			label: rawLabel?.trim() || id,
			provider: "pi",
			piArgs: splitArgs(rawArgs),
		};
	});
}

export function canonicalDirectory(path: string): string {
	const resolved = resolve(path);
	const stat = statSync(resolved);
	if (!stat.isDirectory())
		throw new Error(`Path is not a directory: ${resolved}`);
	return realpathSync.native(resolved);
}

function ensureDirectory(path: string): string {
	const resolved = resolve(path);
	if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true });
	return canonicalDirectory(resolved);
}

function parseWorkspaceMode(raw?: string): AgentWorkspaceMode {
	const value = raw?.trim().toLowerCase() || "clone";
	if (value === "direct" || value === "clone") return value;
	throw new Error("AGENT_WORKSPACE_MODE must be direct or clone");
}

export function loadConfig(): BridgeConfig {
	const defaultCwd = canonicalDirectory(required("DEFAULT_CWD"));
	const allowedRootsRaw = process.env.ALLOWED_ROOTS?.trim();
	const allowedRoots = (
		allowedRootsRaw ? allowedRootsRaw.split(";") : [defaultCwd]
	)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => canonicalDirectory(entry));

	if (!isAllowedCwd(defaultCwd, allowedRoots)) {
		throw new Error(`DEFAULT_CWD must be inside ALLOWED_ROOTS: ${defaultCwd}`);
	}

	const piCliJs = process.env.PI_CLI_JS?.trim();
	const piExtraArgs = splitArgs(
		process.env.PI_EXTRA_ARGS?.trim() || "--no-skill-registry --no-lens",
	);

	return {
		telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
		allowedUserId: parseRequiredPositiveInteger("ALLOWED_USER_ID"),
		defaultCwd,
		allowedRoots,
		piBin: process.env.PI_BIN?.trim() || (piCliJs ? "node" : "pi"),
		piArgs: [...(piCliJs ? [piCliJs] : []), ...piExtraArgs],
		agentProfiles: parseAgentProfiles(process.env.PI_AGENT_PROFILES),
		agentWorkspaceRoot: ensureDirectory(
			process.env.AGENT_WORKSPACE_ROOT?.trim() ||
				join(homedir(), "Documents", "bridge-agents"),
		),
		agentWorkspaceMode: parseWorkspaceMode(process.env.AGENT_WORKSPACE_MODE),
	};
}

export function isAllowedCwd(
	candidate: string,
	allowedRoots: string[],
): boolean {
	let canonicalCandidate: string;
	try {
		canonicalCandidate = canonicalDirectory(candidate);
	} catch {
		return false;
	}

	const normalizedCandidate = normalizeForCompare(canonicalCandidate);
	return allowedRoots.some((root) => {
		let canonicalRoot: string;
		try {
			canonicalRoot = canonicalDirectory(root);
		} catch {
			return false;
		}

		const normalizedRoot = normalizeForCompare(canonicalRoot);
		const relativePath = relative(normalizedRoot, normalizedCandidate);
		return (
			relativePath === "" ||
			(!relativePath.startsWith("..") && !isAbsolute(relativePath))
		);
	});
}
