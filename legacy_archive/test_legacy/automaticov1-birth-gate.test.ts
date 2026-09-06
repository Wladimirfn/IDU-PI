import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateBirthReadiness } from "../src/birth-pipeline.js";
import { writeBirthArtifact } from "../src/birth-artifacts.js";
import type { ProjectCore } from "../src/project-core.js";
import type { MasterPlan } from "../src/master-plan.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-auto-birth-"));
	mkdirSync(join(root, "config"), { recursive: true });
	return { stateRoot: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function seedCore(stateRoot: string, status: ProjectCore["status"]): void {
	const core: ProjectCore = {
		version: "1",
		projectName: "demo",
		sourceCoreStatus: status,
		status,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	} as unknown as ProjectCore;
	writeFileSync(
		join(stateRoot, "config", "project-core.json"),
		JSON.stringify(core),
		"utf8",
	);
}

function seedPlan(stateRoot: string, status: MasterPlan["status"]): void {
	const plan: MasterPlan = {
		version: 1,
		projectId: "demo",
		status,
		workMilestones: [],
	} as unknown as MasterPlan;
	writeFileSync(join(stateRoot, "master-plan.json"), JSON.stringify(plan), "utf8");
}

test("missing Project Core keeps allowedToImplement false", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const r = evaluateBirthReadiness({
			mode: "new_project",
			projectId: "demo",
			coreStatus: "missing",
			masterPlanTaskTreeStatus: "missing_plan",
			constitutionStatus: "missing",
			bibliotecarioStatus: undefined,
			prototypeStatus: "missing",
			generalSpecStatus: "missing",
		});
		assert.equal(r.allowedToImplement, false);
		assert.equal(r.repoWritesAllowed, false);
		assert.equal(r.nextRequiredAction, "idu_birth_intake");
	} finally {
		cleanup();
	}
});

test("Project Core confirmed but plan not approved keeps allowedToImplement false", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		seedCore(stateRoot, "confirmed");
		seedPlan(stateRoot, "draft");
		const r = evaluateBirthReadiness({
			mode: "existing_project",
			projectId: "demo",
			coreStatus: "confirmed",
			masterPlanTaskTreeStatus: "plan_not_approved",
			constitutionStatus: "active",
			bibliotecarioStatus: "local_sources_found",
			prototypeStatus: "missing",
			generalSpecStatus: "missing",
		});
		assert.equal(r.allowedToImplement, false);
		assert.ok(r.blockingReasons.some((reason) => /Master Plan/i.test(reason)));
	} finally {
		cleanup();
	}
});

test("prototype approved but general spec missing keeps visual implementation blocked", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		seedCore(stateRoot, "confirmed");
		seedPlan(stateRoot, "approved");
		writeBirthArtifact(stateRoot, "prototype-master", { status: "approved" });
		const r = evaluateBirthReadiness({
			mode: "new_project",
			projectId: "demo",
			coreStatus: "confirmed",
			masterPlanTaskTreeStatus: "ready",
			constitutionStatus: "active",
			bibliotecarioStatus: "local_sources_found",
			prototypeStatus: "approved",
			generalSpecStatus: "missing",
		});
		assert.equal(r.allowedToImplement, false);
		assert.ok(r.blockingReasons.some((reason) => /General Spec/i.test(reason)));
	} finally {
		cleanup();
	}
});

test("non-visual maintenance exception requires narrowedScopeAccepted", () => {
	const r = evaluateBirthReadiness({
		mode: "new_project",
		projectId: "demo",
		coreStatus: "confirmed",
		masterPlanTaskTreeStatus: "ready",
		constitutionStatus: "active",
		bibliotecarioStatus: "local_sources_found",
		prototypeStatus: "missing",
		generalSpecStatus: "missing",
		requestedWorkKind: "non_visual_maintenance",
		narrowedScopeAccepted: true,
	});
	assert.equal(r.allowedToImplement, true);
	assert.equal(r.repoWritesAllowed, false);
	assert.equal(r.scopeLimit, "non_visual_maintenance_only");
});
