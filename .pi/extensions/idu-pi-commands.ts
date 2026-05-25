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

	registerIduCommand("idu-supervisor-tick", {
		description: "Ejecutar supervisor Idu-pi",
		cliArgs: () => ["idu-supervisor-tick"],
	});

	registerIduCommand("idu-lab-review-plan", {
		description: "Preparar plan de revisión Lab sin ejecutar AgentLabs",
		cliArgs: (args) => ["lab-review-plan", args || "postflight"],
		usage: "/idu-lab-review-plan [postflight|preflight <solicitud>]",
	});

	registerIduCommand("idu-task", {
		description: "Crear tarea estructurada Idu-pi desde Pi CLI",
		cliArgs: (args) => ["idu-task", ...args.split(/\s+/u).filter(Boolean)],
		requiresArgs: true,
		usage:
			"/idu-task [bug|feature|refactor|docs|review] <detalle> | /idu-task <texto libre>",
	});

	registerIduCommand("idu-queue-detail", {
		description: "Ver cola estructurada Idu-pi",
		cliArgs: () => ["idu-queue-detail"],
	});

	registerIduCommand("idu-queue-clear-structured", {
		description: "Limpiar cola estructurada Idu-pi",
		cliArgs: () => ["idu-queue-clear-structured"],
	});

	registerIduCommand("idu-queue-approve", {
		description: "Aprobar tarea pausada en cola Idu-pi",
		cliArgs: (args) => ["idu-queue-approve", args],
		requiresArgs: true,
		usage: "/idu-queue-approve <id>",
	});

	registerIduCommand("idu-queue-reject", {
		description: "Rechazar tarea en cola Idu-pi",
		cliArgs: (args) => ["idu-queue-reject", args],
		requiresArgs: true,
		usage: "/idu-queue-reject <id>",
	});

	registerIduCommand("idu-semantic-audit-status", {
		description: "Mostrar estado de auditoría semántica Idu-pi",
		cliArgs: () => ["idu-semantic-audit-status"],
	});

	registerIduCommand("idu-semantic-audit-run", {
		description: "Registrar auditoría semántica manual Idu-pi",
		cliArgs: () => ["idu-semantic-audit-run"],
	});

	registerIduCommand("idu-semantic-compact-draft", {
		description: "Crear draft de compactación semántica Idu-pi",
		cliArgs: () => ["idu-semantic-compact-draft"],
	});

	registerIduCommand("idu-semantic-compact-review", {
		description: "Revisar draft de compactación semántica Idu-pi",
		cliArgs: (args) => ["idu-semantic-compact-review", args || "latest"],
		usage: "/idu-semantic-compact-review [latest|ruta]",
	});

	registerIduCommand("idu-semantic-agent-tasks-review", {
		description: "Revisar tareas AgentLab sugeridas por auditoría semántica",
		cliArgs: (args) => ["idu-semantic-agent-tasks-review", args || "latest"],
		usage: "/idu-semantic-agent-tasks-review [latest|ruta]",
	});

	registerIduCommand("idu-semantic-agent-tasks-create", {
		description: "Crear tareas review desde auditoría semántica",
		cliArgs: (args) => ["idu-semantic-agent-tasks-create", args || "latest"],
		usage: "/idu-semantic-agent-tasks-create [latest|ruta]",
	});

	registerIduCommand("idu-supervisor-improvements-review", {
		description:
			"Revisar propuestas de mejora del supervisor sin aplicar cambios",
		cliArgs: (args) => ["supervisor-improvements-review", args || "latest"],
		usage: "/idu-supervisor-improvements-review [latest|ruta]",
	});

	registerIduCommand("idu-supervisor-improvements-create", {
		description: "Crear propuestas review-only del supervisor en reports",
		cliArgs: (args) => ["supervisor-improvements-create", args || "latest"],
		usage: "/idu-supervisor-improvements-create [latest|ruta]",
	});

	registerIduCommand("idu-supervisor-improvements-status", {
		description: "Ver estados de propuestas de mejora del supervisor",
		cliArgs: (args) => ["supervisor-improvements-status", args || "latest"],
		usage: "/idu-supervisor-improvements-status [latest|ruta]",
	});

	registerIduCommand("idu-supervisor-improvements-approve", {
		description: "Aprobar propuestas de mejora sin aplicarlas",
		cliArgs: (args) => [
			"supervisor-improvements-approve",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-supervisor-improvements-approve latest <proposalId|all>",
	});

	registerIduCommand("idu-supervisor-improvements-reject", {
		description: "Rechazar propuestas de mejora sin borrarlas",
		cliArgs: (args) => [
			"supervisor-improvements-reject",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage:
			"/idu-supervisor-improvements-reject latest <proposalId|all> [motivo]",
	});

	registerIduCommand("idu-supervisor-improvements-defer", {
		description: "Diferir propuestas de mejora sin aplicarlas",
		cliArgs: (args) => [
			"supervisor-improvements-defer",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage:
			"/idu-supervisor-improvements-defer latest <proposalId|all> [motivo]",
	});

	registerIduCommand("idu-supervisor-improvements-apply", {
		description: "Aplicar sólo propuestas aprobadas como reglas dinámicas",
		cliArgs: (args) => ["supervisor-improvements-apply", args || "latest"],
		usage: "/idu-supervisor-improvements-apply [latest|ruta]",
	});

	registerIduCommand("idu-supervisor-learning-rules-status", {
		description: "Ver reglas dinámicas del supervisor",
		cliArgs: () => ["supervisor-learning-rules-status"],
		usage: "/idu-supervisor-learning-rules-status",
	});

	registerIduCommand("idu-supervisor-learning-rules-test", {
		description: "Probar reglas dinámicas del supervisor",
		cliArgs: () => ["supervisor-learning-rules-test"],
		usage: "/idu-supervisor-learning-rules-test",
	});

	registerIduCommand("idu-supervisor-learning-rules-disable", {
		description: "Desactivar una regla dinámica del supervisor",
		cliArgs: (args) => [
			"supervisor-learning-rules-disable",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-supervisor-learning-rules-disable <ruleId> [motivo]",
	});

	registerIduCommand("idu-supervisor-learning-rules-enable", {
		description: "Reactivar una regla dinámica del supervisor",
		cliArgs: (args) => [
			"supervisor-learning-rules-enable",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-supervisor-learning-rules-enable <ruleId> [motivo]",
	});

	registerIduCommand("idu-supervisor-learning-rules-rollback", {
		description: "Restaurar backup de reglas dinámicas del supervisor",
		cliArgs: (args) => ["supervisor-learning-rules-rollback", args || "latest"],
		usage: "/idu-supervisor-learning-rules-rollback [latest|backup]",
	});
}
