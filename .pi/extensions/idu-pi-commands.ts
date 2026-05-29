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

	function registerIduAliases(name: string, config: CliCommand) {
		registerIduCommand(name.replace(/-/gu, "_"), config);
	}

	registerIduAliases("idu", {
		description: "Activar guardrails automáticos de Idu-pi",
		cliArgs: () => ["idu"],
	});

	registerIduAliases("idu-status", {
		description: "Mostrar estado de sesión Idu-pi",
		cliArgs: () => ["idu-status"],
	});

	registerIduAliases("idu-off", {
		description: "Desactivar guardrails automáticos de Idu-pi",
		cliArgs: () => ["idu-off"],
	});

	registerIduAliases("idu-prepare", {
		description: "Ejecutar prepare seguro de Idu-pi",
		cliArgs: () => ["idu-prepare"],
	});

	registerIduAliases("idu-project-reset-state", {
		description: "Borrar estado aislado del proyecto sin tocar repo real",
		cliArgs: (args) => [
			"idu-project-reset-state",
			...args.split(/\s+/u).filter(Boolean),
		],
		usage: "/idu-project-reset-state --yes",
	});

	registerIduAliases("idu-preflight", {
		description: "Evaluar riesgo preflight para una solicitud",
		cliArgs: (args) => ["idu-preflight", args],
		requiresArgs: true,
		usage: "/idu-preflight <solicitud>",
	});

	registerIduAliases("idu-advisory", {
		description: "Mostrar advisory manual para una solicitud",
		cliArgs: (args) => ["idu-advisory", args],
		requiresArgs: true,
		usage: "/idu-advisory <solicitud>",
	});

	registerIduAliases("idu-postflight", {
		description: "Analizar cambios actuales con postflight",
		cliArgs: () => ["idu-postflight"],
	});

	registerIduAliases("idu-supervisor-tick", {
		description: "Ejecutar supervisor Idu-pi",
		cliArgs: () => ["idu-supervisor-tick"],
	});

	registerIduAliases("idu-review", {
		description: "Revisión simple del proyecto con Plan Maestro",
		cliArgs: () => ["idu-review"],
		usage: "/idu-review",
	});

	registerIduAliases("idu-master-plan-status", {
		description: "Ver estado del Plan Maestro Idu-pi",
		cliArgs: () => ["idu-master-plan-status"],
	});

	registerIduAliases("idu-master-plan-review", {
		description: "Revisar Plan Maestro Idu-pi sin aplicarlo",
		cliArgs: (args) => ["idu-master-plan-review", args || "latest"],
		usage: "/idu-master-plan-review [latest|ruta]",
	});

	registerIduAliases("idu-master-plan-approve", {
		description: "Aprobar Plan Maestro Idu-pi sin aplicar flows",
		cliArgs: (args) => ["idu-master-plan-approve", args || "latest"],
		usage: "/idu-master-plan-approve [latest|ruta]",
	});

	registerIduAliases("idu-master-plan-reject", {
		description: "Rechazar Plan Maestro Idu-pi",
		cliArgs: (args) => [
			"idu-master-plan-reject",
			...(args ? args.split(/\s+/u) : ["latest"]),
		],
		usage: "/idu-master-plan-reject [latest|ruta] [motivo]",
	});

	registerIduAliases("idu-master-plan-redraft", {
		description: "Rehacer Plan Maestro Idu-pi",
		cliArgs: (args) => ["idu-master-plan-redraft", args],
		usage: "/idu-master-plan-redraft [motivo]",
	});

	registerIduAliases("idu-lab-review-plan", {
		description: "Preparar plan de revisión Lab sin ejecutar AgentLabs",
		cliArgs: (args) => ["idu-lab-review-plan", args || "postflight"],
		usage: "/idu-lab-review-plan [postflight|preflight <solicitud>]",
	});

	registerIduAliases("idu-agentlab-request-create", {
		description: "Crear solicitud AgentLab sin ejecutar revisión",
		cliArgs: (args) => [
			"idu-agentlab-request-create",
			...args.split(/\s+/u).filter(Boolean),
		],
		usage:
			"/idu-agentlab-request-create [postflight|master-plan latest|skill-draft latest]",
	});

	registerIduAliases("idu-agentlab-request-review", {
		description: "Revisar solicitud AgentLab sin ejecutarla",
		cliArgs: (args) => ["idu-agentlab-request-review", args || "latest"],
		usage: "/idu-agentlab-request-review [latest|ruta]",
	});

	registerIduAliases("idu-agentlab-review-run", {
		description: "Ejecutar revisión AgentLab review-only",
		cliArgs: (args) => ["idu-agentlab-review-run", args || "latest"],
		usage: "/idu-agentlab-review-run [latest|ruta]",
	});

	registerIduAliases("idu-agentlab-review-status", {
		description: "Ver informe AgentLab review-only",
		cliArgs: (args) => ["idu-agentlab-review-status", args || "latest"],
		usage: "/idu-agentlab-review-status [latest|ruta]",
	});

	registerIduAliases("idu-task", {
		description: "Crear tarea estructurada Idu-pi desde Pi CLI",
		cliArgs: (args) => ["idu-task", ...args.split(/\s+/u).filter(Boolean)],
		requiresArgs: true,
		usage:
			"/idu-task [bug|feature|refactor|docs|review] <detalle> | /idu-task <texto libre>",
	});

	registerIduAliases("idu-queue-detail", {
		description: "Ver cola estructurada Idu-pi",
		cliArgs: () => ["idu-queue-detail"],
	});

	registerIduAliases("idu-queue-clear-structured", {
		description: "Limpiar cola estructurada Idu-pi",
		cliArgs: () => ["idu-queue-clear-structured"],
	});

	registerIduAliases("idu-queue-approve", {
		description: "Aprobar tarea pausada en cola Idu-pi",
		cliArgs: (args) => ["idu-queue-approve", args],
		requiresArgs: true,
		usage: "/idu-queue-approve <id>",
	});

	registerIduAliases("idu-queue-reject", {
		description: "Rechazar tarea en cola Idu-pi",
		cliArgs: (args) => ["idu-queue-reject", args],
		requiresArgs: true,
		usage: "/idu-queue-reject <id>",
	});

	registerIduAliases("idu-semantic-audit-status", {
		description: "Mostrar estado de auditoría semántica Idu-pi",
		cliArgs: () => ["idu-semantic-audit-status"],
	});

	registerIduAliases("idu-semantic-audit-run", {
		description: "Registrar auditoría semántica manual Idu-pi",
		cliArgs: () => ["idu-semantic-audit-run"],
	});

	registerIduAliases("idu-semantic-compact-draft", {
		description: "Crear draft de compactación semántica Idu-pi",
		cliArgs: () => ["idu-semantic-compact-draft"],
	});

	registerIduAliases("idu-semantic-compact-review", {
		description: "Revisar draft de compactación semántica Idu-pi",
		cliArgs: (args) => ["idu-semantic-compact-review", args || "latest"],
		usage: "/idu-semantic-compact-review [latest|ruta]",
	});

	registerIduAliases("idu-semantic-agent-tasks-review", {
		description: "Revisar tareas AgentLab sugeridas por auditoría semántica",
		cliArgs: (args) => ["idu-semantic-agent-tasks-review", args || "latest"],
		usage: "/idu-semantic-agent-tasks-review [latest|ruta]",
	});

	registerIduAliases("idu-semantic-agent-tasks-create", {
		description: "Crear tareas review desde auditoría semántica",
		cliArgs: (args) => ["idu-semantic-agent-tasks-create", args || "latest"],
		usage: "/idu-semantic-agent-tasks-create [latest|ruta]",
	});

	registerIduAliases("idu-supervisor-improvements-review", {
		description:
			"Revisar propuestas de mejora del supervisor sin aplicar cambios",
		cliArgs: (args) => ["idu-supervisor-improvements-review", args || "latest"],
		usage: "/idu-supervisor-improvements-review [latest|ruta]",
	});

	registerIduAliases("idu-supervisor-improvements-create", {
		description: "Crear propuestas review-only del supervisor en reports",
		cliArgs: (args) => ["idu-supervisor-improvements-create", args || "latest"],
		usage: "/idu-supervisor-improvements-create [latest|ruta]",
	});

	registerIduAliases("idu-supervisor-improvements-status", {
		description: "Ver estados de propuestas de mejora del supervisor",
		cliArgs: (args) => ["idu-supervisor-improvements-status", args || "latest"],
		usage: "/idu-supervisor-improvements-status [latest|ruta]",
	});

	registerIduAliases("idu-supervisor-improvements-approve", {
		description: "Aprobar propuestas de mejora sin aplicarlas",
		cliArgs: (args) => [
			"idu-supervisor-improvements-approve",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-supervisor-improvements-approve latest <proposalId|all>",
	});

	registerIduAliases("idu-supervisor-improvements-reject", {
		description: "Rechazar propuestas de mejora sin borrarlas",
		cliArgs: (args) => [
			"idu-supervisor-improvements-reject",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage:
			"/idu-supervisor-improvements-reject latest <proposalId|all> [motivo]",
	});

	registerIduAliases("idu-supervisor-improvements-defer", {
		description: "Diferir propuestas de mejora sin aplicarlas",
		cliArgs: (args) => [
			"idu-supervisor-improvements-defer",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage:
			"/idu-supervisor-improvements-defer latest <proposalId|all> [motivo]",
	});

	registerIduAliases("idu-supervisor-improvements-apply", {
		description: "Aplicar sólo propuestas aprobadas como reglas dinámicas",
		cliArgs: (args) => ["idu-supervisor-improvements-apply", args || "latest"],
		usage: "/idu-supervisor-improvements-apply [latest|ruta]",
	});

	registerIduAliases("idu-skill-improvements-review", {
		description: "Revisar propuestas de mejora de skills sin aplicar cambios",
		cliArgs: (args) => ["idu-skill-improvements-review", args || "latest"],
		usage: "/idu-skill-improvements-review [latest|ruta]",
	});

	registerIduAliases("idu-skill-improvements-create", {
		description: "Crear propuestas review-only de skills en reports",
		cliArgs: (args) => ["idu-skill-improvements-create", args || "latest"],
		usage: "/idu-skill-improvements-create [latest|ruta]",
	});

	registerIduAliases("idu-skill-improvements-status", {
		description: "Ver estados de propuestas de mejora de skills",
		cliArgs: (args) => ["idu-skill-improvements-status", args || "latest"],
		usage: "/idu-skill-improvements-status [latest|ruta]",
	});

	registerIduAliases("idu-skill-improvements-approve", {
		description: "Aprobar propuesta de mejora de skill sin aplicarla",
		cliArgs: (args) => [
			"idu-skill-improvements-approve",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-skill-improvements-approve latest <proposalId|all>",
	});

	registerIduAliases("idu-skill-improvements-reject", {
		description: "Rechazar propuesta de mejora de skill sin borrarla",
		cliArgs: (args) => [
			"idu-skill-improvements-reject",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-skill-improvements-reject latest <proposalId|all> [motivo]",
	});

	registerIduAliases("idu-skill-improvements-defer", {
		description: "Diferir propuesta de mejora de skill sin aplicarla",
		cliArgs: (args) => [
			"idu-skill-improvements-defer",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-skill-improvements-defer latest <proposalId|all> [motivo]",
	});

	registerIduAliases("idu-skill-drafts-create", {
		description: "Crear borradores de skills desde propuestas aprobadas",
		cliArgs: (args) => ["idu-skill-drafts-create", args || "latest"],
		usage: "/idu-skill-drafts-create [latest|ruta]",
	});

	registerIduAliases("idu-skill-drafts-review", {
		description: "Revisar borrador de skill sin aplicar cambios",
		cliArgs: (args) => ["idu-skill-drafts-review", args || "latest"],
		usage: "/idu-skill-drafts-review [latest|ruta]",
	});

	registerIduAliases("idu-supervisor-learning-rules-status", {
		description: "Ver reglas dinámicas del supervisor",
		cliArgs: () => ["idu-supervisor-learning-rules-status"],
		usage: "/idu-supervisor-learning-rules-status",
	});

	registerIduAliases("idu-supervisor-learning-rules-test", {
		description: "Probar reglas dinámicas del supervisor",
		cliArgs: () => ["idu-supervisor-learning-rules-test"],
		usage: "/idu-supervisor-learning-rules-test",
	});

	registerIduAliases("idu-supervisor-learning-rules-disable", {
		description: "Desactivar una regla dinámica del supervisor",
		cliArgs: (args) => [
			"idu-supervisor-learning-rules-disable",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-supervisor-learning-rules-disable <ruleId> [motivo]",
	});

	registerIduAliases("idu-supervisor-learning-rules-enable", {
		description: "Reactivar una regla dinámica del supervisor",
		cliArgs: (args) => [
			"idu-supervisor-learning-rules-enable",
			...args.split(/\s+/u).filter(Boolean),
		],
		requiresArgs: true,
		usage: "/idu-supervisor-learning-rules-enable <ruleId> [motivo]",
	});

	registerIduAliases("idu-supervisor-learning-rules-rollback", {
		description: "Restaurar backup de reglas dinámicas del supervisor",
		cliArgs: (args) => [
			"idu-supervisor-learning-rules-rollback",
			args || "latest",
		],
		usage: "/idu-supervisor-learning-rules-rollback [latest|backup]",
	});
}
