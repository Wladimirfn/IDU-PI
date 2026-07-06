// src/mcp/birth/handlers.ts
//
// PR 17 (Item 4, mcp-server god-file breakup): cluster K (birth)
// wrappers for the dispatchTool switch.
//
// 8 wrappers, one per case group (single label, no fall-through):
//   - handleBirthStatus                 (idu_birth_status)
//   - handleBirthExistingScan           (idu_birth_existing_scan)
//   - handleBirthBibliotecarioDiscovery (idu_birth_bibliotecario_discovery)
//   - handleBirthPrototypeMaster       (idu_birth_prototype_master)
//   - handleBirthGeneralSpec           (idu_birth_general_spec)
//   - handleBirthGeneralSpecDerive     (idu_birth_general_spec_derive)
//   - handleBirthValidate               (idu_birth_validate)
//   - handleBirthRepoPlan               (idu_birth_repo_plan)
//
// Name collision note: the imported helpers from birth-runtime.ts share
// names with the locked-template wrapper names (handleBirthStatus,
// handleBirthExistingScan, etc.). Per the cluster map's locked-template
// rule, the wrapper names are fixed; we use `import { X as XFn }`
// aliases to avoid the local shadow. The byte-identity gate resolves
// aliases automatically (per post-drift contract).
//
// Note: cluster K's case bodies are SPLIT in src/mcp-server.ts:
//   - Block 1: 6 consecutive cases (L2670-L2837)
//   - Block 2: 2 consecutive cases (L2883-L2919) — separated by 3 PR 15
//     genesis delegations (mission_draft, mission_confirm, skill_for_task)
// TWO independent splices.
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

import { readBirthArtifact } from "../../birth-artifacts.js";
import {
	approveBirthGeneralSpec,
} from "../../birth-general-spec-runtime.js";
import { runVisualDerivation } from "../../birth-general-spec-derive.js";
import {
	handleBirthBibliotecarioDiscovery as runBirthBibliotecarioDiscovery,
	handleBirthExistingScan as runBirthExistingScan,
	handleBirthRepoPlan as runBirthRepoPlan,
	handleBirthStatus as runBirthStatus,
	handleBirthValidate as runBirthValidate,
	type BirthRepoPlan,
} from "../../birth-runtime.js";
import { handleBirthPrototypeMaster as runBirthPrototypeMaster } from "../../birth-prototype-runtime.js";
import type { CliRuntime } from "../../cli.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import {
	envelope,
	parseGeneralSpecSectionsArg,
	stringArg,
	stringListArg,
} from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_birth_status — read birth pipeline state from stateRoot.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthStatus(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const env = runBirthStatus({
		projectId: runtime.projectId,
		stateRoot,
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_state=${env.state} allowed=${env.allowedToImplement} repo=${env.repoWritesAllowed}`,
		data: { birth: env },
		safeNotes: [
			...resolution.safeNotes,
			"Birth status is advisory; readiness is derived from existing Idu-pi contracts.",
			"repoWritesAllowed remains false until Project Core + Master Plan are confirmed/approved AND a human push approval is recorded.",
		],
	});
}

/**
 * idu_birth_existing_scan — run a read-only scan of the existing project.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthExistingScan(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	if (!runtime.projectPath) {
		return envelope({
			stateRoot,

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Existing project scan requires an active project path.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["active project path is missing"],
		});
	}
	const env = runBirthExistingScan({
		projectId: runtime.projectId,
		stateRoot,
		projectPath: runtime.projectPath,
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_scan=${env.scan.scanId} pkg=${env.scan.observed.packageManager}`,
		data: { birth: env },
		safeNotes: [
			...resolution.safeNotes,
			"Scan is read-only; artifacts written only under stateRoot/birth/.",
			"Detected specs stay in status=draft until human approval.",
		],
	});
}

