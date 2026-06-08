import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	readBirthArtifact,
	writeBirthArtifact,
} from "./birth-artifacts.js";
import {
	evaluateBibliotecarioAcquisition,
	type BibliotecarioSourceRef,
	type BibliotecarioExternalPermission,
} from "./birth-bibliotecario.js";
import { scanExistingProject } from "./birth-existing-scan.js";
import { evaluateBirthReadiness, type BirthReadiness } from "./birth-pipeline.js";
import type { ProjectCore } from "./project-core.js";
import type { MasterPlan } from "./master-plan.js";

export type BirthRepoPlan = {
	repoName: string;
	visibility: "public" | "private";
	owner: string;
	license: string;
	initialReadmePolicy: string;
	remoteProvider: "github" | "gitlab" | "other";
	pushApproved: boolean;
	branchPolicy: string;
	ciExpectation: string;
};

export type BirthRepoPlanDecision = {
	version: 1;
	projectId: string;
	repoWritesAllowed: boolean;
	blockingReasons: string[];
	nextRequiredAction: string;
};

export type BirthStatusEnvelope = BirthReadiness & {
	version: 1;
	kind: "birth_status";
};

export type BirthExistingScanEnvelope = {
	version: 1;
	kind: "birth_existing_scan";
	projectId: string;
	scan: ReturnType<typeof scanExistingProject>["scan"];
	detectedSpecs: ReturnType<typeof scanExistingProject>["detectedSpecs"];
};

export type BirthBibliotecarioEnvelope = {
	version: 1;
	kind: "birth_bibliotecario_discovery";
	projectId: string;
	discovery: ReturnType<typeof evaluateBibliotecarioAcquisition>;
};

export type BirthValidateEnvelope = {
	version: 1;
	kind: "birth_validate";
	projectId: string;
	scan: ReturnType<typeof scanExistingProject>["scan"];
	detectedSpecs: ReturnType<typeof scanExistingProject>["detectedSpecs"];
	bibliotecario: BirthBibliotecarioEnvelope;
	readiness: BirthReadiness;
};

export type BirthRepoPlanEnvelope = {
	version: 1;
	kind: "birth_repo_plan";
	projectId: string;
	decision: BirthRepoPlanDecision;
};

export function handleBirthStatus(input: {
	projectId: string;
	stateRoot: string;
}): BirthStatusEnvelope {
	const core = loadProjectCoreSnapshot(input.stateRoot);
	const plan = loadMasterPlanSnapshot(input.stateRoot);
	const readiness = evaluateBirthReadiness({
		mode: inferMode(core, plan),
		projectId: input.projectId,
		coreStatus: core?.status ?? "missing",
		masterPlanTaskTreeStatus: derivePlanTaskTreeStatus(plan),
		constitutionStatus: loadConstitutionStatus(input.stateRoot),
		bibliotecarioStatus: deriveBibliotecarioStatus(input.stateRoot),
		prototypeStatus: derivePrototypeStatus(input.stateRoot),
		generalSpecStatus: deriveGeneralSpecStatus(input.stateRoot),
		repoPlanStatus: deriveRepoPlanStatus(input.stateRoot),
		repoHumanApproval: deriveRepoHumanApproval(input.stateRoot),
	});
	return { ...readiness, version: 1, kind: "birth_status" };
}

export function handleBirthExistingScan(input: {
	projectId: string;
	stateRoot: string;
	projectPath: string;
}): BirthExistingScanEnvelope {
	const { scan, detectedSpecs } = scanExistingProject({
		projectId: input.projectId,
		projectPath: input.projectPath,
	});
	writeBirthArtifact(input.stateRoot, "existing-scan", scan);
	writeBirthArtifact(input.stateRoot, "detected-specs", detectedSpecs);
	return {
		version: 1,
		kind: "birth_existing_scan",
		projectId: input.projectId,
		scan,
		detectedSpecs,
	};
}

export function handleBirthBibliotecarioDiscovery(input: {
	projectId: string;
	stateRoot: string;
	localSourceRefs: BibliotecarioSourceRef[];
	requestedExternalCategories: string[];
	externalPermission: BibliotecarioExternalPermission;
	masterPlanSummary: string;
}): BirthBibliotecarioEnvelope {
	const discovery = evaluateBibliotecarioAcquisition(input);
	writeBirthArtifact(input.stateRoot, "bibliotecario-discovery", discovery);
	return {
		version: 1,
		kind: "birth_bibliotecario_discovery",
		projectId: input.projectId,
		discovery,
	};
}

export function handleBirthValidate(input: {
	projectId: string;
	stateRoot: string;
	projectPath: string;
}): BirthValidateEnvelope {
	const { scan, detectedSpecs } = scanExistingProject({
		projectId: input.projectId,
		projectPath: input.projectPath,
	});
	const masterPlan = loadMasterPlanSnapshot(input.stateRoot);
	const planSummary = masterPlan?.inferredObjective ?? "";
	const bibliotecario = handleBirthBibliotecarioDiscovery({
		projectId: input.projectId,
		stateRoot: input.stateRoot,
		localSourceRefs: scan.observed.docs.map((p) => ({ path: p, quality: "secondary" as const })),
		requestedExternalCategories: [],
		externalPermission: "not_requested",
		masterPlanSummary: planSummary,
	});
	const readiness = handleBirthStatus({
		projectId: input.projectId,
		stateRoot: input.stateRoot,
	});
	return {
		version: 1,
		kind: "birth_validate",
		projectId: input.projectId,
		scan,
		detectedSpecs,
		bibliotecario,
		readiness,
	};
}

