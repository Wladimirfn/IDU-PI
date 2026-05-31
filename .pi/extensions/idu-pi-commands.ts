type ExtensionCommandContext = {
	cwd: string;
	ui: {
		notify(message: string, level: "info" | "warning" | "error"): void;
		setStatus(key: string, value: string | undefined): void;
	};
	waitForIdle(): Promise<void>;
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

export default function (pi: ExtensionAPI) {
	async function runCli(
		command: string,
		cliArgs: string[],
		ctx: ExtensionCommandContext,
	) {
		await ctx.waitForIdle();
		ctx.ui.setStatus("idu-pi", `running ${command}`);
		if (command === "idu") {
			pi.sendMessage({
				customType: "idu-pi-progress",
				content: [
					"[idu-pi] ⚙️  Escaneando repositorio... [RUNNING]",
					"[idu-pi] El supervisor está trabajando. Las etapas siguientes cambian a [OK] en el reporte final porque Pi exec entrega la salida al terminar el proceso.",
				].join("\n"),
				display: true,
				details: { command, cliArgs, phase: "scan-running" },
			});
		}
		try {
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
