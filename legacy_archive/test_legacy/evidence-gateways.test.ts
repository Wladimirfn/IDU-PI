import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPostflightEvidenceGateways,
	buildPreflightEvidenceGateways,
	buildSourceRequiredActionsEvidenceGateways,
	buildTaskPackageEvidenceGateways,
} from "../src/evidence-gateways.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import type { SourceRequiredActionsReport } from "../src/source-digest.js";

test("preflight evidence gateway blocks on missing context and human confirmation", () => {
	const report: ProjectPreflightReport = {
		risk: "blocker",
		okToProceed: false,
		request: "cambiar auth",
		projectId: "idu-pi",
		projectPath: "C:/repo",
		connectionStatus: "connected",
		affectedAreas: ["auth/seguridad"],
		missingContext: ["Falta Plan Maestro aprobado."],
		warnings: ["Cambio crítico."],
		recommendedNext: "Pedir aprobación antes de implementar.",
		requiresHumanConfirmation: true,
		shouldRunAgentLab: true,
	};

	const [gateway] = buildPreflightEvidenceGateways(report);

	assert.equal(gateway.status, "block");
	assert.equal(gateway.allowedToProceed, false);
	assert.equal(gateway.advisoryOnly, true);
	assert.ok(gateway.evidence.some((item) => item.status === "needs_evidence"));
	assert.ok(
		gateway.requiredActions.some(
			(action) => action.action === "provide_missing_context_or_reduce_scope",
		),
	);
});

test("postflight evidence gateway records task trace deltas as missing evidence", () => {
	const report: ProjectPostflightReport = {
		risk: "low",
		changedFiles: ["src/mcp-server.ts"],
		ignoredFiles: [],
		observedChangeMode: "code",
		impactedAreas: ["orquestación"],
		warnings: [],
		recommendedNext: "Revisar cambios.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
	};

	const [gateway] = buildPostflightEvidenceGateways({
		report,
		taskTrace: { matchesIntent: false, missingExpectedContracts: ["data"] },
	});

	assert.equal(gateway.status, "needs_evidence");
	assert.equal(gateway.allowedToProceed, false);
	assert.ok(
		gateway.requiredActions.some(
			(action) => action.action === "resolve_task_trace_delta",
		),
	);
});

test("task package evidence gateway keeps worker execution behind governance review", () => {
	const [gateway] = buildTaskPackageEvidenceGateways({
		preconditions: {
			planApproved: true,
			blocked: false,
			blockers: [],
			recommendation: "governance_review",
		},
		orchestratorDecisionRequired: true,
		humanApprovalRequired: false,
		postflightRequired: true,
		governanceReview: { required: true },
	});

	assert.equal(gateway.status, "needs_human");
	assert.equal(gateway.allowedToProceed, false);
	assert.ok(
		gateway.requiredActions.some(
			(action) => action.action === "run_governance_review_before_worker",
		),
	);
	assert.ok(
		gateway.requiredActions.some(
			(action) => action.action === "run_idu_postflight_after_diff",
		),
	);
});

test("source required actions gateway requires librarian reader evidence", () => {
	const report: SourceRequiredActionsReport = {
		projectId: "idu-pi",
		generatedAt: "2026-06-02T00:00:00.000Z",
		actions: [
			{
				sourceId: "source-pdf",
				title: "Unread PDF",
				kind: "pdf",
				digestStatus: "blocked_unread",
				conversionStatus: "metadata_only",
				requiredAction: {
					owner: "orchestrator",
					action: "dispatch_librarian_reader",
					reason: "No readable text was available.",
					recommendedAgent: "librarian",
					recommendedReaderType: "document-reader",
					instructions: "Read the source and produce evidence.",
					contractPromotionAllowed: false,
				},
				contractPromotionAllowed: false,
			},
		],
		limitations: [],
		contractPromotionAllowed: false,
	};

	const [gateway] = buildSourceRequiredActionsEvidenceGateways(report);

	assert.equal(gateway.status, "needs_evidence");
	assert.equal(gateway.allowedToProceed, false);
	assert.equal(gateway.requiredActions[0]?.action, "dispatch_librarian_reader");
	assert.equal(
		(gateway.requiredActions[0]?.data as { contractPromotionAllowed: boolean })
			.contractPromotionAllowed,
		false,
	);
});
