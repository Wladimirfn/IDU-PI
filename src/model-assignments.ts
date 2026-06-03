import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentRouter, profileModelLabel } from "./agent-router.js";
import type { AgentProfile } from "./config.js";
import {
	normalizeModelCatalogId,
	type UnifiedModelCatalogEntry,
} from "./model-catalog.js";

export type IduModelRoleId =
	| "supervisor-main"
	| "supervisor-semantic"
	| "supervisor-compaction"
	| "agentlab-general"
	| "agentlab-project-understanding"
	| "agentlab-security"
	| "agentlab-architecture"
	| "agentlab-database"
	| "agentlab-ui-ux"
	| "agentlab-performance"
	| "agentlab-code-quality"
	| "agentlab-docs"
	| "agentlab-librarian";

export type IduModelRole = {
	id: IduModelRoleId;
	label: string;
	group: "supervisor" | "agentlab";
};

export type AgentLabModelCapability =
	| "general"
	| "project_understanding"
	| "architecture"
	| "database"
	| "security"
	| "ui_ux"
	| "performance"
	| "code_quality"
	| "docs"
	| "librarian";

export type AgentLabModelAssignmentRecommendation = {
	roleId: IduModelRoleId;
	label: string;
	capability: AgentLabModelCapability;
	capabilityLabel: string;
	recommendedProfileId: string;
	recommendedProfile: AgentProfile;
	currentProfileId?: string;
	reason: string;
};

export type ProfileModelInventory = {
	uniqueModelIds: string[];
	duplicateModelGroups: Array<{ modelId: string; profileIds: string[] }>;
	profileModels: Array<{ profileId: string; label: string; modelId: string }>;
};

export type AgentLabModelAssignmentProposal = {
	status: "ready" | "blocked";
	recommendations: AgentLabModelAssignmentRecommendation[];
	limitations: string[];
	inventory: ProfileModelInventory;
	knownModelIds: string[];
};

export const IDU_MODEL_ROLES: IduModelRole[] = [
	{ id: "supervisor-main", label: "Supervisor principal", group: "supervisor" },
	{
		id: "supervisor-semantic",
		label: "Supervisor semántico",
		group: "supervisor",
	},
	{
		id: "supervisor-compaction",
		label: "Supervisor compactación",
		group: "supervisor",
	},
	{ id: "agentlab-general", label: "AgentLab general", group: "agentlab" },
	{
		id: "agentlab-project-understanding",
		label: "AgentLab entendimiento",
		group: "agentlab",
	},
	{ id: "agentlab-security", label: "AgentLab seguridad", group: "agentlab" },
	{
		id: "agentlab-architecture",
		label: "AgentLab arquitectura",
		group: "agentlab",
	},
	{
		id: "agentlab-database",
		label: "AgentLab base de datos",
		group: "agentlab",
	},
	{ id: "agentlab-ui-ux", label: "AgentLab UI/UX", group: "agentlab" },
	{
		id: "agentlab-performance",
		label: "AgentLab performance",
		group: "agentlab",
	},
	{
		id: "agentlab-code-quality",
		label: "AgentLab calidad código",
		group: "agentlab",
	},
	{ id: "agentlab-docs", label: "AgentLab documentación", group: "agentlab" },
	{
		id: "agentlab-librarian",
		label: "AgentLab bibliotecario",
		group: "agentlab",
	},
];

export type ModelAssignments = {
	version: 1;
	assignments: Partial<Record<IduModelRoleId, string>>;
	updatedAt?: string;
	backupPath?: string;
};

export type ModelAssignmentResolution =
	| { source: "assigned"; profile: AgentProfile; profileId: string }
	| { source: "direct-model"; profile: AgentProfile; modelId: string }
	| { source: "missing"; profileId: string }
	| { source: "inherit" };

export function modelAssignmentsPath(stateRoot: string): string {
	return join(stateRoot, "model-assignments.json");
}

