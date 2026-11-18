#!/usr/bin/env node
import { runFleetCli } from "./fleet-cli.js";
import { runOptimizeCli } from "./optimizer/index.js";
import { runAgentsTui } from "./tui.js";

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

function parseFlag(flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx === -1 || !args[idx + 1] || args[idx + 1].startsWith("-")) return undefined;
	return args[idx + 1].trim() || undefined;
}

if (args[0] === "optimize") {
	runOptimizeCli(args.slice(1)).catch((err) => {
		console.error("Fatal idupi optimize error:", err);
		process.exit(1);
	});
} else if (args[0] === "fleet") {
	runFleetCli(args.slice(1)).catch((err) => {
		console.error("Fatal idupi fleet error:", err);
		process.exit(1);
	});
} else if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
	console.log(
		[
			"idupi — Interactive TUI for IDU-PI configured agents & named fleets",
			"",
			"Usage:",
			"  idupi [--fleet <name>]   Launch interactive configured-agents TUI",
			"  idupi --plain            Print configured agents list cleanly without alternate screen",
			"  idupi --json             Print configured agents snapshot as JSON",
			"  idupi fleet <cmd>        Manage named fleets, migrate slots, set-agent & test-model",
			"  idupi optimize           Run the 3-stage fleet optimizer (propose -> --run-bench -> --apply)",
			"  idupi --help             Show this help text",
		].join("\n"),
	);
	process.exit(0);
} else {
	runAgentsTui({
		plain: args.includes("--plain"),
		json: args.includes("--json"),
		fleet: parseFlag("--fleet"),
		workingDir: parseFlag("--cwd") ?? parseFlag("--working-dir"),
	}).catch((err) => {
		console.error("Fatal idupi TUI error:", err);
		process.exit(1);
	});
}
