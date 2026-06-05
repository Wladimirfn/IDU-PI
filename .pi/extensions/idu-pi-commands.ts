import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type PiRunMode = "tui" | "rpc" | "json" | "print";

type ExtensionCommandContext = {
	cwd: string;
	mode?: PiRunMode;
	hasUI?: boolean;
	ui?: {
		notify(message: string, level: "info" | "warning" | "error"): void;
		setStatus(key: string, value: string | undefined): void;
	};
	waitForIdle(): Promise<void>;
	getSystemPromptOptions?(): unknown;
	modelRegistry?: {
		getAvailable(): Promise<unknown[]>;
	};
};

type ExtensionAPI = {
	exec(
		command: string,
		args: string[],
		options: { cwd: string; timeout: number },
	): Promise<{
		stdout?: string;
		stderr?: string;
		code?: number;
		killed?: boolean;
	}>;
	sendMessage(message: {
		customType: string;
		content: string;
		display: boolean;
		details: Record<string, unknown>;
	}): void;
	registerCommand(
		name: string,
		options: {
			description: string;
			handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
		},
	): void;
};

type CliCommand = {
	description: string;
	cliArgs: (args: string) => string[];
	requiresArgs?: boolean;
	usage?: string;
};

const MAX_OUTPUT_CHARS = 12_000;
const IDU_PI_PACKAGE_ROOT: string = "__IDU_PI_PACKAGE_ROOT__";
const SAFE_MODEL_SEGMENT_RE = /^[A-Za-z0-9._~:@%+-]+$/u;

function cliProcess(cliArgs: string[]): { command: string; args: string[] } {
	const cliScript =
		IDU_PI_PACKAGE_ROOT === "__IDU_PI_PACKAGE_ROOT__"
			? "dist/src/cli.js"
			: `${IDU_PI_PACKAGE_ROOT.replace(/\\/gu, "/")}/dist/src/cli.js`;
	return {
		command: process.execPath,
		args: [cliScript, "--", ...cliArgs],
	};
}

function trimOutput(value: string): string {
	if (value.length <= MAX_OUTPUT_CHARS) return value;
	return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[Salida truncada por extensión Pi: ${value.length} caracteres totales]`;
}

function resolveIduPiHomeDir(): string {
	const home =
		process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || homedir();
	return join(home, ".pi", "idu-pi");
}

function resolveModelCatalogSnapshotPath(): string {
	const override = process.env.IDU_PI_MODEL_CATALOG_PATH?.trim();
	if (override) return override;
	return join(resolveIduPiHomeDir(), "model-catalog.json");
}

function resolvePromptContextSnapshotPath(): string {
	const override = process.env.IDU_PI_PROMPT_CONTEXT_PATH?.trim();
	if (override) return override;
	return join(resolveIduPiHomeDir(), "prompt-context-snapshot.json");
}

export function canUseExtensionUi(ctx: {
	mode?: PiRunMode;
	hasUI?: boolean;
	ui?: ExtensionCommandContext["ui"];
}): boolean {
	if (!ctx.ui) return false;
	if (ctx.hasUI === false) return false;
	if (ctx.mode === "json" || ctx.mode === "print") return false;
	return true;
}

function notifyIfUi(
	ctx: ExtensionCommandContext,
	message: string,
	level: "info" | "warning" | "error",
): void {
	if (!canUseExtensionUi(ctx)) return;
	ctx.ui?.notify(message, level);
}

function setStatusIfUi(
	ctx: ExtensionCommandContext,
	key: string,
	value: string | undefined,
): void {
	if (!canUseExtensionUi(ctx)) return;
	ctx.ui?.setStatus(key, value);
}

function objectField(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
	const field = value[key];
	return Array.isArray(field) ? field : [];
}

function safeString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function measuredChars(value: unknown): number {
	if (typeof value === "string") return value.length;
	if (value === undefined || value === null) return 0;
	try {
		return JSON.stringify(value).length;
	} catch {
		return 0;
	}
}

type PromptContextSnapshot = {
	version: 1;
	mode: PiRunMode | "unknown";
	generatedAt: string;
	rawContentIncluded: false;
	contextFiles: {
		count: number;
		paths: string[];
		totalChars: number;
	};
	skills: {
		count: number;
		names: string[];
	};
	tools: {
		count: number;
	};
	limitations: string[];
};

export function buildPromptContextSnapshot(
	options: unknown,
	mode: PiRunMode | "unknown",
): PromptContextSnapshot {
	const record = objectField(options);
	const contextFiles = arrayField(record, "contextFiles");
	const contextSummaries = contextFiles.map((file) => {
		const fileRecord = objectField(file);
		return {
			path:
				safeString(fileRecord.path) ??
				safeString(fileRecord.filePath) ??
				"[unknown-context-file]",
			chars: measuredChars(fileRecord.content ?? fileRecord.text),
		};
	});
	const skills = arrayField(record, "loadedSkills").length
		? arrayField(record, "loadedSkills")
		: arrayField(record, "skills");
	const skillNames = skills
		.map((skill) => {
			const skillRecord = objectField(skill);
			return safeString(skillRecord.name) ?? safeString(skill);
		})
		.filter((name): name is string => Boolean(name));
	const activeTools = arrayField(record, "activeTools").length
		? arrayField(record, "activeTools")
		: arrayField(record, "tools");
	return {
		version: 1,
		mode,
		generatedAt: new Date().toISOString(),
		rawContentIncluded: false,
		contextFiles: {
			count: contextSummaries.length,
			paths: contextSummaries.map((file) => file.path).slice(0, 50),
			totalChars: contextSummaries.reduce(
				(total, file) => total + file.chars,
				0,
			),
		},
		skills: {
			count: skills.length,
			names: skillNames.slice(0, 50),
		},
		tools: {
			count: activeTools.length,
		},
		limitations: [
			"Snapshot records counts, paths, and sizes only; raw prompt and file contents are intentionally omitted.",
		],
	};
}

async function refreshPiPromptContextSnapshot(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const getOptions = ctx.getSystemPromptOptions;
	if (!getOptions) return;
	try {
		const snapshot = buildPromptContextSnapshot(
			getOptions.call(ctx),
			ctx.mode ?? "unknown",
		);
		const path = resolvePromptContextSnapshotPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
	} catch (error) {
		notifyIfUi(
			ctx,
			`Idu-pi no pudo refrescar snapshot de contexto Pi: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
	}
}

