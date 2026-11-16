#!/usr/bin/env node
import { runOptimizeCli } from "./optimizer/index.js";
import { runAgentsTui } from "./tui.js";

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

if (args[0] === "optimize") {
	runOptimizeCli(args.slice(1)).catch((err) => {
		console.error("Fatal idupi optimize error:", err);
		process.exit(1);
	});
} else if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
	console.log(
		[
			"idupi — Interactive TUI for IDU-PI configured agents",
			"",
			"Usage:",
			"  idupi            Launch interactive configured-agents TUI",
			"  idupi --plain    Print configured agents list cleanly without alternate screen",
			"  idupi --json     Print configured agents snapshot as JSON",
			"  idupi optimize   Run the 3-stage fleet optimizer (propose -> --run-bench -> --apply)",
			"  idupi --help     Show this help text",
		].join("\n"),
	);
	process.exit(0);
} else {
	runAgentsTui({
		plain: args.includes("--plain"),
		json: args.includes("--json"),
	}).catch((err) => {
		console.error("Fatal idupi TUI error:", err);
		process.exit(1);
	});
}
