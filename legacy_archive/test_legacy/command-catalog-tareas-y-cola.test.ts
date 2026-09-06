import assert from "node:assert/strict";
import { test } from "node:test";
import { CLI_COMMANDS, formatCommandCatalog } from "../src/command-catalog.js";

test("CLI_COMMANDS exposes a 'Tareas' entry targeting idu-queue-detail", () => {
	const labels = CLI_COMMANDS.map((entry) => entry.label);
	assert.ok(
		labels.includes("Tareas"),
		"expected a CLI_COMMANDS entry labelled 'Tareas'",
	);
	const tareas = CLI_COMMANDS.find((entry) => entry.label === "Tareas");
	assert.ok(
		tareas,
		"expected to find a CLI_COMMANDS entry whose label is 'Tareas'",
	);
	assert.match(
		tareas!.command,
		/corepack pnpm cli -- idu-queue-detail\b/,
		"expected the 'Tareas' entry to invoke `corepack pnpm cli -- idu-queue-detail`",
	);
});

test("CLI_COMMANDS exposes a 'Cola de acciones' entry targeting idu-supervisor-tick", () => {
	const labels = CLI_COMMANDS.map((entry) => entry.label);
	assert.ok(
		labels.includes("Cola de acciones"),
		"expected a CLI_COMMANDS entry labelled 'Cola de acciones'",
	);
	const cola = CLI_COMMANDS.find((entry) => entry.label === "Cola de acciones");
	assert.ok(
		cola,
		"expected to find a CLI_COMMANDS entry whose label is 'Cola de acciones'",
	);
	assert.match(
		cola!.command,
		/corepack pnpm cli -- idu-supervisor-tick\b/,
		"expected the 'Cola de acciones' entry to invoke `corepack pnpm cli -- idu-supervisor-tick`",
	);
});

test("formatCommandCatalog renders the 'Tareas' and 'Cola de acciones' CLI entries", () => {
	// Indirect coverage: /comandos output is what the user sees.
	const text = formatCommandCatalog();
	assert.match(text, /- Tareas: corepack pnpm cli -- idu-queue-detail/u);
	assert.match(
		text,
		/- Cola de acciones: corepack pnpm cli -- idu-supervisor-tick/u,
	);
});
