import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import type { IduConfig, IduProfile } from "./types.js";

export interface ResolvedCommand {
	command: string;
	args: string[];
	isShell: boolean;
}

/**
 * Locate a bare Windows command name on PATH, preferring the .cmd shim that
 * npm installs. Returns null when nothing is found, so callers can fall back
 * to their previous behaviour. Never throws.
 */
function resolveWindowsShim(cmdPath: string): string | null {
	if (process.platform !== "win32" || cmdPath.includes("/") || cmdPath.includes("\\")) {
		return null;
	}
	try {
		const bare = `${cmdPath}.cmd`;
		const bat = `${cmdPath}.bat`;
		const out = execSync(`where ${bare}`, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (out.length > 0 && existsSync(out[0])) return out[0];
		const outBat = execSync(`where ${bat}`, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (outBat.length > 0 && existsSync(outBat[0])) return outBat[0];
	} catch {
		// not on PATH as a shim; caller decides what to do
	}
	return null;
}

export function unwrapCmdExecutable(cmdPath: string, args: string[]): ResolvedCommand {
	if (process.platform !== "win32") {
		return { command: cmdPath, args, isShell: false };
	}

	// A bare command name ("mcode", "claude") is not spawnable on Windows:
	// npm installs these as .cmd shims, and spawn without a shell fails with
	// ENOENT. If the bare name has no extension and is not directly
	// executable, try the PATH shims before giving up. This keeps a default
	// config working out of the box instead of requiring every user to
	// hand-write absolute .cmd paths into ~/.idu/config.json.
	const hasExtension = /\.[a-z0-9]+$/i.test(cmdPath);
	if (!hasExtension && !existsSync(cmdPath)) {
		const resolved = resolveWindowsShim(cmdPath);
		if (resolved) {
			return unwrapCmdExecutable(resolved, args);
		}
	}

	const isCmd = cmdPath.toLowerCase().endsWith(".cmd") || cmdPath.toLowerCase().endsWith(".bat");
	if (!isCmd) {
		return { command: cmdPath, args, isShell: false };
	}

	if (!existsSync(cmdPath)) {
		return { command: cmdPath, args, isShell: true };
	}

	try {
		const content = readFileSync(cmdPath, "utf8");
		const dp0 = dirname(cmdPath);

		// 1. Check for nested .cmd or .bat calls (e.g. wrapper calling npm .cmd)
		const nestedMatch = content.match(/"([^"\r\n]+\.(?:cmd|bat))"/i);
		if (nestedMatch && existsSync(nestedMatch[1])) {
			return unwrapCmdExecutable(nestedMatch[1], args);
		}

		// 2. Scan lines in reverse for the actual invocation line (ignoring IF/SET/REM guard lines)
		for (const line of content.split(/\r?\n/).reverse()) {
			const trimmedLine = line.trim();
			if (/^(?:IF|SET|REM|::|@|GOTO)/i.test(trimmedLine)) continue;

			// Direct binary .exe call with optional prefix arguments (e.g. "path\to.exe" agentapi %*)
			const exeMatch = trimmedLine.match(/"(?:%dp0%|%~dp0)?\\?([^"\r\n]+\.exe)"(?:\s+([^%\r\n]+))?/i);
			if (exeMatch) {
				const target = resolve(dp0, exeMatch[1]);
				if (existsSync(target)) {
					const extraArgs = exeMatch[2] ? exeMatch[2].trim().split(/\s+/).filter(Boolean) : [];
					return { command: target, args: [...extraArgs, ...args], isShell: false };
				}
			}

			// Node script call (e.g. "%_prog%" "%dp0%\node_modules\...bundle\cli.js"), including ES
			// module entry points (`.mjs`/`.cjs`, e.g. Command Code's `dist\index.mjs`).
			const jsMatch = trimmedLine.match(/"(?:%dp0%|%~dp0)?\\?([^"\r\n]+\.[cm]?js)"/i);
			if (jsMatch) {
				const target = resolve(dp0, jsMatch[1]);
				if (existsSync(target)) {
					return { command: process.execPath, args: [target, ...args], isShell: false };
				}
			}
		}
	} catch {
		// Fallback to spawning via shell
	}

	return { command: cmdPath, args, isShell: true };
}

export interface BuiltCommandLine {
	command: string;
	args: string[];
}

export interface BuildWorkerArgsOptions {
	sessionId?: string;
	parentSessionId?: string;
	nativeSessionId?: string;
	parentNativeSessionId?: string;
	isResumed?: boolean;
	fork?: boolean;
}

