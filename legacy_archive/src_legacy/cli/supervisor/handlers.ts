/**
 * handlers.ts — supervisor cluster (G) case wrappers for the dispatch
 * switch.
 *
 * PR 7e of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 16 cases that belong to the supervisor
 * cluster:
 *
 *   - idu-run-cron-preflight
 *   - idu-check-user-escalation
 *   - idu-supervisor-tick | supervisor-tick
 *   - idu-supervisor-improvements-review | supervisor-improvements-review
 *   - idu-supervisor-improvements-create | supervisor-improvements-create
 *   - idu-supervisor-improvements-status | supervisor-improvements-status
 *   - idu-supervisor-improvements-approve | supervisor-improvements-approve
 *   - idu-supervisor-improvements-reject | supervisor-improvements-reject
 *   - idu-supervisor-improvements-defer | supervisor-improvements-defer
 *   - idu-supervisor-improvements-apply | supervisor-improvements-apply
 *   - idu-supervisor-learning-rules-status | supervisor-learning-rules-status
 *   - idu-supervisor-learning-rules-test | supervisor-learning-rules-test
 *   - idu-supervisor-learning-rules-disable | supervisor-learning-rules-disable
 *   - idu-supervisor-learning-rules-enable | supervisor-learning-rules-enable
 *   - idu-supervisor-learning-rules-rollback | supervisor-learning-rules-rollback
 *   - idu-supervisor-trigger | supervisor-trigger
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` (or no
 * rest) and contains the body verbatim from the original case
 * (modulo the `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 */

import {
	requiredText,
	requiredDecisionParts,
	requiredRuleDecisionParts,
} from "../dispatch-glue/parsers.js";
import { ok, fail } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import {
	disableSupervisorTrigger,
	enableSupervisorTrigger,
	formatSupervisorTriggerResult,
	formatSupervisorTriggerStatus,
	getSupervisorTriggerStatus,
} from "../../supervisor-trigger.js";
import { formatLiveness } from "../../liveness-check.js";
import { existsSync, readFileSync } from "node:fs";
import {
	formatLastTick,
	parseLastTick,
	TickParseError,
} from "../../supervisor-tick-last.js";

export async function handleRunCronPreflight(
	runtime: CliRuntime,
	rest: string[] = [],
): Promise<CliResult> {
	// Cron entry point: runs postflight → sensor → AgentLab →
	// supervisor chain and writes a supervisor_advisory to
	// injections.jsonl. Reuses the same promptForRole as the
	// MCP path so role-rails and cooldowns are shared.
	//
	// Opt-in `--json` flag: emit the full structured metrics
	// (sensorImpulseMetrics + supervisorAdvisory) instead of the
	// one-line human summary. The flag is filtered out of
	// `changedFiles` so it is never treated as a filename by the
	// sensor matcher. Default output is byte-identical when absent.
	const jsonMode = rest.includes("--json");
	const changedFiles = jsonMode ? rest.filter((arg) => arg !== "--json") : rest;
	const result = await runtime.runCronPreflight?.({
		changedFiles,
	});
	if (!result) {
		return ok("Cron preflight: not available in this runtime\n");
	}
	if (jsonMode) {
		// Pretty-printed (2-space) JSON so a human or a pipe can consume it.
		// supervisorAdvisory fields are pulled from result.supervisorAdvisory.advisory;
		// when the advisory sub-object is absent (e.g. reason=role_not_enabled),
		// summary/counts fall back to null and the discard fields to their
		// documented empty-state defaults (0 / "").
		const advisory = result.supervisorAdvisory;
		const payload = {
			sensorImpulses: result.sensorImpulses.length,
			sensorImpulseMetrics: result.sensorImpulseMetrics,
			supervisorAdvisory: advisory
				? {
						ok: advisory.ok,
						summary: advisory.advisory?.summary ?? null,
						counts: advisory.advisory?.counts ?? null,
						discardsCount: advisory.advisory?.discardsCount ?? 0,
						discardsSummary: advisory.advisory?.discardsSummary ?? "",
					}
				: null,
		};
		return ok(`${JSON.stringify(payload, null, 2)}\n`);
	}
	const advisoryLine = result.supervisorAdvisory
		? (result.supervisorAdvisory.advisory?.summary ??
			result.supervisorAdvisory.reason ??
			"ok")
		: "null";
	return ok(
		`Cron preflight: sensorImpulses=${result.sensorImpulses.length} supervisorAdvisory=${advisoryLine}\n`,
	);
}

