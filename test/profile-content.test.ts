import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

// When the test runs from dist/test/, cwd is the project root.
// Use process.cwd() so the path resolves from the repo root, not
// from the dist directory.
const SUPERVISOR_PROFILE = resolve(
	process.cwd(),
	"config/profiles/supervisor-main.md",
);
const ORCHESTRATOR_PROFILE = resolve(
	process.cwd(),
	"config/profiles/orchestrator.md",
);

test("supervisor-main.md: contains Formato de salida section", () => {
	const content = readFileSync(SUPERVISOR_PROFILE, "utf8");
	assert.ok(
		content.includes("## Formato de salida") ||
			content.includes("Formato de salida"),
		"supervisor-main.md must include a 'Formato de salida' section that documents the output parser",
	);
});

test("supervisor-main.md: Formato de salida section mentions the 4-strategy parser", () => {
	const content = readFileSync(SUPERVISOR_PROFILE, "utf8");
	// The profile should mention at least 2 of the 4 parser strategies
	// so the LLM has guidance on what formats work.
	const strategies = ["parser", "markdown", "JSON", "tool"];
	const matches = strategies.filter((s) => content.includes(s));
	assert.ok(
		matches.length >= 2,
		`supervisor-main.md Formato de salida should mention at least 2 parser strategies, found: ${matches.join(", ")}`,
	);
});

test("supervisor-main.md: Formato de salida says respond with one line", () => {
	const content = readFileSync(SUPERVISOR_PROFILE, "utf8");
	// Must say something like "una sola linea" or "one line" to instruct the LLM.
	assert.ok(
		content.toLowerCase().includes("una sola línea") ||
			content.toLowerCase().includes("una sola linea") ||
			content.toLowerCase().includes("one line") ||
			content.toLowerCase().includes("single line"),
		"supervisor-main.md Formato de salida must tell the LLM to respond with one line",
	);
});

test("orchestrator.md: documents the cron auto-ack behavior", () => {
	const content = readFileSync(ORCHESTRATOR_PROFILE, "utf8");
	assert.ok(
		content.includes("auto-ack") || content.includes("autoack"),
		"orchestrator.md must document the cron's auto-ack behavior",
	);
});

test("orchestrator.md: documents the 1h cron interval for auto-ack", () => {
	const content = readFileSync(ORCHESTRATOR_PROFILE, "utf8");
	assert.ok(
		content.includes("1h") ||
			content.includes("1 hora") ||
			content.includes("~1 hora") ||
			content.includes("aproximadamente 1") ||
			content.includes("~1h"),
		"orchestrator.md must mention the ~1h cron interval",
	);
});

test("orchestrator.md: documents user-escalation reads by timestamp, not ack state", () => {
	const content = readFileSync(ORCHESTRATOR_PROFILE, "utf8");
	assert.ok(
		content.toLowerCase().includes("timestamp") ||
			content.toLowerCase().includes("marca temporal") ||
			content.toLowerCase().includes("por timestamp"),
		"orchestrator.md must mention that user-escalation reads by timestamp, not by acked state",
	);
});

test("orchestrator.md: contains Hygiene sensor section", () => {
	const content = readFileSync(ORCHESTRATOR_PROFILE, "utf8");
	assert.ok(
		content.includes("## Hygiene sensor"),
		"orchestrator.md must contain a '## Hygiene sensor' section",
	);
});

test("orchestrator.md: mentions hygiene-patterns.json override", () => {
	const content = readFileSync(ORCHESTRATOR_PROFILE, "utf8");
	assert.ok(
		content.includes("hygiene-patterns.json"),
		"orchestrator.md must mention the per-project override file hygiene-patterns.json",
	);
});

test("orchestrator.md: explicitly says idu-pi does NOT delete (orchestrator acts)", () => {
	const content = readFileSync(ORCHESTRATOR_PROFILE, "utf8");
	assert.ok(
		content.toLowerCase().includes("does not delete") ||
			content.toLowerCase().includes("no borra") ||
			content.toLowerCase().includes("no delete"),
		"orchestrator.md must explicitly say idu-pi does NOT delete files",
	);
});
