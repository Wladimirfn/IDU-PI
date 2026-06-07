import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateLifecycleBinding } from "./lifecycle-binding.js";

export type ProposalRisk = "low" | "medium" | "high" | "blocker";
export type ProposalPolicyDecision = "auto" | "ask_human" | "block" | "archive";
export type ProposalRecommendedAction =
	| "create_task"
	| "run_review"
	| "refresh_context"
	| "update_skill"
	| "ask_human"
	| "noop";
export type ProposalStatus =
	| "proposed"
	| "accepted"
	| "rejected"
	| "converted_to_task"
	| "archived";

export type FlowBoundProposalInput = {
	projectId: string;
	sourceTrigger: string;
	sourceEngine:
		| "supervisor"
		| "bibliotecario"
		| "agentlab"
		| "skill-learning"
		| "postflight"
		| "semantic-audit";
	title: string;
	summary: string;
	hitoId: string;
	specId: string;
	flowId: string;
	contractIds: string[];
	evidenceRefs: string[];
	risk: ProposalRisk;
	policyDecision: ProposalPolicyDecision;
	recommendedAction: ProposalRecommendedAction;
};

export type FlowBoundProposal = FlowBoundProposalInput & {
	version: 1;
	id: string;
	status: ProposalStatus;
	createdAt: string;
	updatedAt: string;
};

export type ProposalOutboxOptions = {
	stateRoot: string;
	now?: () => Date;
};

export function proposalOutboxPath(stateRoot: string): string {
	return join(stateRoot, "reports", "proposals.jsonl");
}

export class ProposalOutboxStore {
	private readonly filePath: string;
	private readonly now: () => Date;
	private proposals: FlowBoundProposal[];

	constructor(options: ProposalOutboxOptions) {
		this.filePath = proposalOutboxPath(options.stateRoot);
		this.now = options.now ?? (() => new Date());
		this.proposals = this.load();
	}

	createProposal(input: FlowBoundProposalInput): FlowBoundProposal {
		const binding = validateLifecycleBinding(input);
		if (binding.status !== "bound") {
			throw new Error(binding.blockingReasons.join(" "));
		}
		const { hitoId, specId, flowId } = binding;
		if (!hitoId || !specId || !flowId) {
			throw new Error("Lifecycle binding is incomplete.");
		}

		const canonicalInput: FlowBoundProposalInput = {
			...input,
			hitoId,
			specId,
			flowId,
			contractIds: binding.contractIds,
			evidenceRefs: binding.evidenceRefs,
		};
		const existing = this.proposals.find(
			(proposal) =>
				proposal.status === "proposed" &&
				proposalKey(proposal) === proposalKey(canonicalInput),
		);
		if (existing) return cloneProposal(existing);

		const timestamp = this.now().toISOString();
		const proposal: FlowBoundProposal = {
			...canonicalInput,
			version: 1,
			id: this.nextId(timestamp),
			status: "proposed",
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.proposals.push(proposal);
		this.persist();
		return cloneProposal(proposal);
	}

	listProposals(): FlowBoundProposal[] {
		return this.proposals.map(cloneProposal);
	}

	getProposal(id: string): FlowBoundProposal | undefined {
		const proposal = this.proposals.find((candidate) => candidate.id === id);
		return proposal ? cloneProposal(proposal) : undefined;
	}

	private nextId(timestamp: string): string {
		const suffix = (this.proposals.length + 1).toString().padStart(4, "0");
		return `proposal-${Date.parse(timestamp).toString(36)}-${suffix}`;
	}

	private load(): FlowBoundProposal[] {
		if (!existsSync(this.filePath)) return [];
		return readFileSync(this.filePath, "utf8")
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as FlowBoundProposal);
	}

	private persist(): void {
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(
			this.filePath,
			`${this.proposals.map((proposal) => JSON.stringify(proposal)).join("\n")}\n`,
			"utf8",
		);
	}
}

function cloneProposal(proposal: FlowBoundProposal): FlowBoundProposal {
	return {
		...proposal,
		contractIds: [...proposal.contractIds],
		evidenceRefs: [...proposal.evidenceRefs],
	};
}

function proposalKey(proposal: FlowBoundProposalInput): string {
	return JSON.stringify({
		projectId: proposal.projectId,
		sourceTrigger: proposal.sourceTrigger,
		sourceEngine: proposal.sourceEngine,
		hitoId: proposal.hitoId,
		specId: proposal.specId,
		flowId: proposal.flowId,
		contractIds: [...proposal.contractIds].sort(),
		evidenceRefs: [...proposal.evidenceRefs].sort(),
		risk: proposal.risk,
		policyDecision: proposal.policyDecision,
		recommendedAction: proposal.recommendedAction,
	});
}
