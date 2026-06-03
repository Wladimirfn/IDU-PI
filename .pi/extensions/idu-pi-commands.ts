import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type ExtensionCommandContext = {
	cwd: string;
	ui: {
		notify(message: string, level: "info" | "warning" | "error"): void;
		setStatus(key: string, value: string | undefined): void;
	};
	waitForIdle(): Promise<void>;
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

function resolveModelCatalogSnapshotPath(): string {
	const override = process.env.IDU_PI_MODEL_CATALOG_PATH?.trim();
	if (override) return override;
	const home =
		process.env.USERPROFILE?.trim() || process.env.HOME?.trim() || homedir();
	return join(home, ".pi", "idu-pi", "model-catalog.json");
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
		ctx.ui.notify(
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
		ctx.ui.notify(
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
		ctx.ui.setStatus("idu-pi", `running ${command}`);
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
			ctx.ui.notify(
				result.code === 0
					? `Idu-pi OK: /${command}`
					: `Idu-pi falló: /${command}`,
				result.code === 0 ? "info" : "error",
			);
		} finally {
			ctx.ui.setStatus("idu-pi", undefined);
		}
	}

	function registerIduCommand(name: string, config: CliCommand) {
		pi.registerCommand(name, {
			description: config.description,
			handler: async (args, ctx) => {
				const trimmed = args.trim();
				if (config.requiresArgs && !trimmed) {
					ctx.ui.notify(
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
