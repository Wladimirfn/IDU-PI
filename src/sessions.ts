import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type RecentSession = {
	file: string;
	cwd: string;
	id: string;
	mtimeMs: number;
};

export type SessionPick = RecentSession & {
	index: number;
	title: string;
	messageCount: number;
	subagentCount: number;
	preview: string;
	isAuxiliary: boolean;
};

export function sessionDirNameForCwd(cwd: string): string {
	return `--${cwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
}

function walkJsonlFiles(root: string, limit = 2000): string[] {
	if (!existsSync(root)) return [];
	const result: string[] = [];
	const stack = [root];

	while (stack.length && result.length < limit) {
		const dir = stack.pop();
		if (!dir) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.isFile() && entry.name.endsWith(".jsonl"))
				result.push(full);
		}
	}

	return result;
}

function readFirstJsonLine(file: string): any | undefined {
	const text = readFileSync(file, "utf8");
	const firstLine = text.split(/\r?\n/u).find((line) => line.trim());
	if (!firstLine) return undefined;
	try {
		return JSON.parse(firstLine);
	} catch {
		return undefined;
	}
}

function recordsFromFiles(files: string[], max: number): RecentSession[] {
	return files
		.map((file) => {
			const header = readFirstJsonLine(file);
			const stat = statSync(file);
			return {
				file,
				cwd: typeof header?.cwd === "string" ? header.cwd : "(cwd desconocido)",
				id:
					typeof header?.id === "string" ? header.id : basename(file, ".jsonl"),
				mtimeMs: stat.mtimeMs,
			};
		})
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, max);
}

export function findRecentSessions(homeDir: string, max = 8): RecentSession[] {
	const root = join(homeDir, ".pi", "agent", "sessions");
	return recordsFromFiles(walkJsonlFiles(root), max);
}

export function findRecentSessionsForCwd(
	homeDir: string,
	cwd: string,
	max = 8,
): RecentSession[] {
	const root = join(
		homeDir,
		".pi",
		"agent",
		"sessions",
		sessionDirNameForCwd(cwd),
	);
	return recordsFromFiles(walkJsonlFiles(root), max).filter(
		(session) => session.cwd === cwd,
	);
}

function normalizeChoiceInput(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/\.$/u, "");
}

export function resolveSessionPick(
	picks: SessionPick[],
	input: string,
): SessionPick | undefined {
	const normalized = normalizeChoiceInput(input);
	const match = normalized.match(
		/^(?:(?:ver|resume|retomar|usar)\s+)?(?:(?:t|trabajo|sesion)\s*)?(\d+)$/u,
	);
	if (!match) return undefined;
	const index = Number(match[1]);
	if (!Number.isInteger(index) || index < 1 || index > picks.length)
		return undefined;
	return picks[index - 1];
}

export function isActiveSessionChoice(input: string): boolean {
	return /^(?:a|activo|agente activo|esta sesion|usar esta sesion|seguir activo)$/u.test(
		normalizeChoiceInput(input),
	);
}

export function formatAge(mtimeMs: number): string {
	const seconds = Math.max(0, Math.round((Date.now() - mtimeMs) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}
