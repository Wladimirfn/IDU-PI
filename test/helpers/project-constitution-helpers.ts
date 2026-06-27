import { execFileSync } from "node:child_process";
import {
	deriveConstitutionFromProjectCore,
	type ProjectConstitution,
	type RejectedRule,
	type RejectedStackEntry,
} from "../../src/project-constitution.js";
import {
	createDefaultProjectCore,
	type ProjectCore,
} from "../../src/project-core.js";

/**
 * Build a `ProjectConstitution` whose `rejectedStack` is exactly the given
 * rules/strings. Used by R3.4 integration tests to drive the gate against
 * the proposed migration output without touching the real brain.
 *
 * The base constitution is derived from a default confirmed Project Core
 * (status: "confirmed") so the gate's `project_core_not_confirmed` check
 * does not trip and pollute the predicate hits.
 */
export function buildConstitutionFromRejectedStack(
	rules: RejectedStackEntry[],
): ProjectConstitution {
	const core: ProjectCore = {
		...createDefaultProjectCore("idu-pi"),
		projectGoal: "Coordinate safe development from Telegram",
		problemStatement: "Tasks lose context and human confirmation",
		targetUsers: ["Founder", "maintainers"],
		preferredStack: ["TypeScript", "Node.js ESM", "pnpm"],
		rejectedStack: [],
		includedScope: ["src", "test", "scripts"],
		excludedScope: ["workspaces", ".idu/workspaces"],
		successCriteria: ["Build and tests pass"],
		securityLevel: "high",
		dataSensitivity: "medium",
		openQuestions: [],
		status: "confirmed",
	};
	const base = deriveConstitutionFromProjectCore(core);
	return {
		...base,
		technologyRules: {
			preferredStack: base.technologyRules.preferredStack,
			rejectedStack: rules,
		},
	};
}

/**
 * Run a git subcommand in `cwd`. Synchronous, captures stdout, throws on
 * non-zero exit. Wrapped here so R3.3 / R3.4 tests share the same helper.
 */
export function runGitIn(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/**
 * Type-narrow helper: returns only the object entries in a mixed
 * `RejectedStackEntry[]`. Item 6 (the trailing string) is filtered out.
 * Useful for tests that want to iterate rule-shaped entries only.
 */
export function objectRulesOnly(
	entries: RejectedStackEntry[],
): RejectedRule[] {
	return entries.filter(
		(e): e is RejectedRule => typeof e === "object" && e !== null,
	);
}