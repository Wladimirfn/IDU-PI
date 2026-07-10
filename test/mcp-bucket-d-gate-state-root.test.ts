import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CliRuntime } from "../src/cli.js";
import {
	callIduMcpTool,
	type IduMcpProjectResolution,
	type IduMcpRuntimeFactory,
} from "../src/mcp-server.js";

// Test-of-record for the 13 BUCKET-D "master-plan / supervisor gate" sites.
// Phase 2 (issue #257, type:fix). The gate branch now propagates the real
// resolution.stateRoot instead of the literal "".
//
// Sibling to Phase 1A (issue #258), which pinned the 9 *unregistered*
// sites, and Phase 1B (issue #259), which pinned these 13 gate sites
// asserting `null` BEFORE the coercion landed. This file covers the other
// BUCKET-D family: sites that DO have a resolved stateRoot but guard on a
// runtime capability. When the capability is absent the handler returns
// `envelope({ stateRoot: resolution.stateRoot ?? "" })`, and the shared
// `envelope()` keeps the truthy resolved stateRoot on the wire.
//
// Phase 1B pinned the pre-coercion `null` behavior. Phase 2 flips the
// assertion to the real resolved stateRoot (GATE_STATE_ROOT) now that the
// gate branch returns `resolution.stateRoot` instead of "".
//
// IMPORTANT difference from Phase 1A: the resolution here is a REGISTERED
// project WITH a real stateRoot (a fresh tmpdir). The early unregistered
// guard inside `callIduMcpTool` (src/mcp-server.ts) would otherwise
// short-circuit before the handler gate is reached. The gate fires here
// because the runtime lacks the specific capability each handler checks
// first.
//
// Self-contained by orchestrator decision: this file does NOT import the
// Phase 1A helper at test/helpers/bucket-d-setup.ts. The 13 gate sites
// share enough structure that one table-driven file is preferable.

const GATE_PROJECT_ID = "bucket-d-phase-1b-gate-probe";

// A real stateRoot (fresh tmpdir). Required so the registered resolution
// passes the early unregistered guard AND so recordMcpUsage — which the
// call reaches after the handler returns — has a writable target. The
// usage-event writer does mkdir{recursive}+appendFile inside try/catch, so
// a fresh tmpdir is hermetic (same pattern as test/mcp-server.test.ts).
const GATE_STATE_ROOT = mkdtempSync(
	join(tmpdir(), "idu-bucket-d-phase-1b-gate-"),
);

/**
 * A REGISTERED resolution carrying a real tmpdir stateRoot. This is the key
 * difference from Phase 1A's unregisteredResolution(): we must pass the
 * early unregistered guard in callIduMcpTool so the per-handler capability
 * gate is the branch that fires.
 */
function registeredResolution(): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: GATE_PROJECT_ID,
		projectPath: "fake-repo-root",
		stateRoot: GATE_STATE_ROOT,
		recommendedNext: "proceed",
		safeNotes: [],
		errors: [],
	};
}

/**
 * Minimal CliRuntime stub with NONE of the eight gate capabilities set:
 *   masterPlanStatus, masterPlanRedraft, masterPlanReview,
 *   masterPlanApprove, masterPlanReject, executionDirectorTick,
 *   proposalOutbox, proposalDetail.
 *
 * Every gate handler checks its capability as the FIRST line and returns
 * `envelope({ stateRoot: "" })` when it is undefined. Because the stub
 * omits all eight, a single uniform runtime makes all 13 gates fire — no
 * per-site capability wiring is needed. Identity fields only; capabilities
 * are deliberately absent so the guard branch is taken before any arg
 * parsing.
 */
function makeGateRuntime(): CliRuntime {
	return {
		projectId: GATE_PROJECT_ID,
		projectPath: "fake-repo-root",
		workspaceRoot: GATE_STATE_ROOT,
		labDbPath: join(GATE_STATE_ROOT, "lab.db"),
	} as unknown as CliRuntime;
}

