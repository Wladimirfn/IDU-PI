/**
 * handlers.ts — birth cluster (D) case wrappers for the dispatch switch.
 *
 * PR 7j of 7 (Item 4, god-files breakup). Phase 2 continues: switch
 * decomposition. Extracts the 8 cases that belong to the birth
 * cluster:
 *
 *   - idu-birth-status | birth-status
 *   - idu-birth-existing-scan | birth-existing-scan
 *   - idu-birth-bibliotecario-discovery | birth-bibliotecario-discovery
 *   - idu-birth-validate | birth-validate
 *   - idu-birth-general-spec | birth-general-spec  (async)
 *   - idu-birth-general-spec-derive | birth-general-spec-derive  (async)
 *   - idu-birth-prototype-master | birth-prototype-master
 *   - idu-birth-repo-plan | birth-repo-plan
 *
 * Each wrapper takes `(runtime: CliRuntime, rest?: string[])` and
 * contains the body verbatim from the original case (modulo the
 * `activeRuntime` → `runtime` rename).
 *
 * Each wrapper preserves the original semantics — same calls, same
 * telemetry, same side-effects — so the dispatcher's behavior is
 * byte-equivalent.
 *
 * Note: the helper functions `handleBirthStatus`, `handleBirthExistingScan`,
 * `handleBirthBibliotecarioDiscovery`, `handleBirthValidate`, and
 * `handleBirthRepoPlan` are imported from `birth-runtime.js` (PR 2
 * already moved them there). They share names with our case wrappers
 * (which must match the case label per the locked template). We
 * alias the imports to avoid the local-declaration conflict.
 */

import { ok, fail } from "../dispatch-glue/index.js";
import type { CliResult } from "../dispatch-glue/index.js";
import type { CliRuntime } from "../../cli.js";
import { readBirthArtifact } from "../../birth-artifacts.js";
import { handleBirthPrototypeMaster as runBirthPrototypeMaster } from "../../birth-prototype-runtime.js";
import {
	handleBirthStatus as runBirthStatus,
	handleBirthExistingScan as runBirthExistingScan,
	handleBirthBibliotecarioDiscovery as runBirthBibliotecarioDiscovery,
	handleBirthValidate as runBirthValidate,
	handleBirthRepoPlan as runBirthRepoPlan,
	type BirthRepoPlan,
} from "../../birth-runtime.js";
import { approveBirthGeneralSpec } from "../../birth-general-spec-runtime.js";
import { runVisualDerivation } from "../../birth-general-spec-derive.js";
import {
	parseBirthGeneralSpecCliInput,
	parseUiFiles,
	formatBirthStatus,
	formatBirthExistingScan,
	formatBirthBibliotecario,
	formatBirthValidate,
	formatBirthGeneralSpec,
	formatBirthGeneralSpecDerivation,
	formatBirthRepoPlan,
	formatBirthPrototype,
} from "./helpers.js";

export function handleBirthStatus(runtime: CliRuntime): CliResult {
	return ok(
		formatBirthStatus(
			runBirthStatus({
				projectId: runtime.projectId,
				stateRoot: runtime.workspaceRoot,
			}),
		),
	);
}

export function handleBirthExistingScan(runtime: CliRuntime): CliResult {
	const result = runBirthExistingScan({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		projectPath: runtime.projectPath,
	});
	return ok(formatBirthExistingScan(result));
}

export function handleBirthBibliotecarioDiscovery(
	runtime: CliRuntime,
): CliResult {
	const scan = readBirthArtifact<{ observed?: { docs?: string[] } }>(
		runtime.workspaceRoot,
		"existing-scan",
	);
	const localRefs = (scan?.observed?.docs ?? [])
		.slice(0, 5)
		.map((p) => ({ path: p, quality: "secondary" as const }));
	const result = runBirthBibliotecarioDiscovery({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		localSourceRefs: localRefs,
		requestedExternalCategories: [],
		externalPermission: "not_requested",
		masterPlanSummary: "",
	});
	return ok(formatBirthBibliotecario(result));
}

export function handleBirthValidate(runtime: CliRuntime): CliResult {
	const result = runBirthValidate({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		projectPath: runtime.projectPath,
	});
	return ok(formatBirthValidate(result));
}

export async function handleBirthGeneralSpec(
	runtime: CliRuntime,
	rest: string[] = [],
): Promise<CliResult> {
	if (!runtime.workspaceRoot) {
		return fail("General Spec approval requires an active project stateRoot.");
	}
	const input = parseBirthGeneralSpecCliInput(rest);
	const result = await approveBirthGeneralSpec({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		sections: input.sections,
		approvedBy: input.approvedBy,
	});
	const status = runBirthStatus({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
	});
	return ok(formatBirthGeneralSpec(result, status));
}

export async function handleBirthGeneralSpecDerive(
	runtime: CliRuntime,
	rest: string[] = [],
): Promise<CliResult> {
	if (!runtime.workspaceRoot) {
		return fail(
			"General Spec derivation requires an active project stateRoot.",
		);
	}
	const promptForRole = runtime.promptForRole;
	const result = await runVisualDerivation({
		stateRoot: runtime.workspaceRoot,
		uiFiles: parseUiFiles(rest),
		promptForRole: promptForRole ?? (async () => ({ ok: false, output: "" })),
	});
	return ok(formatBirthGeneralSpecDerivation(result));
}

export function handleBirthPrototypeMaster(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const json = rest.join(" ").trim();
	let action: "draft" | "review" | "approve" = "review";
	let draft: Parameters<typeof runBirthPrototypeMaster>[0]["draft"];
	let approvedBy: string | undefined;
	if (json) {
		let parsedUnknown: unknown;
		try {
			parsedUnknown = JSON.parse(json);
		} catch (e) {
			return fail(`JSON inválido: ${(e as Error).message}`);
		}
		if (typeof parsedUnknown === "object" && parsedUnknown !== null) {
			const p = parsedUnknown as {
				action?: string;
				draft?: Parameters<typeof runBirthPrototypeMaster>[0]["draft"];
				approvedBy?: string;
			};
			if (
				p.action === "draft" ||
				p.action === "review" ||
				p.action === "approve"
			) {
				action = p.action;
			}
			draft = p.draft;
			approvedBy = p.approvedBy;
		}
	}
	const result = runBirthPrototypeMaster({
		action,
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		...(draft ? { draft } : {}),
		...(approvedBy ? { approvedBy } : {}),
	});
	return ok(formatBirthPrototype(result));
}

export function handleBirthRepoPlan(
	runtime: CliRuntime,
	rest: string[] = [],
): CliResult {
	const json = rest.join(" ").trim();
	if (!json) return fail("Uso: idu-pi idu-birth-repo-plan <json-plan>");
	let parsedUnknown: unknown;
	try {
		parsedUnknown = JSON.parse(json);
	} catch (e) {
		return fail(`JSON inválido: ${(e as Error).message}`);
	}
	// Accept both { repoPlan: {...} } envelope and raw { ... } body.
	const parsed: BirthRepoPlan =
		typeof parsedUnknown === "object" &&
		parsedUnknown !== null &&
		"repoPlan" in parsedUnknown
			? (parsedUnknown as { repoPlan: BirthRepoPlan }).repoPlan
			: (parsedUnknown as BirthRepoPlan);
	const result = runBirthRepoPlan({
		projectId: runtime.projectId,
		stateRoot: runtime.workspaceRoot,
		repoPlan: parsed,
	});
	return ok(formatBirthRepoPlan(result));
}
