/**
 * helpers.ts — role cluster (M).
 * PR 4 of 7 (Item 4). Move + re-export PURO.
 */

import type { buildCliHomeStatus } from "../../cli-home.js";
import {
	readPiModelCatalogSnapshot,
	resolvePiModelCatalogSnapshotPath,
	buildUnifiedModelCatalog,
	modelProviderDisplayKey,
	modelProviderDisplayLabel,
} from "../../model-catalog.js";
import {
	readGentleModelRouting,
	assignmentOptionsFromModelCatalog,
} from "../../model-assignments.js";
import { profileModelLabel } from "../../agent-router.js";
import type { ModelAssignmentMenuOption, ModelAssignmentMenuGroups } from "./types.js";
import {
	IDU_MODEL_ROLES,
	formatModelAssignments,
	loadModelAssignments,
} from "../../model-assignments.js";
import { parseAgentProfiles } from "../../config.js";

export function modelAssignmentOptions(
	status: ReturnType<typeof buildCliHomeStatus>,
): ModelAssignmentMenuOption[] {
	const snapshot = readPiModelCatalogSnapshot(
		resolvePiModelCatalogSnapshotPath(),
	);
	const catalog = buildUnifiedModelCatalog({
		snapshotModels: snapshot?.models,
		gentleModelIds: readGentleModelRouting(status.cwd),
		profileModelIds: status.agentProfiles.map(profileModelLabel),
	});
	return assignmentOptionsFromModelCatalog(
		status.agentProfiles,
		catalog.entries,
	).map((option) => {
		const provider = option.value.split("/")[0];
		return {
			value: option.value,
			label: formatModelAssignmentOptionLabel(option),
			source: option.source,
			...(option.source === "model" && provider
				? {
						providerKey: modelProviderDisplayKey(provider),
						providerLabel: modelProviderDisplayLabel(provider),
					}
				: {}),
		};
	});
}

export function modelAssignmentOptionGroups(
	status: ReturnType<typeof buildCliHomeStatus>,
): ModelAssignmentMenuGroups {
	const options = modelAssignmentOptions(status);
	const providerGroups = new Map<
		string,
		{
			key: string;
			label: string;
			providers: string[];
			models: ModelAssignmentMenuOption[];
		}
	>();
	let custom: ModelAssignmentMenuOption | undefined;
	const profiles: ModelAssignmentMenuOption[] = [];
	for (const option of options) {
		if (option.source === "profile") {
			profiles.push(option);
			continue;
		}
		if (option.source === "custom") {
			custom = option;
			continue;
		}
		const provider = option.value.split("/")[0];
		if (!provider) continue;
		const key = option.providerKey ?? modelProviderDisplayKey(provider);
		const label = option.providerLabel ?? modelProviderDisplayLabel(provider);
		const current = providerGroups.get(key) ?? {
			key,
			label,
			providers: [],
			models: [],
		};
		if (!current.providers.includes(provider)) current.providers.push(provider);
		current.models.push(option);
		providerGroups.set(key, current);
	}
	return {
		profiles,
		providerGroups: [...providerGroups.values()]
			.map((group) => ({
				...group,
				providers: [...group.providers].sort((left, right) =>
					left.localeCompare(right),
				),
				models: [...group.models].sort(
					(left, right) =>
						left.label.localeCompare(right.label) ||
						left.value.localeCompare(right.value),
				),
			}))
			.sort(
				(left, right) =>
					left.label.localeCompare(right.label) ||
					left.key.localeCompare(right.key),
			),
		custom,
	};
}

export function formatModelAssignmentOptionLabel(option: {
	value: string;
	label: string;
	source: "profile" | "model" | "custom";
}): string {
	if (option.source === "profile") return `[perfil] ${option.label}`;
	if (option.source === "custom") return `${option.label}`;
	const provider = option.value.split("/")[0] ?? "modelo";
	return `${option.label} — ${modelProviderDisplayLabel(provider)}`;
}

export function resolveRoleSelection(input: string): string | undefined {
	const index = Number(input);
	if (
		Number.isInteger(index) &&
		index >= 1 &&
		index <= IDU_MODEL_ROLES.length
	) {
		return IDU_MODEL_ROLES[index - 1]?.id;
	}
	return IDU_MODEL_ROLES.find((role) => role.id === input)?.id;
}

export function resolveAssignmentSelection(
	input: string,
	options: Array<{ value: string }>,
): string | undefined {
	const index = Number(input);
	if (Number.isInteger(index) && index >= 1 && index <= options.length) {
		return options[index - 1]?.value;
	}
	return options.find((option) => option.value === input)?.value;
}

export function validateAgentProfiles(
	status: ReturnType<typeof buildCliHomeStatus>,
): string {
	try {
		parseAgentProfiles(
			status.agentProfiles
				.map(
					(profile) =>
						`${profile.id}|${profile.label}|${profile.piArgs.join(" ")}`,
				)
				.join(";"),
		);
		return [
			"Configuración de perfiles válida.",
			`perfiles: ${status.agentProfiles.length}`,
			...(status.project.stateRoot
				? [
						formatModelAssignments(
							loadModelAssignments(status.project.stateRoot),
							status.agentProfiles,
						),
					]
				: ["model assignments: sin stateRoot"]),
		].join("\n");
	} catch (error) {
		return `Configuración inválida: ${error instanceof Error ? error.message : String(error)}`;
	}
}