export function loadModelAssignments(stateRoot: string): ModelAssignments {
	const path = modelAssignmentsPath(stateRoot);
	if (!existsSync(path)) return { version: 1, assignments: {} };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(parsed) ||
			parsed.version !== 1 ||
			!isRecord(parsed.assignments)
		) {
			return { version: 1, assignments: {} };
		}
		const assignments: Partial<Record<IduModelRoleId, string>> = {};
		for (const role of IDU_MODEL_ROLES) {
			const value = parsed.assignments[role.id];
			if (typeof value === "string" && value.trim())
				assignments[role.id] = value.trim();
		}
		return {
			version: 1,
			assignments,
			...(typeof parsed.updatedAt === "string"
				? { updatedAt: parsed.updatedAt }
				: {}),
		};
	} catch {
		return { version: 1, assignments: {} };
	}
}

export function profileForModelRole(
	assignments: ModelAssignments,
	roleId: IduModelRoleId,
	profiles: AgentProfile[],
): ModelAssignmentResolution | undefined {
	const profileId = assignments.assignments[roleId];
	if (!profileId) return undefined;
	const profile = profiles.find((candidate) => candidate.id === profileId);
	if (profile) return { source: "assigned", profile, profileId };
	if (isValidDirectModelId(profileId)) {
		return {
			source: "direct-model",
			modelId: profileId,
			profile: virtualAgentProfile(roleId, profileId),
		};
	}
	return { source: "missing", profileId };
}

export function applySupervisorModelAssignment(
	router: AgentRouter,
	assignments: ModelAssignments,
	profiles: AgentProfile[],
): ModelAssignmentResolution {
	const resolution = profileForModelRole(
		assignments,
		"supervisor-main",
		profiles,
	);
	if (!resolution) return { source: "inherit" };
	if (resolution.source !== "assigned") return resolution;
	const selected = router.setActiveProfile(resolution.profile.id);
	return selected
		? resolution
		: { source: "missing", profileId: resolution.profile.id };
}

export function saveModelAssignment(
	stateRoot: string,
	roleId: string,
	profileId: string,
	profiles: AgentProfile[],
): ModelAssignments {
	const role = IDU_MODEL_ROLES.find((candidate) => candidate.id === roleId);
	if (!role) throw new Error(`Rol desconocido: ${roleId}`);
	validateAssignmentTarget(profileId, profiles);
	const current = loadModelAssignments(stateRoot);
	return saveModelAssignments(
		stateRoot,
		{ ...current.assignments, [role.id]: profileId },
		profiles,
	);
}

export function saveModelAssignments(
	stateRoot: string,
	assignments: Partial<Record<IduModelRoleId, string>>,
	profiles: AgentProfile[],
): ModelAssignments {
	const validated: Partial<Record<IduModelRoleId, string>> = {};
	for (const [roleId, profileId] of Object.entries(assignments) as Array<
		[IduModelRoleId, string]
	>) {
		const role = IDU_MODEL_ROLES.find((candidate) => candidate.id === roleId);
		if (!role) throw new Error(`Rol desconocido: ${roleId}`);
		validateAssignmentTarget(profileId, profiles);
		validated[role.id] = profileId;
	}
	mkdirSync(stateRoot, { recursive: true });
	const path = modelAssignmentsPath(stateRoot);
	const backupPath = existsSync(path)
		? `${path}.backup-${timestamp()}`
		: undefined;
	if (backupPath) copyFileSync(path, backupPath);
	const next: ModelAssignments = {
		version: 1,
		assignments: validated,
		updatedAt: new Date().toISOString(),
		...(backupPath ? { backupPath } : {}),
	};
	writeFileSync(
		path,
		`${JSON.stringify({ version: next.version, assignments: next.assignments, updatedAt: next.updatedAt }, null, 2)}\n`,
		"utf8",
	);
	return next;
}

