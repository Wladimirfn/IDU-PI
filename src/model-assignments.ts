import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type AgentRouter, profileModelLabel } from "./agent-router.js";
import type { AgentProfile } from "./config.js";

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

export type AgentLabModelAssignmentRecommendation = {
	roleId: IduModelRoleId;
	label: string;
	recommendedProfileId: string;
	recommendedProfile: AgentProfile;
	currentProfileId?: string;
	reason: string;
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
	if (!profile) return { source: "missing", profileId };
	return { source: "assigned", profile, profileId };
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
	if (!profiles.some((profile) => profile.id === profileId))
		throw new Error(`Perfil desconocido: ${profileId}`);
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
		if (!profiles.some((profile) => profile.id === profileId))
			throw new Error(`Perfil desconocido: ${profileId}`);
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
): AgentLabModelAssignmentRecommendation[] {
	const labProfiles = profiles.slice(1);
	const fallback =
		findRecommendedProfile(labProfiles, [/general/iu]) ?? labProfiles[0];
	if (!fallback) return [];
	return IDU_MODEL_ROLES.filter((role) => role.group === "agentlab").map(
		(role) => {
			const patterns = recommendationPatternsForRole(role.id);
			const recommendedProfile =
				findRecommendedProfile(labProfiles, patterns) ?? fallback;
			return {
				roleId: role.id,
				label: role.label,
				recommendedProfileId: recommendedProfile.id,
				recommendedProfile,
				...(current.assignments[role.id]
					? { currentProfileId: current.assignments[role.id] }
					: {}),
				reason: recommendationReasonForRole(role.id, recommendedProfile),
			};
		},
	);
}

export function formatAgentLabModelAssignmentProposal(
	recommendations: AgentLabModelAssignmentRecommendation[],
	profiles: AgentProfile[],
): string {
	return [
		"Propuesta automática por AgentLab",
		"",
		"Idu-pi no rota modelos automáticamente. Guardar esta propuesta requiere aprobación explícita del usuario.",
		"",
		...recommendations.map((recommendation) => {
			const current = recommendation.currentProfileId
				? (profiles.find(
						(profile) => profile.id === recommendation.currentProfileId,
					)?.label ?? `missing profile ${recommendation.currentProfileId}`)
				: "sin asignación explícita";
			return [
				`${recommendation.label}`,
				`  actual: ${current}`,
				`  recomendado: ${recommendation.recommendedProfile.label} / ${profileModelLabel(recommendation.recommendedProfile)}`,
				`  motivo: ${recommendation.reason}`,
			].join("\n");
		}),
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
