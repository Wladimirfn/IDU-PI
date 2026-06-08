import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type MasterPlanObjectiveSnapshot = {
	version: 1;
	projectId: string;
	projectPath: string;
	planStatus: string;
	planApproved: boolean;
	blocked: boolean;
	blockReason?: string;
	objective: string;
	summary: string;
	risks: string[];
	generatedAt: string;
	expiresAt: string;
	advisoryOnly: true;
};

type PlanLike = Record<string, unknown>;

export function resolveMasterPlanObjectiveCachePath(stateRoot: string): string {
	return join(stateRoot, "reports", "master-plan-objective-cache.json");
}

export function buildMasterPlanObjectiveSnapshot(input: {
	projectId: string;
	projectPath: string;
	plan: PlanLike;
	now?: Date;
	ttlMinutes?: number;
}): MasterPlanObjectiveSnapshot {
	const now = input.now ?? new Date();
	const ttlMinutes = input.ttlMinutes ?? 60;
	const status = String(input.plan.status ?? "unknown");
	const rawObjective = String(
		input.plan.inferredObjective ?? input.plan.executiveSummary ?? "",
	);
	const objective = boundText(rawObjective, 500);
	const summary = boundText(String(input.plan.executiveSummary ?? ""), 500);
	const risks = stringArray(input.plan.criticalRisks)
		.slice(0, 8)
		.map((item) => boundText(item, 180));
	const planApproved = status === "approved";
	const blocked = !planApproved || !objective.trim();
	return {
		version: 1,
		projectId: input.projectId,
		projectPath: input.projectPath,
		planStatus: status,
		planApproved,
		blocked,
		...(blocked
			? {
					blockReason: planApproved ? "objective missing" : "plan not approved",
				}
			: {}),
		objective,
		summary,
		risks,
		generatedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString(),
		advisoryOnly: true,
	};
}

export function getCachedMasterPlanObjectiveSnapshot(input: {
	stateRoot: string;
	projectId: string;
	projectPath: string;
	loadPlan: () => PlanLike;
	now?: Date;
	ttlMinutes?: number;
}): MasterPlanObjectiveSnapshot {
	const now = input.now ?? new Date();
	const cached = readSnapshot(input.stateRoot);
	if (cached && Date.parse(cached.expiresAt) > now.getTime()) return cached;
	const snapshot = buildMasterPlanObjectiveSnapshot({
		projectId: input.projectId,
		projectPath: input.projectPath,
		plan: input.loadPlan(),
		now,
		ttlMinutes: input.ttlMinutes,
	});
	writeSnapshot(input.stateRoot, snapshot);
	return snapshot;
}

function readSnapshot(
	stateRoot: string,
): MasterPlanObjectiveSnapshot | undefined {
	const path = resolveMasterPlanObjectiveCachePath(stateRoot);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isSnapshot(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function invalidateMasterPlanObjectiveCache(
	stateRoot: string,
): { invalidated: boolean } {
	if (typeof stateRoot !== "string" || stateRoot.length === 0) {
		throw new Error("stateRoot inválido: vacío");
	}
	if (stateRoot.includes("..") || stateRoot.includes("\0")) {
		throw new Error("stateRoot inválido: contiene '..' o null byte");
	}
	const path = resolveMasterPlanObjectiveCachePath(stateRoot);
	if (!existsSync(path)) {
		return { invalidated: false };
	}
	try {
		unlinkSync(path);
		return { invalidated: true };
	} catch {
		return { invalidated: false };
	}
}

function writeSnapshot(
	stateRoot: string,
	snapshot: MasterPlanObjectiveSnapshot,
): void {
	const path = resolveMasterPlanObjectiveCachePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(snapshot, null, "\t")}\n`, "utf8");
}

function isSnapshot(value: unknown): value is MasterPlanObjectiveSnapshot {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		typeof record.projectId === "string" &&
		typeof record.projectPath === "string" &&
		typeof record.planStatus === "string" &&
		typeof record.planApproved === "boolean" &&
		typeof record.blocked === "boolean" &&
		typeof record.objective === "string" &&
		typeof record.summary === "string" &&
		Array.isArray(record.risks) &&
		record.risks.every((item) => typeof item === "string") &&
		typeof record.generatedAt === "string" &&
		typeof record.expiresAt === "string" &&
		record.advisoryOnly === true
	);
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function boundText(value: string, maxChars: number): string {
	const normalized = value.replace(/\s+/gu, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 18)).trimEnd()}… [truncated]`;
}
