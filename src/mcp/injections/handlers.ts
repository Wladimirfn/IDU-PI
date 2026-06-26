// src/mcp/injections/handlers.ts
//
// PR 16 (Item 4, mcp-server god-file breakup): cluster N (injections-hygiene)
// wrappers for the dispatchTool switch.
//
// 6 wrappers, one per case group (single label, no fall-through):
//   - handlePendingInjections   (idu_pending_injections)
//   - handleHygieneMigrate      (idu_hygiene_migrate)
//   - handleHygieneSweep        (idu_hygiene_sweep)
//   - handleAckAdvisory         (idu_ack_advisory)
//   - handleOutboxPrune         (idu_outbox_prune)
//   - handleSubscribeTriggers   (idu_subscribe_triggers)
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name, args, runtime, resolution params).
//
// Free vars used (locked template):
//   - name: IduMcpToolName (param)
//   - args: JsonObject (param)
//   - runtime: CliRuntime (param)
//   - resolution: IduMcpProjectResolution (param)
//   - All other identifiers are imports or already-imported helpers.

import type { CliRuntime } from "../../cli.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	markInjectionAcked,
	readPendingInjections,
} from "../../injection-store.js";
import { ackAdvisory, type AckAdvisoryResult } from "../../idu-ack-advisory.js";
import { applyPrune, planPrune } from "../../idu-outbox-prune.js";
import { migrateHygieneLayout, type MigrationResult } from "../../hygiene-migrate.js";
import { runHygieneSensor } from "../../hygiene-sensor.js";
import { recordLifecycleEvent } from "../../telemetry-lifecycle.js";
import { TRIGGER_DEFINITIONS } from "../../trigger-engine.js";
import { planSweep, type PlanSweepResult } from "../../sweep-command.js";
import { envelope } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_pending_injections — read pending injections from stateRoot.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handlePendingInjections(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as { ack?: boolean };
	// AUDITOR-FIX-A: default ack = FALSE. A routine pull (no flag)
	// only writes `delivered`. ack:true must be EXPLICIT — that's
	// the deliberate dismissal escape hatch. If we default to true,
	// every pull dismisses + acks the advisory, defeating Item 5's
	// forced-pull escalation. (Use idu_ack_advisory for the
	// dedicated escape hatch tool.)
	const ack = params.ack === true;
	const pending = readPendingInjections(stateRoot, {});
	if (pending.length > 0) {
		for (const inj of pending) {
			// Wire telemetry: write `delivered` for each surfaced advisory (#2467).
			// The cron evaluator will call markInjectionAcked when it writes
			// `resolved` (clear PISO gate) or `expired` (per-kind policy).
			// The path is included for hygiene advisories so the
			// path-absent predicate can be constructed.
			const meta = inj.meta as { path?: string } | undefined;
			recordLifecycleEvent({
				stateRoot,
				injectionId: inj.injectionId,
				phase: "delivered",
				kind: inj.kind,
				path: meta?.path,
				now: new Date(),
			});
			if (ack) {
				// A.2: ack-side coupling. Pass `phase: "dismissed"`
				// so the central markInjectionAcked auto-emits the
				// terminal event in the same atomic call. The
				// phantom-dismissal guard from the #156 audit is
				// preserved INSIDE markInjectionAcked (auto-emit only
				// on `outcome === "acked"`). The `outcome` variable
				// is kept for parity with the idu_ack_advisory twin;
				// the `kind` field on the auto-emit comes from the
				// injection itself when the central writer reads it.
				const outcome = markInjectionAcked(
					stateRoot,
					inj.injectionId,
					{
						phase: "dismissed",
						reason: "idu_pending_injections ack:true",
					},
				);
				void outcome;
			}
		}
	}
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `pending=${pending.length} acked=${ack ? pending.length : 0}`,
		data: {
			birth: {
				pendingInjections: pending,
				ackedCount: ack ? pending.length : 0,
			},
		},
		safeNotes: [
			...resolution.safeNotes,
			"Read pending injections from stateRoot only; no repo files were touched.",
			ack
				? "Side effect: mark-as-acked happened on disk."
				: "Side effect: read-only, no disk write.",
		],
	});
}

