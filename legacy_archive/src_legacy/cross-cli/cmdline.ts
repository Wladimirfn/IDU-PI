import { existsSync } from "node:fs";
import type { IduConfig, IduProfile } from "./types.js";

export interface BuiltCommandLine {
	command: string;
	args: string[];
}

export function buildWorkerArgs(
	profile: IduProfile,
	task: string,
	contextFiles: string[] = [],
	config: IduConfig,
): BuiltCommandLine {
	const harness = profile.harness.toLowerCase();
	const cliDef = config.clis[harness];
	const command = cliDef?.command || harness;

	let fullMessage = task;
	if (contextFiles.length > 0) {
		fullMessage += `\n\nContext Files to review:\n${contextFiles.map((f) => `- ${f}`).join("\n")}`;
	}

	const args: string[] = [];

	switch (harness) {
		case "claude":
		case "claude-code": {
			if (profile.model) {
				args.push("--model", profile.model);
			}
			args.push(
				"--output-format", "stream-json",
				"--verbose",
				"--permission-mode", "bypassPermissions",
				"-p", fullMessage,
			);
			break;
		}

		case "opencode": {
			args.push("run", "--format", "json", "--auto");
			if (profile.model) {
				const fullModel = profile.provider ? `${profile.provider}/${profile.model}` : profile.model;
				args.push("--model", fullModel);
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
			args.push("-p", fullMessage);
			break;
		}

		case "codex": {
			args.push("exec", "--auto-approve");
			if (profile.model) {
				args.push("--model", profile.model);
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
	// In Windows PATH resolution
	return true;
}
