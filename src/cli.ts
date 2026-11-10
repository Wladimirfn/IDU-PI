#!/usr/bin/env node
import {
	existsSync,
	statSync,
	openSync,
	readSync,
	closeSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { runMcpServer } from "./mcp-server.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { runPreflight } from "./quality.js";
import { IDU_HOME, loadProfilesConfig } from "./config.js";
import {
	AUDIT_DIR,
	AUDIT_FILE,
	AUDIT_VERSION,
	type AuditFile,
	auditFilePath,
	buildAuditPrompt,
	collectAuditInputs,
	evaluateAudit,
	listSceneKeyframes,
	normalizeHarness,
	parseAuditReply,
	readBriefField,
} from "./video-audit.js";
import { installPiMcpConfig, resolvePiAgentDir } from "./setup.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
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
			   accion explicita, no el estado por defecto. `render` produce el
			   video de entrega con render_frames.mjs y corre el gate de motion;
			   `studio`/`status`/`measure` siguen usando iduframe. */
			const sub = args[1] || "studio";
			const flag = (name: string) => {
				const i = args.indexOf(`--${name}`);
				return i >= 0 ? args[i + 1] : undefined;
			};
			if (
				sub !== "studio" &&
				sub !== "render" &&
				sub !== "status" &&
				sub !== "measure" &&
				sub !== "validate" &&
				sub !== "audit"
			) {
				console.error(
					"Uso: idu-pi video studio [--project <dir>] [--port <n>]\n" +
						"     idu-pi video status|measure [--project <dir>] [--url <url>]\n" +
						"     idu-pi video audit [--project <dir>] [--profile <perfil>] [--timeout <ms>]\n" +
						"     idu-pi video validate [--project <dir>] [--video <file>] [--debug [dir]]\n" +
						"     idu-pi video render [--project <dir>] [--out <mp4>] [--audio <file>] [--end <s>] [--no-validate]\n" +
						"                        [--width <px>] [--height <px>] [--gpu] [--angle <backend>] [--skip-style-gate]",
				);
				process.exit(1);
			}
			const projectRoot = resolve(flag("project") ?? process.cwd());

			/* Auditoría artística independiente: un worker de otro harness mira
			   los keyframes y deja su veredicto en audit/visual-qa.json. Gasta
			   una llamada de modelo, por eso es un comando y no un efecto de
			   `render`. */
			if (sub === "audit") {
				process.exit(await runVideoAudit(projectRoot, flag("profile"), flag("timeout")));
			}

			/* Gate de motion: valida un MP4 ya renderizado. No renderiza nada;
			   devuelve el veredicto para que el pipeline no publique un video que
			   parpadea o termina fuera del keyframe aprobado. */
			if (sub === "validate") {
				const debugIndex = args.indexOf("--debug");
				const debugValue = debugIndex >= 0 ? args[debugIndex + 1] : undefined;
				const debug =
					debugIndex >= 0
						? debugValue && !debugValue.startsWith("--")
							? debugValue
							: ""
						: undefined;
				process.exit(runMotionValidator(projectRoot, flag("video"), debug));
			}

			/* Render de entrega: un solo camino. Resuelve duracion, audio y
			   Playwright; despues corre el mismo gate que `video validate`. */
			if (sub === "render") {
				const renderer = resolveFrameRenderer();
				if (!renderer) {
					console.error(
						"No encontré skills-bundle/video-production/render_frames.mjs en el paquete.",
					);
					process.exit(1);
				}
				const duration = readCompositionDuration(projectRoot);
				const endFlag = flag("end");
				const end = endFlag !== undefined ? Number(endFlag) : duration;
				if (end === null || !Number.isFinite(end) || end <= 0) {
					console.error("No pude determinar la duración. Pasá --end <segundos>.");
					process.exit(1);
				}
				/* Un render completo es una entrega: exige intent y lane válidos,
				   contrato de dirección artística, e00 aprobado y el veredicto
				   de un auditor que no sea el autor. Un render parcial es
				   revisión y puede correr antes de la aprobación. */
				if (endFlag === undefined) {
					const skipGates = args.includes("--skip-style-gate");
					const gate = checkStyleGate(projectRoot, skipGates);
					if (gate !== 0) process.exit(gate);
					if (!skipGates) {
						const audit = checkAuditGate(projectRoot);
						if (audit !== 0) process.exit(audit);
					}
				}
				const outFlag = flag("out");
				const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
				const out = outFlag
					? resolve(projectRoot, outFlag)
					: join(projectRoot, "renders", `${basename(projectRoot)}_${stamp}.mp4`);
				mkdirSync(dirname(out), { recursive: true });
				const audioFlag = flag("audio");
				const audio = audioFlag ? resolve(projectRoot, audioFlag) : findApprovedAudio(projectRoot, out);
				const playwright = resolvePlaywrightEntry(projectRoot);
				const renderArgs = [
					renderer,
					"--url",
					pathToFileURL(join(projectRoot, "index.html")).href,
					"--end",
					String(end),
					"--out",
					out,
				];
				if (audio) renderArgs.push("--audio", audio);
				if (playwright) renderArgs.push("--playwright", playwright);
				for (const name of ["width", "height"]) {
					const value = flag(name);
					if (value) renderArgs.push(`--${name}`, value);
				}
				if (args.includes("--gpu")) renderArgs.push("--gpu");
				if (flag("angle")) renderArgs.push("--angle", flag("angle") as string);
				console.log(`render: ${projectRoot} -> ${out} (${end}s)`);
				if (audio) console.log(`audio: ${audio}`);
				else console.log("sin audio aprobado: el render sale mudo (pasá --audio)");
				const render = spawnSync(process.execPath, renderArgs, {
					stdio: "inherit",
					env: { ...process.env },
					cwd: projectRoot,
				});
				if (render.status !== 0) process.exit(render.status ?? 1);
				console.log(`render listo: ${out}`);
				const partial = endFlag !== undefined && duration !== null && end < duration - 0.01;
				if (partial || args.includes("--no-validate")) {
					console.log(partial ? "render parcial: gate omitido" : "gate omitido");
					process.exit(0);
				}
				const gate = runMotionValidator(projectRoot, out);
				if (gate !== 0) {
					console.error("El render terminó, pero el gate de motion falló: no publicar.");
				}
				process.exit(gate);
			}

			const iduframeArgs = [sub === "studio" ? "preview" : sub, "--project", projectRoot];
			if (flag("port")) iduframeArgs.push("--port", flag("port") as string);
			if (flag("url")) iduframeArgs.push("--url", flag("url") as string);
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
				cwd: projectRoot,
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

/* El validador de motion vive en el bundle de skills del paquete, no en el
   proyecto: el proyecto solo aporta timeline.json y keyframes/. */
function resolveMotionValidator(): string | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const candidate = join(root, "skills-bundle", "video-production", "validar_motion.py");
	return existsSync(candidate) ? candidate : null;
}

