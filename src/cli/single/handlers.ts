// src/cli/single/handlers.ts
// PR 7k (Item 4): cluster K (single-shot cases) wrappers for the dispatch switch.
//
// 21 wrappers, one per case group. Each wrapper preserves its case body verbatim
// from src/cli.ts (modulo `activeRuntime` → `runtime` rename + signature).
//
// Cases covered (groups):
//   status
//   idu
//   idu-off
//   idu-status
//   idu-prepare | prepare
//   idu-project-reset-state | project-reset-state
//   idu-hygiene-migrate | hygiene-migrate
//   idu-ack-advisory | ack-advisory
//   idu-hygiene-sweep | hygiene-sweep
//   idu-preflight | preflight
//   idu-advisory | advisory
//   idu-postflight | postflight
//   idu-objective-status
//   idu-onboard-project | onboard-project
//   idu-bibliotecario-init | bibliotecario-init
//   idu-pending-injections | pending-injections
//   idu-decision-ledger | decision-ledger
//   idu-outbox-prune | outbox-prune
//   idu-subscribe-triggers | subscribe-triggers
//   idu-trigger-engine | trigger-engine
//   idu-trigger-show

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CliRuntime } from "../../cli.js";
import type { CliResult } from "../dispatch-glue/index.js";
import {
	activateIduSession,
	deactivateIduSession,
	formatIduSessionStatus,
	getIduSessionStatus,
} from "../../idu-session.js";
import { readPendingBlockingInjection } from "../../objective-injection.js";
import { recordLifecycleEvent } from "../../telemetry-lifecycle.js";
import { recordCliUsage } from "../usage.js";
import { ackAdvisory, type AckAdvisoryResult } from "../../idu-ack-advisory.js";
import {
	parseHygieneMigrateArgs,
	fail,
	ok,
	requiredText,
} from "../dispatch-glue/index.js";
import {
	migrateHygieneLayout,
	type MigrationResult,
} from "../../hygiene-migrate.js";
import {
	formatHygieneMigrateResult,
	formatHygieneSweepResult,
} from "../dispatch-glue/index.js";
import { runHygieneSensor } from "../../hygiene-sensor.js";
import { planSweep, type PlanSweepResult } from "../../sweep-command.js";
import { formatCliSupervisorStartupSection } from "../setup/index.js";
import { runOnboardProject } from "../../cli-onboard-project.js";
import {
	formatBibliotecarioInit,
	runBibliotecarioInit,
} from "../../cli-bibliotecario-init.js";
import {
	readPendingInjections,
	markInjectionAcked,
} from "../../injection-store.js";
import { listDecisions } from "../../decision-ledger.js";
import { applyPrune, planPrune } from "../../idu-outbox-prune.js";
import { formatTriggerSubscription } from "../tail-formatters/index.js";
import {
	disableTriggerEngineConfig,
	enableTriggerEngineConfig,
	formatTriggerEngineConfigResult,
	formatTriggerEngineConfigStatus,
	getTriggerEngineConfigStatus,
} from "../../trigger-engine-config.js";
import { TRIGGER_DEFINITIONS } from "../../trigger-engine.js";
import { formatPendingInjections } from "../tail-formatters/index.js";

/**
 * Build the PISO banner line for a workspace. Extracted from cli.ts
 * (formerly a private top-level function) so wrappers can call it
 * without going back through cli.ts.
 */
function pisoBannerLine(workspaceRoot: string): string {
	const blocking = readPendingBlockingInjection(workspaceRoot);
	if (!blocking) return "";
	const mins = Math.floor(blocking.ageMs / 60_000);
	return `\u26a0 BLOCKING: ${blocking.severity} ${blocking.kind} — ${blocking.summary} (acked=${blocking.acked}, ageMs=${blocking.ageMs} ~${mins}m) — pull \`idu_pending_injections\` and act\n`;
}

// 1. status
export function handleStatus(runtime: CliRuntime): CliResult {
	return ok(
		runtime.formatConnection(runtime.inspectConnection()),
	);
}

// 2. idu
export function handleIdu(runtime: CliRuntime, command: string): CliResult {
	activateIduSession(runtime.projectId);
	const supervisorStartup = runtime.supervisorOnIduActivation();
	recordCliUsage(runtime, command, { ok: true });
	return ok(
		[
			"Guardrails automáticos activados para el proyecto activo.",
			...formatCliSupervisorStartupSection(supervisorStartup),
			"",
			runtime.formatDashboard(runtime.inspectConnection()),
		].join("\n"),
	);
}

