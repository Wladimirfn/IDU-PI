import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProjectPreflightReport } from "../src/project-preflight.js";
import {
	buildProjectAdvisory,
	formatProjectAdvisory,
} from "../src/project-advisory.js";

function preflight(
	overrides: Partial<ProjectPreflightReport> = {},
): ProjectPreflightReport {
	return {
		risk: "low",
		okToProceed: true,
		request: "resumir archivo",
		projectId: "demo",
		projectPath: "/demo",
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

test("low preflight risk becomes info advisory", () => {
	const advisory = buildProjectAdvisory(preflight({ risk: "low" }));

	assert.equal(advisory.level, "info");
	assert.equal(advisory.title, "Idu-pi Advisory — Info");
});

test("medium preflight risk becomes warning advisory", () => {
	const advisory = buildProjectAdvisory(preflight({ risk: "medium" }));

	assert.equal(advisory.level, "warning");
});

test("high preflight risk becomes risk advisory", () => {
	const advisory = buildProjectAdvisory(
		preflight({
			risk: "high",
			request: "agrega módulo de compras y conéctalo con inventario",
			affectedAreas: ["arquitectura", "flujo funcional", "módulo nuevo"],
			warnings: ["compras no está confirmado en project-flows."],
			recommendedNext: "Confirmar project-flows antes de implementar.",
			requiresHumanConfirmation: true,
			shouldRunAgentLab: true,
		}),
	);

	assert.equal(advisory.level, "risk");
	assert.equal(advisory.requiresHumanConfirmation, true);
	assert.ok(advisory.actions.some((action) => /preflight/u.test(action)));
});

test("blocker preflight risk becomes blocker advisory", () => {
	const advisory = buildProjectAdvisory(
		preflight({
			risk: "blocker",
			okToProceed: false,
			connectionStatus: "not_connected",
			missingContext: ["No hay proyecto activo conectado."],
			recommendedNext: "/addproject <id> <ruta>",
			requiresHumanConfirmation: true,
		}),
	);

	assert.equal(advisory.level, "blocker");
	assert.equal(advisory.title, "Idu-pi Advisory — Bloqueado");
});

test("formatProjectAdvisory limits long lists to top 5", () => {
	const advisory = buildProjectAdvisory(
		preflight({
			risk: "high",
			affectedAreas: ["a", "b", "c", "d", "e", "f"],
			warnings: ["w1", "w2", "w3", "w4", "w5", "w6"],
		}),
	);
	const text = formatProjectAdvisory(advisory);

	assert.match(text, /- a\n- b\n- c\n- d\n- e\n- \+1 más/u);
	assert.match(text, /- w1\n- w2\n- w3\n- w4\n- w5\n- \+1 más/u);
	assert.doesNotMatch(text, /- f/u);
	assert.doesNotMatch(text, /- w6/u);
});

test("formatProjectAdvisory renders short risk advisory", () => {
	const advisory = buildProjectAdvisory(
		preflight({
			risk: "high",
			request: "agrega módulo de compras y conéctalo con inventario",
			affectedAreas: ["arquitectura", "flujo funcional", "módulos"],
			recommendedNext: "Confirmar project-flows antes de implementar.",
			shouldRunAgentLab: true,
		}),
	);
	const text = formatProjectAdvisory(advisory);

	assert.match(text, /Idu-pi Advisory — Riesgo alto/u);
	assert.match(text, /Solicitud:\nagrega módulo de compras/u);
	assert.match(text, /Detecté impacto en:/u);
	assert.match(text, /Recomendación:\nConfirmar project-flows/u);
	assert.match(text, /No ejecuté scan, IA ni AgentLabs/u);
	assert.ok(text.length < 1200);
});

test("formatProjectAdvisory separates missing context from warnings", () => {
	const advisory = buildProjectAdvisory(
		preflight({
			risk: "medium",
			missingContext: [
				"Falta config/project-blueprint.json project-local.",
				"Falta config/project-flows.json project-local.",
			],
			warnings: ["compras no está confirmado en project-flows."],
		}),
	);
	const text = formatProjectAdvisory(advisory);

	assert.match(
		text,
		/Contexto faltante:\n- Falta config\/project-blueprint\.json project-local/u,
	);
	assert.match(
		text,
		/Contexto faltante:[\s\S]*project-flows\.json project-local/u,
	);
	assert.match(text, /Alertas:\n- compras no está confirmado/u);
	assert.doesNotMatch(text, /project-local válido/u);
});

test("buildProjectAdvisory does not write files", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-advisory-"));
	try {
		const before = readdirSync(dir);
		buildProjectAdvisory(preflight({ projectPath: dir }));
		assert.deepEqual(readdirSync(dir), before);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