const gateRuntimeFactory: IduMcpRuntimeFactory = () => makeGateRuntime();

/**
 * The 13 BUCKET-D gate sites. Each entry records:
 *   - tool:  the MCP tool name
 *   - args:  arguments (empty — the gate fires BEFORE required-arg parsing,
 *            so even tools with required `id`/`request` are safe with {})
 *   - gate:  the runtime capability whose absence makes this site's guard
 *            branch fire (documented for traceability; the single uniform
 *            runtime above omits all of them)
 *   - site:  source location of the `stateRoot: ""` literal
 *
 * 9 sites in src/mcp/master-plan/handlers.ts:
 *   master_plan_status(66) master_plan_create(105) master_plan_review(154)
 *   master_plan_approve(202) master_plan_reject(256) plan_snapshot(309)
 *   next_advisory_action(354) continuation_proposal(418)
 *   task_package_create(469)
 * 3 sites in src/mcp/supervisor-tick/handlers.ts:
 *   execution_director_tick(117) proposal_outbox(190) proposal_detail(233)
 * 1 site in src/mcp/supervisor-context/handlers.ts:
 *   supervisor_context_pack(62)
 */
const GATE_SITES = [
	{ tool: "idu_master_plan_status", args: {}, gate: "masterPlanStatus", site: "master-plan/handlers.ts:66" },
	{ tool: "idu_master_plan_create", args: {}, gate: "masterPlanRedraft", site: "master-plan/handlers.ts:105" },
	{ tool: "idu_master_plan_review", args: {}, gate: "masterPlanReview", site: "master-plan/handlers.ts:154" },
	{ tool: "idu_master_plan_approve", args: {}, gate: "masterPlanApprove", site: "master-plan/handlers.ts:202" },
	{ tool: "idu_master_plan_reject", args: {}, gate: "masterPlanReject", site: "master-plan/handlers.ts:256" },
	{ tool: "idu_plan_snapshot", args: {}, gate: "masterPlanReview", site: "master-plan/handlers.ts:309" },
	{ tool: "idu_next_advisory_action", args: {}, gate: "masterPlanReview", site: "master-plan/handlers.ts:354" },
	{ tool: "idu_continuation_proposal", args: {}, gate: "masterPlanReview", site: "master-plan/handlers.ts:418" },
	{ tool: "idu_task_package_create", args: {}, gate: "masterPlanReview", site: "master-plan/handlers.ts:469" },
	{ tool: "idu_execution_director_tick", args: {}, gate: "executionDirectorTick", site: "supervisor-tick/handlers.ts:117" },
	{ tool: "idu_proposal_outbox", args: {}, gate: "proposalOutbox", site: "supervisor-tick/handlers.ts:190" },
	{ tool: "idu_proposal_detail", args: {}, gate: "proposalDetail", site: "supervisor-tick/handlers.ts:233" },
	{ tool: "idu_supervisor_context_pack", args: {}, gate: "masterPlanReview", site: "supervisor-context/handlers.ts:62" },
] as const;

// One table-driven test, one uniform runtime, one uniform assertion. No
// per-site branching: every gate fires on the same all-capabilities-absent
// runtime, and every gate returns `envelope({ stateRoot: resolution.stateRoot })`
// which the shared envelope() keeps as the real resolved path on the wire.
for (const site of GATE_SITES) {
	test(`[bucket-d 2] ${site.tool} capability-absent gate emits real stateRoot`, async () => {
		const result = await callIduMcpTool(site.tool, { ...site.args }, {
			projectResolver: () => registeredResolution(),
			runtimeFactory: gateRuntimeFactory,
		});

		// Primary contract (REQ-BD2-1): the gate branch propagates the
		// real resolution.stateRoot; envelope() keeps it on the wire.
		assert.equal(result.stateRoot, GATE_STATE_ROOT);
		// Secondary: confirms the guard-failure branch was taken (these
		// are not success paths) — only stateRoot changed, not ok.
		assert.equal(result.ok, false);
	});
}