// 3. idu-off
export function handleIduOff(runtime: CliRuntime, command: string): CliResult {
	const status = deactivateIduSession(runtime.projectId);
	recordCliUsage(runtime, command, { ok: true });
	return ok(formatIduSessionStatus(status));
}

// 4. idu-status
export function handleIduStatus(
	runtime: CliRuntime,
	command: string,
): CliResult {
	const status = getIduSessionStatus(runtime.projectId);
	recordCliUsage(runtime, command, { ok: true });
	const banner = pisoBannerLine(runtime.workspaceRoot);
	return ok(banner + formatIduSessionStatus(status));
}

// 5. idu-prepare | prepare
export function handleIduPrepare(
	runtime: CliRuntime,
	command: string,
): CliResult {
	const result = runtime.prepare();
	recordCliUsage(runtime, command, { ok: true });
	return ok(runtime.formatPrepare(result));
}

// 6. idu-project-reset-state | project-reset-state
export function handleIduProjectResetState(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	return ok(
		runtime.formatProjectStateResetResult(
			runtime.projectStateReset(rest.includes("--yes")),
		),
	);
}

// 7. idu-hygiene-migrate | hygiene-migrate
export function handleIduHygieneMigrate(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const parsed = parseHygieneMigrateArgs(rest);
	const repoRoot = parsed.repoRoot ?? runtime.projectPath;
	if (!repoRoot) {
		return fail(
			"idu-hygiene-migrate requiere --repo-root <path> o un proyecto activo.",
		);
	}
	const result: MigrationResult = migrateHygieneLayout({
		repoRoot,
		stateRoot: runtime.workspaceRoot,
	});
	return {
		exitCode: result.errors.length > 0 ? 1 : 0,
		stdout: formatHygieneMigrateResult(repoRoot, result),
		stderr: "",
	};
}

// 8. idu-ack-advisory | ack-advisory
export function handleIduAckAdvisory(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const injectionId = rest[0];
	if (!injectionId) {
		return fail("Usage: idu-ack-advisory <injectionId> [reason...]");
	}
	const reason = rest.slice(1).join(" ").trim() || undefined;
	const result: AckAdvisoryResult = ackAdvisory({
		stateRoot: runtime.workspaceRoot,
		injectionId,
		reason,
	});
	return ok(`acked ${result.injectionId} (${result.reason})`);
}

// 9. idu-hygiene-sweep | hygiene-sweep
export function handleIduHygieneSweep(runtime: CliRuntime): CliResult {
	const repoRoot = runtime.projectPath;
	if (!repoRoot) {
		return fail(
			"idu-hygiene-sweep requiere un proyecto activo (runtime.projectPath).",
		);
	}
	const stateRoot = runtime.workspaceRoot;
	const sensorOutput = runHygieneSensor({
		stateRoot,
		repoPath: repoRoot,
	});
	const sweep: PlanSweepResult = planSweep({
		sensorOutput,
		stateRoot,
		repoPath: repoRoot,
		mode: "advisory",
	});
	return {
		exitCode: 0, // advisory only — never fail
		stdout: formatHygieneSweepResult(repoRoot, sweep),
		stderr: "",
	};
}

// 10. idu-preflight | preflight
export function handleIduPreflight(
	runtime: CliRuntime,
	command: string,
	rest: string[] = [],
): CliResult {
	const report = runtime.preflight(requiredText(rest));
	recordCliUsage(runtime, command, {
		risk: report.risk,
		recommendation: report.recommendedNext,
		allowedToProceed: report.okToProceed,
		requiresHuman: report.requiresHumanConfirmation,
		ok: report.okToProceed,
	});
	return ok(runtime.formatPreflight(report));
}

// 11. idu-advisory | advisory
export function handleIduAdvisory(
	runtime: CliRuntime,
	command: string,
	rest: string[] = [],
): CliResult {
	const advisory = runtime.advisory(requiredText(rest));
	recordCliUsage(runtime, command, {
		recommendation: advisory.recommendation,
		requiresHuman: advisory.requiresHumanConfirmation,
		allowedToProceed: advisory.okToProceed,
		ok: advisory.okToProceed,
	});
	return ok(runtime.formatAdvisory(advisory));
}

// 12. idu-postflight | postflight
export function handleIduPostflight(
	runtime: CliRuntime,
	command: string,
): CliResult {
	const report = runtime.postflight();
	recordCliUsage(runtime, command, {
		risk: report.risk,
		recommendation: report.recommendedNext,
		requiresHuman: report.requiresHumanConfirmation,
		ok: !report.requiresHumanConfirmation,
	});
	return ok(runtime.formatPostflight(report));
}

