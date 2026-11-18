import { checkCliAvailable } from "./cmdline.js";
import { loadIduConfig } from "./config.js";
import { parseReasoningEffortInput } from "./effort.js";
import {
	bindProjectFleet,
	buildDynamicProfileDescription,
	checkHarnessModelCompatibility,
	createFleet,
	deleteFleet,
	extractRoleRank,
	formatProfileFieldsForHarness,
	inferProfileRole,
	listFleets,
	migrateFleetFile,
	normalizeRoleLabel,
	parseModelSpec,
	renameFleet,
	resolveAgentProfile,
	resolveEffectiveFleet,
	ROLE_SLOT_DEFAULTS,
	unbindProjectFleet,
	upsertFleetAgent,
	useFleet,
	writeLocalFleetMarker,
} from "./fleets.js";
import { formatTerminalTestMarkdown } from "./optimizer/index.js";
import { testModelAcrossTerminals } from "./optimizer/runner.js";
import type { IduProfile } from "./types.js";

function flagValue(args: string[], flag: string): string | undefined {
	const idx = args.indexOf(flag);
	if (idx === -1 || !args[idx + 1] || args[idx + 1].startsWith("-")) return undefined;
	return args[idx + 1].trim() || undefined;
}

function csvFlagValues(args: string[], flag: string): string[] | undefined {
	const raw = flagValue(args, flag);
	if (!raw) return undefined;
	const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

export function printFleetHelp(): void {
	console.log(
		[
			"idu-pi fleet — Gestión de perfiles de flota, slots por rol y test por modelo",
			"",
			"Usage:",
			"  idu-pi fleet list [--json]",
			"  idu-pi fleet create <name> [--from <source>] [--empty] [--description <desc>] [--use] [--json]",
			"  idu-pi fleet use <name> [--json]",
			"  idu-pi fleet bind <name> [--cwd <dir>] [--local] [--json]",
			"  idu-pi fleet unbind [--cwd <dir>] [--json]",
			"  idu-pi fleet rename <oldName> <newName> [--json]",
			"  idu-pi fleet delete <name> [--json]",
			"  idu-pi fleet migrate [--fleet <name>] [--refresh-descriptions] [--json]",
			"  idu-pi fleet set-agent <slot> [--model <m>] [--effort <level|default>] [--harness <h>] [--test-terminals] [--fleet <f>] [--role <r>] [--permissions <p>] [--json]",
			"  idu-pi fleet test-model --model <m> [--effort <level>] [--role <r>] [--harnesses a,b] [--apply-to <slot>] [--fleet <f>] [--include-heavy] [--json]",
		].join("\n"),
	);
}

export async function runFleetCli(args: string[]): Promise<void> {
	const sub = args[0];
	const asJson = args.includes("--json");

	if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
		printFleetHelp();
		return;
	}

	switch (sub) {
		case "list": {
			const fleets = listFleets();
			if (asJson) {
				console.log(JSON.stringify(fleets, null, 2));
				return;
			}
			console.log("\n=== IDU Fleet Profiles ===");
			for (const f of fleets) {
				const mark = f.isActive ? "*" : " ";
				const desc = f.description ? ` — ${f.description}` : "";
				console.log(`  ${mark} ${f.name.padEnd(20)} (${f.agentCount} agentes)${desc}`);
			}
			console.log("==========================\n");
			return;
		}

		case "create": {
			const name = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			if (!name) {
				console.error("Uso: idu-pi fleet create <name> [--from <source>] [--empty] [--description <desc>] [--use]");
				process.exit(1);
			}
			const created = createFleet({
				name,
				fromFleet: flagValue(args, "--from"),
				empty: args.includes("--empty"),
				description: flagValue(args, "--description"),
				migrateAliases: !args.includes("--no-migrate"),
				activate: args.includes("--use"),
			});
			if (asJson) console.log(JSON.stringify(created, null, 2));
			else console.log(`Perfil "${created.name}" creado (${created.agentCount} agentes) en ${created.path}${created.isActive ? " [ACTIVO]" : ""}.`);
			return;
		}

		case "use": {
			const name = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			if (!name) {
				console.error("Uso: idu-pi fleet use <name>");
				process.exit(1);
			}
			const res = useFleet(name);
			if (asJson) console.log(JSON.stringify(res, null, 2));
			else console.log(`Perfil activo cambiado a "${res.activeFleet}" (${res.summary.agentCount} agentes).`);
			return;
		}

		case "bind": {
			const name = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			if (!name) {
				console.error("Uso: idu-pi fleet bind <name> [--cwd <dir>] [--local]");
				process.exit(1);
			}
			const cwd = flagValue(args, "--cwd") ?? process.cwd();
			if (args.includes("--local")) {
				const markerPath = writeLocalFleetMarker(name, cwd);
				const payload = { fleetName: name, projectPath: cwd, markerPath };
				if (asJson) console.log(JSON.stringify(payload, null, 2));
				else console.log(`Proyecto "${cwd}" fijado a "${name}" en ${markerPath}.`);
				return;
			}
			const res = bindProjectFleet(name, cwd);
			if (asJson) console.log(JSON.stringify(res, null, 2));
			else console.log(`Proyecto "${res.projectPath}" vinculado al perfil "${res.fleetName}".`);
			return;
		}

		case "unbind": {
			const cwd = flagValue(args, "--cwd") ?? process.cwd();
			const res = unbindProjectFleet(cwd);
			if (asJson) console.log(JSON.stringify(res, null, 2));
			else console.log(res.removed ? `Vínculo eliminado para "${res.projectPath}".` : `No había vínculo registrado para "${res.projectPath}".`);
			return;
		}

		case "rename": {
			const oldName = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			const newName = args[2] && !args[2].startsWith("-") ? args[2] : undefined;
			if (!oldName || !newName) {
				console.error("Uso: idu-pi fleet rename <oldName> <newName>");
				process.exit(1);
			}
			const res = renameFleet(oldName, newName);
			if (asJson) console.log(JSON.stringify(res, null, 2));
			else console.log(`Perfil "${oldName}" renombrado a "${res.name}".`);
			return;
		}

		case "delete": {
			const name = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			if (!name) {
				console.error("Uso: idu-pi fleet delete <name>");
				process.exit(1);
			}
			const res = deleteFleet(name);
			if (asJson) console.log(JSON.stringify(res, null, 2));
			else console.log(`Perfil "${res.deleted}" eliminado. Perfil activo: "${res.activeFleet}".`);
			return;
		}

		case "migrate": {
			const fleet = flagValue(args, "--fleet");
			const refreshDescriptions = args.includes("--refresh-descriptions");
			const res = migrateFleetFile({ fleet, refreshDescriptions });
			if (asJson) console.log(JSON.stringify(res, null, 2));
			else if (res.renamed.length === 0) {
				console.log(`Perfil "${res.fleetName}" ya usa nombres agnósticos al modelo.`);
			} else {
				console.log(`Migrados ${res.renamed.length} slots en "${res.fleetName}" (backup: ${res.backupPath}):`);
				for (const r of res.renamed) {
					console.log(`  ${r.from} -> ${r.to}`);
				}
			}
			return;
		}

		case "test-model": {
			const modelInput = flagValue(args, "--model");
			if (!modelInput) {
				console.error("Uso: idu-pi fleet test-model --model <provider/model> [--effort <level>] [--role <role>] [--harnesses a,b] [--apply-to <slot>] [--fleet <f>]");
				process.exit(1);
			}
			const role = normalizeRoleLabel(flagValue(args, "--role") ?? "Trabajo");
			const harnesses = csvFlagValues(args, "--harnesses");
			const fleet = flagValue(args, "--fleet");
			const applyTo = flagValue(args, "--apply-to");
			const includeHeavyBench = args.includes("--include-heavy");
			const effortFlag = flagValue(args, "--effort");
			const explicitEffort = effortFlag !== undefined ? parseReasoningEffortInput(effortFlag) : undefined;

			const report = await testModelAcrossTerminals({
				role,
				modelInput,
				...(explicitEffort ? { effort: explicitEffort } : {}),
				harnesses,
				includeHeavyBench,
				onProgress: asJson ? undefined : (line) => console.log(line),
			});

			let applied: unknown = null;
			if (applyTo && report.recommendedHarness) {
				const effective = resolveEffectiveFleet({ fleet });
				const resolvedExisting = resolveAgentProfile(effective.config.profiles, applyTo);
				const slotName = resolvedExisting?.resolvedName ?? applyTo;
				const existing = resolvedExisting?.profile;
				const parsed = parseModelSpec(modelInput);
				const finalEffort = explicitEffort ?? parsed.effortSuffix ?? existing?.effort;
				const formatted = formatProfileFieldsForHarness(report.recommendedHarness, parsed);
				const winnerCell = report.results.find((r) => r.harness === report.recommendedHarness);
				const roleLabel = existing ? inferProfileRole(slotName, existing) : role;
				const rank = extractRoleRank(existing?.description, slotName);
				const defaults = ROLE_SLOT_DEFAULTS[roleLabel];
				const nextProfile: IduProfile = {
					...(existing ?? {
						harness: formatted.harness,
						permissions: defaults?.permissions ?? "workspace",
						timeoutMs: defaults?.timeoutMs ?? 3600000,
						idleTimeoutMs: defaults?.idleTimeoutMs ?? 600000,
						hardCapMs: defaults?.hardCapMs ?? 14400000,
					}),
					harness: formatted.harness,
					model: formatted.model,
					streams: formatted.streams,
					description: buildDynamicProfileDescription({
						slotName,
						role: roleLabel,
						rank,
						existingDescription: existing?.description,
						harness: formatted.harness,
						provider: formatted.provider,
						model: formatted.model,
						...(finalEffort ? { effort: finalEffort } : {}),
						benchmark: winnerCell
							? {
									taskId: report.taskId,
									resolved: winnerCell.resolved,
									regressionsClean: winnerCell.regressionsClean,
									durationMs: winnerCell.durationMs,
									totalTokens: winnerCell.totalTokens,
									score: winnerCell.compositeBenchScore,
									testedCount: report.results.filter((r) => r.compatible && r.available).length,
									recommended: true,
								}
							: undefined,
					}),
				};
				if (formatted.provider) nextProfile.provider = formatted.provider;
				else delete nextProfile.provider;
				if (finalEffort) nextProfile.effort = finalEffort;
				else delete nextProfile.effort;
				applied = upsertFleetAgent({ fleet: effective.fleetName, slotName, profile: nextProfile });
			}

			if (asJson) {
				console.log(JSON.stringify({ report, applied }, null, 2));
			} else {
				console.log(formatTerminalTestMarkdown(report));
				if (applied) {
					console.log(`\nAplicado automáticamente a "${applyTo}" en perfil "${fleet ?? "activo"}".`);
				}
			}
			return;
		}

		case "set-agent": {
			const rawSlot = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
			const fleet = flagValue(args, "--fleet");
			const effective = resolveEffectiveFleet({ fleet });
			const resolvedExisting = rawSlot ? resolveAgentProfile(effective.config.profiles, rawSlot) : undefined;
			const slotName = resolvedExisting?.resolvedName ?? rawSlot;
			const existing = resolvedExisting?.profile;

			const existingModelInput = existing
				? existing.provider && !existing.model?.startsWith(`${existing.provider}/`)
					? `${existing.provider}/${existing.model ?? "default"}`
					: existing.model
				: undefined;
			const modelInput = flagValue(args, "--model") ?? existingModelInput;
			if (!slotName || !modelInput) {
				console.error("Uso: idu-pi fleet set-agent <slot> [--model <m>] [--effort <level|default>] [--harness <h>] [--test-terminals] [--fleet <f>] [--role <r>] [--permissions <read-only|workspace>]");
				process.exit(1);
			}

			const hasEffortFlag = args.includes("--effort");
			const effortRaw = flagValue(args, "--effort");
			const explicitEffort = hasEffortFlag ? parseReasoningEffortInput(effortRaw ?? "") : undefined;

			const roleFlag = flagValue(args, "--role");
			const role = roleFlag ? normalizeRoleLabel(roleFlag) : existing ? inferProfileRole(slotName, existing) : inferProfileRole(slotName, {});
			const defaults = ROLE_SLOT_DEFAULTS[role];
			const permissionsFlag = flagValue(args, "--permissions");
			const permissions: "read-only" | "workspace" =
				permissionsFlag === "read-only" || permissionsFlag === "workspace"
					? permissionsFlag
					: existing?.permissions === "read-only"
						? "read-only"
						: existing?.permissions === "workspace"
							? "workspace"
							: defaults?.permissions ?? "workspace";

			const parsed = parseModelSpec(modelInput);
			const finalEffort = hasEffortFlag ? explicitEffort : (parsed.effortSuffix ?? existing?.effort);
			let targetHarness = flagValue(args, "--harness");
			let benchmarkSummary: Parameters<typeof buildDynamicProfileDescription>[0]["benchmark"] | undefined;

			if (!targetHarness && args.includes("--test-terminals")) {
				const report = await testModelAcrossTerminals({
					role,
					modelInput,
					...(finalEffort ? { effort: finalEffort } : {}),
					permissions,
					onProgress: asJson ? undefined : (line) => console.log(line),
				});
				if (!report.recommendedHarness) {
					console.error(report.recommendationReason);
					process.exit(1);
				}
				targetHarness = report.recommendedHarness;
				const winCell = report.results.find((r) => r.harness === targetHarness);
				if (winCell) {
					benchmarkSummary = {
						taskId: report.taskId,
						resolved: winCell.resolved,
						regressionsClean: winCell.regressionsClean,
						durationMs: winCell.durationMs,
						totalTokens: winCell.totalTokens,
						score: winCell.compositeBenchScore,
						testedCount: report.results.filter((r) => r.compatible && r.available).length,
						recommended: true,
					};
				}
			}

			if (!targetHarness) {
				targetHarness = existing?.harness;
			}
			if (!targetHarness) {
				console.error("Falta --harness <terminal> (o pasá --test-terminals para testear y elegir la mejor).");
				process.exit(1);
			}

			const cfg = loadIduConfig();
			const cliDef = cfg.clis[targetHarness];
			const avail = cliDef ? checkCliAvailable(cliDef.command) : true;
			const compat = checkHarnessModelCompatibility(targetHarness, parsed, avail);
			if (!compat.compatible) {
				console.error(`Terminal "${targetHarness}" incompatible con "${parsed.display}": ${compat.reason}`);
				process.exit(1);
			}

			const formatted = formatProfileFieldsForHarness(targetHarness, parsed);
			const rank = extractRoleRank(existing?.description, slotName);
			const description = buildDynamicProfileDescription({
				slotName,
				role,
				rank,
				existingDescription: existing?.description,
				harness: formatted.harness,
				provider: formatted.provider,
				model: formatted.model,
				...(finalEffort ? { effort: finalEffort } : {}),
				benchmark: benchmarkSummary,
				manualNote: benchmarkSummary ? undefined : finalEffort ? `effort ${finalEffort}` : "configuración manual",
			});

			const nextProfile: IduProfile = {
				...(existing ?? {
					harness: formatted.harness,
					permissions,
					timeoutMs: defaults?.timeoutMs ?? 3600000,
					idleTimeoutMs: defaults?.idleTimeoutMs ?? 600000,
					hardCapMs: defaults?.hardCapMs ?? 14400000,
				}),
				harness: formatted.harness,
				model: formatted.model,
				permissions,
				streams: formatted.streams,
				description,
			};
			if (formatted.provider) nextProfile.provider = formatted.provider;
			else delete nextProfile.provider;
			if (finalEffort) nextProfile.effort = finalEffort;
			else delete nextProfile.effort;

			const saved = upsertFleetAgent({
				fleet: effective.fleetName,
				slotName,
				profile: nextProfile,
			});

			if (asJson) {
				console.log(JSON.stringify(saved, null, 2));
			} else {
				console.log(`Actualizado "${saved.slotName}" en perfil "${saved.fleetName}" -> ${formatted.harness} · ${parsed.display}${finalEffort ? ` · effort=${finalEffort}` : ""}`);
				console.log(`Descripción: ${description}`);
			}
			return;
		}

		default: {
			console.error(`Subcomando de fleet desconocido: "${sub}".`);
			printFleetHelp();
			process.exit(1);
		}
	}
}