export async function handleCheckUserEscalation(
	runtime: CliRuntime,
): Promise<CliResult> {
	// PR-105c. Reads last-user-interaction.json (if present) and
	// runs the user escalation check. Writes user-escalations.jsonl
	// if any threshold is breached.
	const result = await runtime.checkUserEscalation?.({});
	if (!result) {
		return ok("User escalation: not available in this runtime\n");
	}
	if (result.shouldEscalate) {
		return ok(
			`User escalation: shouldEscalate=true reasons=${result.reasons.join(",")} critical=${result.counts.critical} total=${result.counts.total} hoursSince=${result.hoursSinceLastInteraction.toFixed(1)} escalationId=${result.escalationId}\n`,
		);
	}
	return ok(
		`User escalation: shouldEscalate=false critical=${result.counts.critical} total=${result.counts.total} hoursSince=${result.hoursSinceLastInteraction.toFixed(1)}\n`,
	);
}

export function handleCheckLiveness(runtime: CliRuntime): CliResult {
	const result = runtime.checkLiveness?.();
	if (!result) {
		return ok("Liveness: not available in this runtime\n");
	}
	return ok(`${formatLiveness(result)}\n`);
}

export function handleSupervisorTick(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatSupervisorTick(runtime.supervisorTick()),
	);
}

export function handleSupervisorTickLast(rest: string[] = []): CliResult {
	// Issue #424. Read-only: parses the LAST COMPLETE tick from the
	// configured supervisor-tick.log and renders a compact hierarchy.
	// Does not touch the live tick output.
	//
	// Log resolution is CONFIGURABLE ONLY (--log or IDU_PI_TICK_LOG).
	// No default: since #483 the tick writes to the deploy's log, not the
	// CLI checkout's, whose supervisor-tick.log is frozen. Silently
	// defaulting to the checkout log would report a stale tick as current
	// (the #490 family). If neither is set, fail with an actionable error.
	const verbose = rest.includes("--verbose");
	let logPath: string | undefined;
	const logIdx = rest.indexOf("--log");
	if (logIdx >= 0) {
		const value = rest[logIdx + 1];
		if (typeof value === "string" && value.length > 0) logPath = value;
	}
	logPath = logPath ?? process.env.IDU_PI_TICK_LOG?.trim();
	if (!logPath) {
		return fail(
			"No configuraste el log del tick (IDU_PI_TICK_LOG o --log).\n\n" +
				"El tick ya no escribe en el log del checkout del CLI: desde el PR #483 corre desde el " +
				"directorio de deploy, y el supervisor-tick.log del checkout quedó congelado. " +
				"Leer ese log daría el último tick viejo (p. ej. de hace días) y lo reportaría como si fuera " +
				"el actual — una mentira silenciosa.\n\n" +
				"Establecé la variable IDU_PI_TICK_LOG apuntando al supervisor-tick.log del deploy (la ruta " +
				"real de tu máquina) o pasá --log <ruta>.",
		);
	}
	if (!existsSync(logPath)) {
		return fail(`No existe el archivo de log del tick: ${logPath}`);
	}
	let text: string;
	try {
		text = readFileSync(logPath, "utf8");
	} catch (err) {
		return fail(`No pude leer el log del tick (${logPath}): ${(err as Error).message}`);
	}
	try {
		const tick = parseLastTick(text);
		return ok(formatLastTick(tick, { verbose }));
	} catch (err) {
		if (err instanceof TickParseError) return fail(err.message);
		throw err;
	}
}

