import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDU_HOME, ensureIduDirectories } from "./config.js";

export interface DecisionRecord {
	id?: number;
	projectId: string;
	decidedAt?: string;
	decidedBy: string;
	decision: string;
	targetKind: string;
	targetId: string;
	rationale?: string;
	profileRef?: string;
}

export interface ListDecisionsOptions {
	projectId?: string;
	limit?: number;
}

function getLedgerPath(): string {
	ensureIduDirectories();
	return join(IDU_HOME, "decision_ledger.json");
}

export function recordDecision(record: DecisionRecord): DecisionRecord {
	const filePath = getLedgerPath();
	const list = listDecisions({});
	const nextId = list.length > 0 ? Math.max(...list.map((d) => d.id || 0)) + 1 : 1;

	const entry: DecisionRecord = {
		id: nextId,
		projectId: record.projectId,
		decidedAt: record.decidedAt || new Date().toISOString(),
		decidedBy: record.decidedBy,
		decision: record.decision,
		targetKind: record.targetKind,
		targetId: record.targetId,
		rationale: record.rationale,
		profileRef: record.profileRef,
	};

	list.unshift(entry);
	writeFileSync(filePath, JSON.stringify(list, null, 2), "utf8");
	return entry;
}

export function listDecisions(options: ListDecisionsOptions = {}): DecisionRecord[] {
	const filePath = getLedgerPath();
	if (!existsSync(filePath)) return [];
	try {
		const raw = readFileSync(filePath, "utf8");
		let list = JSON.parse(raw) as DecisionRecord[];
		if (options.projectId) {
			list = list.filter((d) => d.projectId === options.projectId);
		}
		const limit = options.limit ?? 20;
		return list.slice(0, limit);
	} catch {
		return [];
	}
}
