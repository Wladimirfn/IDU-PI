import assert from "node:assert/strict";
import { test } from "node:test";
import {
	classifyIntentDeterministic,
	classifyIntentWithContext,
	formatIntentClassification,
	normalizeHumanText,
	type IntentClassification,
	type IntentConcept,
	type IntentRiskHint,
} from "../src/human-intent.js";

test("normalizeHumanText lowercases, removes accents, and compacts whitespace", () => {
	assert.equal(
		normalizeHumanText("  ¡CRÍTICO!  Login\tfalló otra vez  "),
		"critico login fallo otra vez",
	);
});

test("classifyIntentDeterministic detects urgent auth task intent", () => {
	const result = classifyIntentDeterministic(
		"Urgente, el login falla y no deja autenticar usuarios",
	);

	assert.equal(result.kind, "task");
	assert.equal(result.action, "require_confirmation");
	assert.equal(result.riskHint, "high");
	assert.equal(result.emotion, "urgente");
	assert.equal(result.urgency, 5);
	assert.equal(result.requiresHumanConfirmation, true);
	assert.equal(result.concepts.includes("auth"), true);
	assert.match(result.evidence.join(" "), /login|autenticar/u);
});

test("classifyIntentDeterministic detects destructive database blocker intent", () => {
	const result = classifyIntentDeterministic(
		"Borrá la base de datos y aplicá el cambio de schema en producción",
	);

	assert.equal(result.kind, "task");
	assert.equal(result.action, "require_confirmation");
	assert.equal(result.riskHint, "blocker");
	assert.equal(result.requiresHumanConfirmation, true);
	assert.deepEqual(
		result.concepts.filter((concept) => concept === "database"),
		["database"],
	);
	assert.equal(result.concepts.includes("deployment"), true);
});

test("classifyIntentDeterministic separates approvals, rejections, status, and questions", () => {
	assert.equal(
		classifyIntentDeterministic("aprobá la tarea task-123").kind,
		"approval",
	);
	assert.equal(
		classifyIntentDeterministic("rechazá esa tarea").kind,
		"rejection",
	);
	assert.equal(
		classifyIntentDeterministic("mostrame el estado de la cola").kind,
		"status",
	);
	assert.equal(
		classifyIntentDeterministic("qué hace idu-pi?").kind,
		"question",
	);
});

test("classifyIntentWithContext adds task category concept and escalates risk", () => {
	const result = classifyIntentWithContext("actualizar README", {
		taskCategory: "docs",
		projectRisk: "medium",
	});

	assert.equal(result.kind, "task");
	assert.equal(result.riskHint, "medium");
	assert.equal(result.concepts.includes("docs"), true);
});

test("formatIntentClassification exposes kind concepts risk and evidence", () => {
	const classification: IntentClassification = {
		kind: "task",
		action: "require_confirmation",
		concepts: ["auth" satisfies IntentConcept],
		riskHint: "high" satisfies IntentRiskHint,
		confidence: "high",
		requiresHumanConfirmation: true,
		emotion: "urgente",
		urgency: 5,
		evidence: ["login"],
		normalizedText: "urgente login falla",
	};

	const formatted = formatIntentClassification(classification);

	assert.match(formatted, /task/u);
	assert.match(formatted, /auth/u);
	assert.match(formatted, /high/u);
	assert.match(formatted, /login/u);
});
