import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";

export const BUG_FINDING_RISK_PREFIX = "bug_finding:";

export type MasterPlanBugFindingCorpus = {
	status: "missing" | "readable" | "unreadable";
	criticalRisks: string[];
	openCriticalCount: number;
	blocksReliability: boolean;
};

export function readMasterPlanBugFindingCorpus(
	stateRoot: string,
	projectId: string,
): MasterPlanBugFindingCorpus {
	const dbPath = join(resolve(stateRoot), "lab.db");
	if (!existsSync(dbPath)) {
		return emptyCorpus("missing");
	}
	try {
		const findings = new LabDbRepository(dbPath)
			.listOpenFindings(projectId)
			.filter(
				(finding) =>
					finding.severity === "critical" || finding.severity === "high",
			);
		const openCriticalCount = findings.filter(
			(finding) => finding.severity === "critical",
		).length;
		return {
			status: "readable",
			criticalRisks: findings.map(
				(finding) =>
					`${BUG_FINDING_RISK_PREFIX}${finding.id} [${finding.severity}/${finding.status}] ${finding.title}`,
			),
			openCriticalCount,
			blocksReliability: openCriticalCount > 0,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			status: "unreadable",
			criticalRisks: [
				`${BUG_FINDING_RISK_PREFIX}corpus_unreadable Persistent bug finding corpus is unreadable: ${reason}`,
			],
			openCriticalCount: 0,
			blocksReliability: true,
		};
	}
}

export function integrateMasterPlanBugFindingRisks(
	criticalRisks: string[],
	corpus: MasterPlanBugFindingCorpus,
): string[] {
	return [
		...criticalRisks.filter(
			(risk) => !risk.startsWith(BUG_FINDING_RISK_PREFIX),
		),
		...corpus.criticalRisks,
	];
}

function emptyCorpus(
	status: MasterPlanBugFindingCorpus["status"],
): MasterPlanBugFindingCorpus {
	return {
		status,
		criticalRisks: [],
		openCriticalCount: 0,
		blocksReliability: false,
	};
}
