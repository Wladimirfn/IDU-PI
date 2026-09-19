import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import type { IduConfig, IduProfile } from "./types.js";

export interface ResolvedCommand {
	command: string;
	args: string[];
	isShell: boolean;
}

export function unwrapCmdExecutable(cmdPath: string, args: string[]): ResolvedCommand {
	if (process.platform !== "win32") {
		return { command: cmdPath, args, isShell: false };
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

			// Node script call (e.g. "%_prog%" "%dp0%\node_modules\...bundle\cli.js")
			const jsMatch = trimmedLine.match(/"(?:%dp0%|%~dp0)?\\?([^"\r\n]+\.js)"/i);
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
	const cliDef = config.clis[harness] || (harness === "antigravity" ? config.clis["agy"] : undefined);
	let command = cliDef?.command || (harness === "antigravity" ? "agy" : harness);

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
