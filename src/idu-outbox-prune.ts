import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type PruneOptions = {
	olderThanDays: number;
	now?: Date;
};

export type PrunableEntry = {
	id: string;
	createdAt: string;
	raw: string; // original JSONL line, preserved verbatim
};

export type PrunePlan = {
	cutoff: string;
	dryRun: boolean;
	proposals: PrunableEntry[];
	injections: PrunableEntry[];
};

export type PruneApplyResult = {
	cutoff: string;
	archived: {
		proposals: number;
		injections: number;
	};
	removed: {
		proposals: number;
		injections: number;
	};
	archiveDir: string;
};

function getNow(options: PruneOptions): Date {
	return options.now ?? new Date();
}

function getCutoff(options: PruneOptions): string {
	const cutoffMs =
		getNow(options).getTime() - options.olderThanDays * 24 * 60 * 60 * 1000;
	return new Date(cutoffMs).toISOString();
}

function readJsonlEntries(path: string): string[] {
	if (!existsSync(path)) return [];
	const raw = readFileSync(path, "utf8");
	return raw.split(/\r?\n/u).filter(Boolean);
}

function parseEntry(
	line: string,
): { id: string; createdAt: string } | null {
	try {
		const parsed = JSON.parse(line) as Record<string, unknown>;
		if (typeof parsed === "object" && parsed !== null) {
			const id = parsed.id;
			const createdAt =
				(typeof parsed.createdAt === "string" && parsed.createdAt) ||
				(typeof parsed.envelope === "object" &&
					parsed.envelope !== null &&
					typeof (parsed.envelope as Record<string, unknown>).createdAt ===
						"string" &&
					(parsed.envelope as Record<string, unknown>)
						.createdAt as string) ||
				"";
			if (typeof id === "string" && id.length > 0 && createdAt.length > 0) {
				return { id, createdAt };
			}
		}
	} catch {
		// Lenient parse-or-skip
	}
	return null;
}

function collectPrunable(
	path: string,
	cutoff: string,
): PrunableEntry[] {
	const out: PrunableEntry[] = [];
	for (const line of readJsonlEntries(path)) {
		const entry = parseEntry(line);
		if (entry && entry.createdAt < cutoff) {
			out.push({
				id: entry.id,
				createdAt: entry.createdAt,
				raw: line,
			});
		}
	}
	return out;
}

export function planPrune(
	stateRoot: string,
	options: PruneOptions,
): PrunePlan {
	const cutoff = getCutoff(options);
	const proposalsPath = join(stateRoot, "reports", "proposals.jsonl");
	const injectionsPath = join(stateRoot, "injections.jsonl");
	return {
		cutoff,
		dryRun: true,
		proposals: collectPrunable(proposalsPath, cutoff),
		injections: collectPrunable(injectionsPath, cutoff),
	};
}

function archiveLines(
	archivePath: string,
	entries: PrunableEntry[],
): void {
	if (entries.length === 0) return;
	mkdirSync(dirname(archivePath), { recursive: true });
	const block = entries.map((e) => e.raw).join("\n") + "\n";
	if (existsSync(archivePath)) {
		writeFileSync(
			archivePath,
			readFileSync(archivePath, "utf8") + block,
			"utf8",
		);
	} else {
		writeFileSync(archivePath, block, "utf8");
	}
}

function rewriteJsonl(
	livePath: string,
	pruneIds: Set<string>,
): number {
	if (!existsSync(livePath)) return 0;
	const lines = readJsonlEntries(livePath);
	const kept: string[] = [];
	let removed = 0;
	for (const line of lines) {
		const entry = parseEntry(line);
		if (entry && pruneIds.has(entry.id)) {
			removed += 1;
			continue;
		}
		kept.push(line);
	}
	if (kept.length === 0) {
		writeFileSync(livePath, "", "utf8");
	} else {
		writeFileSync(livePath, `${kept.join("\n")}\n`, "utf8");
	}
	return removed;
}

export function applyPrune(
	stateRoot: string,
	plan: PrunePlan,
	options: PruneOptions,
): PruneApplyResult {
	const now = getNow(options);
	const dateDir = now.toISOString().slice(0, 10);
	const archiveDir = join(stateRoot, ".archive", dateDir);
	const proposalsArchivePath = join(archiveDir, "proposals.jsonl");
	const injectionsArchivePath = join(archiveDir, "injections.jsonl");
	archiveLines(proposalsArchivePath, plan.proposals);
	archiveLines(injectionsArchivePath, plan.injections);
	const proposalIds = new Set(plan.proposals.map((e) => e.id));
	const injectionIds = new Set(plan.injections.map((e) => e.id));
	const proposalsRemoved = rewriteJsonl(
		join(stateRoot, "reports", "proposals.jsonl"),
		proposalIds,
	);
	const injectionsRemoved = rewriteJsonl(
		join(stateRoot, "injections.jsonl"),
		injectionIds,
	);
	return {
		cutoff: plan.cutoff,
		archived: {
			proposals: plan.proposals.length,
			injections: plan.injections.length,
		},
		removed: {
			proposals: proposalsRemoved,
			injections: injectionsRemoved,
		},
		archiveDir,
	};
}
