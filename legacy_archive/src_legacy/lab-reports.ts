import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type LabRunStatus =
	| "running"
	| "completed"
	| "failed"
	| "timeout"
	| "skipped";

export type EngramSyncStatus =
	| "pending"
	| "approved"
	| "saved"
	| "skipped"
	| "failed";
export type TriageStatus = "pending" | "triaged" | "failed" | "skipped";
export type DecisionStatus = "none" | "work_now" | "defer" | "ignore" | "save";

export type LabRunRecord = {
	id: string;
	projectId: string;
	projectPath: string;
	agentId: string;
	agentLabel: string;
	workspace: string;
	durationLabel: string;
	durationMs: number;
	status: LabRunStatus;
	summary: string;
	rawOutput?: string;
	error?: string;
	triageStatus?: TriageStatus;
	triageSummary?: string;
	triageRaw?: string;
	triagedAt?: string;
	triageError?: string;
	decisionStatus?: DecisionStatus;
	decidedAt?: string;
	engramStatus?: EngramSyncStatus;
	engramSyncedAt?: string;
	engramError?: string;
	startedAt: string;
	finishedAt: string;
};

export class LabReportStore {
	private file: string;

	constructor(private workspaceRoot: string) {
		this.file = join(workspaceRoot, "reports", "lab-runs.jsonl");
	}

	append(record: LabRunRecord): void {
		mkdirSync(join(this.workspaceRoot, "reports"), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify(record)}\n`, { flag: "a" });
	}

	update(id: string, patch: Partial<LabRunRecord>): LabRunRecord | undefined {
		const records = this.readAllChronological();
		const index = records.findIndex((record) => record.id === id);
		if (index === -1) return undefined;
		records[index] = { ...records[index], ...patch };
		mkdirSync(join(this.workspaceRoot, "reports"), { recursive: true });
		writeFileSync(
			this.file,
			records.map((record) => JSON.stringify(record)).join("\n") + "\n",
		);
		return records[index];
	}

	pendingTriage(limit = 10): LabRunRecord[] {
		return this.list(Number.POSITIVE_INFINITY)
			.filter(
				(record) =>
					(record.triageStatus ?? "pending") === "pending" &&
					record.status !== "skipped",
			)
			.slice(0, limit);
	}

	pendingEngram(limit = 10): LabRunRecord[] {
		return this.list(Number.POSITIVE_INFINITY)
			.filter(
				(record) =>
					record.engramStatus === "approved" &&
					record.status !== "skipped" &&
					record.decisionStatus !== "ignore",
			)
			.slice(0, limit);
	}

	list(limit = 10): LabRunRecord[] {
		let text = "";
		try {
			text = readFileSync(this.file, "utf8");
		} catch {
			return [];
		}
		return text
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LabRunRecord)
			.reverse()
			.slice(0, limit);
	}

	get(id: string): LabRunRecord | undefined {
		return this.list(Number.POSITIVE_INFINITY).find(
			(record) => record.id === id,
		);
	}

	private readAllChronological(): LabRunRecord[] {
		let text = "";
		try {
			text = readFileSync(this.file, "utf8");
		} catch {
			return [];
		}
		return text
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as LabRunRecord);
	}
}

export function cleanAgentOutput(output: string): string {
	return output
		.split(/\r?\n/u)
		.filter((line) => !line.trim().startsWith("[tool:"))
		.join("\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

export function stripEngramNoise(output: string): string {
	return output
		.split(/\r?\n/u)
		.filter((line) => !/\bEngram\b|mem_context|mem_search/iu.test(line))
		.join("\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

export function summarizeOutput(output: string, maxLength = 220): string {
	const normalized = stripEngramNoise(cleanAgentOutput(output))
		.replace(/\s+/gu, " ")
		.trim();
	if (!normalized) return "Sin salida.";
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength - 3)}...`
		: normalized;
}