/* Python cambia de nombre segun plataforma e instalacion. */
function resolvePython(): string | null {
	const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
	for (const cmd of candidates) {
		const probe = spawnSync(cmd, ["--version"], { stdio: "ignore" });
		if (!probe.error && probe.status === 0) return cmd;
	}
	return null;
}

/* Renderer de entrega: frames deterministas, no la ruta de chunks de
   HyperFrames. Ver skills-bundle/video-production/SKILL.md. */
function resolveFrameRenderer(): string | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const candidate = join(root, "skills-bundle", "video-production", "render_frames.mjs");
	return existsSync(candidate) ? candidate : null;
}

/* Gate de estilo para un render completo. El brief y el e00 existían como
   prosa; sin este chequeo un render de entrega podía salir sin lane válida,
   sin contrato de dirección artística y sin aprobación. */
function readStyleBrief(
	project: string,
): { intent: string | null; lane: string | null; approvedE00: boolean } | null {
	const file = join(project, "style-brief.md");
	if (!existsSync(file)) return null;
	/* El brief puede usar markdown (`- **Lane:** ...`); se normaliza antes de
	   parsear para que el formato del documento no cambie el veredicto. */
	/* Un bloque cercado es una plantilla o un ejemplo, no una decisión: se
	   descarta antes de leer cualquier campo. */
	const text = readFileSync(file, "utf8")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/\*\*|`/g, "");
	/* El intent es la primera palabra de su propia línea; lo que siga es la
	   razón. `[ \t]` y no `\s`: un `Intent:` vacío no toma su valor de la línea
	   siguiente. La palabra se devuelve entera para que el rechazo nombre lo
	   que estaba escrito. */
	const intentMatch = text.match(/^[ \t]*-[ \t]*Intent:[ \t]*(\S.*)$/im);
	const intent = intentMatch
		? intentMatch[1].trim().split(/[\s;:,.]+/)[0].toLowerCase() || null
		: null;
	const laneMatch = text.match(/^\s*-\s*Lane:\s*(.+)$/im);
	const lane = laneMatch ? laneMatch[1].trim().split(/\s+/)[0].toLowerCase() : null;
	const approvedE00 = /^\s*-\s*Approved e00:\s*(yes|sí|si|true|approved)\b/im.test(text);
	return { intent, lane, approvedE00 };
}

/* Qué tipo de pieza es. La lane nombra una técnica; sin el intent toda pieza se
   produce y se juzga como un explainer narrado. video-lanes.json es la fuente;
   esta lista cubre un bundle anterior al bloque `intents`. */
const DEFAULT_VIDEO_INTENTS = ["presentation", "story", "experience"];

type VideoLanes = {
	lanes?: Record<string, unknown>;
	intents?: Record<string, unknown>;
	audit?: { profiles?: string[] };
};

function resolveVideoLanes(): VideoLanes | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const candidate = join(
		root,
		"skills-bundle",
		"video-production",
		"references",
		"video-lanes.json",
	);
	if (!existsSync(candidate)) return null;
	try {
		return JSON.parse(readFileSync(candidate, "utf8")) as VideoLanes;
	} catch {
		return null;
	}
}

function validIntentIds(lanes: VideoLanes | null): string[] {
	const declared = lanes?.intents ? Object.keys(lanes.intents) : [];
	return declared.length > 0 ? declared : DEFAULT_VIDEO_INTENTS;
}

function checkStyleGate(project: string, skip: boolean): number {
	if (skip) {
		console.warn(
			"style gate y audit gate omitidos por --skip-style-gate: NO PUBLICAR sin brief, dirección artística, e00 aprobado y auditoría independiente.",
		);
		return 0;
	}
	const brief = readStyleBrief(project);
	if (!brief) {
		console.error(
			"style gate: falta style-brief.md. Escribí el brief, aprobá e00 y volvé a renderizar.",
		);
		return 1;
	}
	const lanes = resolveVideoLanes();
	const intentIds = validIntentIds(lanes);
	if (!brief.intent) {
		console.error(
			`style gate: style-brief.md no declara \`Intent:\`. Decidí qué tipo de pieza es antes de elegir la lane: ${intentIds.join(", ")}.`,
		);
		return 1;
	}
	if (!intentIds.includes(brief.intent)) {
		console.error(
			`style gate: intent desconocido "${brief.intent}". Valores válidos: ${intentIds.join(", ")}.`,
		);
		return 1;
	}
	if (!brief.lane) {
		console.error("style gate: style-brief.md no declara `Lane:`.");
		return 1;
	}
	const laneIds = lanes?.lanes ? Object.keys(lanes.lanes) : [];
	if (laneIds.length > 0 && !laneIds.includes(brief.lane)) {
		console.error(
			`style gate: lane desconocida "${brief.lane}". Valores válidos: ${laneIds.join(", ")}.`,
		);
		return 1;
	}
	if (!brief.approvedE00) {
		console.error(
			"style gate: e00 no aprobado. Presentá keyframes/e00-styleboard.png y poné `Approved e00: yes`.",
		);
		return 1;
	}
	if (!existsSync(join(project, "keyframes", "e00-styleboard.png"))) {
		console.error("style gate: falta keyframes/e00-styleboard.png.");
		return 1;
	}
	if (!existsSync(join(project, "art-direction.md"))) {
		console.error(
			"style gate: falta art-direction.md (contrato de dirección artística previo al HTML).",
		);
		return 1;
	}
	console.log(`style gate: ok (intent ${brief.intent}, lane, art direction, e00)`);
	return 0;
}