function normalizeModelCatalogId(value: string): string | undefined {
	const trimmed = value.trim();
	const [provider, ...modelSegments] = trimmed.split("/");
	if (!provider || modelSegments.length === 0) return undefined;
	if (!SAFE_MODEL_SEGMENT_RE.test(provider)) return undefined;
	if (
		modelSegments.some(
			(segment) =>
				!segment ||
				segment === "." ||
				segment === ".." ||
				!SAFE_MODEL_SEGMENT_RE.test(segment),
		)
	) {
		return undefined;
	}
	return `${provider}/${modelSegments.join("/")}`;
}

function sanitizeRegistryModel(value: unknown):
	| {
			provider: string;
			id: string;
			name?: string;
			inputCost?: number;
			outputCost?: number;
	  }
	| undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.provider !== "string" || typeof record.id !== "string") {
		return undefined;
	}
	const provider = record.provider.trim();
	const id = record.id.trim();
	if (!normalizeModelCatalogId(`${provider}/${id}`)) return undefined;
	const model: {
		provider: string;
		id: string;
		name?: string;
		inputCost?: number;
		outputCost?: number;
	} = { provider, id };
	if (typeof record.name === "string" && record.name.trim()) {
		model.name = record.name.trim();
	}
	if (
		typeof record.inputCost === "number" &&
		Number.isFinite(record.inputCost)
	) {
		model.inputCost = record.inputCost;
	}
	if (
		typeof record.outputCost === "number" &&
		Number.isFinite(record.outputCost)
	) {
		model.outputCost = record.outputCost;
	}
	return model;
}

async function refreshPiModelCatalogSnapshot(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const getAvailable = ctx.modelRegistry?.getAvailable;
	if (!getAvailable) return;
	try {
		const rawModels = await getAvailable.call(ctx.modelRegistry);
		const models = rawModels.flatMap((model) => {
			const sanitized = sanitizeRegistryModel(model);
			return sanitized ? [sanitized] : [];
		});
		const path = resolveModelCatalogSnapshotPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			`${JSON.stringify(
				{
					version: 1,
					generatedAt: new Date().toISOString(),
					source: "pi-model-registry",
					models,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
	} catch (error) {
		notifyIfUi(
			ctx,
			`Idu-pi no pudo refrescar catálogo de modelos: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
	}
}

function formatCliResult(
	command: string,
	stdout: string,
	stderr: string,
	code: number,
): string {
	const parts = [`$ node dist/src/cli.js -- ${command}`, ""];
	if (stdout.trim()) parts.push(trimOutput(stdout.trim()));
	if (stderr.trim()) parts.push("", "stderr:", trimOutput(stderr.trim()));
	parts.push("", `exitCode: ${code}`);
	return parts.join("\n");
}

type ProgressStage =
	| "scan"
	| "reverse_engineering"
	| "forge_plan"
	| "quarantine";
type ProgressStatus = "queued" | "running" | "ok" | "blocked";
type CliProgressEvent = {
	stage: ProgressStage;
	status: ProgressStatus;
	message: string;
};

const PROGRESS_LABELS: Record<ProgressStage, string> = {
	scan: "⚙️  Escaneando repositorio",
	reverse_engineering:
		"🧠  Preparando ingeniería inversa de flujos y arquitectura",
	forge_plan: "📝  Forjando Plan Maestro A-Z y matriz de riesgos",
	quarantine: "🔒  Manteniendo repo real en cuarentena hasta aprobación humana",
};

const PROGRESS_ORDER: ProgressStage[] = [
	"scan",
	"reverse_engineering",
	"forge_plan",
	"quarantine",
];

