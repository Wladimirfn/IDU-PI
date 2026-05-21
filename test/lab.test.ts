import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	formatDurationChoices,
	labPrompt,
	parseLabDuration,
} from "../src/lab.js";
import {
	formatLabProjectContext,
	loadLabProjectContext,
} from "../src/lab-context.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-lab-context-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("parseLabDuration accepts depth labels and selector numbers", () => {
	assert.equal(parseLabDuration("1")?.label, "quick");
	assert.equal(parseLabDuration("2")?.label, "3tests");
	assert.equal(parseLabDuration("4.")?.label, "full");
	assert.equal(parseLabDuration("5tests")?.maxCommands, 5);
	assert.equal(parseLabDuration("bad"), undefined);
});

test("formatDurationChoices lists all options", () => {
	const choices = formatDurationChoices();
	assert.match(choices, /1\. quick/);
	assert.match(choices, /4\. full/);
});

test("labPrompt includes lab safety constraints", () => {
	const prompt = labPrompt(
		{
			label: "3tests",
			ms: 900_000,
			maxCommands: 3,
			description: "hasta 3 comandos",
		},
		{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
	);
	assert.match(prompt, /Profundidad: 3tests/);
	assert.match(prompt, /No hagas commit/);
	assert.match(prompt, /No hagas push/);
	assert.match(prompt, /workspace\/clon/);
	assert.match(prompt, /máximo 3 comandos/);
	assert.match(prompt, /corepack pnpm test/);
});

test("labPrompt includes project context when provided", () => {
	const prompt = labPrompt(
		{
			label: "quick",
			ms: 300_000,
			maxCommands: 1,
			description: "1 verificación corta",
		},
		{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
		{
			text: "Proyecto: Demo\nObjetivo: Gestionar máquinas\nMódulos: machines\nPantallas: /machines\nDatos: operations-db\nFlujos: button -> function -> db",
		},
	);

	assert.match(prompt, /Contexto del proyecto real/u);
	assert.match(prompt, /Gestionar máquinas/u);
	assert.match(prompt, /operations-db/u);
	assert.match(prompt, /No hagas commit/u);
	assert.match(prompt, /No hagas push/u);
	assert.match(prompt, /AgentLabReport/u);
});

test("labPrompt works without project context", () => {
	const prompt = labPrompt(
		{
			label: "quick",
			ms: 300_000,
			maxCommands: 1,
			description: "1 verificación corta",
		},
		{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
	);

	assert.doesNotMatch(prompt, /Contexto del proyecto real/u);
	assert.match(prompt, /No hagas commit/u);
	assert.match(prompt, /AgentLabReport/u);
});

test("loadLabProjectContext returns undefined when blueprint or flows fail", () => {
	const projectPath = tempDir();
	mkdirSync(join(projectPath, "config"), { recursive: true });
	writeFileSync(
		join(projectPath, "config", "project-blueprint.json"),
		"{ invalid",
	);

	assert.equal(loadLabProjectContext(projectPath), undefined);
});

test("loadLabProjectContext includes scan summary when scanner works", () => {
	const projectPath = tempDir();
	writeFileSync(
		join(projectPath, "index.html"),
		`<button id="unmapped" onclick="runSecret()">token=secret-value</button><button id="unmapped">Duplicate</button>`,
	);

	const context = loadLabProjectContext(projectPath);

	assert.ok(context);
	assert.match(context.text, /Scan project map/u);
	assert.match(context.text, /Pantallas reales no mapeadas/u);
	assert.match(context.text, /UI elements no mapeados/u);
	assert.match(context.text, /Selectores faltantes/u);
	assert.match(context.text, /Botones duplicados/u);
	assert.doesNotMatch(context.text, /secret-value/u);
	assert.doesNotMatch(context.text, /<button/u);
});

test("loadLabProjectContext works without scan when scanner throws", () => {
	const projectPath = join(tempDir(), "missing-project-dir");

	const context = loadLabProjectContext(projectPath);

	assert.ok(context);
	assert.match(context.text, /Blueprint/u);
	assert.match(context.text, /Project flows/u);
	assert.doesNotMatch(context.text, /Scan project map/u);
});

test("formatLabProjectContext stays short and redacts secret-looking values", () => {
	const context = formatLabProjectContext(
		`Proyecto: Demo\napiKey: abc123\nObjetivo: ${"x".repeat(1200)}`,
		`Módulos: machines\nPantallas: /machines\nDatos: operations-db\nFlujos: ${"y".repeat(1200)}`,
		`Scan project map:\n${"z".repeat(1200)}`,
	);

	assert.ok(context.text.length <= 1800);
	assert.doesNotMatch(context.text, /abc123/u);
	assert.match(context.text, /apiKey: \[redacted\]/u);
});

test("labPrompt requests optional AgentLabReport JSON", () => {
	const prompt = labPrompt(
		{
			label: "quick",
			ms: 300_000,
			maxCommands: 1,
			description: "1 verificación corta",
		},
		{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
	);

	assert.match(prompt, /AgentLabReport/);
	assert.match(prompt, /evidence/);
	assert.match(prompt, /findings.*\[\]/is);
	assert.match(prompt, /high\/critical.*requiresHumanApproval.*true/is);
	assert.match(prompt, /"commandsExecuted": \[\s*"corepack pnpm test"\s*\]/s);
	assert.doesNotMatch(prompt, /"command": "corepack pnpm test"/);
	assert.match(prompt, /No hagas commit/);
	assert.match(prompt, /No hagas push/);
});
