import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NAN_BASE_URL = "https://api.nan.builders/v1";

export interface ResolveNanKeyOptions {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
}

/**
 * Resolves the Nan API key purely in memory from `NAN_API_KEY` or configured
 * local CLI credential stores. Never persists secrets to disk or logs.
 */
export function resolveNanApiKey(options: ResolveNanKeyOptions = {}): string | null {
	const env = options.env ?? process.env;
	if (env.NAN_API_KEY?.trim()) {
		return env.NAN_API_KEY.trim();
	}

	const home = options.homeDir ?? homedir();

	const piAuthPath = join(home, ".pi", "agent", "auth.json");
	if (existsSync(piAuthPath)) {
		try {
			const piAuth = JSON.parse(readFileSync(piAuthPath, "utf8")) as Record<string, { key?: string; apiKey?: string }>;
			const k = piAuth.nan?.key || piAuth.nan?.apiKey;
			if (typeof k === "string" && k.trim()) return k.trim();
		} catch {
			// ignore parse/read error and try next credential store
		}
	}

	const minimaxPath = join(home, ".minimax", "config.yaml");
	if (existsSync(minimaxPath)) {
		try {
			const raw = readFileSync(minimaxPath, "utf8");
			const match = raw.match(/baseURL:\s*https:\/\/api\.nan\.builders\/v1[\s\S]{0,400}?apiKey:\s*([^\r\n]+)/);
			if (match?.[1]?.trim()) return match[1].trim().replace(/^['"]|['"]$/g, "");
		} catch {
			// ignore
		}
	}

	const kimiPath = join(home, ".kimi-code", "config.toml");
	if (existsSync(kimiPath)) {
		try {
			const raw = readFileSync(kimiPath, "utf8");
			const match = raw.match(/\[providers\.nan\][\s\S]{0,400}?api_key\s*=\s*"([^"]+)"/);
			if (match?.[1]?.trim()) return match[1].trim();
		} catch {
			// ignore
		}
	}

	const cmdcAuthPath = join(home, ".commandcode", "auth.json");
	if (existsSync(cmdcAuthPath)) {
		try {
			const cmdcAuth = JSON.parse(readFileSync(cmdcAuthPath, "utf8")) as Record<string, { key?: string; apiKey?: string }>;
			const k = cmdcAuth.nan?.key || cmdcAuth.nan?.apiKey;
			if (typeof k === "string" && k.trim()) return k.trim();
		} catch {
			// ignore
		}
	}

	return null;
}