export function recommendAgentLabModelAssignments(
	profiles: AgentProfile[],
	current: ModelAssignments = { version: 1, assignments: {} },
	options: { cwd?: string; knownModelIds?: string[] } = {},
): AgentLabModelAssignmentProposal {
	const labProfiles = profiles.slice(1);
	const inventory = profileModelInventory(labProfiles);
	const knownModelIds = uniqueStrings([
		...(options.knownModelIds ?? []),
		...readGentleModelRouting(options.cwd),
	]);
	const limitations: string[] = [];
	if (!labProfiles.length) {
		limitations.push(
			"No hay perfiles AgentLab configurados; agregá perfiles antes de generar propuesta.",
		);
	}
	if (inventory.uniqueModelIds.length < 2) {
		limitations.push(
			`Diversidad insuficiente: detecté ${inventory.uniqueModelIds.length} modelo(s) real(es) en perfiles AgentLab. No voy a recomendar el mismo modelo para todos los labs.`,
		);
		if (inventory.uniqueModelIds.length === 1) {
			limitations.push(
				`Modelo único detectado: ${inventory.uniqueModelIds[0]}. Creá perfiles con modelos distintos o usá selección manual.`,
			);
		}
	}
	const fallback =
		findRecommendedProfile(labProfiles, [/general/iu]) ?? labProfiles[0];
	if (!fallback || limitations.length) {
		return {
			status: "blocked",
			recommendations: [],
			limitations,
			inventory,
			knownModelIds,
		};
	}
	const recommendations = IDU_MODEL_ROLES.filter(
		(role) => role.group === "agentlab",
	).map((role) => {
		const patterns = recommendationPatternsForRole(role.id);
		const recommendedProfile =
			findRecommendedProfile(labProfiles, patterns) ?? fallback;
		return {
			roleId: role.id,
			label: role.label,
			capability: capabilityForRole(role.id),
			capabilityLabel: capabilityLabelForRole(role.id),
			recommendedProfileId: recommendedProfile.id,
			recommendedProfile,
			...(current.assignments[role.id]
				? { currentProfileId: current.assignments[role.id] }
				: {}),
			reason: recommendationReasonForRole(role.id, recommendedProfile),
		};
	});
	return {
		status: "ready",
		recommendations,
		limitations,
		inventory,
		knownModelIds,
	};
}

export function formatAgentLabModelAssignmentProposal(
	proposal: AgentLabModelAssignmentProposal,
	profiles: AgentProfile[],
): string {
	const duplicateLines = proposal.inventory.duplicateModelGroups.map(
		(group) =>
			`- ${group.modelId}: perfiles duplicados ${group.profileIds.join(", ")}`,
	);
	const knownLines = proposal.knownModelIds.map((modelId) => `- ${modelId}`);
	return [
		"Propuesta automática por AgentLab",
		"",
		"Idu-pi no rota modelos automáticamente. Guardar esta propuesta requiere aprobación explícita del usuario.",
		"",
		`estado: ${proposal.status}`,
		...(proposal.limitations.length
			? [
					"",
					"Limitaciones:",
					...proposal.limitations.map((item) => `- ${item}`),
				]
			: []),
		...(duplicateLines.length
			? ["", "Duplicados detectados:", ...duplicateLines]
			: []),
		...(knownLines.length
			? ["", "Modelos conocidos por Gentle AI (sólo lectura):", ...knownLines]
			: []),
		...(proposal.recommendations.length
			? [
					"",
					"Recomendaciones:",
					...proposal.recommendations.map((recommendation) => {
						const current = recommendation.currentProfileId
							? (profiles.find(
									(profile) => profile.id === recommendation.currentProfileId,
								)?.label ??
								`missing profile ${recommendation.currentProfileId}`)
							: "sin asignación explícita";
						return [
							`${recommendation.label}`,
							`  capacidad: ${recommendation.capabilityLabel}`,
							`  actual: ${current}`,
							`  recomendado: ${recommendation.recommendedProfile.label} / ${profileModelLabel(recommendation.recommendedProfile)}`,
							`  motivo: ${recommendation.reason}`,
						].join("\n");
					}),
				]
			: []),
	].join("\n");
}

export function formatModelAssignments(
	assignments: ModelAssignments,
	profiles: AgentProfile[],
): string {
	return [
		"Asignaciones por rol",
		"",
		...IDU_MODEL_ROLES.map((role, index) => {
			const resolution = profileForModelRole(assignments, role.id, profiles);
			const value = formatAssignmentResolution(resolution);
			return `  ${index === 0 ? "▸" : " "} ${role.label.padEnd(28, " ")} ${value}`;
		}),
	].join("\n");
}

