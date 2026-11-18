import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { formatModelForOpenCode, resolveHarnessEffortArg, stripEffortVariantSuffix } from "./effort.js";
import { NAN_BASE_URL } from "./nan-auth.js";
import type { IduConfig, IduProfile } from "./types.js";
import { isUuid } from "./session-ids.js";
import { canonicalHarnessName } from "./session-policy.js";

export interface ResolvedCommand {
	command: string;
	args: string[];
	/**
	 * Always false. A shell would interpret task text and config-supplied values,
	 * which are never escaped. A .cmd/.bat shim is resolved to a real executable
	 * or refused instead of being handed to a shell.
	 */
	isShell: false;
}

/**
 * Locate a bare Windows command name on PATH, preferring the .cmd shim that
 * npm installs. Returns null when nothing is found, so callers can fall back
 * to their previous behaviour. Never throws.
 */
export function resolveWindowsShim(cmdPath: string): string | null {
	if (process.platform !== "win32" || cmdPath.includes("/") || cmdPath.includes("\\")) {
		return null;
	}
	// Each lookup has to tolerate "not found" on its own. `where` exits non-zero
	// for a missing name, and letting that propagate skipped the .bat fallback
	// entirely, so a .bat-only install was never resolved.
	const lookup = (fileName: string): string | null => {
		try {
			const out = execFileSync("where", [fileName], { stdio: ["ignore", "pipe", "ignore"] })
				.toString()
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			return out.length > 0 && existsSync(out[0]) ? out[0] : null;
		} catch {
			return null;
		}
	};
	return lookup(`${cmdPath}.cmd`) ?? lookup(`${cmdPath}.bat`);
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
		// Nothing to execute. Let the spawn fail with ENOENT instead of handing
		// the missing name and its arguments to a shell.
		return { command: cmdPath, args, isShell: false };
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

	throw new Error(
		`Cannot safely execute "${cmdPath}": it is a .cmd/.bat shim whose target could not be resolved. ` +
			`Running it through a shell would let task text and config values be interpreted as commands. ` +
			`Point the CLI entry in ~/.idu/config.json at a real executable, or at a script it can run directly.`,
	);
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
	const rawHarness = profile.harness.trim().toLowerCase();
	const harness = canonicalHarnessName(rawHarness);
	const cliDef =
		config.clis[harness] ||
		config.clis[rawHarness] ||
		(harness === "antigravity" ? config.clis["agy"] : undefined) ||
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
	const effortRes = resolveHarnessEffortArg(harness, profile.effort);
	const normalizeNonOpenCodeModel = (rawModel: string): string =>
		profile.effort ? stripEffortVariantSuffix(rawModel).model : rawModel;

	switch (harness) {
		case "claude":
		case "claude-code": {
			if (profile.model) {
				args.push("--model", normalizeNonOpenCodeModel(profile.model));
			}
			if (effortRes.args.length > 0) {
				args.push(...effortRes.args);
			}
			args.push(
				"--output-format", "stream-json",
				"--verbose",
			);
			if (hasWorkspacePermissions(profile)) {
				args.push("--permission-mode", "bypassPermissions");
			} else {
				args.push("--permission-mode", "plan");
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
				args.push("--model", formatModelForOpenCode(fullModel, profile.effort));
			}

			// OpenCode Session Handling:
			// Turn 1: do NOT pass --session (prevents "Session not found" error)
			// Fork: --session <parentNativeSessionId || parentSessionId> --fork
			// Turn 2+ (resume): --session <nativeSessionId || sessionId>
			// OpenCode v2.3+ rejects `--session` IDs not starting with "ses" via Zod.
			const rawParent = sessionOptions.parentNativeSessionId || parentSessionId;
			const targetParent = rawParent && rawParent.startsWith("ses") ? rawParent : undefined;
			const rawSession = sessionOptions.nativeSessionId || sessionId;
			const targetSession = rawSession && rawSession.startsWith("ses") ? rawSession : undefined;
			if (sessionOptions.fork && targetParent) {
				args.push("--session", targetParent, "--fork");
			} else if (targetSession && sessionOptions.isResumed) {
				args.push("--session", targetSession);
			}

			args.push(fullMessage);
			break;
		}

		case "pi":
		case "pi-cli":
		case "gentle-shell": {
			args.push("--mode", "json");
			if (!hasWorkspacePermissions(profile)) {
				args.push("--tools", "read,grep,find,ls");
			}
			if (profile.provider) {
				args.push("--provider", profile.provider);
			}
			if (profile.model) {
				args.push("--model", normalizeNonOpenCodeModel(profile.model));
			}
			if (effortRes.args.length > 0) {
				args.push(...effortRes.args);
			}

			// Pi Session Handling:
			// Fork: --fork <targetParent>
			// Turn 1 (new): --session-id <sessionId>
			// Turn 2+ (resume): --session <targetSession>
			const targetParent = sessionOptions.parentNativeSessionId || parentSessionId;
			const targetSession = sessionOptions.nativeSessionId || sessionId;
			if (sessionOptions.fork && targetParent) {
				args.push("--fork", targetParent);
			} else if (sessionOptions.isResumed && targetSession) {
				args.push("--session", targetSession);
			} else if (sessionId) {
				args.push("--session-id", sessionId);
			}

			args.push("-p", fullMessage);
			break;
		}

		case "codex": {
			const targetParent = sessionOptions.parentNativeSessionId || parentSessionId;
			const targetSession = sessionOptions.nativeSessionId || sessionId;
			const isFork = Boolean(sessionOptions.fork && targetParent);
			const isResume = !isFork && Boolean(sessionOptions.isResumed && targetSession);
			args.push("exec");
			if (isFork) {
				args.push("fork", targetParent!);
			} else if (isResume) {
				args.push("resume", targetSession!);
			}
			args.push("--json", "--skip-git-repo-check");
			if (hasWorkspacePermissions(profile)) {
				args.push("--dangerously-bypass-approvals-and-sandbox");
			} else if (!isFork && !isResume) {
				// `codex exec resume/fork` do not accept `-s`; only initial `exec` takes it.
				args.push("-s", "read-only");
			}
			if (profile.provider === "nan") {
				args.push(
					"-c",
					`model_providers.nan={name="Nan",base_url="${NAN_BASE_URL}",env_key="NAN_API_KEY",wire_api="responses"}`,
					"-c",
					'model_provider="nan"',
				);
			}
			if (effortRes.args.length > 0) {
				args.push(...effortRes.args);
			}
			if (profile.model) {
				args.push("-m", normalizeNonOpenCodeModel(profile.model));
			}
			args.push(fullMessage);
			break;
		}

		case "kimi":
		case "kimi-code": {
			if (profile.model) {
				args.push("-m", normalizeNonOpenCodeModel(profile.model));
			}
			// `kimi 0.29.x` rejects combining `-p` with `--auto`, `--plan`, or `--yolo`.
			args.push("--output-format", "stream-json");
			// `-S <id>` fails on Turn 1 if the session does not already exist; only
			// pass it on resume using the verified native session ID from `session.resume_hint`.
			const targetSession = sessionOptions.nativeSessionId;
			if (!sessionOptions.fork && sessionOptions.isResumed && targetSession) {
				args.push("-S", targetSession);
			}
			args.push("-p", fullMessage);
			break;
		}

		case "qwen":
		case "qwen-code": {
			args.push("-o", "stream-json");
			if (profile.provider === "nan") {
				args.push("--auth-type", "openai", "--openai-base-url", "https://api.nan.builders/v1");
			}
			if (profile.model) {
				args.push("-m", normalizeNonOpenCodeModel(profile.model));
			}
			if (hasWorkspacePermissions(profile)) {
				args.push("-y");
			} else {
				args.push("--approval-mode", "plan");
			}
			const targetSession = sessionOptions.nativeSessionId || sessionId;
			if (!sessionOptions.fork && sessionOptions.isResumed && targetSession) {
				args.push("-r", targetSession);
			} else if (sessionId && isUuid(sessionId)) {
				args.push("--session-id", sessionId);
			}
			args.push("-p", fullMessage);
			break;
		}

		case "antigravity":
		case "agy": {
			if (profile.model) {
				let model = normalizeNonOpenCodeModel(profile.model);
				if (model === "flash") model = "gemini-3.8-flash-high";
				else if (model === "pro" || model === "argon" || model === "gemini-3.1-pro-high") model = "gemini-4-argon-high";
				args.push("--model", model);
			}
			if (effortRes.args.length > 0) {
				args.push(...effortRes.args);
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
				args.push("-m", normalizeNonOpenCodeModel(profile.model));
			}
			if (effortRes.args.length > 0) {
				args.push(...effortRes.args);
			}
			args.push("--output-format", "json");
			// cmdc in print mode blocks shell_command unless --yolo is passed, and a
			// blocked tool aborts the whole run (stopReason "permission_denied"). Read-only
			// workers still need shell for inspection (wc, git, grep, tsc), while `--permission-mode plan`
			// blocks commands like `git --version`. So --yolo is required here; read-only is
			// enforced by the worker's prompt (isolated benchmarks configure `--permission-mode` explicitly).
			args.push("--yolo");
			args.push("--skip-onboarding");
			args.push("--no-auto-update");

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
			args.push("--output-format", "stream-json");

			// mcode --permission accepts smart | full | off. The default is
			// "smart", which asks for interactive confirmation and therefore
			// HANGS a detached worker until the harness kills it. Always pass
			// the policy explicitly: full for implementers, off for readers.
			args.push("--permission", hasWorkspacePermissions(profile) ? "full" : "off");

			if (profile.model) {
				const cleanModel = normalizeNonOpenCodeModel(profile.model);
				let fullModel = cleanModel;
				if (profile.provider) {
					const prefix =
						profile.provider === "minimax" || profile.provider.startsWith("custom_provider:")
							? profile.provider
							: `custom_provider:${profile.provider}`;
					if (!cleanModel.startsWith(`${profile.provider}/`) && !cleanModel.startsWith(`${prefix}/`)) {
						fullModel = `${prefix}/${cleanModel}`;
					} else if (profile.provider !== "minimax" && !profile.provider.startsWith("custom_provider:") && !cleanModel.startsWith("custom_provider:")) {
						fullModel = `custom_provider:${cleanModel}`;
					}
				}
				args.push("--model", fullModel);
			}
			if (effortRes.args.length > 0) {
				args.push(...effortRes.args);
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
		execFileSync(whichCmd, [command], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
