import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectPostflightReport } from "../src/project-postflight.js";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import {
	buildLabReviewPlan,
	formatLabReviewPlan,
} from "../src/lab-review-plan.js";

function postflight(
	overrides: Partial<ProjectPostflightReport> = {},
): ProjectPostflightReport {
	return {
		risk: "low",
		changedFiles: [],
		impactedAreas: [],
		warnings: [],
		recommendedNext: "Sin cambios locales detectados.",
		shouldRunAgentLab: false,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: false,
		...overrides,
	};
}

function preflight(
	overrides: Partial<ProjectPreflightReport> = {},
): ProjectPreflightReport {
	return {
		risk: "low",
		okToProceed: true,
		request: "resumir proyecto",
		connectionStatus: "ready",
		affectedAreas: ["tarea simple"],
		missingContext: [],
		warnings: [],
		recommendedNext: "Puede continuar sin preflight adicional.",
		requiresHumanConfirmation: false,
		shouldRunAgentLab: false,
		...overrides,
	};
}

test("postflight low does not require review", () => {
	const plan = buildLabReviewPlan({ postflightReport: postflight() });

	assert.equal(plan.shouldReview, false);
	assert.equal(plan.risk, "low");
	assert.equal(plan.structuredTaskInput, undefined);
});

test("postflight DB high suggests database lab", () => {
	const plan = buildLabReviewPlan({
		projectId: "demo",
		postflightReport: postflight({
			risk: "high",
			impactedAreas: ["DB/storage"],
			warnings: ["Cambio toca DB/storage: src/lab-db.ts"],
		}),
	});

	assert.equal(plan.shouldReview, true);
	assert.ok(plan.suggestedAgentLabs.includes("database"));
	assert.equal(plan.structuredTaskInput?.category, "review");
	assert.equal(plan.structuredTaskInput?.source, "idu-pi");
	assert.equal(plan.structuredTaskInput?.projectId, "demo");
});

test("postflight security/env suggests security lab", () => {
	const plan = buildLabReviewPlan({
		postflightReport: postflight({
			risk: "blocker",
			impactedAreas: ["seguridad"],
			warnings: ["Archivo .env cambiado o trackeado; posible secreto."],
		}),
	});

	assert.ok(plan.suggestedAgentLabs.includes("security"));
});

test("postflight project-flows suggests architecture lab", () => {
	const plan = buildLabReviewPlan({
		postflightReport: postflight({
			risk: "high",
			impactedAreas: ["flujos/mapa"],
		}),
	});

	assert.ok(plan.suggestedAgentLabs.includes("architecture"));
});

test("English map impact suggests architecture lab", () => {
	const plan = buildLabReviewPlan({
		postflightReport: postflight({
			risk: "medium",
			impactedAreas: ["map"],
		}),
	});

	assert.ok(plan.suggestedAgentLabs.includes("architecture"));
});

test("orchestration index lab queue suggests code_quality lab", () => {
	for (const impactedArea of ["orquestación", "orchestration"]) {
		const plan = buildLabReviewPlan({
			postflightReport: postflight({
				risk: "high",
				impactedAreas: [impactedArea],
			}),
		});

		assert.ok(plan.suggestedAgentLabs.includes("code_quality"));
	}
});

test("UI components html suggests ui_ux lab", () => {
	const plan = buildLabReviewPlan({
		postflightReport: postflight({
			risk: "medium",
			impactedAreas: ["UI"],
		}),
	});

	assert.ok(plan.suggestedAgentLabs.includes("ui_ux"));
});

test("performance build test impact suggests performance lab", () => {
	const plan = buildLabReviewPlan({
		postflightReport: postflight({
			risk: "medium",
			impactedAreas: ["performance/build/test"],
		}),
	});

	assert.ok(plan.suggestedAgentLabs.includes("performance"));
});

test("preflight high by login auth suggests security lab", () => {
	const plan = buildLabReviewPlan({
		projectId: "demo",
		requestText: "arreglar login y auth",
		preflightReport: preflight({
			risk: "high",
			affectedAreas: ["auth/login", "security"],
			warnings: ["cambio toca autenticación"],
		}),
	});

	assert.equal(plan.shouldReview, true);
	assert.ok(plan.suggestedAgentLabs.includes("security"));
	assert.equal(plan.structuredTaskInput?.category, "review");
	assert.equal(plan.structuredTaskInput?.source, "idu-pi");
});

test("medium high and blocker risks create review StructuredTaskInput", () => {
	for (const risk of ["medium", "high", "blocker"] as const) {
		const plan = buildLabReviewPlan({
			projectId: "demo",
			preflightReport: preflight({
				risk,
				affectedAreas: ["lab/queue"],
			}),
		});

		assert.equal(plan.shouldReview, true);
		assert.equal(plan.structuredTaskInput?.category, "review");
		assert.equal(plan.structuredTaskInput?.source, "idu-pi");
		assert.equal(plan.structuredTaskInput?.projectId, "demo");
	}
});

test("preflight high creates StructuredTaskInput category review", () => {
	const plan = buildLabReviewPlan({
		projectId: "demo",
		requestText: "agrega módulo de compras",
		preflightReport: preflight({
			risk: "high",
			affectedAreas: ["arquitectura", "módulo nuevo"],
			warnings: ["compras no está confirmado"],
		}),
	});

	assert.equal(plan.shouldReview, true);
	assert.equal(plan.structuredTaskInput?.category, "review");
	assert.match(
		plan.structuredTaskInput?.text ?? "",
		/agrega módulo de compras/u,
	);
	assert.ok(plan.suggestedAgentLabs.includes("architecture"));
});

test("formatLabReviewPlan shows labs and never claims execution", () => {
	const plan = buildLabReviewPlan({
		postflightReport: postflight({
			risk: "high",
			impactedAreas: ["DB/storage"],
			warnings: ["Cambio toca DB/storage"],
		}),
	});
	const text = formatLabReviewPlan(plan);

	assert.match(text, /Lab Review Plan Idu-pi/u);
	assert.match(text, /Riesgo:\nhigh/u);
	assert.match(text, /database/u);
	assert.match(text, /No ejecuté AgentLabs/u);
});
