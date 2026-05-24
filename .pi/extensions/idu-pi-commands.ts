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

function cliProcess(cliArgs: string[]): { command: string; args: string[] } {
	return {
		command: process.execPath,
		args: ["dist/src/cli.js", "--", ...cliArgs],
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
		try {
			const processConfig = cliProcess(cliArgs);
			const result = await pi.exec(processConfig.command, processConfig.args, {
				cwd: ctx.cwd,
				timeout: 120_000,
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

	registerIduCommand("idu", {
		description: "Activar guardrails automáticos de Idu-pi",
		cliArgs: () => ["idu"],
	});

	registerIduCommand("idu-status", {
		description: "Mostrar estado de sesión Idu-pi",
		cliArgs: () => ["idu-status"],
	});

	registerIduCommand("idu-off", {
		description: "Desactivar guardrails automáticos de Idu-pi",
		cliArgs: () => ["idu-off"],
	});

	registerIduCommand("idu-prepare", {
		description: "Ejecutar prepare seguro de Idu-pi",
		cliArgs: () => ["prepare"],
	});

	registerIduCommand("idu-preflight", {
		description: "Evaluar riesgo preflight para una solicitud",
		cliArgs: (args) => ["preflight", args],
		requiresArgs: true,
		usage: "/idu-preflight <solicitud>",
	});

	registerIduCommand("idu-advisory", {
		description: "Mostrar advisory manual para una solicitud",
		cliArgs: (args) => ["advisory", args],
		requiresArgs: true,
		usage: "/idu-advisory <solicitud>",
	});

	registerIduCommand("idu-postflight", {
		description: "Analizar cambios actuales con postflight",
		cliArgs: () => ["postflight"],
	});

	registerIduCommand("idu-lab-review-plan", {
		description: "Preparar plan de revisión Lab sin ejecutar AgentLabs",
		cliArgs: (args) => ["lab-review-plan", args || "postflight"],
		usage: "/idu-lab-review-plan [postflight|preflight <solicitud>]",
	});

	registerIduCommand("idu-task", {
		description: "Crear tarea estructurada Idu-pi desde Pi CLI",
		cliArgs: (args) => ["task", ...args.split(/\s+/u).filter(Boolean)],
		requiresArgs: true,
		usage:
			"/idu-task [bug|feature|refactor|docs|review] <detalle> | /idu-task <texto libre>",
	});

	registerIduCommand("task", {
		description: "Alias legacy para /idu-task",
		cliArgs: (args) => ["task", ...args.split(/\s+/u).filter(Boolean)],
		requiresArgs: true,
		usage:
			"/task [bug|feature|refactor|docs|review] <detalle> | /task <texto libre>",
	});

	registerIduCommand("idu-queue-detail", {
		description: "Ver cola estructurada Idu-pi",
		cliArgs: () => ["queue-detail"],
	});

	registerIduCommand("queue-detail", {
		description: "Ver cola estructurada Idu-pi",
		cliArgs: () => ["queue-detail"],
	});

	registerIduCommand("idu-queue-clear-structured", {
		description: "Limpiar cola estructurada Idu-pi",
		cliArgs: () => ["queue-clear-structured"],
	});

	registerIduCommand("queue-clear-structured", {
		description: "Alias legacy para /idu-queue-clear-structured",
		cliArgs: () => ["queue-clear-structured"],
	});

	registerIduCommand("idu-queue-approve", {
		description: "Aprobar tarea pausada en cola Idu-pi",
		cliArgs: (args) => ["queue-approve", args],
		requiresArgs: true,
		usage: "/idu-queue-approve <id>",
	});

	registerIduCommand("queue_approve", {
		description: "Aprobar tarea pausada en cola Idu-pi",
		cliArgs: (args) => ["queue-approve", args],
		requiresArgs: true,
		usage: "/queue_approve <id>",
	});

	registerIduCommand("idu-queue-reject", {
		description: "Rechazar tarea en cola Idu-pi",
		cliArgs: (args) => ["queue-reject", args],
		requiresArgs: true,
		usage: "/idu-queue-reject <id>",
	});

	registerIduCommand("queue_reject", {
		description: "Alias legacy para /idu-queue-reject",
		cliArgs: (args) => ["queue-reject", args],
		requiresArgs: true,
		usage: "/queue_reject <id>",
	});

	registerIduCommand("semantic-audit-status", {
		description: "Mostrar estado de auditoría semántica Idu-pi",
		cliArgs: () => ["semantic-audit-status"],
	});

	registerIduCommand("semantic-audit-run", {
		description: "Registrar auditoría semántica manual Idu-pi",
		cliArgs: () => ["semantic-audit-run"],
	});

	registerIduCommand("idu-semantic-audit-status", {
		description: "Alias Idu-pi para estado de auditoría semántica",
		cliArgs: () => ["semantic-audit-status"],
	});

	registerIduCommand("idu-semantic-audit-run", {
		description: "Alias Idu-pi para auditoría semántica manual",
		cliArgs: () => ["semantic-audit-run"],
	});

	registerIduCommand("semantic-compact-draft", {
		description: "Crear draft de compactación semántica Idu-pi",
		cliArgs: () => ["semantic-compact-draft"],
	});

	registerIduCommand("semantic-compact-review", {
		description: "Revisar draft de compactación semántica Idu-pi",
		cliArgs: (args) => ["semantic-compact-review", args || "latest"],
		usage: "/semantic-compact-review [latest|ruta]",
	});

	registerIduCommand("idu-semantic-compact-draft", {
		description: "Alias Idu-pi para draft de compactación semántica",
		cliArgs: () => ["semantic-compact-draft"],
	});

	registerIduCommand("idu-semantic-compact-review", {
		description: "Alias Idu-pi para revisar compactación semántica",
		cliArgs: (args) => ["semantic-compact-review", args || "latest"],
		usage: "/idu-semantic-compact-review [latest|ruta]",
	});
}