function hasWorkspacePermissions(profile: IduProfile): boolean {
	return profile.permissions === "workspace";
}
export function buildWorkerArgs(
	profile: IduProfile,
	task: string,
	contextFiles: string[] = [],
	config: IduConfig,
	sessionOptions: BuildWorkerArgsOptions = {},
): BuiltCommandLine {
	const harness = profile.harness.toLowerCase();
	const cliDef =
		config.clis[harness] ||
		(harness === "antigravity" ? config.clis["agy"] : undefined) ||
		(harness === "cmdc" ? config.clis["commandcode"] : undefined) ||
		(harness === "commandcode" ? config.clis["cmdc"] : undefined);
	let command =
		cliDef?.command ||
		(harness === "antigravity" ? "agy" : harness === "commandcode" ? "cmdc" : harness);

	if ((command === "agy" || command === "antigravity") && !checkCliAvailable(command)) {
		const localAgy = join(process.env.LOCALAPPDATA || "", "agy", "bin", process.platform === "win32" ? "agy.exe" : "agy");
		if (existsSync(localAgy)) {
			command = localAgy;
		}
	}

	let fullMessage = task;
	if (contextFiles.length > 0) {
		fullMessage += `\n\nContext Files to review:\n${contextFiles.map((f) => `- ${f}`).join("\n")}`;
	}

	const args: string[] = [];
	const sessionId = sessionOptions.sessionId?.trim();
	const parentSessionId = sessionOptions.parentSessionId?.trim();

	switch (harness) {
		case "claude":
		case "claude-code": {
			if (profile.model) {
				args.push("--model", profile.model);
			}
			args.push(
				"--output-format", "stream-json",
				"--verbose",
			);
			if (hasWorkspacePermissions(profile)) {
				args.push("--permission-mode", "bypassPermissions");
			}

			// Claude Code Session Handling:
			// Turn 1 (new): --session-id <uuid>
			// Turn 2+ (resume): --resume <uuid>
			// Fork: --resume <parentSessionId> --fork-session --session-id <newSessionId>
			if (sessionOptions.fork && parentSessionId) {
				args.push("--resume", parentSessionId, "--fork-session");
				if (sessionId) {
					args.push("--session-id", sessionId);
				}
			} else if (sessionId) {
				if (sessionOptions.isResumed) {
					args.push("--resume", sessionId);
				} else {
					args.push("--session-id", sessionId);
				}
			}

			args.push("-p", fullMessage);
			break;
		}

		case "opencode": {
			const autoArgs = hasWorkspacePermissions(profile) ? ["--auto"] : [];
			args.push("run", "--format", "json", ...autoArgs);
			if (profile.model) {
				const fullModel = profile.provider ? `${profile.provider}/${profile.model}` : profile.model;
				args.push("--model", fullModel);
			}

			// OpenCode Session Handling:
			// Turn 1: do NOT pass --session (prevents "Session not found" error)
			// Fork: --session <parentNativeSessionId || parentSessionId> --fork
			// Turn 2+ (resume): --session <nativeSessionId || sessionId>
			const targetParent = sessionOptions.parentNativeSessionId || parentSessionId;
			const targetSession = sessionOptions.nativeSessionId || sessionId;
			if (sessionOptions.fork && targetParent) {
				args.push("--session", targetParent, "--fork");
			} else if (targetSession && sessionOptions.isResumed) {
				args.push("--session", targetSession);
			}

			args.push(fullMessage);
			break;
		}

		case "pi":
		case "pi-cli": {
			if (profile.provider) {
				args.push("--provider", profile.provider);
			}
			if (profile.model) {
				args.push("--model", profile.model);
			}

			// Pi Session Handling:
			// Fork: --fork <parentSessionId>
			// Turn 1 (new): --session-id <sessionId>
			// Turn 2+ (resume): --session <sessionId>
			if (sessionOptions.fork && parentSessionId) {
				args.push("--fork", parentSessionId);
			} else if (sessionId) {
				if (sessionOptions.isResumed) {
					args.push("--session", sessionId);
				} else {
					args.push("--session-id", sessionId);
				}
			}

			args.push("-p", fullMessage);
			break;
		}

		case "codex": {
			args.push("exec");
			if (sessionOptions.fork && parentSessionId) {
				args.push("fork", parentSessionId);
			} else if (sessionOptions.isResumed && sessionId) {
				args.push("resume", sessionId);
			}
			args.push("--json");
			if (hasWorkspacePermissions(profile)) {
				args.push("--dangerously-bypass-approvals-and-sandbox");
			}
			if (profile.model) {
				args.push("-m", profile.model);
			}
			args.push(fullMessage);
			break;
		}

		case "kimi":
		case "kimi-code": {
			if (profile.model) {
				args.push("-m", profile.model);
			}
			if (hasWorkspacePermissions(profile)) {
				args.push("--auto");
			}
			if (sessionId) {
				args.push("-S", sessionId);
			}
			args.push("-p", fullMessage);
			break;
		}

		case "qwen":
		case "qwen-code": {
			if (profile.model) {
				args.push("-m", profile.model);
			}
			if (hasWorkspacePermissions(profile)) {
				args.push("-y");
			}
			if (sessionOptions.isResumed && sessionId) {
				args.push("-r", sessionId);
			} else if (sessionId) {
				args.push("--session-id", sessionId);
			}
			args.push("-p", fullMessage);
			break;
		}

		case "antigravity":
		case "agy": {
			if (profile.model) {
				let model = profile.model;
				if (model === "flash") model = "gemini-3.8-flash-high";
				else if (model === "pro") model = "gemini-3.1-pro-high";
				args.push("--model", model);
			}
			args.push("--output-format", "stream-json");
			if (hasWorkspacePermissions(profile)) {
				args.push("--dangerously-skip-permissions");
			}
			const targetSession = sessionOptions.nativeSessionId || sessionId;
			if (sessionOptions.isResumed && targetSession) {
				args.push("--conversation", targetSession);
			}
			args.push("-p", fullMessage);
			break;
		}

		case "commandcode":
		case "cmdc": {
			if (profile.model) {
				args.push("-m", profile.model);
			}
			args.push("--output-format", "json");
			if (hasWorkspacePermissions(profile)) {
				args.push("--yolo");
			}
			args.push("--skip-onboarding");

			// Command Code Session Handling:
			// Turn 1: do not pass --session (starts fresh session)
			// Fork: --session <targetParent> --fork-session
			// Turn 2+ (resume): --session <targetSession>
			// Note: cmdc throws if passed an unknown session ID (requires real transcript/id prefix).
			// If nativeSessionId is not available, we do NOT pass --session (safe degraded fresh session).
			const targetParent = sessionOptions.parentNativeSessionId;
			const targetSession = sessionOptions.nativeSessionId;
			if (sessionOptions.fork && targetParent) {
				args.push("--session", targetParent, "--fork-session");
			} else if (sessionOptions.isResumed && targetSession) {
				args.push("--session", targetSession);
			}

			args.push("-p", fullMessage);
			break;
		}

		case "mcode":
		case "minimax-code": {
			args.push("exec");
			args.push("--output-format", "json");

			// mcode --permission accepts smart | full | off. The default is
			// "smart", which asks for interactive confirmation and therefore
			// HANGS a detached worker until the harness kills it. Always pass
			// the policy explicitly: full for implementers, off for readers.
			args.push("--permission", hasWorkspacePermissions(profile) ? "full" : "off");

			if (profile.model) {
				const fullModel = profile.provider ? `${profile.provider}/${profile.model}` : profile.model;
				args.push("--model", fullModel);
			}

			// minimax Code Session Handling:
			// Turn 1: do NOT pass --session (lets the CLI mint a fresh session).
			// Turn 2+ (resume): --session <targetSession>
			// Fork: mcode exec has no fork flag, so a fork degrades to a
			// fresh session rather than branching the parent's history.
			const targetSession = sessionOptions.nativeSessionId || sessionId;
			if (!sessionOptions.fork && sessionOptions.isResumed && targetSession) {
				args.push("--session", targetSession);
			}

			args.push(fullMessage);
			break;
		}

		default: {
			// Generic CLI template fallback
			if (cliDef?.argsTemplate) {
				for (const t of cliDef.argsTemplate) {
					if (t === "{task}") {
						args.push(fullMessage);
					} else {
						args.push(t);
					}
				}
			} else {
				args.push(fullMessage);
			}
			break;
		}
	}

	return { command, args };
}

export function checkCliAvailable(command: string): boolean {
	if (!command) return false;
	if (existsSync(command)) return true;
	try {
		const whichCmd = process.platform === "win32" ? "where" : "which";
		execSync(`${whichCmd} ${command}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