export function assignmentOptionsFromModelCatalog(
	profiles: AgentProfile[],
	catalogEntries: UnifiedModelCatalogEntry[],
): Array<{
	value: string;
	label: string;
	source: "profile" | "model" | "custom";
}> {
	const options = new Map<
		string,
		{ value: string; label: string; source: "profile" | "model" | "custom" }
	>();
	const profileModelIds = new Set<string>();
	for (const profile of profiles) {
		const modelId = normalizeModelCatalogId(profileModelLabel(profile));
		if (modelId) profileModelIds.add(modelId);
		options.set(profile.id, {
			value: profile.id,
			label: `${profile.label} (${profile.id}) — ${profileModelLabel(profile)}`,
			source: "profile",
		});
	}
	for (const entry of catalogEntries) {
		if (
			options.has(entry.canonicalId) ||
			profileModelIds.has(entry.canonicalId)
		) {
			continue;
		}
		options.set(entry.canonicalId, {
			value: entry.canonicalId,
			label: `${entry.label} (${entry.canonicalId})`,
			source: "model",
		});
	}
	options.set("__custom_model__", {
		value: "__custom_model__",
		label: "Custom model id (provider/model)",
		source: "custom",
	});
	return [...options.values()];
}

export function profileModelInventory(
	profiles: AgentProfile[],
): ProfileModelInventory {
	const profileModels = profiles.map((profile) => ({
		profileId: profile.id,
		label: profile.label,
		modelId: normalizeModelId(profileModelLabel(profile)),
	}));
	const groups = new Map<string, string[]>();
	for (const profile of profileModels) {
		if (!isRealModelId(profile.modelId)) continue;
		groups.set(profile.modelId, [
			...(groups.get(profile.modelId) ?? []),
			profile.profileId,
		]);
	}
	return {
		profileModels,
		uniqueModelIds: Array.from(groups.keys()).sort((left, right) =>
			left.localeCompare(right),
		),
		duplicateModelGroups: Array.from(groups.entries())
			.filter(([, profileIds]) => profileIds.length > 1)
			.map(([modelId, profileIds]) => ({ modelId, profileIds })),
	};
}

export function readGentleModelRouting(cwd?: string): string[] {
	const paths = [
		join(homedir(), ".pi", "gentle-ai", "models.json"),
		...(cwd ? [join(cwd, ".pi", "gentle-ai", "models.json")] : []),
	];
	const modelIds: string[] = [];
	for (const path of paths) {
		if (!existsSync(path)) continue;
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!isRecord(parsed)) continue;
			for (const value of Object.values(parsed)) {
				if (typeof value === "string") {
					const model = normalizeModelId(value);
					if (isRealModelId(model)) modelIds.push(model);
				} else if (isRecord(value) && typeof value.model === "string") {
					const model = normalizeModelId(value.model);
					if (isRealModelId(model)) modelIds.push(model);
				}
			}
		} catch {}
	}
	return uniqueStrings(modelIds);
}

function capabilityForRole(roleId: IduModelRoleId): AgentLabModelCapability {
	switch (roleId) {
		case "agentlab-project-understanding":
			return "project_understanding";
		case "agentlab-architecture":
			return "architecture";
		case "agentlab-database":
			return "database";
		case "agentlab-security":
			return "security";
		case "agentlab-ui-ux":
			return "ui_ux";
		case "agentlab-performance":
			return "performance";
		case "agentlab-code-quality":
			return "code_quality";
		case "agentlab-docs":
			return "docs";
		case "agentlab-librarian":
			return "librarian";
		case "agentlab-general":
		case "supervisor-main":
		case "supervisor-semantic":
		case "supervisor-compaction":
			return "general";
	}
}

function capabilityLabelForRole(roleId: IduModelRoleId): string {
	switch (capabilityForRole(roleId)) {
		case "project_understanding":
			return "entendimiento de proyecto y contexto amplio";
		case "architecture":
			return "razonamiento sistémico/arquitectura";
		case "database":
			return "SQL, persistencia, schema y datos";
		case "security":
			return "auditoría adversarial y seguridad";
		case "ui_ux":
			return "producto, frontend y experiencia de usuario";
		case "performance":
			return "performance, costo y eficiencia";
		case "code_quality":
			return "lectura de código, testing y calidad";
		case "docs":
			return "documentación técnica y trazabilidad";
		case "librarian":
			return "lectura larga, síntesis y catalogación";
		case "general":
			return "auditoría general";
	}
}

