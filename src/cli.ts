#!/usr/bin/env node
import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { runMcpServer } from "./mcp-server.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { runPreflight } from "./quality.js";
import { IDU_HOME } from "./config.js";
import { installPiMcpConfig, resolvePiAgentDir } from "./setup.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

// `node cli.js -- setup ...` (how scripts/install.mjs and the Pi extension call it)
// passes the separator through; drop it so the subcommand is args[0].
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
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
			const caps = await CrossCliProcessManager.getInstance().getCapabilities();
			console.log("\n=== IDU Cross-CLI Status ===");
			console.log(`IDU Home: ${IDU_HOME}`);
			console.log("One Orchestrator Rule: ACTIVE (always on, not configurable — see SECURITY.md)");
			console.log("\nDetected CLIs:");
			for (const cli of caps.installedClis) {
				console.log(`  - ${cli.name.padEnd(10)} [${cli.available ? "OK" : "NOT FOUND"}]: ${cli.command}`);
			}
			console.log("\nProfiles:");
			for (const [name, prof] of Object.entries(caps.profiles)) {
				const provider = prof.provider ? ` Provider: ${prof.provider}` : "";
				console.log(`  - ${name.padEnd(15)} -> Harness: ${prof.harness.padEnd(10)}${provider} Model: ${prof.model || "default"}`);
			}
			console.log("============================\n");
			break;
		}

		case "result": {
			const targetRunId = args[1];
			if (!targetRunId || targetRunId.startsWith("-")) {
				console.error("Error: runId is required. Usage: idu-pi result <runId> [--verbose]");
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
				console.error("Error: runId is required. Usage: idu-pi wait <runId> [--timeout <ms>] [--follow] [--verbose]");
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
			const caps = await CrossCliProcessManager.getInstance().getCapabilities();
			console.log(JSON.stringify(caps, null, 2));
			break;
		}

		case "quota": {
			// Cached by default: two of the sources run a model, and a cold read
			// takes about eleven seconds. `--fresh` is the explicit "spend it now".
			const { readQuotaSnapshots, formatQuota } = await import("./quota.js");
			const snapshots = await readQuotaSnapshots({ fresh: args.includes("--fresh") });
			console.log(formatQuota(snapshots));
			break;
		}

		case "preflight": {
			let workingDirIndex = args.indexOf("--working-dir");
			if (workingDirIndex === -1) workingDirIndex = args.indexOf("--cwd");
			const workingDir =
				workingDirIndex !== -1 && args[workingDirIndex + 1] ? args[workingDirIndex + 1] : undefined;

			const expectedIndex = args.indexOf("--expected-files");
			const expectedFiles =
				expectedIndex !== -1 && args[expectedIndex + 1]
					? args[expectedIndex + 1]
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean)
					: [];

			// Flags must be stripped from the request text. Previously --cwd was
			// swallowed into the request string and the audit silently ran against
			// process.cwd() while reporting the foreign path as if it were honored.
			const flagsToFilter = new Set([
				workingDirIndex,
				workingDirIndex !== -1 ? workingDirIndex + 1 : -1,
				expectedIndex,
				expectedIndex !== -1 ? expectedIndex + 1 : -1,
			]);

			const request =
				args
					.slice(1)
					.filter((_, i) => !flagsToFilter.has(i + 1))
					.join(" ") || "General check";

			const result = runPreflight({ request, expectedFiles, cwd: workingDir });
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
			const profileExplicit = profileIndex !== -1;
			const profile = profileExplicit ? args[profileIndex + 1] : "fast";
			const sessionIndex = args.indexOf("--session");
			const sessionId = sessionIndex !== -1 ? args[sessionIndex + 1] : undefined;
			const parentIndex = args.indexOf("--parent");
			const parentSessionId = parentIndex !== -1 ? args[parentIndex + 1] : undefined;
			const fork = args.includes("--fork");
			const verbose = args.includes("--verbose");
			// --force allows resuming a session under a different harness.
			// Off by default: a cross-harness resume drops the native session.
			const force = args.includes("--force");

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
				args.indexOf("--force"),
			]);

			const taskArgs = args.slice(1).filter((_, i) => !flagsToFilter.has(i + 1));
			const task = taskArgs.join(" ") || "Status probe";

			console.log(`Delegating task to profile: ${profile}${sessionId ? ` (session: ${sessionId})` : ""}${workingDir ? ` in ${workingDir}` : ""}...`);
			const result = await CrossCliProcessManager.getInstance().delegate({
				task,
				profile,
				profileExplicit,
				force,
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

		case "arbitrate": {
			const { looksLikeHighRiskMitigation, normalizeThreshold } = await import("./arbitration.js");
			const stateIndex = args.indexOf("--state");
			let state = "Current workspace state and backlog triage";
			if (stateIndex !== -1 && args[stateIndex + 1]) {
				state = args[stateIndex + 1];
			}

			const thresholdIndex = args.indexOf("--threshold");
			const threshold = thresholdIndex !== -1 ? normalizeThreshold(args[thresholdIndex + 1]) : 0.85;

			const cwdIndex = args.indexOf("--cwd");
			const targetCwd = cwdIndex !== -1 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd();

			const apiKeyIndex = args.indexOf("--api-key");
			if (apiKeyIndex !== -1) {
				console.error(
					"WARNING: --api-key is deprecated: the value is visible in the OS process table and shell history." +
					" Prefer TYPESAFE_API_KEY in the environment, a .env file, or ~/.idu/config.json.",
				);
			}
			const explicitApiKey = apiKeyIndex !== -1 && args[apiKeyIndex + 1] ? args[apiKeyIndex + 1] : undefined;

			const endpointIndex = args.indexOf("--endpoint");
			const explicitEndpoint = endpointIndex !== -1 && args[endpointIndex + 1] ? args[endpointIndex + 1] : undefined;

			const offline = args.includes("--offline");

			const optionsList: Array<{ id: string; description: string; isHighRiskMitigation?: boolean }> = [];

			for (let i = 1; i < args.length; i++) {
				if (args[i] === "--option" && args[i + 1]) {
					const val = args[i + 1];
					const sep = val.indexOf(":");
					if (sep !== -1) {
						optionsList.push({
							id: val.slice(0, sep).trim(),
							description: val.slice(sep + 1).trim(),
							isHighRiskMitigation: looksLikeHighRiskMitigation(val),
						});
					} else {
						optionsList.push({ id: val, description: val });
					}
					i++;
				}
			}

			if (optionsList.length === 0) {
				// Walk once, marking known flags and their values as consumed. An
				// unknown flag is skipped along with its value so a typo can never
				// inject a positional candidate into the decision (F). Any flag token
				// (single or double dash) consumes the token right after it, so a
				// repeated known flag or `-x` cannot leak its value as a candidate.
				const consumed = new Set<number>();
				for (const flagIdx of [stateIndex, thresholdIndex, cwdIndex, apiKeyIndex, endpointIndex]) {
					if (flagIdx !== -1) {
						consumed.add(flagIdx);
						consumed.add(flagIdx + 1);
					}
				}
				for (let i = 1; i < args.length; i++) {
					if (args[i].startsWith("-")) {
						consumed.add(i);
						if (args[i + 1] && !args[i + 1].startsWith("-")) {
							consumed.add(i + 1);
						}
					}
				}
				const positional = args.slice(1).filter((_, idx) => !consumed.has(idx + 1));
				for (let idx = 0; idx < positional.length; idx++) {
					const item = positional[idx];
					optionsList.push({
						id: `opt_${idx + 1}`,
						description: item,
						isHighRiskMitigation: looksLikeHighRiskMitigation(item),
					});
				}
			}

			if (optionsList.length === 0) {
				console.error('Usage: idu-pi arbitrate --option "id1:description 1" --option "id2:description 2" [--state "summary"] [--cwd <dir>] [--threshold <0..1>] [--offline]');
				process.exit(1);
			}

			const { arbitrateAndRecord } = await import("./arbitration-run.js");
			const decision = await arbitrateAndRecord({
				label: "idu-pi arbitrate",
				decidedByPrefix: "cli-arbitrate",
				stateSummary: state,
				options: optionsList,
				confidenceThreshold: threshold,
				cwd: targetCwd,
				apiKey: explicitApiKey,
				endpoint: explicitEndpoint,
				offline,
			});

			console.log(JSON.stringify(decision, null, 2));
			break;
		}

		case "video": {
			/* iduframe: el Studio siempre arriba, y render SOLO si lo piden.
			   El flujo normal es editar y ver el cambio en vivo; un MP4 es una
			   accion explicita, no el estado por defecto. */
			const sub = args[1] || "studio";
			const flag = (name: string) => {
				const i = args.indexOf(`--${name}`);
				return i >= 0 ? args[i + 1] : undefined;
			};
			if (sub !== "studio" && sub !== "render" && sub !== "status" && sub !== "measure") {
				console.error(
					"Uso: idu-pi video studio [--project <dir>] [--port <n>]\n" +
						"     idu-pi video status|measure [--project <dir>] [--url <url>]\n" +
						"     idu-pi video render [--project <dir>]   # unico camino que produce MP4",
				);
				process.exit(1);
			}
			const project = flag("project") ?? process.cwd();
			const iduframeArgs = [sub === "studio" ? "preview" : sub, "--project", project];
			if (flag("port")) iduframeArgs.push("--port", flag("port") as string);
			if (flag("url")) iduframeArgs.push("--url", flag("url") as string);
			if (sub === "render") {
				// Diferencia explicita: render usa el CLI de HyperFrames, no el de preview.
				iduframeArgs.splice(0, 1, "render");
			}
			/* En Windows spawnear `iduframe.cmd` sin shell falla: CreateProcess no
			   ejecuta un .cmd. Se resuelve el entry .mjs real y se corre con node,
			   que ademas evita cualquier quoting de shell sobre rutas de proyecto. */
			const env = { ...process.env };
			const entry = resolveIduframeEntry(env.IDUFRAME_CLI);
			if (!entry) {
				console.error(
					"No encontré `iduframe`. Instalalo con `npm i -g @wladimirfn/iduframe` " +
						"o apuntá IDUFRAME_CLI a su cli.mjs.",
				);
				process.exit(1);
			}
			const run = spawnSync(process.execPath, [entry, ...iduframeArgs], {
				stdio: "inherit",
				env,
				cwd: project,
			});
			process.exit(run.status ?? 1);
			break;
		}

		case "setup": {
			const sub = args[1];
			if (sub !== "mcp-init" && sub !== "mcp-print") {
				console.error("Uso: idu-pi setup mcp-init [--force] [--dry-run] | idu-pi setup mcp-print");
				process.exit(1);
			}
			const mcpServerPath = join(dirname(fileURLToPath(import.meta.url)), "mcp-server.js");
			const result = installPiMcpConfig({
				agentDir: resolvePiAgentDir(),
				mcpServerPath,
				force: args.includes("--force"),
				dryRun: sub === "mcp-print" || args.includes("--dry-run"),
			});
			if (sub === "mcp-print") {
				console.log(JSON.stringify(result.config, null, 2));
			} else {
				console.log(result.summary);
			}
			break;
		}
		case "help":
		case "--help":
		case "-h": {
			printUsage();
			break;
		}
		default: {
			// An unknown command must fail: exiting 0 here is what let scripts/install.mjs
			// report `setup mcp-init` as done for months after the command was removed.
			console.error(`Comando desconocido: ${command}\n`);
			printUsage(console.error);
			process.exit(1);
		}
	}
}

