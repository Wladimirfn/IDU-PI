import {
	initLabDb,
	listOpenFindings,
	recordBugFinding,
	recordFindingWithProposal,
	recordLabRun,
	recordUserSignal,
	type BugFinding,
	type BugFindingInput,
	type FindingWithProposalInput,
	type InitLabDbResult,
	type UserSignalInput,
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

	recordUserSignal(input: UserSignalInput): void {
		recordUserSignal(this.dbPath, input);
	}

	recordFindingWithProposal(input: FindingWithProposalInput): void {
		recordFindingWithProposal(this.dbPath, input);
	}

	listOpenFindings(projectId: string): BugFinding[] {
		return listOpenFindings(this.dbPath, projectId);
	}
}