export function handleSupervisorImprovementsReview(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSupervisorImprovementPlan(
			runtime.supervisorImprovementPlan(requiredText(rest)),
		),
	);
}

export function handleSupervisorImprovementsCreate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSupervisorImprovementCreationResult(
			runtime.supervisorImprovementCreate(requiredText(rest)),
		),
	);
}

export function handleSupervisorImprovementsStatus(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSupervisorImprovementStatus(
			runtime.supervisorImprovementStatus(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleSupervisorImprovementsApprove(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredDecisionParts(rest);
	return ok(
		runtime.formatSupervisorImprovementDecisionResult(
			runtime.supervisorImprovementApprove(
				decision.pathOrLatest,
				decision.proposalIdOrAll,
				decision.reason,
			),
		),
	);
}

export function handleSupervisorImprovementsReject(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredDecisionParts(rest);
	return ok(
		runtime.formatSupervisorImprovementDecisionResult(
			runtime.supervisorImprovementReject(
				decision.pathOrLatest,
				decision.proposalIdOrAll,
				decision.reason,
			),
		),
	);
}

export function handleSupervisorImprovementsDefer(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredDecisionParts(rest);
	return ok(
		runtime.formatSupervisorImprovementDecisionResult(
			runtime.supervisorImprovementDefer(
				decision.pathOrLatest,
				decision.proposalIdOrAll,
				decision.reason,
			),
		),
	);
}

export function handleSupervisorImprovementsApply(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSupervisorLearningRulesApplyResult(
			runtime.supervisorImprovementsApply(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleSupervisorLearningRulesStatus(
	runtime: CliRuntime,
): CliResult {
	return ok(
		runtime.formatSupervisorLearningRulesStatus(
			runtime.supervisorLearningRulesStatus(),
		),
	);
}

export function handleSupervisorLearningRulesTest(
	runtime: CliRuntime,
): CliResult {
	return ok(
		runtime.formatSupervisorLearningRulesTest(
			runtime.supervisorLearningRulesTest(),
		),
	);
}

export function handleSupervisorLearningRulesDisable(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredRuleDecisionParts(rest);
	return ok(
		runtime.formatSupervisorLearningRuleDecision(
			runtime.supervisorLearningRulesDisable(
				decision.ruleId,
				decision.reason,
			),
		),
	);
}

export function handleSupervisorLearningRulesEnable(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const decision = requiredRuleDecisionParts(rest);
	return ok(
		runtime.formatSupervisorLearningRuleDecision(
			runtime.supervisorLearningRulesEnable(
				decision.ruleId,
				decision.reason,
			),
		),
	);
}

export function handleSupervisorLearningRulesRollback(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatSupervisorLearningRulesRollback(
			runtime.supervisorLearningRulesRollback(
				rest.join(" ").trim() || "latest",
			),
		),
	);
}

export function handleSupervisorTrigger(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const subcommand = (rest.shift() ?? "status").toLowerCase();
	const stateRoot = runtime.workspaceRoot;
	if (subcommand === "enable") {
		return ok(
			formatSupervisorTriggerResult(
				enableSupervisorTrigger(stateRoot, {
					source: "cli",
					now: new Date(),
				}),
			),
		);
	}
	if (subcommand === "disable") {
		return ok(
			formatSupervisorTriggerResult(
				disableSupervisorTrigger(stateRoot, {
					source: "cli",
					now: new Date(),
				}),
			),
		);
	}
	if (subcommand === "status") {
		return ok(
			formatSupervisorTriggerStatus(
				getSupervisorTriggerStatus(stateRoot),
			),
		);
	}
	return fail(
		`Subcomando no reconocido: ${subcommand}. Usá enable | disable | status.`,
	);
}