function renderProgress(
	statuses: Record<ProgressStage, ProgressStatus>,
): string {
	return PROGRESS_ORDER.map((stage) => {
		const status = statuses[stage];
		return `[idu-pi] ${PROGRESS_LABELS[stage]}... [${status.toUpperCase()}]`;
	}).join("\n");
}

export default function (pi: ExtensionAPI) {
	async function runCliStreamingIdu(
		command: string,
		cliArgs: string[],
		ctx: ExtensionCommandContext,
	) {
		const processConfig = cliProcess(cliArgs);
		const statuses: Record<ProgressStage, ProgressStatus> = {
			scan: "queued",
			reverse_engineering: "queued",
			forge_plan: "queued",
			quarantine: "queued",
		};
		let stdout = "";
		let stderr = "";
		let stderrBuffer = "";
		let killed = false;
		const publishProgress = (details: Record<string, unknown>) => {
			pi.sendMessage({
				customType: "idu-pi-progress",
				content: renderProgress(statuses),
				display: true,
				details: { command, cliArgs, ...details },
			});
		};
		publishProgress({ phase: "queued" });
		const processStderrLine = (line: string) => {
			if (!line) return;
			if (line.startsWith("__IDU_PROGRESS__")) {
				try {
					const event = JSON.parse(
						line.slice("__IDU_PROGRESS__".length),
					) as CliProgressEvent;
					statuses[event.stage] = event.status;
					publishProgress({
						phase: event.stage,
						status: event.status,
						message: event.message,
					});
				} catch {
					stderr += `${line}\n`;
				}
			} else {
				stderr += `${line}\n`;
			}
		};
		const code = await new Promise<number>((resolve) => {
			const child = spawn(processConfig.command, processConfig.args, {
				cwd: ctx.cwd,
				env: { ...process.env, IDU_PI_PROGRESS: "1" },
				windowsHide: true,
			});
			const timeout = setTimeout(() => {
				killed = true;
				child.kill();
			}, 1_200_000);
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderrBuffer += chunk.toString("utf8");
				const lines = stderrBuffer.split(/\r?\n/u);
				stderrBuffer = lines.pop() ?? "";
				for (const line of lines) processStderrLine(line);
			});
			child.on("error", (error) => {
				stderr += `${error.message}\n`;
			});
			child.on("close", (exitCode) => {
				clearTimeout(timeout);
				if (stderrBuffer) processStderrLine(stderrBuffer);
				resolve(exitCode ?? (killed ? 124 : 1));
			});
		});
		const text = formatCliResult(command, stdout, stderr, code);
		pi.sendMessage({
			customType: "idu-pi-cli",
			content: text,
			display: true,
			details: { command, cliArgs, code, killed },
		});
		notifyIfUi(
			ctx,
			code === 0 ? `Idu-pi OK: /${command}` : `Idu-pi falló: /${command}`,
			code === 0 ? "info" : "error",
		);
	}

	async function runCli(
		command: string,
		cliArgs: string[],
		ctx: ExtensionCommandContext,
	) {
		await ctx.waitForIdle();
		await refreshPiModelCatalogSnapshot(ctx);
		await refreshPiPromptContextSnapshot(ctx);
		setStatusIfUi(ctx, "idu-pi", `running ${command}`);
		try {
			if (command === "idu") {
				await runCliStreamingIdu(command, cliArgs, ctx);
				return;
			}
			const processConfig = cliProcess(cliArgs);
			const result = await pi.exec(processConfig.command, processConfig.args, {
				cwd: ctx.cwd,
				timeout: 1_200_000,
			});
			const text = formatCliResult(
				command,
				result.stdout ?? "",
				result.stderr ?? "",
				result.code ?? 0,
			);
			pi.sendMessage({
				customType: "idu-pi-cli",
				content: text,
				display: true,
				details: {
					command,
					cliArgs,
					code: result.code,
					killed: result.killed,
				},
			});
			notifyIfUi(
				ctx,
				result.code === 0
					? `Idu-pi OK: /${command}`
					: `Idu-pi falló: /${command}`,
				result.code === 0 ? "info" : "error",
			);
		} finally {
			setStatusIfUi(ctx, "idu-pi", undefined);
		}
	}

	function registerIduCommand(name: string, config: CliCommand) {
		pi.registerCommand(name, {
			description: config.description,
			handler: async (args, ctx) => {
				const trimmed = args.trim();
				if (config.requiresArgs && !trimmed) {
					notifyIfUi(
						ctx,
						`Uso: ${config.usage ?? `/${name} <texto>`}`,
						"warning",
					);
					return;
				}
				await runCli(name, config.cliArgs(trimmed), ctx);
			},
		});
	}

	function registerIduAliases(name: string, config: CliCommand) {
		registerIduCommand(name.replace(/-/gu, "_"), config);
	}

	registerIduAliases("idu", {
		description: "Crear o activar el plan supervisor Idu-pi",
		cliArgs: () => ["idu"],
	});

	registerIduAliases("idu-off", {
		description: "Desactivar guardrails automáticos de Idu-pi",
		cliArgs: () => ["idu-off"],
	});
}
