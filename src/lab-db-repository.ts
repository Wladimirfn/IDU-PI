import {
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	recordFindingWithProposal,
	recordLabRun,
	type BugFinding,
	type BugFindingInput,
	type FindingWithProposalInput,
	type InitLabDbResult,
} from "./lab-db.js";
import type { LabRunRecord } from "./lab-reports.js";

export class LabDbRepository {
	constructor(private readonly dbPath: string) {}

	init(): InitLabDbResult {
		return initLabDb(this.dbPath);
	}

	recordBugFinding(input: BugFindingInput): void {
		recordBugFinding(this.dbPath, input);
	}

	recordLabRun(record: LabRunRecord): void {
		recordLabRun(this.dbPath, record);
	}

	recordFindingWithProposal(input: FindingWithProposalInput): void {
		recordFindingWithProposal(this.dbPath, input);
	}

	listOpenFindings(projectId: string): BugFinding[] {
		return listOpenFindings(this.dbPath, projectId);
	}
}
