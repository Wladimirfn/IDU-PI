import type { ProjectCoreStatus } from "./project-core.js";
import type { ProjectConstitutionStatus } from "./project-constitution.js";
import type { MasterPlanTaskTreeStatus } from "./master-plan-task-tree.js";

export type BirthProjectMode = "new_project" | "existing_project";

export type BirthPipelineState =
	| "not_started"
	| "intake_ready"
	| "core_confirmed"
	| "master_plan_approved"
	| "bibliotecario_ready"
	| "prototype_approved"
	| "general_spec_approved"
	| "implementation_ready"
	| "repo_ready"
	| "postflight_passed";

export type BibliotecarioAcquisitionState =
	| "local_sources_found"
	| "local_sources_empty"
	| "external_fetch_needed"
	| "external_fetch_blocked"
	| "external_sources_found"
	| "ideas_extracted"
	| "ideas_ready_for_orchestrator";

export type BirthPrototypeStatus =
	| "missing"
	| "draft"
	| "reviewed"
	| "approved"
	| "stale";

export type BirthGeneralSpecStatus =
	| "missing"
	| "draft"
	| "reviewed"
	| "approved"
	| "stale";

export type BirthRequestedWorkKind =
	| "visual_product"
	| "non_visual_maintenance"
	| "repo_git"
	| "unknown";

export type BirthRepoPlanStatus = "missing" | "planned" | "approved";
export type BirthRepoHumanApproval = "missing" | "pending" | "approved";

export type BirthScopeLimit =
	| "non_visual_maintenance_only"
	| "implementation_ready";

export type EvaluateBirthReadinessInput = {
	mode: BirthProjectMode;
	projectId: string;
	coreStatus: ProjectCoreStatus | "missing" | "unknown";
	masterPlanTaskTreeStatus: MasterPlanTaskTreeStatus | "unknown";
	constitutionStatus: ProjectConstitutionStatus | "missing" | "unknown";
	bibliotecarioStatus?: BibliotecarioAcquisitionState;
	prototypeStatus?: BirthPrototypeStatus;
	generalSpecStatus?: BirthGeneralSpecStatus;
	requestedWorkKind?: BirthRequestedWorkKind;
	narrowedScopeAccepted?: boolean;
	repoPlanStatus?: BirthRepoPlanStatus;
	repoHumanApproval?: BirthRepoHumanApproval;
};

export type BirthReadiness = {
	version: 1;
	projectId: string;
	mode: BirthProjectMode;
	state: BirthPipelineState;
	allowedToImplement: boolean;
	repoWritesAllowed: boolean;
	nextRequiredAction: string;
	blockingReasons: string[];
	scopeLimit?: BirthScopeLimit;
};

const NON_VISUAL_NARROW = "non_visual_maintenance_only" as const;
const FULL_IMPL = "implementation_ready" as const;