// 13. idu-objective-status
export function handleIduObjectiveStatus(runtime: CliRuntime): CliResult {
	// PR-A of objective-injection (PISO gate read path).
	// Read-only: no side effects, no enqueue. Use this to verify
	// the current PISO gate state from the CLI.
	const blocking = readPendingBlockingInjection(
		runtime.workspaceRoot,
	);
	const statePath = join(
		runtime.workspaceRoot,
		"objective-reminder.json",
	);
	const reminderExists = existsSync(statePath);
	return ok(
		`objective_reminder state:\n` +
			`  blocking: ${blocking ? `${blocking.severity} ${blocking.kind} (acked=${blocking.acked}, ageMs=${blocking.ageMs})` : "none"}\n` +
			`  state_file: ${reminderExists ? statePath : "not created yet"}\n`,
	);
}

// 14. idu-onboard-project | onboard-project
export function handleIduOnboardProject(runtime: CliRuntime): CliResult {
	const result = runOnboardProject(
		runtime.workspaceRoot,
		runtime.projectId,
		{
			projectPath: runtime.projectPath,
			allowedRoots: [
				runtime.projectPath,
				runtime.workspaceRoot,
			],
			registryPath: process.env.IDU_PI_REGISTRY_PATH,
		},
	);
	return {
		exitCode: result.exitCode,
		stdout: result.ok ? `${JSON.stringify(result, null, 2)}\n` : "",
		stderr: result.ok ? "" : `${JSON.stringify(result, null, 2)}\n`,
	};
}

// 15. idu-bibliotecario-init | bibliotecario-init
export function handleIduBibliotecarioInit(runtime: CliRuntime): CliResult {
	const result = runBibliotecarioInit({
		stateRoot: runtime.workspaceRoot,
		projectId: runtime.projectId,
	});
	if (!result.ok) {
		return fail(result.error);
	}
	return ok(formatBibliotecarioInit(result));
}

// 16. idu-pending-injections | pending-injections
export function handleIduPendingInjections(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const params = rest.join(" ").trim();
	// AUDITOR-FIX-A: default ack = FALSE. A routine pull (no flag)
	// only writes `delivered`. `ack:true` must be EXPLICIT — that's
	// the deliberate dismissal escape hatch. If we default to true,
	// every pull dismisses + acks the advisory, defeating Item 5's
	// forced-pull escalation.
	const ack = /\back\s*:\s*true\b/.test(params);
	const pending = readPendingInjections(runtime.workspaceRoot, {});
	if (pending.length > 0) {
		for (const inj of pending) {
			// Wire telemetry: write `delivered` for each surfaced
			// advisory (#2467). The cron evaluator calls
			// markInjectionAcked when it writes `resolved` or
			// `expired` (per-kind policy). The path is included
			// for hygiene advisories so the path-absent
			// predicate can be constructed.
			const meta = inj.meta as { path?: string } | undefined;
			recordLifecycleEvent({
				stateRoot: runtime.workspaceRoot,
				injectionId: inj.injectionId,
				phase: "delivered",
				kind: inj.kind,
				path: meta?.path,
				now: new Date(),
			});
			if (ack) {
				// ack:true on the pull = deliberate dismissal (escape
				// hatch). Same guard as idu_ack_advisory: only
				// write the `dismissed` event on a real
				// transition. The #156 audit caught the
				// phantom-dismissal bug; the MCP server
				// twin and this CLI mirror were both fixed
				// in the same commit.
				const outcome = markInjectionAcked(
					runtime.workspaceRoot,
					inj.injectionId,
				);
				if (outcome === "acked") {
					recordLifecycleEvent({
						stateRoot: runtime.workspaceRoot,
						injectionId: inj.injectionId,
						phase: "dismissed",
						kind: inj.kind,
						reason: "idu-pending-injections ack:true",
						now: new Date(),
					});
				}
			}
		}
	}
	const banner = pisoBannerLine(runtime.workspaceRoot);
	return ok(banner + formatPendingInjections(pending, ack));
}

// 17. idu-decision-ledger | decision-ledger
export function handleIduDecisionLedger(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	// Syntax: idu-decision-ledger list [--project <id>] [--since <iso>] [--limit N]
	let projectId = "";
	let since: string | undefined;
	let limit = 50;
	for (const arg of rest) {
		if (arg.startsWith("--project=")) {
			projectId = arg.slice("--project=".length);
			continue;
		}
		if (arg.startsWith("--since=")) {
			since = arg.slice("--since=".length);
			continue;
		}
		const m = /^--limit\s+(\d+)$/u.exec(arg);
		if (m) limit = Number(m[1]);
	}
	if (!projectId) {
		projectId = runtime.workspaceRoot;
	}
	const dbPath = join(runtime.workspaceRoot, "lab.db");
	const decisions = listDecisions(dbPath, { projectId, since, limit });
	return ok(
		[
			`Decision ledger for projectId=${projectId}`,
			`count: ${decisions.length}`,
			"",
			...decisions.map((d) => {
				const rationale = d.rationale ? ` — ${d.rationale}` : "";
				return `[${d.id}] ${d.decidedAt} ${d.decidedBy} ${d.decision} ${d.targetKind}:${d.targetId}${d.profileRef ? ` (profile: ${d.profileRef})` : ""}${rationale}`;
			}),
		].join("\n"),
	);
}

