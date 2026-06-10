import assert from "node:assert/strict";
import { test } from "node:test";
import { CLI_COMMANDS, formatCommandCatalog } from "../src/command-catalog.js";

test("CLI_COMMANDS exposes a 'Tareas y cola' entry targeting idu-queue-detail", () => {
	const labels = CLI_COMMANDS.map((entry) => entry.label);
	assert.ok(
		labels.includes("Tareas y cola"),
		"expected a CLI_COMMANDS entry labelled 'Tareas y cola'",
	);
	const tareasYCola = CLI_COMMANDS.find(
		(entry) => entry.label === "Tareas y cola",
	);
	assert.ok(
		tareasYCola,
		"expected to find a CLI_COMMANDS entry whose label is 'Tareas y cola'",
	);
	assert.match(
		tareasYCola!.command,
		/corepack pnpm cli -- idu-queue-detail\b/,
		"expected the 'Tareas y cola' entry to invoke `corepack pnpm cli -- idu-queue-detail`",
	);
});

test("formatCommandCatalog renders the 'Tareas y cola' CLI entry", () => {
	// Indirect coverage: /comandos output is what the user sees.
	// The label "Tareas y cola" should appear in the rendered
	// catalog so it is reachable from the catalog surface.
	const text = formatCommandCatalog();
	assert.match(text, /- Tareas y cola: corepack pnpm cli -- idu-queue-detail/u);
});