function normalizeModelId(value: string): string {
	return value.trim();
}

function isValidDirectModelId(modelId: string): boolean {
	return /^[A-Za-z0-9._~:@%+-]+\/[A-Za-z0-9._~:@%+-]+$/u.test(modelId.trim());
}

function validateAssignmentTarget(
	value: string,
	profiles: AgentProfile[],
): void {
	if (profiles.some((profile) => profile.id === value)) return;
	if (isValidDirectModelId(value)) return;
	throw new Error(`Perfil o modelo desconocido: ${value}`);
}

function virtualAgentProfile(
	roleId: IduModelRoleId,
	modelId: string,
): AgentProfile {
	return {
		id: `${roleId}__${slugModelId(modelId)}`,
		label: `${roleId} direct model`,
		provider: "pi",
		piArgs: ["--model", modelId],
	};
}

function slugModelId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/giu, "_")
		.replace(/^_+|_+$/gu, "");
}

function isRealModelId(modelId: string): boolean {
	return modelId.length > 0 && !/^pi default$/iu.test(modelId);
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
		(left, right) => left.localeCompare(right),
	);
}

function recommendationPatternsForRole(roleId: IduModelRoleId): RegExp[] {
	switch (roleId) {
		case "agentlab-security":
			return [/security|seguridad|sec/iu, /audit|review/iu, /general/iu];
		case "agentlab-database":
			return [
				/database|db|datos|data/iu,
				/architecture|arquitectura/iu,
				/general/iu,
			];
		case "agentlab-architecture":
		case "agentlab-project-understanding":
			return [/architecture|arquitectura|arch/iu, /review/iu, /general/iu];
		case "agentlab-ui-ux":
			return [/ui|ux|frontend|front/iu, /general/iu];
		case "agentlab-performance":
			return [/performance|perf|rendimiento|token/iu, /general/iu];
		case "agentlab-code-quality":
			return [/code[_ -]?quality|quality|calidad|review/iu, /general/iu];
		case "agentlab-docs":
		case "agentlab-librarian":
			return [/docs?|documentation|librarian|bibliotecario/iu, /general/iu];
		case "agentlab-general":
			return [/general/iu];
		case "supervisor-main":
		case "supervisor-semantic":
		case "supervisor-compaction":
			return [/general/iu];
	}
}

function recommendationReasonForRole(
	roleId: IduModelRoleId,
	profile: AgentProfile,
): string {
	const target = `${profile.id} ${profile.label} ${profileModelLabel(profile)}`;
	const matchedSpecialty = recommendationPatternsForRole(roleId).some(
		(pattern) => pattern.test(target),
	);
	if (matchedSpecialty)
		return "perfil detectado por nombre/modelo compatible con la especialidad";
	return "fallback seguro: primer perfil AgentLab disponible; requiere revisión humana";
}

function findRecommendedProfile(
	profiles: AgentProfile[],
	patterns: RegExp[],
): AgentProfile | undefined {
	return profiles.find((profile) =>
		patterns.some((pattern) =>
			pattern.test(
				`${profile.id}\n${profile.label}\n${profileModelLabel(profile)}`,
			),
		),
	);
}

function formatAssignmentResolution(
	resolution: ModelAssignmentResolution | undefined,
): string {
	if (!resolution || resolution.source === "inherit")
		return "inherit (fallback)";
	if (resolution.source === "missing")
		return `missing profile ${resolution.profileId} (fallback)`;
	if (resolution.source === "direct-model")
		return `${resolution.modelId} (direct model)`;
	return `${resolution.profile.label} / ${profileModelLabel(resolution.profile)} (assigned)`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(): string {
	return new Date()
		.toISOString()
		.replace(/[-:T.]/gu, "")
		.slice(0, 14);
}