export function handleBirthRepoPlan(input: {
	projectId: string;
	stateRoot: string;
	repoPlan: BirthRepoPlan;
}): BirthRepoPlanEnvelope {
	const blockingReasons: string[] = [];
	const core = loadProjectCoreSnapshot(input.stateRoot);
	if (!core || core.status !== "confirmed") {
		blockingReasons.push(
			`Project Core must be confirmed before repo plan; current=${core?.status ?? "missing"}.`,
		);
	}
	const plan = loadMasterPlanSnapshot(input.stateRoot);
	if (!plan || plan.status !== "approved") {
		blockingReasons.push(
			`Master Plan must be approved before repo plan; current=${plan?.status ?? "missing"}.`,
		);
	}
	if (!input.repoPlan.pushApproved) {
		blockingReasons.push(
			"Human push approval is required before any repo write.",
		);
	}
	const readiness = handleBirthStatus({
		projectId: input.projectId,
		stateRoot: input.stateRoot,
	});
	if (readiness.allowedToImplement !== true) {
		blockingReasons.push(
			"Birth pipeline must permit implementation before repo writes.",
		);
	}
	const decision: BirthRepoPlanDecision = {
		version: 1,
		projectId: input.projectId,
		repoWritesAllowed:
			blockingReasons.length === 0 && readiness.allowedToImplement === true,
		blockingReasons,
		nextRequiredAction: readiness.nextRequiredAction,
	};
	// Persist the repo plan snapshot for the audit trail.
	writeBirthArtifact(input.stateRoot, "repo-plan", {
		projectId: input.projectId,
		plan: input.repoPlan,
		decision,
	});
	return {
		version: 1,
		kind: "birth_repo_plan",
		projectId: input.projectId,
		decision,
	};
}

function inferMode(
	core: ProjectCore | undefined,
	plan: MasterPlan | undefined,
): "new_project" | "existing_project" {
	// Heuristic: if neither core nor plan is set, treat as new project.
	// If anything exists or approval is set, treat as existing project.
	if (core || plan) return "existing_project";
	return "new_project";
}

function loadProjectCoreSnapshot(stateRoot: string): ProjectCore | undefined {
	const path = join(stateRoot, "config", "project-core.json");
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as ProjectCore;
	} catch {
		return undefined;
	}
}

function loadMasterPlanSnapshot(stateRoot: string): MasterPlan | undefined {
	const path = join(stateRoot, "master-plan.json");
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as MasterPlan;
	} catch {
		return undefined;
	}
}

function loadConstitutionStatus(
	stateRoot: string,
): "active" | "missing" | "unknown" {
	const status = readBirthArtifact<{ status?: string }>(stateRoot, "status");
	if (status?.status === "implementation_ready" || status?.status === "repo_ready") {
		// Best-effort signal: status advanced implies constitution is at least active.
		return "active";
	}
	return "missing";
}

function derivePlanTaskTreeStatus(
	plan: MasterPlan | undefined,
): "ready" | "plan_not_approved" | "missing_plan" | "empty" | "unknown" {
	if (!plan) return "missing_plan";
	if (plan.status !== "approved") return "plan_not_approved";
	if (!Array.isArray(plan.workMilestones) || plan.workMilestones.length === 0) {
		return "empty";
	}
	return "ready";
}

function deriveBibliotecarioStatus(
	stateRoot: string,
):
	| "local_sources_found"
	| "local_sources_empty"
	| "external_fetch_needed"
	| "external_fetch_blocked"
	| "external_sources_found"
	| "ideas_extracted"
	| "ideas_ready_for_orchestrator"
	| undefined {
	const disc = readBirthArtifact<{ status?: string }>(
		stateRoot,
		"bibliotecario-discovery",
	);
	const s = disc?.status;
	switch (s) {
		case "local_sources_found":
		case "local_sources_empty":
		case "external_fetch_needed":
		case "external_fetch_blocked":
		case "external_sources_found":
		case "ideas_extracted":
		case "ideas_ready_for_orchestrator":
			return s;
		default:
			return undefined;
	}
}

function derivePrototypeStatus(
	stateRoot: string,
): "missing" | "draft" | "reviewed" | "approved" | "stale" {
	const p = readBirthArtifact<{ status?: string }>(stateRoot, "prototype-master");
	const s = p?.status;
	if (s === "draft" || s === "reviewed" || s === "approved" || s === "stale") {
		return s;
	}
	return "missing";
}

function deriveGeneralSpecStatus(
	stateRoot: string,
): "missing" | "draft" | "reviewed" | "approved" | "stale" {
	const p = readBirthArtifact<{ status?: string }>(stateRoot, "general-spec");
	const s = p?.status;
	if (s === "draft" || s === "reviewed" || s === "approved" || s === "stale") {
		return s;
	}
	return "missing";
}

function deriveRepoPlanStatus(
	stateRoot: string,
): "missing" | "planned" | "approved" {
	const p = readBirthArtifact<{ decision?: { repoWritesAllowed?: boolean } }>(
		stateRoot,
		"repo-plan",
	);
	if (!p) return "missing";
	if (p.decision?.repoWritesAllowed) return "approved";
	return "planned";
}

function deriveRepoHumanApproval(
	stateRoot: string,
): "missing" | "pending" | "approved" {
	const p = readBirthArtifact<{ plan?: { pushApproved?: boolean } }>(
		stateRoot,
		"repo-plan",
	);
	if (!p) return "missing";
	return p.plan?.pushApproved ? "approved" : "pending";
}