export function evaluateBirthReadiness(
	input: EvaluateBirthReadinessInput,
): BirthReadiness {
	const blockingReasons: string[] = [];
	const nextReasons: string[] = [];

	const prototypeStatus = input.prototypeStatus ?? "missing";
	const generalSpecStatus = input.generalSpecStatus ?? "missing";
	const requestedWork = input.requestedWorkKind ?? "unknown";
	const narrowed = input.narrowedScopeAccepted === true;
	const repoPlanStatus = input.repoPlanStatus ?? "missing";
	const repoHumanApproval = input.repoHumanApproval ?? "missing";

	// Core gate
	if (input.coreStatus !== "confirmed") {
		blockingReasons.push(
			`Project Core must be confirmed; current=${input.coreStatus}.`,
		);
		nextReasons.push("idu_birth_intake");
	}

	// Constitution gate
	if (input.constitutionStatus !== "active") {
		blockingReasons.push(
			`Constitution must be active; current=${input.constitutionStatus}.`,
		);
	}

	// Master Plan task tree gate
	if (input.masterPlanTaskTreeStatus !== "ready") {
		blockingReasons.push(
			`Master Plan task tree must be ready; current=${input.masterPlanTaskTreeStatus}.`,
		);
	}

	// Bibliotecario gate
	if (
		input.bibliotecarioStatus === "external_fetch_blocked" ||
		input.bibliotecarioStatus === undefined
	) {
		blockingReasons.push(
			`Bibliotecario acquisition must be at least local_sources_found, current=${
				input.bibliotecarioStatus ?? "missing"
			}.`,
		);
	}

	// Prototype gate
	const prototypeReady = prototypeStatus === "approved";

	// General Spec gate
	const generalSpecReady = generalSpecStatus === "approved";

	// Mode reconciliation for existing project
	if (input.mode === "existing_project" && input.coreStatus !== "confirmed") {
		blockingReasons.push(
			"Existing project must reconcile Project Core after scan approval.",
		);
	}

	// Visual product needs prototype approved
	const isVisualProduct = requestedWork === "visual_product";
	const isNonVisualMaintenance = requestedWork === "non_visual_maintenance";
	const isRepoGit = requestedWork === "repo_git";

	if (isVisualProduct && !prototypeReady) {
		blockingReasons.push(
			`Master Prototype must be approved before visual/product work; current=${prototypeStatus}.`,
		);
	}

	// Compute allowedToImplement
	let allowedToImplement = false;
	let scopeLimit: BirthScopeLimit | undefined;

	if (isNonVisualMaintenance && narrowed) {
		// Narrow exception
		// Still require Core + Plan ready
		const coreOk = input.coreStatus === "confirmed";
		const planOk = input.masterPlanTaskTreeStatus === "ready";
		const constitutionOk = input.constitutionStatus === "active";
		const bibliotecarioOk =
			input.bibliotecarioStatus !== undefined &&
			input.bibliotecarioStatus !== "external_fetch_blocked";
		if (coreOk && planOk && constitutionOk && bibliotecarioOk) {
			allowedToImplement = true;
			scopeLimit = NON_VISUAL_NARROW;
		} else {
			blockingReasons.push(
				"Non-visual maintenance exception still requires Project Core confirmed, Master Plan ready, Constitution active, and Bibliotecario minimum.",
			);
		}
	} else {
		// Normal path: ALL gates required (core, plan, constitution,
		// bibliotecario, prototype, general spec).
		const coreOk = input.coreStatus === "confirmed";
		const planOk = input.masterPlanTaskTreeStatus === "ready";
		const constitutionOk = input.constitutionStatus === "active";
		const bibliotecarioOk =
			input.bibliotecarioStatus !== undefined &&
			input.bibliotecarioStatus !== "external_fetch_blocked";
		if (
			coreOk &&
			planOk &&
			constitutionOk &&
			bibliotecarioOk &&
			prototypeReady &&
			generalSpecReady
		) {
			allowedToImplement = true;
			scopeLimit = FULL_IMPL;
		} else if (!prototypeReady) {
			blockingReasons.push(
				`Master Prototype is not approved; current=${prototypeStatus}.`,
			);
		} else if (!generalSpecReady) {
			blockingReasons.push(
				`General Spec is not approved; current=${generalSpecStatus}.`,
			);
		}
	}

	// Repo writes gate (independent of implement gate)
	let repoWritesAllowed = false;
	if (repoPlanStatus === "approved" && repoHumanApproval === "approved") {
		// Even with repo plan approved, prototype/general spec must be ready
		// for repo write authority to make sense for a visual project.
		// For non-visual maintenance, repo writes are still blocked by default.
		if (!isNonVisualMaintenance) {
			repoWritesAllowed = true;
		} else {
			blockingReasons.push(
				"Non-visual maintenance exception cannot grant repoWritesAllowed.",
			);
		}
	}

	// Determine pipeline state
	const state = deriveState({
		input,
		prototypeReady,
		generalSpecReady,
		repoWritesAllowed,
	});

	// Determine next required action
	const nextRequiredAction = pickNextAction({
		input,
		state,
		prototypeStatus,
		generalSpecStatus,
		nextReasons,
		isRepoGit,
	});

	return {
		version: 1,
		projectId: input.projectId,
		mode: input.mode,
		state,
		allowedToImplement,
		repoWritesAllowed,
		nextRequiredAction,
		blockingReasons,
		scopeLimit,
	};
}

function deriveState(args: {
	input: EvaluateBirthReadinessInput;
	prototypeReady: boolean;
	generalSpecReady: boolean;
	repoWritesAllowed: boolean;
}): BirthPipelineState {
	const { input, prototypeReady, generalSpecReady, repoWritesAllowed } = args;
	if (repoWritesAllowed) return "repo_ready";
	if (generalSpecReady && prototypeReady) return "implementation_ready";
	if (prototypeReady) return "prototype_approved";
	if (input.bibliotecarioStatus === "ideas_ready_for_orchestrator")
		return "bibliotecario_ready";
	if (input.masterPlanTaskTreeStatus === "ready") return "master_plan_approved";
	if (input.coreStatus === "confirmed") return "core_confirmed";
	if (input.coreStatus === "draft" || input.coreStatus === "proposed")
		return "intake_ready";
	return "not_started";
}

function pickNextAction(args: {
	input: EvaluateBirthReadinessInput;
	state: BirthPipelineState;
	prototypeStatus: BirthPrototypeStatus;
	generalSpecStatus: BirthGeneralSpecStatus;
	nextReasons: string[];
	isRepoGit: boolean;
}): string {
	if (args.isRepoGit) return "idu_birth_repo_plan";
	if (args.input.coreStatus !== "confirmed") return "idu_birth_intake";
	if (args.input.constitutionStatus !== "active") return "idu_birth_validate";
	if (args.input.masterPlanTaskTreeStatus !== "ready")
		return "idu_birth_validate";
	if (
		args.input.bibliotecarioStatus === undefined ||
		args.input.bibliotecarioStatus === "external_fetch_blocked"
	)
		return "idu_birth_bibliotecario_discovery";
	if (args.prototypeStatus !== "approved") return "idu_birth_prototype_master";
	if (args.generalSpecStatus !== "approved") return "idu_birth_general_spec";
	return "idu_birth_status";
}