/* Resuelve el entry real de iduframe. En Windows un .cmd no es ejecutable por
   CreateProcess sin shell, asi que se apunta al .mjs y se corre con node: cero
   quoting de shell sobre rutas de proyecto con espacios. */
function resolveIduframeEntry(explicit?: string): string | null {
	if (explicit && existsSync(explicit)) return explicit;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const candidates = [
		process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@wladimirfn", "iduframe", "src", "cli.mjs") : "",
		"/usr/local/lib/node_modules/@wladimirfn/iduframe/src/cli.mjs",
		"/usr/lib/node_modules/@wladimirfn/iduframe/src/cli.mjs",
		home ? join(home, ".npm-global", "lib", "node_modules", "@wladimirfn", "iduframe", "src", "cli.mjs") : "",
	].filter(Boolean);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function printUsage(out: (line: string) => void = console.log): void {
	out("IDU Cross-CLI Agent Router v2.3.0");
	out("Usage:");
	out("  idu-pi mcp                                 Run stdio MCP server");
	out("  idu-pi status [runId]                      Display detected CLIs & profiles or status of run");
	out("  idu-pi result <runId> [--verbose]          Display final execution result of run");
	out("  idu-pi wait <runId> [--follow]             Wait for background run (with optional live streaming)");
	out("  idu-pi sessions                            Display session hierarchy tree");
	out("  idu-pi capabilities                        Print JSON capabilities");
	out("  idu-pi quota [--fresh]                     Each CLI's own account quota (cached 10m; --fresh spends a live call)");
	out("  idu-pi preflight <request> [--cwd <dir>]   Run preflight safety check");
	out("  idu-pi preflight <r> --expected-files <a,b>  Declare expected blast radius");
	out("  idu-pi arbitrate --option <id:desc> ...    Autonomous task decision via Kev/Jev");
	out("  idu-pi setup mcp-init [--force] [--dry-run]  Write idu-pi into Pi's ~/.pi/agent/mcp.json");
	out("  idu-pi delegate <task> --profile <p>       Directly delegate to a worker");
	out("  idu-pi delegate <task> --session <id>      Resume an existing session");
	out("  idu-pi delegate <task> --session <id> --fork Branch a child session");
	out("  idu-pi delegate <task> --session <id> --force Resume across harnesses (drops native continuity)");
	out("  idu-pi delegate <task> --working-dir <dir> Set target working directory");
	out("  idu-pi delegate <task> --timeout <ms>      Set timeout in milliseconds");
	out("  idu-pi video studio [--project <dir>]      Open the hyperframes Studio (never renders)");
	out("  idu-pi video status|measure                Lint state / Spanish coverage");
	out("  idu-pi video render [--project <dir>]      The only path that produces an MP4");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
