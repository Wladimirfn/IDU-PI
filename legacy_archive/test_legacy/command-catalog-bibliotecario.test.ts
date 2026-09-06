import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { CLI_COMMANDS } from "../src/command-catalog.js";

describe("T3.1 — command catalog registration", () => {
	it("CLI_COMMANDS includes idu-bibliotecario-init", () => {
		const bibliotecarioCommands = CLI_COMMANDS.filter((entry) =>
			entry.command.includes("idu-bibliotecario-init"),
		);

		assert.ok(
			bibliotecarioCommands.length > 0,
			"CLI_COMMANDS should include at least one entry with idu-bibliotecario-init",
		);

		// Verify the command is properly formatted
		const hasCorepackCommand = bibliotecarioCommands.some((entry) =>
			entry.command.includes("corepack pnpm cli -- idu-bibliotecario-init"),
		);
		assert.ok(
			hasCorepackCommand,
			"Should have a corepack pnpm cli -- idu-bibliotecario-init command",
		);

		// Verify labels exist
		const hasLabel = bibliotecarioCommands.some(
			(entry) => entry.label && entry.label.length > 0,
		);
		assert.ok(hasLabel, "Should have at least one label for the command");
	});
});
