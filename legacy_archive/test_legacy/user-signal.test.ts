import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeUserSignal } from "../src/user-signal.js";

test("analyzeUserSignal detects urgent messages", () => {
	const result = analyzeUserSignal(
		"Urgente, se cayó el sistema y no funciona ya",
	);

	assert.equal(result.emotion, "urgente");
	assert.equal(result.urgency, 5);
	assert.equal(result.confidence, "high");
	assert.ok(result.matchedKeywords.includes("urgente"));
	assert.ok(result.matchedKeywords.includes("se cayó"));
});

test("analyzeUserSignal detects annoyed messages", () => {
	const result = analyzeUserSignal("Estoy harto, otra vez pasa lo mismo");

	assert.equal(result.emotion, "molesto");
	assert.equal(result.urgency, 4);
	assert.ok(result.matchedKeywords.includes("harto"));
	assert.ok(result.matchedKeywords.includes("otra vez"));
});

test("analyzeUserSignal detects tired messages", () => {
	const result = analyzeUserSignal("Estoy cansado y agotado con este problema");

	assert.equal(result.emotion, "cansado");
	assert.equal(result.urgency, 3);
	assert.ok(result.matchedKeywords.includes("cansado"));
	assert.ok(result.matchedKeywords.includes("agotado"));
});

test("analyzeUserSignal detects confused messages", () => {
	const result = analyzeUserSignal("No entiendo, estoy confundido");

	assert.equal(result.emotion, "confundido");
	assert.equal(result.urgency, 3);
	assert.ok(result.matchedKeywords.includes("no entiendo"));
	assert.ok(result.matchedKeywords.includes("confundido"));
});

test("analyzeUserSignal detects happy messages", () => {
	const result = analyzeUserSignal("Excelente, perfecto, gracias");

	assert.equal(result.emotion, "feliz");
	assert.equal(result.urgency, 2);
	assert.ok(result.matchedKeywords.includes("excelente"));
	assert.ok(result.matchedKeywords.includes("perfecto"));
	assert.ok(result.matchedKeywords.includes("gracias"));
});

test("analyzeUserSignal returns neutral without keywords", () => {
	const result = analyzeUserSignal("Revisemos el estado del proyecto");

	assert.equal(result.emotion, "neutral");
	assert.equal(result.urgency, 1);
	assert.equal(result.confidence, "low");
	assert.deepEqual(result.matchedKeywords, []);
});

test("analyzeUserSignal handles empty text", () => {
	const result = analyzeUserSignal("");

	assert.equal(result.emotion, "neutral");
	assert.equal(result.urgency, 1);
	assert.equal(result.confidence, "low");
	assert.deepEqual(result.matchedKeywords, []);
});

test("analyzeUserSignal reports medium confidence for one keyword", () => {
	const result = analyzeUserSignal("Esto no me queda claro");

	assert.equal(result.emotion, "confundido");
	assert.equal(result.urgency, 3);
	assert.equal(result.confidence, "medium");
	assert.deepEqual(result.matchedKeywords, ["no me queda claro"]);
});
