import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AUTONOMY_GATES,
	AUTONOMY_GATE_TEXTS,
	buildAutonomyGateTrace,
	buildAutonomyGateTraces,
	classifyGateOperation,
	parseAutonomyGateTrace,
} from "../src/autonomy-gates.js";

test("AUTONOMY_GATES ships the seven gates with stable ids and an operation tag", () => {
	assert.equal(AUTONOMY_GATES.length, 7);
	assert.equal(AUTONOMY_GATE_TEXTS.length, 7);
	const ids = AUTONOMY_GATES.map((gate) => gate.gateId);
	assert.equal(new Set(ids).size, 7, "gate ids must be unique");
	for (const gate of AUTONOMY_GATES) {
		assert.ok(gate.operation === "read" || gate.operation === "write");
		assert.ok(gate.text.length > 0);
	}
});

// D2 part 2: read gates are advisory (warn, never block), write gates block.
test("buildAutonomyGateTrace: READ gate is advisory (allow, agent proceeds)", () => {
	const trace = buildAutonomyGateTrace({
		gateId: "agentlabs-audit-only",
		text: "AgentLabs son audit-only y sólo por llamada explícita; nunca implementan.",
		operation: "read",
	});
	assert.equal(trace.operation, "read");
	assert.equal(trace.advisory, true);
	assert.equal(trace.verdict, "allow");
	assert.equal(trace.honored, true);
	assert.equal(trace.overridden, false);
	assert.match(trace.outcome, /advisory/u);
});

test("buildAutonomyGateTrace: WRITE gate is blocking (deny)", () => {
	const trace = buildAutonomyGateTrace({
		gateId: "no-commit-without-instruction",
		text: "No commit/push sin instrucción explícita.",
		operation: "write",
	});
	assert.equal(trace.operation, "write");
	assert.equal(trace.advisory, false);
	assert.equal(trace.verdict, "deny");
	assert.equal(trace.honored, true);
	assert.equal(trace.overridden, false);
	assert.match(trace.outcome, /block/u);
});

test("buildAutonomyGateTraces: every gate leaves a per-gate trace", () => {
	const traces = buildAutonomyGateTraces();
	assert.equal(traces.length, AUTONOMY_GATES.length);
	// Mix of read (advisory) and write (blocking) gates is present.
	assert.ok(traces.some((trace) => trace.operation === "read" && trace.advisory));
	assert.ok(traces.some((trace) => trace.operation === "write" && !trace.advisory));
	for (const trace of traces) {
		assert.ok(typeof trace.gateId === "string" && trace.gateId.length > 0);
		assert.ok(trace.verdict === "allow" || trace.verdict === "deny");
	}
});

test("classifyGateOperation: write keywords classify as write, else read", () => {
	assert.equal(classifyGateOperation("No commit/push sin instrucción"), "write");
	assert.equal(classifyGateOperation("Corregir bugs con tests"), "write");
	assert.equal(classifyGateOperation("Ejecutar idu_postflight antes de cerrar"), "write");
	assert.equal(classifyGateOperation("cambiar deps y config"), "write");
	assert.equal(classifyGateOperation("Consultar Plan Maestro"), "read");
	assert.equal(classifyGateOperation("AgentLabs audit-only"), "read");
	assert.equal(classifyGateOperation("reportar parcial/omisiones"), "read");
	// Default (unknown) is read — least restrictive, never block a read.
	assert.equal(classifyGateOperation("algo totalmente neutro"), "read");
});

test("parseAutonomyGateTrace: coerces loose records and rejects junk", () => {
	assert.equal(parseAutonomyGateTrace(null), null);
	assert.equal(parseAutonomyGateTrace("not-an-object"), null);
	assert.equal(parseAutonomyGateTrace({ operation: "read" }), null); // missing gateId
	const parsed = parseAutonomyGateTrace({
		gateId: "g1",
		operation: "write",
	});
	assert.equal(parsed?.gateId, "g1");
	assert.equal(parsed?.verdict, "allow"); // default when not 'deny'
	assert.equal(parsed?.advisory, false); // write => not advisory
	assert.equal(parsed?.honored, true);
	assert.equal(parsed?.overridden, false);
});
