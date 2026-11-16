import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveWindowsShim, unwrapCmdExecutable } from "../src/cmdline.js";
import { NAN_BASE_URL, resolveNanApiKey } from "../src/nan-auth.js";
import { killProcessTree } from "../src/process-utils.js";
import type { BenchmarkModelSpec, BenchmarkTaskDef, BenchmarkTrack, PermissionMode } from "./types.js";

export interface FileChecksumSnapshot {
	profilesSha256: string | null;
	configSha256: string | null;
}

export interface HarnessInvocation {
	supported: boolean;
	unsupportedReason?: string;
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	apiProtocol: string;
}

export interface SpawnOutcome {
	exitCode: number | null;
	timedOut: boolean;
	durationMs: number;
	stdout: string;
	stderr: string;
	spawnError?: string;
}

function sha256FileIfExists(filePath: string): string | null {
	if (!existsSync(filePath)) return null;
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function snapshotUserIduFiles(): FileChecksumSnapshot {
	const iduDir = join(homedir(), ".idu");
	return {
		profilesSha256: sha256FileIfExists(join(iduDir, "profiles.json")),
		configSha256: sha256FileIfExists(join(iduDir, "config.json")),
	};
}

export { resolveNanApiKey };

function buildPiModelsJson(model: BenchmarkModelSpec): string {
	return JSON.stringify(
		{
			providers: {
				nan: {
					baseUrl: NAN_BASE_URL,
					api: "openai-completions",
					models: [
						{
							id: model.providerModelId,
							name: model.displayName,
							reasoning: true,
							input: ["text"],
							contextWindow: 1000000,
							maxTokens: 32768,
						},
					],
				},
			},
		},
		null,
		2,
	);
}

function buildMcodeYaml(model: BenchmarkModelSpec, apiKey: string): string {
	const safeKey = apiKey.replace(/'/g, "''");
	const safeName = model.displayName.replace(/'/g, "''");
	return [
		"logLevel: info",
		`defaultModel: custom_provider:nan/${model.providerModelId}`,
		"dataContribution:",
		"  enabled: false",
		"custom_provider:",
		"  nan:",
		"    name: nan",
		"    kind: custom",
		"    enabled: true",
		"    api: openai-completions",
		"    options:",
		`      baseURL: ${NAN_BASE_URL}`,
		`      apiKey: '${safeKey}'`,
		"      authMode: api-key",
		"    models:",
		`      ${model.providerModelId}:`,
		`        name: '${safeName}'`,
		"        enabled: true",
		"        tool_call: true",
		"        reasoning: true",
		"        limit:",
		"          context: 1000000",
		"          output: 131072",
		"",
	].join("\n");
}

function lookupExecutableOnPath(cmdName: string): string | null {
	const candidates = process.platform === "win32" ? [`${cmdName}.exe`, cmdName] : [cmdName];
	const tool = process.platform === "win32" ? "where" : "which";
	for (const c of candidates) {
		try {
			const out = execFileSync(tool, [c], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
				.toString()
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			const hit = out.find((p) => existsSync(p) && !p.toLowerCase().endsWith(".cmd") && !p.toLowerCase().endsWith(".bat"));
			if (hit) return hit;
		} catch {
			// continue
		}
	}
	return null;
}

function resolveExecutable(cmdName: string, args: string[]): { command: string; args: string[] } | null {
	const shim = process.platform === "win32" ? resolveWindowsShim(cmdName) : null;
	const candidate = shim ?? (existsSync(cmdName) ? cmdName : lookupExecutableOnPath(cmdName));
	if (!candidate) {
		return null;
	}
	if (candidate.toLowerCase().endsWith(".cmd") || candidate.toLowerCase().endsWith(".bat")) {
		const unwrapped = unwrapCmdExecutable(candidate, args);
		if (unwrapped.isShell) return null;
		return { command: unwrapped.command, args: unwrapped.args };
	}
	return { command: candidate, args };
}

function cleanBaseEnv(isolationRoot: string, apiKey: string, track: BenchmarkTrack = "controlled"): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.IDU_WORKER;
	delete env.IDU_RUN_ID;
	env.IDU_HOME = join(isolationRoot, "idu-home");
	mkdirSync(env.IDU_HOME, { recursive: true });
	if (process.platform === "win32") {
		const psCacheDir = join(isolationRoot, "ps-module-cache");
		mkdirSync(psCacheDir, { recursive: true });
		env.PSModuleAnalysisCachePath = join(psCacheDir, "ModuleAnalysisCache");
	}
	if (track === "controlled") {
		const appData = join(isolationRoot, "appdata");
		const localAppData = join(isolationRoot, "localappdata");
		mkdirSync(appData, { recursive: true });
		mkdirSync(localAppData, { recursive: true });
		if (process.platform === "win32") {
			mkdirSync(join(localAppData, "Microsoft", "Windows", "PowerShell"), { recursive: true });
		}
		env.APPDATA = appData;
		env.LOCALAPPDATA = localAppData;
	}
	env.NAN_API_KEY = apiKey;
	env.CI = "1";
	env.NO_COLOR = "1";
	return env;
}

export function buildHarnessInvocation(params: {
	harness: string;
	model: BenchmarkModelSpec;
	prompt: string;
	isolationRoot: string;
	track: BenchmarkTrack;
	apiKey: string;
	permissionMode?: PermissionMode;
}): HarnessInvocation {
	const { harness, model, prompt, isolationRoot, track, apiKey, permissionMode = "workspace" } = params;
	const isReadOnly = permissionMode === "read-only";
	const h = harness.toLowerCase();
	const realHome = homedir();
	const env = cleanBaseEnv(isolationRoot, apiKey, track);

	if (h === "claude") {
		return {
			supported: false,
			unsupportedReason: "Nan returns 404 on Anthropic /v1/messages; Claude Code cannot natively talk to Nan without an external proxy.",
			command: "claude",
			args: [],
			env,
			apiProtocol: "anthropic-messages",
		};
	}

	if (h === "antigravity" || h === "agy") {
		return {
			supported: false,
			unsupportedReason: "Antigravity (agy) uses Google Antigravity OAuth backend and does not accept Nan OpenAI BYOK providers.",
			command: "agy",
			args: [],
			env,
			apiProtocol: "antigravity-oauth",
		};
	}

	if (h === "opencode") {
		const ocHome = join(isolationRoot, "oc-home");
		if (track === "controlled") {
			mkdirSync(join(ocHome, ".config", "opencode"), { recursive: true });
			mkdirSync(join(ocHome, ".local", "share", "opencode"), { recursive: true });
			mkdirSync(join(ocHome, ".local", "state", "opencode"), { recursive: true });
			mkdirSync(join(ocHome, ".cache", "opencode"), { recursive: true });
			writeFileSync(
				join(ocHome, ".config", "opencode", "opencode.json"),
				JSON.stringify(
					{
						$schema: "https://opencode.ai/config.json",
						provider: {
							nan: {
								npm: "@ai-sdk/openai-compatible",
								name: "Nan",
								options: { baseURL: NAN_BASE_URL, apiKey: "{env:NAN_API_KEY}" },
								models: {
									[model.providerModelId]: {
										name: model.displayName,
										tool_call: true,
										reasoning: true,
										limit: { context: 1000000, output: 131072 },
									},
								},
							},
						},
					},
					null,
					2,
				),
				"utf8",
			);
			env.HOME = ocHome;
			env.USERPROFILE = ocHome;
			env.XDG_CONFIG_HOME = join(ocHome, ".config");
			env.XDG_DATA_HOME = join(ocHome, ".local", "share");
			env.XDG_STATE_HOME = join(ocHome, ".local", "state");
			env.XDG_CACHE_HOME = join(ocHome, ".cache");
		}
		const exec = resolveExecutable("opencode", [
			"run",
			"--format",
			"json",
			...(isReadOnly ? [] : ["--auto"]),
			"-m",
			`nan/${model.providerModelId}`,
			prompt,
		]);
		if (!exec) {
			return { supported: false, unsupportedReason: "opencode CLI binary not found on PATH", command: "opencode", args: [], env, apiProtocol: "openai-completions" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-completions" };
	}

	if (h === "pi") {
		const piDir = join(isolationRoot, "pi-agent");
		const homeDir = join(isolationRoot, "pi-home");
		if (track === "controlled") {
			mkdirSync(piDir, { recursive: true });
			mkdirSync(homeDir, { recursive: true });
			writeFileSync(join(piDir, "auth.json"), JSON.stringify({ nan: { type: "api_key", key: apiKey } }), "utf8");
			writeFileSync(join(piDir, "models.json"), buildPiModelsJson(model), "utf8");
			env.PI_CODING_AGENT_DIR = piDir;
			env.HOME = homeDir;
			env.USERPROFILE = homeDir;
		}
		const rawArgs =
			track === "controlled"
				? [
						"--mode",
						"json",
						...(isReadOnly ? ["--tools", "read,grep,find,ls"] : []),
						"--no-extensions",
						"--no-skills",
						"--no-mcp",
						"--no-context-files",
						"--no-session",
						"--provider",
						"nan",
						"--model",
						model.providerModelId,
						"-p",
						prompt,
					]
				: [
						"--mode",
						"json",
						...(isReadOnly ? ["--tools", "read,grep,find,ls"] : []),
						"--provider",
						"nan",
						"--model",
						model.providerModelId,
						"-p",
						prompt,
					];
		const exec = resolveExecutable("pi", rawArgs);
		if (!exec) {
			return { supported: false, unsupportedReason: "pi CLI binary not found on PATH", command: "pi", args: [], env, apiProtocol: "openai-completions" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-completions" };
	}

	if (h === "gentle-shell") {
		const gsHome = join(isolationRoot, "gs-home");
		const gsCfg = join(isolationRoot, "gs-cfg");
		const fakeHome = join(isolationRoot, "gs-user");
		// Prevent bundled gentle-pi from running parent ODD/exploration-budget
		// delegation or interactive confirmation hooks inside a leaf worker.
		env.GENTLE_PI_AGENTS_CHILD = "1";
		env.GENTLE_PI_AUTONOMOUS_MODE = "1";
		if (track === "controlled") {
			mkdirSync(gsHome, { recursive: true });
			mkdirSync(gsCfg, { recursive: true });
			mkdirSync(fakeHome, { recursive: true });
			writeFileSync(join(gsHome, "auth.json"), JSON.stringify({ nan: { type: "api_key", key: apiKey } }), "utf8");
			writeFileSync(join(gsHome, "models.json"), buildPiModelsJson(model), "utf8");
			env.GENTLE_SHELL_HOME = gsHome;
			env.GENTLE_PI_CONFIG_HOME = gsCfg;
			env.GENTLE_SHELL_NO_AUTO_SETUP = "1";
			env.HOME = fakeHome;
			env.USERPROFILE = fakeHome;
		}
		const rawArgs =
			track === "controlled"
				? [
						"--mode",
						"json",
						...(isReadOnly ? ["--tools", "read,grep,find,ls"] : []),
						"--no-extensions",
						"--no-skills",
						"--no-mcp",
						"--no-context-files",
						"--no-session",
						"--provider",
						"nan",
						"--model",
						model.providerModelId,
						"-p",
						prompt,
					]
				: [
						"--mode",
						"json",
						...(isReadOnly ? ["--tools", "read,grep,find,ls"] : []),
						"--provider",
						"nan",
						"--model",
						model.providerModelId,
						"-p",
						prompt,
					];
		const exec = resolveExecutable("gentle-shell", rawArgs);
		if (!exec) {
			return { supported: false, unsupportedReason: "gentle-shell CLI binary not found on PATH", command: "gentle-shell", args: [], env, apiProtocol: "openai-completions" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-completions" };
	}

	if (h === "commandcode" || h === "cmdc") {
		const ccHome = join(isolationRoot, "cc-home");
		if (track === "controlled") {
			const realAuthPath = join(realHome, ".commandcode", "auth.json");
			if (!existsSync(realAuthPath)) {
				return {
					supported: false,
					unsupportedReason: "cmdc requires an existing Command Code login token in ~/.commandcode/auth.json alongside --local-only",
					command: "cmdc",
					args: [],
					env,
					apiProtocol: "openai-responses",
				};
			}
			const realAuth = JSON.parse(readFileSync(realAuthPath, "utf8")) as Record<string, unknown>;
			mkdirSync(join(ccHome, ".commandcode"), { recursive: true });
			writeFileSync(
				join(ccHome, ".commandcode", "providers.json"),
				JSON.stringify(
					{
						provider: {
							nan: {
								api: "openai-responses",
								baseURL: NAN_BASE_URL,
								models: {
									[model.providerModelId]: { name: model.displayName, contextWindow: 1000000, maxOutput: 131072 },
								},
							},
						},
					},
					null,
					2,
				),
				"utf8",
			);
			writeFileSync(
				join(ccHome, ".commandcode", "auth.json"),
				JSON.stringify({
					apiKey: realAuth.apiKey,
					userId: realAuth.userId,
					userName: realAuth.userName,
					keyName: realAuth.keyName,
					authenticatedAt: realAuth.authenticatedAt,
					nan: { type: "api", key: apiKey },
				}),
				"utf8",
			);
			writeFileSync(
				join(ccHome, ".commandcode", "settings.json"),
				JSON.stringify({
					permissions: { defaultMode: "auto-accept", allow: ["Edit(**)", "Shell(node *)", "Shell(git *)", "powershell"] },
				}),
				"utf8",
			);
			env.HOME = ccHome;
			env.USERPROFILE = ccHome;
			env.CMD_LOCAL_ONLY = "1";
		}
		const rawArgs =
			track === "controlled"
				? ["--local-only", "--skip-onboarding", "--no-auto-update", "--no-skills", "--safe-mode", "--no-session", "--yolo", "-m", `nan/${model.providerModelId}`, "-p", "--output-format", "json", prompt]
				: ["--no-auto-update", "--yolo", "-m", `nan/${model.providerModelId}`, "-p", "--output-format", "json", prompt];
		const exec = resolveExecutable("cmdc", rawArgs);
		if (!exec) {
			return { supported: false, unsupportedReason: "cmdc CLI binary not found on PATH", command: "cmdc", args: [], env, apiProtocol: "openai-responses" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-responses" };
	}

	if (h === "mcode") {
		const mmHome = join(isolationRoot, "mcode-home");
		const cfgPath = join(isolationRoot, "mcode-config.yaml");
		const extraArgs: string[] = [];
		if (track === "controlled") {
			const realMinimaxAuth = join(realHome, ".minimax", "auth");
			if (!existsSync(realMinimaxAuth)) {
				return {
					supported: false,
					unsupportedReason: "mcode requires an existing MiniMax login session in ~/.minimax/auth alongside --config",
					command: "mcode",
					args: [],
					env,
					apiProtocol: "openai-completions",
				};
			}
			mkdirSync(join(mmHome, ".minimax"), { recursive: true });
			cpSync(realMinimaxAuth, join(mmHome, ".minimax", "auth"), { recursive: true });
			writeFileSync(cfgPath, buildMcodeYaml(model, apiKey), "utf8");
			env.HOME = mmHome;
			env.USERPROFILE = mmHome;
			extraArgs.push("--config", cfgPath);
		}
		const rawArgs = [
			"exec",
			"--output-format",
			"stream-json",
			"--permission",
			isReadOnly ? "off" : "full",
			"--model",
			`custom_provider:nan/${model.providerModelId}`,
			...extraArgs,
			prompt,
		];
		const exec = resolveExecutable("mcode", rawArgs);
		if (!exec) {
			return { supported: false, unsupportedReason: "mcode CLI binary not found on PATH", command: "mcode", args: [], env, apiProtocol: "openai-completions" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-completions" };
	}

	if (h === "qwen") {
		const qwHome = join(isolationRoot, "qwen-home");
		if (track === "controlled") {
			mkdirSync(qwHome, { recursive: true });
			env.HOME = qwHome;
			env.USERPROFILE = qwHome;
			env.OPENAI_API_KEY = apiKey;
		}
		const qwenPermArgs = isReadOnly ? ["--approval-mode", "plan"] : ["-y"];
		const rawArgs =
			track === "controlled"
				? ["-o", "stream-json", "--auth-type", "openai", "--openai-base-url", NAN_BASE_URL, "-m", model.providerModelId, ...qwenPermArgs, "--chat-recording", "false", "-p", prompt]
				: ["-o", "stream-json", "--auth-type", "openai", "--openai-base-url", NAN_BASE_URL, "-m", model.providerModelId, ...qwenPermArgs, "-p", prompt];
		const exec = resolveExecutable("qwen", rawArgs);
		if (!exec) {
			return { supported: false, unsupportedReason: "qwen CLI binary not found on PATH", command: "qwen", args: [], env, apiProtocol: "openai-completions" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-completions" };
	}

	if (h === "codex") {
		const cxHome = join(isolationRoot, "codex-home");
		if (track === "controlled") {
			mkdirSync(cxHome, { recursive: true });
			env.CODEX_HOME = cxHome;
			env.HOME = cxHome;
			env.USERPROFILE = cxHome;
		}
		// On Windows, Codex Windows sandbox fails with CreateProcessAsUserW / "blocked by policy"
		// on BOTH `-s workspace-write` and `-s read-only` (leaving read-only agents unable to list
		// or inspect files since Codex uses shell commands). Controlled ephemeral sandboxes use
		// `--dangerously-bypass-approvals-and-sandbox` on win32 while evaluators strictly enforce
		// zero file modifications (`changedFiles.length === 0`) on read-only tasks.
		const sandboxFlags =
			process.platform === "win32"
				? ["--dangerously-bypass-approvals-and-sandbox"]
				: isReadOnly
					? ["-s", "read-only"]
					: ["-s", "workspace-write"];
		const rawArgs = [
			"exec",
			"--json",
			"--skip-git-repo-check",
			"--ephemeral",
			...(track === "controlled" ? ["--ignore-user-config", "--ignore-rules"] : []),
			...sandboxFlags,
			"-c",
			`model_providers.nan={name="Nan",base_url="${NAN_BASE_URL}",env_key="NAN_API_KEY",wire_api="responses"}`,
			"-c",
			'model_provider="nan"',
			"-m",
			model.providerModelId,
			prompt,
		];
		const exec = resolveExecutable("codex", rawArgs);
		if (!exec) {
			return { supported: false, unsupportedReason: "codex CLI binary not found on PATH", command: "codex", args: [], env, apiProtocol: "openai-responses" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-responses" };
	}

	if (h === "kimi") {
		const kiHome = join(isolationRoot, "kimi-home");
		const kiSkills = join(isolationRoot, "kimi-skills");
		const extraArgs: string[] = [];
		if (track === "controlled") {
			mkdirSync(join(kiHome, ".kimi-code"), { recursive: true });
			mkdirSync(kiSkills, { recursive: true });
			writeFileSync(
				join(kiHome, ".kimi-code", "config.toml"),
				[
					`default_model = "nan/${model.providerModelId}"`,
					"merge_all_available_skills = false",
					"",
					"[providers.nan]",
					'type = "openai"',
					`base_url = "${NAN_BASE_URL}"`,
					`api_key = "${apiKey}"`,
					"",
					`[models."nan/${model.providerModelId}"]`,
					'provider = "nan"',
					`model = "${model.providerModelId}"`,
					"max_context_size = 1000000",
					"",
				].join("\n"),
				"utf8",
			);
			writeFileSync(join(kiHome, ".kimi-code", "mcp.json"), JSON.stringify({ mcpServers: {} }), "utf8");
			env.HOME = kiHome;
			env.USERPROFILE = kiHome;
			extraArgs.push("--skills-dir", kiSkills);
		}
		const exec = resolveExecutable("kimi", ["--output-format", "stream-json", "--model", `nan/${model.providerModelId}`, ...extraArgs, "-p", prompt]);
		if (!exec) {
			return { supported: false, unsupportedReason: "kimi CLI binary not found on PATH", command: "kimi", args: [], env, apiProtocol: "openai-completions" };
		}
		return { supported: true, command: exec.command, args: exec.args, env, apiProtocol: "openai-completions" };
	}

	return {
		supported: false,
		unsupportedReason: `Unknown harness: ${harness}`,
		command: harness,
		args: [],
		env,
		apiProtocol: "unknown",
	};
}

export interface PreparedSandbox {
	sandboxDir: string;
	isolationRoot: string;
	initialCommitSha: string;
	cleanup: () => void;
}

export function prepareTaskSandbox(task: BenchmarkTaskDef, sentinelValue: string): PreparedSandbox {
	const base = mkdtempSync(join(tmpdir(), `idu-bench-${task.id}-`));
	const sandboxDir = join(base, "repo");
	const isolationRoot = join(base, "iso");
	mkdirSync(sandboxDir, { recursive: true });
	mkdirSync(isolationRoot, { recursive: true });

	writeFileSync(join(base, "HOST_SENTINEL.txt"), `${sentinelValue}\n`, "utf8");
	writeFileSync(join(isolationRoot, "HOST_SENTINEL.txt"), `${sentinelValue}\n`, "utf8");

	for (const [relPath, content] of Object.entries(task.fixtureFiles)) {
		const abs = join(sandboxDir, relPath);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content, "utf8");
	}

	execFileSync("git", ["init", "-q"], { cwd: sandboxDir, windowsHide: true });
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: sandboxDir, windowsHide: true });
	execFileSync("git", ["config", "user.email", "bench@idu-pi.local"], { cwd: sandboxDir, windowsHide: true });
	execFileSync("git", ["config", "user.name", "IDU Benchmark"], { cwd: sandboxDir, windowsHide: true });
	execFileSync("git", ["add", "-A"], { cwd: sandboxDir, windowsHide: true });
	execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd: sandboxDir, windowsHide: true });
	const initialCommitSha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: sandboxDir,
		encoding: "utf8",
		windowsHide: true,
	}).trim();

	return {
		sandboxDir,
		isolationRoot,
		initialCommitSha,
		cleanup: () => {
			try {
				rmSync(base, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[bench/isolation] best-effort cleanup left residual dir ${base}: ${msg}`);
			}
		},
	};
}

export function collectGitChangedFiles(sandboxDir: string, baseRef?: string): string[] {
	const changed = new Set<string>();
	if (baseRef) {
		try {
			const diffOut = execFileSync("git", ["diff", "--name-only", baseRef], {
				cwd: sandboxDir,
				encoding: "utf8",
				timeout: 5000,
				windowsHide: true,
			});
			for (const l of diffOut.split(/\r?\n/)) {
				const trimmed = l.trim();
				if (trimmed) changed.add(trimmed);
			}
		} catch {
			// Fall back to working-tree status below
		}
	}
	try {
		const out = execFileSync("git", ["status", "--porcelain"], {
			cwd: sandboxDir,
			encoding: "utf8",
			timeout: 5000,
			windowsHide: true,
		});
		for (const rawLine of out.split(/\r?\n/)) {
			const line = rawLine.replace(/\r$/, "");
			if (line.length > 3) {
				const rel = line.slice(3).trim();
				if (rel) changed.add(rel);
			}
		}
	} catch {
		// Return whatever diff captured
	}
	return [...changed];
}

const MAX_WORKER_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TRANSIENT_TAIL_LINES = 20;
const MAX_PENDING_LINE_BYTES = 512 * 1024;

function isTransientStreamDeltaLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
	if (!trimmed.includes('"message_update"') && !trimmed.includes('"item.updated"')) return false;
	try {
		const parsed = JSON.parse(trimmed) as { type?: unknown };
		return parsed.type === "message_update" || parsed.type === "item.updated";
	} catch {
		return false;
	}
}

/**
 * Collects streamed CLI output under a hard memory cap while discarding noisy
 * intermediate token/progress delta spam (`message_update`, `item.updated`)
 * except a small rolling tail so final `turn_end` / `exec.completed` events
 * and token usage are never truncated away.
 */
export class StreamLineCapture {
	private pending = "";
	private readonly substantiveLines: string[] = [];
	private readonly transientTail: string[] = [];
	private substantiveBytes = 0;
	private droppedTransientCount = 0;

	constructor(
		private readonly maxSubstantiveBytes = MAX_WORKER_OUTPUT_BYTES,
		private readonly maxTransientTail = MAX_TRANSIENT_TAIL_LINES,
	) {}

	pushChunk(chunk: Buffer | string): void {
		const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
		this.pending += text;
		let nlIdx = this.pending.indexOf("\n");
		while (nlIdx !== -1) {
			const line = this.pending.slice(0, nlIdx).replace(/\r$/, "");
			this.pending = this.pending.slice(nlIdx + 1);
			this.handleLine(line);
			nlIdx = this.pending.indexOf("\n");
		}
		if (Buffer.byteLength(this.pending, "utf8") >= MAX_PENDING_LINE_BYTES) {
			this.handleLine(this.pending);
			this.pending = "";
		}
	}

	private handleLine(line: string): void {
		if (isTransientStreamDeltaLine(line)) {
			if (this.maxTransientTail > 0) {
				if (this.transientTail.length >= this.maxTransientTail) {
					this.transientTail.shift();
				}
				this.transientTail.push(line);
			}
			this.droppedTransientCount++;
			return;
		}
		if (this.substantiveBytes >= this.maxSubstantiveBytes) return;
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		if (this.substantiveBytes + lineBytes <= this.maxSubstantiveBytes) {
			this.substantiveLines.push(line);
			this.substantiveBytes += lineBytes;
			return;
		}
		const remaining = this.maxSubstantiveBytes - this.substantiveBytes;
		if (remaining > 0) {
			this.substantiveLines.push(Buffer.from(line, "utf8").subarray(0, remaining).toString("utf8"));
			this.substantiveBytes = this.maxSubstantiveBytes;
		}
	}

	finalize(): { text: string; droppedTransientCount: number } {
		if (this.pending.length > 0) {
			this.handleLine(this.pending);
			this.pending = "";
		}
		const combined = [...this.substantiveLines, ...this.transientTail];
		return {
			text: combined.join("\n"),
			droppedTransientCount: this.droppedTransientCount,
		};
	}
}

function appendWorkerOutput(chunks: Buffer[], chunk: Buffer, bytesRef: { value: number }): void {
	if (bytesRef.value >= MAX_STDERR_OUTPUT_BYTES) return;
	const remaining = MAX_STDERR_OUTPUT_BYTES - bytesRef.value;
	chunks.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
	bytesRef.value += Math.min(chunk.length, remaining);
}

export async function spawnIsolatedWorker(params: {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
}): Promise<SpawnOutcome> {
	const { command, args, cwd, env, timeoutMs } = params;
	const startedAt = Date.now();

	return await new Promise<SpawnOutcome>((resolve) => {
		const stdoutCapture = new StreamLineCapture();
		const stderrChunks: Buffer[] = [];
		const errBytes = { value: 0 };
		let timedOut = false;
		let settled = false;
		let postExitTimer: NodeJS.Timeout | undefined;
		let forceResolveTimer: NodeJS.Timeout | undefined;

		let child;
		try {
			child = spawn(command, args, {
				cwd,
				env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (err) {
			resolve({
				exitCode: null,
				timedOut: false,
				durationMs: Date.now() - startedAt,
				stdout: "",
				stderr: "",
				spawnError: err instanceof Error ? err.message : String(err),
			});
			return;
		}

		child.stdout?.on("data", (chunk: Buffer) => stdoutCapture.pushChunk(chunk));
		child.stderr?.on("data", (chunk: Buffer) => appendWorkerOutput(stderrChunks, chunk, errBytes));

		const finish = (code: number | null, errMsg?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (postExitTimer) clearTimeout(postExitTimer);
			if (forceResolveTimer) clearTimeout(forceResolveTimer);
			const captured = stdoutCapture.finalize();
			resolve({
				exitCode: code,
				timedOut,
				durationMs: Date.now() - startedAt,
				stdout: captured.text,
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				spawnError: errMsg,
			});
		};

		const timer = setTimeout(() => {
			timedOut = true;
			killProcessTree(child);
			forceResolveTimer = setTimeout(() => finish(null), 1500);
		}, timeoutMs);

		child.on("error", (err) => finish(null, err.message));
		child.on("exit", (code) => {
			// Guard against orphaned Windows child processes holding stdout/stderr open.
			postExitTimer = setTimeout(() => {
				killProcessTree(child);
				finish(code);
			}, 1000);
		});
		child.on("close", (code) => finish(code));
	});
}