/**
 * idu_birth_bibliotecario_discovery — evaluate Bibliotecario posture.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthBibliotecarioDiscovery(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const scan = readBirthArtifact<{ observed?: { docs?: string[] } }>(
		stateRoot,
		"existing-scan",
	);
	const localRefs = (scan?.observed?.docs ?? [])
		.slice(0, 5)
		.map((p) => ({ path: p, quality: "secondary" as const }));
	const env = runBirthBibliotecarioDiscovery({
		projectId: runtime.projectId,
		stateRoot,
		localSourceRefs: localRefs,
		requestedExternalCategories: [],
		externalPermission: "not_requested",
		masterPlanSummary: "",
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_bibliotecario_status=${env.discovery.status} ideas=${env.discovery.ideas.length}`,
		data: { birth: env },
		safeNotes: [
			...resolution.safeNotes,
			"Bibliotecario ideas are idea_only; no automatic decision or contract is created.",
			"External fetch requires explicit human permission.",
		],
	});
}

/**
 * idu_birth_prototype_master — create/review/approve the Master Prototype.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthPrototypeMaster(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as {
		action?: "draft" | "review" | "approve";
		draft?: Parameters<typeof runBirthPrototypeMaster>[0]["draft"];
		approvedBy?: string;
	};
	const action = params.action ?? "review";
	const env = runBirthPrototypeMaster({
		action,
		projectId: runtime.projectId,
		stateRoot,
		...(params.draft ? { draft: params.draft } : {}),
		...(params.approvedBy ? { approvedBy: params.approvedBy } : {}),
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_prototype_status=${env.prototype.status}`,
		data: { birth: env },
		safeNotes: [
			...resolution.safeNotes,
			"Master Prototype is approved only by explicit human action.",
			"Only stateRoot/birth/prototype-master.json is written.",
		],
	});
}

/**
 * idu_birth_general_spec — explicitly approve a General Spec.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthGeneralSpec(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (resolution.status !== "registered_project" || !resolution.stateRoot) {
		return envelope({
			stateRoot: "", /* BUCKET-D unregistered: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"General Spec approval requires an active project stateRoot.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["active project stateRoot is missing"],
		});
	}
	const params = args as JsonObject;
	const sections = parseGeneralSpecSectionsArg(params.sections);
	const birth = await approveBirthGeneralSpec({
		projectId: runtime.projectId,
		stateRoot: resolution.stateRoot,
		sections,
		approvedBy: stringArg(params, "approvedBy") ?? "owner",
	});
	const readiness = runBirthStatus({
		projectId: runtime.projectId,
		stateRoot: resolution.stateRoot,
	});
	return envelope({
		stateRoot: resolution.stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_general_spec_status=${birth.generalSpec.status}`,
		data: { birth, readiness },
		safeNotes: [
			...resolution.safeNotes,
			"General Spec approval is explicit owner input; no derivation, model call, or Telegram surface was used.",
			"Only stateRoot/birth/general-spec.json is written.",
		],
	});
}

/**
 * idu_birth_general_spec_derive — visual derivation of the General Spec.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthGeneralSpecDerive(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (resolution.status !== "registered_project" || !resolution.stateRoot) {
		return envelope({
			stateRoot: "", /* BUCKET-D unregistered: sin state todavía */

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"General Spec derivation requires an active project stateRoot.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["active project stateRoot is missing"],
		});
	}
	const params = args as JsonObject;
	const promptForRole = runtime.promptForRole;
	const result = await runVisualDerivation({
		stateRoot: resolution.stateRoot,
		uiFiles: stringListArg(params, "uiFiles"),
		promptForRole:
			promptForRole ?? (async () => ({ ok: false, output: "" })),
	});
	return envelope({
		stateRoot: resolution.stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_general_spec_derive applied=${result.appliedCount}`,
		data: { derivation: result },
		safeNotes: [
			...resolution.safeNotes,
			"General Spec visual derivation is owner-invoked only; approveBirthGeneralSpec does not auto-trigger it.",
			"Only stateRoot/birth/general-spec.json is written.",
		],
	});
}

/**
 * idu_birth_validate — run scan + Bibliotecario + readiness check.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthValidate(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	if (!runtime.projectPath) {
		return envelope({
			stateRoot,

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Birth validate requires an active project path.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["active project path is missing"],
		});
	}
	const env = runBirthValidate({
		projectId: runtime.projectId,
		stateRoot,
		projectPath: runtime.projectPath,
	});
	return envelope({
		stateRoot,

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_validate state=${env.readiness.state}`,
		data: { birth: env },
		safeNotes: [
			...resolution.safeNotes,
			"Birth validate runs read-only scan + Bibliotecario + readiness; nothing is written except under stateRoot/birth/.",
		],
	});
}

/**
 * idu_birth_repo_plan — evaluate a repo plan; never executes git init/push.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleBirthRepoPlan(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const stateRoot = resolution.stateRoot ?? runtime.workspaceRoot;
	const params = args as {
		repoPlan?: Partial<BirthRepoPlan>;
	};
	const plan: BirthRepoPlan = {
		repoName: String(params.repoPlan?.repoName ?? runtime.projectId),
		visibility:
			params.repoPlan?.visibility === "public" ? "public" : "private",
		owner: String(params.repoPlan?.owner ?? ""),
		license: String(params.repoPlan?.license ?? "MIT"),
		initialReadmePolicy: String(
			params.repoPlan?.initialReadmePolicy ?? "minimal",
		),
		remoteProvider:
			(params.repoPlan?.remoteProvider as
				| "github"
				| "gitlab"
				| "other"
				| undefined) ?? "github",
		pushApproved: Boolean(params.repoPlan?.pushApproved),
		branchPolicy: String(params.repoPlan?.branchPolicy ?? "main"),
		ciExpectation: String(params.repoPlan?.ciExpectation ?? ""),
	};
	const env = runBirthRepoPlan({
		projectId: runtime.projectId,
		stateRoot,
		repoPlan: plan,
	});
	return envelope({
		stateRoot,

		ok: env.decision.repoWritesAllowed,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `birth_repo_plan repoWritesAllowed=${env.decision.repoWritesAllowed}`,
		data: { birth: env },
		safeNotes: [
			...resolution.safeNotes,
			"Repo plan is evaluated only; no git init/push is executed by Idu-pi.",
			"Human push approval is required and recorded before any repoWritesAllowed=true.",
		],
	});
}