/**
 * idu_hygiene_migrate — manifest-driven hygiene layout migration.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleHygieneMigrate(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as { projectPath?: string };
	const repoRoot = (params.projectPath ?? runtime.projectPath ?? "").trim();
	if (!repoRoot) {
		return envelope({
			stateRoot,

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"idu_hygiene_migrate requires --projectPath or an active project.",
			data: {},
			safeNotes: [
				...resolution.safeNotes,
				"No migration executed: missing target repo root.",
			],
			errors: [
				"projectPath is required when no active project is registered",
			],
		});
	}
	const migration: MigrationResult = migrateHygieneLayout({
		repoRoot,
		stateRoot,
	});
	return envelope({
		stateRoot,

		ok: migration.errors.length === 0,
		tool: name,
		projectId: runtime.projectId,
		projectPath: repoRoot,
		summary: `moved=${migration.moved.length} skipped=${migration.skipped.length} errors=${migration.errors.length}`,
		data: {
			hygiene: {
				repoRoot,
				moved: migration.moved,
				skipped: migration.skipped,
				errors: migration.errors,
			},
		},
		safeNotes: [
			...resolution.safeNotes,
			"Territory model: migration only moves files idu-pi owns (manifest-driven).",
			"Idempotent: running twice does not double-move.",
			migration.errors.length > 0
				? `Side effect: ${migration.moved.length} moves applied; ${migration.errors.length} errors recorded in <stateRoot>/events.jsonl.`
				: `Side effect: ${migration.moved.length} moves applied; logged to <stateRoot>/events.jsonl.`,
		],
		...(migration.errors.length > 0
			? {
					errors: migration.errors.map((e) => `${e.from}: ${e.message}`),
				}
			: {}),
	});
}

/**
 * idu_hygiene_sweep — advisory-only hygiene sweep (never deletes).
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleHygieneSweep(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as { projectPath?: string; mode?: string };
	// The CLI/MCP surface only supports `advisory`. `auto` is
	// internal-only (used by the cron preflight to clean
	// <stateRoot>/tmp/**). Reject any other mode explicitly.
	if (params.mode && params.mode !== "advisory") {
		return envelope({
			stateRoot,
			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: `idu_hygiene_sweep rejects mode='${params.mode}'`,
			data: {},
			safeNotes: [
				...resolution.safeNotes,
				"Mode `auto` is internal-only (idu-pi internal auto-clean of <stateRoot>/tmp/**).",
			],
			errors: [
				"auto mode is internal-only. Use mode='advisory' (default).",
			],
		});
	}
	const repoRoot = (params.projectPath ?? runtime.projectPath ?? "").trim();
	if (!repoRoot) {
		return envelope({
			stateRoot,
			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"idu_hygiene_sweep requires --projectPath or an active project.",
			data: {},
			safeNotes: [
				...resolution.safeNotes,
				"No sweep executed: missing target repo root.",
			],
			errors: [
				"projectPath is required when no active project is registered",
			],
		});
	}
	// Re-run the sensor at sweep time for a fresh snapshot. The
	// sensor's findings[].path becomes the source of truth; the
	// sweep never re-discovers. (See design.md / spec.md.)
	const sensorOutput = runHygieneSensor({ stateRoot, repoPath: repoRoot });
	const sweep: PlanSweepResult = planSweep({
		sensorOutput,
		stateRoot,
		repoPath: repoRoot,
		mode: "advisory",
	});
	return envelope({
		stateRoot,
		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: repoRoot,
		summary: `sweep: ${sweep.paths.length} paths to delete, ${sweep.skipped.length} skipped`,
		data: { sweep },
		safeNotes: [
			...resolution.safeNotes,
			"ADVISORY ONLY. idu-pi does NOT delete. The orchestrator runs the suggested commands.",
			"NEVER `find -delete`. Each command is `rm <exact-path>` from the sensor's findings[].path.",
			"Re-validated at sweep time: territoriality, pattern, existence, symlink target.",
		],
	});
}

/**
 * idu_ack_advisory — deliberate dismissal escape hatch for an injection.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleAckAdvisory(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as { injectionId?: string; reason?: string };
	if (!params.injectionId) {
		return envelope({
			stateRoot,
			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "idu_ack_advisory requires --injectionId",
			data: {},
			safeNotes: [
				...resolution.safeNotes,
				"No ack executed: missing injectionId.",
			],
			errors: ["injectionId is required"],
		});
	}
	const result: AckAdvisoryResult = ackAdvisory({
		stateRoot,
		injectionId: params.injectionId,
		reason: params.reason,
	});
	return envelope({
		stateRoot,
		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `acked ${result.injectionId} (${result.reason})`,
		data: { ack: result },
		safeNotes: [
			...resolution.safeNotes,
			"Explicit dismissal escape hatch. Audit log written.",
			"This is the dedicated tool for deliberate dismissal; the inline `ack:true` flag on idu_pending_injections still works for ad-hoc use.",
		],
	});
}

/**
 * idu_outbox_prune — dry-run or apply archive+remove old proposals/injections.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleOutboxPrune(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as {
		olderThanDays?: string | number;
		confirm?: boolean;
	};
	const olderThanDays =
		typeof params.olderThanDays === "string"
			? Number(params.olderThanDays)
			: typeof params.olderThanDays === "number"
				? params.olderThanDays
				: 30;
	const confirm = params.confirm === true;
	const plan = planPrune(stateRoot, { olderThanDays });
	if (!confirm) {
		return envelope({
			stateRoot: "",

			ok: true,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: `dry-run: proposals=${plan.proposals.length} injections=${plan.injections.length} cutoff=${plan.cutoff}`,
			data: {
				outboxPrune: {
					dryRun: true,
					cutoff: plan.cutoff,
					proposals: plan.proposals.map((e) => ({
						id: e.id,
						createdAt: e.createdAt,
					})),
					injections: plan.injections.map((e) => ({
						id: e.id,
						createdAt: e.createdAt,
					})),
				},
			},
			safeNotes: [
				...resolution.safeNotes,
				"Dry run: no files were touched. Re-call with confirm=true to apply.",
			],
		});
	}
	const result = applyPrune(stateRoot, plan, { olderThanDays });
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `applied: archive=${result.archiveDir} archived(proposals=${result.archived.proposals}, injections=${result.archived.injections})`,
		data: {
			outboxPrune: {
				dryRun: false,
				cutoff: result.cutoff,
				archiveDir: result.archiveDir,
				archived: result.archived,
				removed: result.removed,
			},
		},
		safeNotes: [
			...resolution.safeNotes,
			"StateRoot-only writes: archived old entries to .archive/YYYY-MM-DD/ and removed from live files.",
		],
	});
}

/**
 * idu_subscribe_triggers — describe available triggers and contracts.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSubscribeTriggers(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `triggers=${TRIGGER_DEFINITIONS.length}`,
		data: {
			birth: {
				triggers: TRIGGER_DEFINITIONS.map((d) => ({
					id: d.id,
					description: d.description,
					kinds: d.kinds,
					signature: d.signature,
					contract: {
						decisionRequired: d.contract.decisionRequired,
						severity: d.contract.severity,
						options: d.contract.options,
					},
				})),
			},
		},
		safeNotes: [
			...resolution.safeNotes,
			"Read-only; describe los disparadores y su contrato. No escribe.",
		],
	});
}
