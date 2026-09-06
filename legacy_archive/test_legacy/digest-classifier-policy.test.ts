import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyInterrupt, type DigestSignal } from "../src/digest.js";
import { loadRoleProfile } from "../src/roles/profile-loader.js";

function signal(overrides: Partial<DigestSignal> = {}): DigestSignal {
	return {
		id: "sig-1",
		domain: "ui",
		kind: "ui-regression",
		riskLevel: "low",
		guardRisk: "low",
		summary: "demo signal",
		...overrides,
	};
}

test("policy: supervisor-main only escalates security/db/data-loss to immediate", () => {
	// The policy: the supervisor-main profile must explicitly
	// say "Escalaciones a humano SOLO para riesgo crítico
	// (seguridad, DB, pérdida de datos). Señales no críticas
	// dirigidas al digest, nunca interrupciones individuales."
	const profile = loadRoleProfile("supervisor-main");
	const allProhibitions = profile.prohibitions.join("\n");
	assert.match(
		allProhibitions,
		/Interrumpir al humano/i,
		"supervisor-main must prohibit arbitrary interruptions",
	);
});

test("classifyInterrupt: high riskLevel does NOT interrupt (digest)", () => {
	const result = classifyInterrupt(signal({ riskLevel: "high" }));
	assert.equal(result, "digest", "high severity must not interrupt");
});

test("classifyInterrupt: blocker riskLevel does NOT interrupt (digest)", () => {
	const result = classifyInterrupt(signal({ riskLevel: "blocker" }));
	assert.equal(result, "digest", "blocker severity must not interrupt");
});

test("classifyInterrupt: high riskLevel + ui domain still goes to digest", () => {
	const result = classifyInterrupt(signal({ riskLevel: "high", domain: "ui" }));
	assert.equal(result, "digest");
});

test("classifyInterrupt: high riskLevel + code-quality still goes to digest", () => {
	const result = classifyInterrupt(
		signal({ riskLevel: "high", domain: "code-quality" }),
	);
	assert.equal(result, "digest");
});

test("classifyInterrupt: security domain interrupts (immediate)", () => {
	const result = classifyInterrupt(signal({ domain: "security" }));
	assert.equal(result, "immediate", "security must interrupt");
});

test("classifyInterrupt: db domain interrupts (immediate)", () => {
	const result = classifyInterrupt(signal({ domain: "db" }));
	assert.equal(result, "immediate");
});

test("classifyInterrupt: data_loss riskHint interrupts (immediate)", () => {
	const result = classifyInterrupt(signal({ riskHints: ["data_loss"] }));
	assert.equal(result, "immediate");
});

test("classifyInterrupt: low severity + ui domain stays in digest", () => {
	const result = classifyInterrupt(signal({ riskLevel: "low", domain: "ui" }));
	assert.equal(result, "digest");
});
