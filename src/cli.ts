#!/usr/bin/env node
import { runMcpServer } from "./mcp-server.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { runPreflight } from "./quality.js";
import { IDU_HOME } from "./config.js";

const args = process.argv.slice(2);
const command = args[0] || "mcp";

async function main(): Promise<void> {
	switch (command) {
		case "mcp": {
			runMcpServer();
			break;
		}

		case "status": {
			const caps = CrossCliProcessManager.getInstance().getCapabilities();
			console.log("\n=== IDU Cross-CLI Status ===");
			console.log(`IDU Home: ${IDU_HOME}`);
			console.log(`One Orchestrator Rule: ${caps.oneOrchestratorRule.enabled ? "ENABLED" : "DISABLED"}`);
			console.log("\nDetected CLIs:");
			for (const cli of caps.installedClis) {
				console.log(`  - ${cli.name.padEnd(10)} [${cli.available ? "OK" : "NOT FOUND"}]: ${cli.command}`);
			}
			console.log("\nProfiles:");
			for (const [name, prof] of Object.entries(caps.profiles)) {
				console.log(`  - ${name.padEnd(15)} -> Harness: ${prof.harness.padEnd(10)} Model: ${prof.model || "default"}`);
			}
			console.log("============================\n");
			break;
		}

		case "capabilities": {
			const caps = CrossCliProcessManager.getInstance().getCapabilities();
			console.log(JSON.stringify(caps, null, 2));
			break;
		}

		case "preflight": {
			const request = args.slice(1).join(" ") || "General check";
			const result = runPreflight({ request });
			console.log(JSON.stringify(result, null, 2));
			break;
		}

		case "sessions": {
			const sessions = CrossCliProcessManager.getInstance().listSessions();
			console.log("\n=== IDU Sessions Tree ===");
			if (sessions.length === 0) {
				console.log("No active or resumed sessions tracked.");
			} else {
				for (const s of sessions) {
					const parentStr = s.parentSessionId ? ` (parent: ${s.parentSessionId})` : " (root)";
					console.log(`- Session: ${s.sessionId}${parentStr}`);
					console.log(`  Profile: ${s.profile} [${s.harness}] | Turns: ${s.turnCount} | Last Active: ${s.lastActiveAt}`);
					console.log(`  Dir: ${s.workingDir}`);
				}
			}
			console.log("=========================\n");
			break;
		}

		case "delegate": {
			const profileIndex = args.indexOf("--profile");
			const profile = profileIndex !== -1 ? args[profileIndex + 1] : "fast";
			const sessionIndex = args.indexOf("--session");
			const sessionId = sessionIndex !== -1 ? args[sessionIndex + 1] : undefined;
			const parentIndex = args.indexOf("--parent");
			const parentSessionId = parentIndex !== -1 ? args[parentIndex + 1] : undefined;
			const fork = args.includes("--fork");
			const verbose = args.includes("--verbose");

			let workingDirIndex = args.indexOf("--working-dir");
			if (workingDirIndex === -1) workingDirIndex = args.indexOf("--cwd");
			const workingDir = workingDirIndex !== -1 ? args[workingDirIndex + 1] : undefined;

			let timeoutIndex = args.indexOf("--timeout");
			if (timeoutIndex === -1) timeoutIndex = args.indexOf("--timeout-ms");
			const timeoutMs = timeoutIndex !== -1 ? parseInt(args[timeoutIndex + 1], 10) : undefined;

			const flagsToFilter = new Set([
				profileIndex, profileIndex !== -1 ? profileIndex + 1 : -1,
				sessionIndex, sessionIndex !== -1 ? sessionIndex + 1 : -1,
				parentIndex, parentIndex !== -1 ? parentIndex + 1 : -1,
				workingDirIndex, workingDirIndex !== -1 ? workingDirIndex + 1 : -1,
				timeoutIndex, timeoutIndex !== -1 ? timeoutIndex + 1 : -1,
				args.indexOf("--fork"),
				args.indexOf("--verbose"),
			]);

			const taskArgs = args.slice(1).filter((_, i) => !flagsToFilter.has(i + 1));
			const task = taskArgs.join(" ") || "Status probe";

			console.log(`Delegating task to profile: ${profile}${sessionId ? ` (session: ${sessionId})` : ""}${workingDir ? ` in ${workingDir}` : ""}...`);
			const result = await CrossCliProcessManager.getInstance().delegate({
				task,
				profile,
				parentOrchestrator: "cli",
				sessionId,
				parentSessionId,
				fork,
				workingDir,
				timeoutMs,
				verbose,
			});
			console.log(JSON.stringify(result, null, 2));
			break;
		}

		default: {
			console.log("IDU Cross-CLI Agent Router v2.1.0");
			console.log("Usage:");
			console.log("  idu mcp                                 Run stdio MCP server");
			console.log("  idu status                              Display detected CLIs & profiles");
			console.log("  idu sessions                            Display session hierarchy tree");
			console.log("  idu capabilities                        Print JSON capabilities");
			console.log("  idu preflight <request>                 Run preflight safety check");
			console.log("  idu delegate <task> --profile <p>       Directly delegate to a worker");
			console.log("  idu delegate <task> --session <id>      Resume an existing session");
			console.log("  idu delegate <task> --session <id> --fork Branch a child session");
			console.log("  idu delegate <task> --working-dir <dir> Set target working directory");
			console.log("  idu delegate <task> --timeout <ms>      Set timeout in milliseconds");
			break;
		}
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
