import { existsSync, readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	ProjectAlignmentStatus,
	ProjectReadiness,
} from "./project-connection.js";
import type { ProjectAlignmentDiffCounts } from "./idu-prepare.js";

export type ProjectAlignmentState = {
	version: 1;
	projectId: string;
	projectPath: string;
	alignmentStatus: ProjectAlignmentStatus;
	readiness: ProjectReadiness;
	alignmentReason: string[];
	differencesDetected?: ProjectAlignmentDiffCounts;
	recordedAt: string;
};

export function projectAlignmentStatePath(stateRoot: string): string {
	return join(stateRoot, "reports", "idu-prepare-alignment-state.json");
}

export function recordProjectAlignmentState(
	stateRoot: string,
	state: Omit<ProjectAlignmentState, "version" | "recordedAt"> & {
		recordedAt?: string;
	},
): ProjectAlignmentState {
	const normalized: ProjectAlignmentState = {
		version: 1,
		projectId: state.projectId,
		projectPath: state.projectPath,
		alignmentStatus: state.alignmentStatus,
		readiness: state.readiness,
		alignmentReason: state.alignmentReason,
		...(state.differencesDetected
			? { differencesDetected: state.differencesDetected }
			: {}),
		recordedAt: state.recordedAt ?? new Date().toISOString(),
	};
	const path = projectAlignmentStatePath(stateRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	return normalized;
}

export function readProjectAlignmentState(
	stateRoot: string,
	match: { projectId: string; projectPath: string },
): ProjectAlignmentState | undefined {
	const path = projectAlignmentStatePath(stateRoot);
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isProjectAlignmentState(parsed)) return undefined;
		if (parsed.projectId !== match.projectId) return undefined;
		if (!samePath(parsed.projectPath, match.projectPath)) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function isProjectAlignmentState(value: unknown): value is ProjectAlignmentState {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ProjectAlignmentState>;
	return (
		candidate.version === 1 &&
		typeof candidate.projectId === "string" &&
		typeof candidate.projectPath === "string" &&
		isAlignmentStatus(candidate.alignmentStatus) &&
		isReadiness(candidate.readiness) &&
		Array.isArray(candidate.alignmentReason) &&
		candidate.alignmentReason.every((entry) => typeof entry === "string") &&
		typeof candidate.recordedAt === "string"
	);
}

function isAlignmentStatus(
	value: unknown,
): value is ProjectAlignmentStatus {
	return (
		value === "unknown" ||
		value === "pending_scan" ||
		value === "needs_review" ||
		value === "aligned" ||
		value === "stale"
	);
}

function isReadiness(value: unknown): value is ProjectReadiness {
	return value === "not_ready" || value === "config_ready" || value === "aligned_ready";
}

function samePath(left: string, right: string): boolean {
	return process.platform === "win32"
		? left.toLowerCase() === right.toLowerCase()
		: left === right;
}