/* Gate de auditoría para un render completo. El gate de estilo comprueba que
   las decisiones existan; este comprueba que alguien distinto del autor miró
   el resultado, sobre los mismos keyframes que se van a entregar. */
function checkAuditGate(project: string): number {
	const { errors, warnings } = evaluateAudit(project);
	for (const warning of warnings) console.warn(`audit gate (aviso): ${warning}`);
	if (errors.length > 0) {
		for (const error of errors) console.error(`audit gate: ${error}`);
		return 1;
	}
	console.log(`audit gate: ok (${AUDIT_DIR}/${AUDIT_FILE}, ${warnings.length} aviso(s))`);
	return 0;
}

function resolveVisualQaContract(): string | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const candidate = join(root, "skills-bundle", "video-production", "references", "visual-qa.md");
	return existsSync(candidate) ? candidate : null;
}

/* Despacha la auditoría a un worker de otro harness y guarda su veredicto.
   Devuelve 0 cuando la pieza queda en condiciones de pasar el gate. */
async function runVideoAudit(
	project: string,
	profileFlag: string | undefined,
	timeoutFlag: string | undefined,
): Promise<number> {
	const brief = readStyleBrief(project);
	if (!brief?.intent) {
		console.error("video audit: style-brief.md no existe o no declara `Intent:`. La pieza se audita contra su intent.");
		return 1;
	}
	/* Un intent que el gate de estilo va a rechazar no merece gastar la
	   llamada de modelo del auditor. */
	const intentIds = validIntentIds(resolveVideoLanes());
	if (!intentIds.includes(brief.intent)) {
		console.error(
			`video audit: intent desconocido "${brief.intent}". Valores válidos: ${intentIds.join(", ")}.`,
		);
		return 1;
	}
	const author = readBriefField(readFileSync(join(project, "style-brief.md"), "utf8"), "Author");
	if (!author) {
		console.error(
			"video audit: style-brief.md no declara `Author:`. Agregá `- Author: <harness>/<modelo>` de quien armó la composición; sin eso no se puede elegir un auditor distinto.",
		);
		return 1;
	}
	if (!existsSync(join(project, "art-direction.md"))) {
		console.error("video audit: falta art-direction.md; no hay contrato contra el cual auditar.");
		return 1;
	}
	const sceneIds = listSceneKeyframes(project);
	if (sceneIds.length === 0) {
		console.error("video audit: no hay keyframes/eNN.png; no hay escenas que auditar.");
		return 1;
	}
	const contractPath = resolveVisualQaContract();
	if (!contractPath) {
		console.error("video audit: no encontré references/visual-qa.md en el paquete.");
		return 1;
	}

	/* El auditor no puede ser el autor. Con --profile se respeta la elección y
	   se rechaza si coincide el harness; sin él se toma el primer perfil
	   declarado en video-lanes.json que exista y sea de otro harness. */
	const { profiles } = loadProfilesConfig();
	const authorHarness = normalizeHarness(author);
	const candidates = profileFlag ? [profileFlag] : (resolveVideoLanes()?.audit?.profiles ?? []);
	const profileName = candidates.find(
		(name) => profiles[name] && normalizeHarness(profiles[name].harness) !== authorHarness,
	);
	if (!profileName) {
		console.error(
			profileFlag
				? profiles[profileFlag]
					? `video audit: el perfil "${profileFlag}" usa el mismo harness que el autor (${author}). Elegí otro.`
					: `video audit: el perfil "${profileFlag}" no existe en ~/.idu/profiles.json.`
				: `video audit: ningún perfil de auditoría disponible es de un harness distinto del autor (${author}). Probados: ${candidates.join(", ") || "ninguno"}. Pasá --profile <perfil>.`,
		);
		return 1;
	}

	const parsedTimeout = timeoutFlag !== undefined ? Number(timeoutFlag) : NaN;
	const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 900_000;
	const inputs = collectAuditInputs(project, sceneIds);
	console.log(
		`video audit: ${sceneIds.length} escena(s), intent ${brief.intent}, auditor ${profileName} (autor: ${author})...`,
	);
	let result: Awaited<ReturnType<CrossCliProcessManager["delegate"]>>;
	try {
		result = await CrossCliProcessManager.getInstance().delegate({
			task: buildAuditPrompt({
				intent: brief.intent,
				sceneIds,
				hasScript: existsSync(join(project, "guion.md")),
				hasTimeline: existsSync(join(project, "timeline.json")),
				contractPath,
			}),
			profile: profileName,
			profileExplicit: true,
			parentOrchestrator: "cli",
			workingDir: project,
			timeoutMs,
		});
	} catch (err) {
		/* Un worker no puede auditar a otro: la regla de un solo orquestador
		   rechaza la delegación, y eso se informa en vez de reventar. */
		console.error(`video audit: no se pudo despachar el auditor: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
	if (result.status !== "completed") {
		console.error(`video audit: el auditor terminó en "${result.status}". Log: ${result.logPath}`);
		return 1;
	}

	const auditDir = join(project, AUDIT_DIR);
	mkdirSync(auditDir, { recursive: true });
	const parsed = parseAuditReply(result.summary ?? "", sceneIds);
	if (!parsed.ok) {
		/* La respuesta se guarda para poder leer por qué no sirvió; no se
		   escribe un veredicto a medias. */
		const rawPath = join(auditDir, "visual-qa.raw.txt");
		writeFileSync(rawPath, result.summary ?? "", "utf8");
		console.error(`video audit: ${parsed.error}. Respuesta guardada en ${rawPath}. Log: ${result.logPath}`);
		return 1;
	}

	const audit: AuditFile = {
		version: AUDIT_VERSION,
		createdAt: new Date().toISOString(),
		intent: brief.intent,
		author,
		auditor: {
			profile: profileName,
			harness: result.harness,
			model: result.model ?? "",
			runId: result.runId,
		},
		inputs,
		...parsed.reply,
	};
	writeFileSync(auditFilePath(project), `${JSON.stringify(audit, null, 2)}\n`, "utf8");

	for (const scene of audit.scenes) {
		const checks = scene.failed.length > 0 ? ` (checks ${scene.failed.join(", ")})` : "";
		console.log(`  ${scene.id}  ${scene.verdict}${checks}${scene.fix ? `  -> ${scene.fix}` : ""}`);
	}
	console.log(
		`  pieza: intent ${audit.piece.intent}${audit.piece.became ? ` (${audit.piece.became})` : ""}, variedad ${audit.piece.variety}`,
	);
	console.log(`video audit: veredicto en ${auditFilePath(project)}`);
	return checkAuditGate(project);
}

/* Duracion declarada por la composicion; timeline.total es el fallback. */
function readCompositionDuration(project: string): number | null {
	const index = join(project, "index.html");
	if (existsSync(index)) {
		const html = readFileSync(index, "utf8");
		/* La composicion y cada <audio> declaran data-duration; el total es el
		   mayor, no el primero del documento. */
		let max = 0;
		for (const match of html.matchAll(/data-duration="([0-9.]+)"/g)) {
			const value = Number(match[1]);
			if (Number.isFinite(value)) max = Math.max(max, value);
		}
		if (max > 0) return max;
	}
	const timeline = join(project, "timeline.json");
	if (!existsSync(timeline)) return null;
	try {
		const data = JSON.parse(readFileSync(timeline, "utf8")) as {
			total?: number;
			scenes?: Array<{ fin_voz?: number; end?: number; frases?: Array<{ end?: number }> }>;
		};
		if (typeof data.total === "number" && data.total > 0) return data.total;
		let max = 0;
		for (const scene of data.scenes ?? []) {
			max = Math.max(max, scene.fin_voz ?? 0, scene.end ?? 0);
			for (const frase of scene.frases ?? []) max = Math.max(max, frase.end ?? 0);
		}
		return max > 0 ? max : null;
	} catch {
		return null;
	}
}

/* Audio aprobado: el MP4 -hq con audio, o el primer MP4 que no sea video-only.
   El render de frames no reproduce las etiquetas <audio>; la pista se muxea. */
function findApprovedAudio(project: string, out: string): string | null {
	let entries: string[];
	try {
		entries = readdirSync(project);
	} catch {
		return null;
	}
	const videos = entries
		.filter((name) => name.toLowerCase().endsWith(".mp4"))
		.map((name) => join(project, name))
		.filter((path) => resolve(path) !== resolve(out));
	const hq = videos.filter((path) => /-hq\.mp4$/i.test(path));
	if (hq.length > 0) return hq.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
	const candidates = videos.filter((path) => !/(^|[-_])video\.mp4$/i.test(path));
	return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

/* Playwright puede estar instalado en el proyecto, global o en el cache de npx. */
function resolvePlaywrightEntry(project: string): string | null {
	const explicit = process.env.PLAYWRIGHT_PATH;
	if (explicit && existsSync(explicit)) return explicit;
	const local = join(project, "node_modules", "playwright", "index.mjs");
	if (existsSync(local)) return local;
	const npx = process.env.LOCALAPPDATA
		? join(process.env.LOCALAPPDATA, "npm-cache", "_npx")
		: join(process.env.HOME ?? "", ".npm", "_npx");
	if (existsSync(npx)) {
		for (const dir of readdirSync(npx)) {
			const candidate = join(npx, dir, "node_modules", "playwright", "index.mjs");
			if (existsSync(candidate)) return candidate;
		}
	}
	const globalNpm = process.env.APPDATA
		? join(process.env.APPDATA, "npm", "node_modules", "playwright", "index.mjs")
		: "";
	if (globalNpm && existsSync(globalNpm)) return globalNpm;
	return null;
}

function runMotionValidator(project: string, video?: string, debug?: string): number {
	const script = resolveMotionValidator();
	if (!script) {
		console.error("No encontré skills-bundle/video-production/validar_motion.py en el paquete.");
		return 1;
	}
	const python = resolvePython();
	if (!python) {
		console.error("No encontré Python. Instalalo y agregá numpy + Pillow: pip install numpy pillow");
		return 1;
	}
	const args = [script, "--proyecto", project];
	if (video) args.push("--video", video);
	if (debug !== undefined) {
		args.push("--debug");
		if (debug) args.push(debug);
	}
	const run = spawnSync(python, args, { stdio: "inherit", cwd: project });
	return run.status ?? 1;
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
	out("                                  Full renders enforce the style gate:");
	out("                                  intent, lane, art-direction.md and approved e00");
	out("                                  Full renders also enforce the audit gate");
	out("  idu-pi video audit [--project <dir>]       Independent artistic audit by another harness;");
	out("                                  writes audit/visual-qa.json (spends one model call)");
	out("                                  --width/--height/--gpu for the render profile");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
