#!/usr/bin/env node
import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { runMcpServer } from "./mcp-server.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { runPreflight } from "./quality.js";
import { IDU_HOME } from "./config.js";

const args = process.argv.slice(2);
const command = args[0] || "mcp";

async function waitRunCommand(
	runId: string,
	options: { timeoutMs: number; follow: boolean; verbose: boolean; intervalMs: number },
): Promise<void> {
	const manager = CrossCliProcessManager.getInstance();
	let status = manager.getStatus(runId);
	if (!status) {
		console.error(`Error: Run ID "${runId}" not found in ~/.idu/sessions`);
		process.exit(1);
	}

	const logPath = status.logPath;
	let logOffset = 0;

	const streamLog = () => {
		if (!options.follow || !existsSync(logPath)) return;
		try {
			const stat = statSync(logPath);
			if (stat.size > logOffset) {
				const fd = openSync(logPath, "r");
				const bufferSize = stat.size - logOffset;
				const buffer = Buffer.alloc(bufferSize);
				readSync(fd, buffer, 0, bufferSize, logOffset);
				closeSync(fd);
				logOffset = stat.size;
				process.stdout.write(buffer);
			}
		} catch {
			// best effort
		}
	};

	streamLog();

	const start = Date.now();
	while (Date.now() - start < options.timeoutMs) {
		status = manager.getStatus(runId);
		if (!status) break;

		streamLog();

		if (status.status !== "running" && status.status !== "pending") {
			streamLog();
			const result = manager.getResult(runId, options.verbose);
			if (!options.follow) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				console.log(`\n=== IDU RUN FINISHED: ${status.status.toUpperCase()} (code: ${status.exitCode}) ===`);
				if (status.resultSummary) {
					console.log(`Summary:\n${status.resultSummary}`);
				}
			}
			process.exit(status.status === "completed" ? 0 : 1);
		}

		await new Promise((r) => setTimeout(r, options.intervalMs));
	}

	// Double check status before declaring timeout in case process completed during final tick
	status = manager.getStatus(runId);
	if (status && status.status !== "running" && status.status !== "pending") {
		streamLog();
		const result = manager.getResult(runId, options.verbose);
		if (!options.follow) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(`\n=== IDU RUN FINISHED: ${status.status.toUpperCase()} (code: ${status.exitCode}) ===`);
			if (status.resultSummary) {
				console.log(`Summary:\n${status.resultSummary}`);
			}
		}
		process.exit(status.status === "completed" ? 0 : 1);
	}

	console.error(`\nWait timed out after ${options.timeoutMs}ms. Worker is still running in background.`);
	process.exit(124);
}

async function main(): Promise<void> {
	switch (command) {
		case "mcp": {
			runMcpServer();
			break;
		}

		case "status": {
			const targetRunId = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			if (targetRunId) {
				const status = CrossCliProcessManager.getInstance().getStatus(targetRunId);
				if (!status) {
					console.error(`Run ID "${targetRunId}" not found.`);
					process.exit(1);
				}
				console.log(JSON.stringify(status, null, 2));
				break;
			}
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

		case "result": {
			const targetRunId = args[1];
			if (!targetRunId || targetRunId.startsWith("-")) {
				console.error("Error: runId is required. Usage: idu result <runId> [--verbose]");
				process.exit(1);
			}
			const verbose = args.includes("--verbose");
			const result = CrossCliProcessManager.getInstance().getResult(targetRunId, verbose);
			if (!result) {
				console.error(`Run ID "${targetRunId}" not found.`);
				process.exit(1);
			}
			console.log(JSON.stringify(result, null, 2));
			break;
		}

		case "wait": {
			const runId = args[1];
			if (!runId || runId.startsWith("-")) {
				console.error("Error: runId is required. Usage: idu wait <runId> [--timeout <ms>] [--follow] [--verbose]");
				process.exit(1);
			}

			let timeoutIndex = args.indexOf("--timeout");
			if (timeoutIndex === -1) timeoutIndex = args.indexOf("--timeout-ms");
			const parsedTimeout = timeoutIndex !== -1 ? parseInt(args[timeoutIndex + 1], 10) : NaN;
			const timeoutMs = (!isNaN(parsedTimeout) && parsedTimeout > 0) ? parsedTimeout : 540_000;
			const follow = args.includes("--follow") || args.includes("-f");
			const verbose = args.includes("--verbose");

			let intervalIndex = args.indexOf("--interval");
			const parsedInterval = intervalIndex !== -1 ? parseInt(args[intervalIndex + 1], 10) : NaN;
			const intervalMs = (!isNaN(parsedInterval) && parsedInterval > 0) ? parsedInterval : 1000;

			await waitRunCommand(runId, { timeoutMs, follow, verbose, intervalMs });
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
			console.log("  idu status [runId]                      Display detected CLIs & profiles or status of run");
			console.log("  idu result <runId> [--verbose]          Display final execution result of run");
			console.log("  idu wait <runId> [--follow]             Wait for background run (with optional live streaming)");
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
