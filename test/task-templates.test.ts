import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildTaskPrompt,
	formatTaskTemplateHelp,
	inferTaskTemplateKind,
	parseTaskTemplateCommand,
} from "../src/task-templates.js";

test("parseTaskTemplateCommand extracts kind and details", () => {
	assert.deepEqual(parseTaskTemplateCommand("/task bug falla login"), {
		kind: "bug",
		details: "falla login",
	});
	assert.deepEqual(parseTaskTemplateCommand("/task feature"), {
		kind: "feature",
		details: "",
	});
	assert.equal(parseTaskTemplateCommand("/task nope"), undefined);
});

test("inferTaskTemplateKind treats database failures as bugs", () => {
	assert.equal(
		inferTaskTemplateKind("fallas en las bases de datos debemos arreglarla"),
		"bug",
	);
	assert.equal(inferTaskTemplateKind("arreglar db"), "bug");
	assert.equal(
		inferTaskTemplateKind("seguimos con fallas en base de datos"),
		"bug",
	);
});

test("buildTaskPrompt creates focused templates", () => {
	assert.match(buildTaskPrompt("bug", "falla login") ?? "", /bug/i);
	assert.match(buildTaskPrompt("feature", "nuevo dashboard") ?? "", /feature/i);
	assert.match(buildTaskPrompt("refactor", "limpiar index") ?? "", /refactor/i);
	assert.match(buildTaskPrompt("docs", "README") ?? "", /documentation|docs/i);
	assert.equal(buildTaskPrompt("bad", "x"), undefined);
});

test("formatTaskTemplateHelp lists supported kinds", () => {
	const help = formatTaskTemplateHelp();
	assert.match(help, /\/task bug/);
	assert.match(help, /\/task feature/);
	assert.match(help, /\/task refactor/);
	assert.match(help, /\/task docs/);
});
