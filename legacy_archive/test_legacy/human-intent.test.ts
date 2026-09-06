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

	assert.equal(result.intent, "bug_report");
	assert.equal(result.kind, "bug_report");
	assert.equal(result.action, "require_confirmation");
	assert.equal(result.taskCategory, "bug");
	assert.equal(result.riskHint, "high");
	assert.equal(result.emotion, "urgente");
	assert.equal(result.urgency, 5);
	assert.equal(result.requiresHumanConfirmation, true);
	assert.equal(result.shouldBlockIfIduActive, true);
	assert.equal(result.concepts.includes("auth"), true);
	assert.equal(result.concepts.includes("login"), true);
	assert.equal(result.riskHints.includes("auth_change"), true);
	assert.match(result.matchedEvidence.join(" "), /login|autentic/u);
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

test("classifyIntentDeterministic blocks destructive non database intent", () => {
	for (const text of ["delete file", "borrar archivo", "delete deployment"]) {
		const result = classifyIntentDeterministic(text);

		assert.equal(result.kind, "task", text);
		assert.equal(result.action, "require_confirmation", text);
		assert.equal(result.riskHint, "blocker", text);
		assert.equal(result.requiresHumanConfirmation, true, text);
		assert.equal(result.shouldBlockIfIduActive, true, text);
	}
});

test("classifyIntentDeterministic detects database failure bug reports", () => {
	for (const text of [
		"fallas en las bases de datos debemos arreglarla",
		"arreglar db",
		"seguimos con fallas en base de datos",
		"segimos con fallas en las bases de datos debemos arreglarla",
		"nuevamnet a fallado la base de datos",
		"database keeps failing",
	]) {
		const result = classifyIntentDeterministic(text);

		assert.equal(result.intent, "bug_report");
		assert.equal(result.kind, "bug_report");
		assert.equal(result.taskCategory, "bug");
		assert.equal(result.action, "require_confirmation");
		assert.equal(result.riskHint, "high");
		assert.equal(result.requiresHumanConfirmation, true);
		assert.equal(result.shouldBlockIfIduActive, true);
		assert.equal(result.concepts.includes("database"), true);
		assert.equal(result.riskHints.includes("db_change"), true);
	}
});

test("classifyIntentDeterministic normalizes nuevamnet as recurring database failure", () => {
	const result = classifyIntentDeterministic(
		"nuevamnet a fallado la base de datos",
	);

	assert.match(result.normalizedText, /nuevamente/u);
	assert.equal(result.intent, "bug_report");
	assert.equal(result.riskHint, "high");
	assert.equal(result.concepts.includes("database"), true);
	assert.equal(result.concepts.includes("recurring_failure"), true);
});

test("classifyIntentDeterministic separates approvals, rejections, status, and questions", () => {
	assert.equal(
		classifyIntentDeterministic("aprobá la tarea task-123").kind,
		"approval",
	);
	assert.equal(classifyIntentDeterministic("dale confirmo").kind, "approval");
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

test("classifyIntentDeterministic handles required auth and task examples", () => {
	const cases = [
		["fallo el loggin", ["auth", "login"]],
		["fallo nuevamente el legin", ["auth", "login", "recurring_failure"]],
		["inicio de secion no funciona", ["auth", "login", "session"]],
		["no puedo entrar al sistema", ["auth", "access"]],
		["me saca del sistema", ["auth", "session"]],
		["clave mala", ["auth", "password", "security"]],
		["the login is broken again", ["auth", "login", "recurring_failure"]],
		["user cannot sign in", ["auth", "login", "access"]],
		["password is wrong", ["auth", "password", "security"]],
	] as const;
	for (const [text, concepts] of cases) {
		const result = classifyIntentDeterministic(text);
		assert.equal(result.intent, "bug_report", text);
		assert.equal(result.taskCategory, "bug", text);
		assert.equal(result.shouldBlockIfIduActive, true, text);
		for (const concept of concepts) {
			assert.equal(
				result.concepts.includes(concept),
				true,
				`${text}: ${concept}`,
			);
		}
	}
});

test("classifyIntentDeterministic does not treat authority as auth", () => {
	const result = classifyIntentDeterministic("advisory-only authority");

	assert.equal(result.concepts.includes("auth"), false);
	assert.equal(result.concepts.includes("login"), false);
	assert.equal(result.concepts.includes("security"), false);
	assert.equal(result.riskHints.includes("auth_change"), false);
	assert.equal(result.riskHints.includes("security"), false);
	assert.notEqual(result.riskHint, "high");
	assert.equal(result.shouldBlockIfIduActive, false);
});

test("classifyIntentDeterministic handles change docs and review examples", () => {
	const table = [
		["cambia tabla users", "change_request", "feature", ["database", "schema"]],
		["agrega módulo compras", "change_request", "feature", ["module"]],
		["conecta compras con inventario", "change_request", "feature", ["flow"]],
		["documenta el readme", "documentation_task", "docs", ["docs"]],
		["summarize README", "documentation_task", "docs", ["docs"]],
		["revisa si esto está bien", "review_request", "review", ["quality"]],
		["review this code", "review_request", "review", ["quality"]],
	] as const;
	for (const [text, intent, category, concepts] of table) {
		const result = classifyIntentDeterministic(text);
		assert.equal(result.intent, intent, text);
		assert.equal(result.taskCategory, category, text);
		for (const concept of concepts) {
			assert.equal(
				result.concepts.includes(concept),
				true,
				`${text}: ${concept}`,
			);
		}
	}
});

test("classifyIntentWithContext adds task category concept and escalates risk", () => {
	const result = classifyIntentWithContext("actualizar README", {
		taskCategory: "docs",
		projectRisk: "medium",
	});

	assert.equal(result.kind, "documentation_task");
	assert.equal(result.riskHint, "medium");
	assert.equal(result.concepts.includes("docs"), true);
});

test("formatIntentClassification exposes kind concepts risk and evidence", () => {
	const classification: IntentClassification = {
		originalText: "urgente login falla",
		languageHints: "spanish",
		intent: "bug_report",
		taskCategory: "bug",
		kind: "bug_report",
		action: "require_confirmation",
		concepts: ["auth" satisfies IntentConcept],
		riskHints: ["auth_change"],
		riskHint: "high" satisfies IntentRiskHint,
		confidence: "high",
		matchedEvidence: ["login"],
		ambiguity: [],
		shouldAskClarification: false,
		shouldBlockIfIduActive: true,
		recommendedHandling: "needs_confirmation",
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