// 18. idu-outbox-prune | outbox-prune
export function handleIduOutboxPrune(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	// Syntax: idu-outbox-prune [--older-than 30d] [--confirm]
	let olderThanDays = 30;
	let confirm = false;
	for (const arg of rest) {
		if (arg === "--confirm") {
			confirm = true;
			continue;
		}
		const m = /^--older-than\s+(\d+)([dhm])$/u.exec(arg);
		if (m) {
			const n = Number(m[1]);
			const unit = m[2];
			if (unit === "d") olderThanDays = n;
			else if (unit === "h")
				olderThanDays = Math.max(1, Math.round(n / 24));
			else if (unit === "m")
				olderThanDays = Math.max(1, Math.round(n / 60 / 24));
		}
	}
	const plan = planPrune(runtime.workspaceRoot, { olderThanDays });
	if (!confirm) {
		return ok(
			[
				"Outbox prune — DRY RUN (use --confirm to apply)",
				`cutoff: ${plan.cutoff}`,
				`proposals prunable: ${plan.proposals.length}`,
				`injections prunable: ${plan.injections.length}`,
				"",
				"Nada se modifica. Re-correr con --confirm para archivar.",
			].join("\n"),
		);
	}
	const result = applyPrune(runtime.workspaceRoot, plan, {
		olderThanDays,
	});
	return ok(
		[
			"Outbox prune — applied",
			`cutoff: ${result.cutoff}`,
			`archive: ${result.archiveDir}`,
			`archived: proposals=${result.archived.proposals}, injections=${result.archived.injections}`,
			`removed (live): proposals=${result.removed.proposals}, injections=${result.removed.injections}`,
		].join("\n"),
	);
}

// 19. idu-subscribe-triggers | subscribe-triggers
export function handleIduSubscribeTriggers(): CliResult {
	return ok(formatTriggerSubscription());
}

// 20. idu-trigger-engine | trigger-engine
export function handleIduTriggerEngine(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const subcommand = (rest.shift() ?? "status").toLowerCase();
	const stateRoot = runtime.workspaceRoot;
	if (subcommand === "enable") {
		return ok(
			formatTriggerEngineConfigResult(
				enableTriggerEngineConfig(stateRoot, {
					source: "cli",
					now: new Date(),
				}),
			),
		);
	}
	if (subcommand === "disable") {
		return ok(
			formatTriggerEngineConfigResult(
				disableTriggerEngineConfig(stateRoot, {
					source: "cli",
					now: new Date(),
				}),
			),
		);
	}
	if (subcommand === "status") {
		return ok(
			formatTriggerEngineConfigStatus(
				getTriggerEngineConfigStatus(stateRoot),
			),
		);
	}
	return fail(
		`Subcomando no reconocido: ${subcommand}. Usá enable | disable | status.`,
	);
}

// 21. idu-trigger-show
export function handleIduTriggerShow(rest: string[] = []): CliResult {
	const triggerId = rest[0];
	if (!triggerId) {
		return fail("Uso: idu-trigger-show <triggerId>");
	}
	const def = TRIGGER_DEFINITIONS.find((d) => d.id === triggerId);
	if (!def) {
		return fail(`Trigger not found: ${triggerId}`);
	}
	const cadenceMap: Record<string, string> = {
		objective_reminder_hourly:
			"1h after the master-plan-objective-cache.json `updatedAt`",
		stuck_tasks_1h:
			"1h after task_stuck event without subsequent task_created",
		intention_decision_pending:
			"30min after intention_decision_pending event",
	};
	const cadence = cadenceMap[def.id] || "not specified";
	const output = [
		`ID: ${def.id}`,
		`Description: ${def.description}`,
		`Kinds: ${def.kinds.join(", ")}`,
		`Signature: ${def.signature}`,
		`Contract:`,
		`  - decisionRequired: ${def.contract.decisionRequired}`,
		`  - severity: ${def.contract.severity}`,
		`  - options: [${def.contract.options.join(", ")}]`,
		`Cadence: ${cadence}`,
	].join("\n");
	return ok(output);
}
