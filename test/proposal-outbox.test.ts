import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	ProposalOutboxStore,
	proposalOutboxPath,
} from "../src/proposal-outbox.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-proposal-outbox-"));
}

test("proposal outbox path is reports/proposals.jsonl under stateRoot", () => {
	const path = proposalOutboxPath("/tmp/idu-state").replaceAll("\\", "/");
	assert.ok(path.endsWith("/tmp/idu-state/reports/proposals.jsonl"));
});

test("proposal outbox writes flow-bound proposals under stateRoot", () => {
	const stateRoot = tempRoot();
	const store = new ProposalOutboxStore({
		stateRoot,
		now: () => new Date("2026-06-07T00:00:00.000Z"),
	});

	const proposal = store.createProposal({
		projectId: "idu-pi",
		sourceTrigger: "manual-tick",
		sourceEngine: "supervisor",
		title: "Review supervisor pressure",
		summary: "Create a bounded task for advisory pressure.",
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "execution-director-loop",
		contractIds: ["agent", "agent"],
		evidenceRefs: ["supervisor:signal", "supervisor:signal"],
		risk: "low",
		policyDecision: "auto",
		recommendedAction: "create_task",
	});

	assert.ok(proposal.id.startsWith("proposal-"));
	assert.equal(proposal.version, 1);
	assert.equal(proposal.status, "proposed");
	assert.equal(proposal.createdAt, "2026-06-07T00:00:00.000Z");
	assert.equal(proposal.updatedAt, "2026-06-07T00:00:00.000Z");
	assert.deepEqual(proposal.contractIds, ["agent"]);
	assert.deepEqual(proposal.evidenceRefs, ["supervisor:signal"]);
	assert.equal(store.listProposals().length, 1);
	assert.equal(
		store.getProposal(proposal.id)?.flowId,
		"execution-director-loop",
	);
	assert.ok(
		proposalOutboxPath(stateRoot)
			.replaceAll("\\", "/")
			.endsWith("reports/proposals.jsonl"),
	);
	assert.ok(existsSync(proposalOutboxPath(stateRoot)));
	assert.equal(
		readFileSync(proposalOutboxPath(stateRoot), "utf8").trim().split("\n")
			.length,
		1,
	);
});

test("proposal outbox loads existing JSONL proposals", () => {
	const stateRoot = tempRoot();
	const store = new ProposalOutboxStore({
		stateRoot,
		now: () => new Date("2026-06-07T00:00:00.000Z"),
	});
	const created = store.createProposal({
		projectId: "idu-pi",
		sourceTrigger: "manual-tick",
		sourceEngine: "supervisor",
		title: "Persisted proposal",
		summary: "Verify list and detail after reload.",
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "execution-director-loop",
		contractIds: ["agent"],
		evidenceRefs: ["proposal-outbox:reload"],
		risk: "low",
		policyDecision: "auto",
		recommendedAction: "create_task",
	});

	const reloaded = new ProposalOutboxStore({ stateRoot });
	assert.equal(reloaded.listProposals().length, 1);
	assert.equal(reloaded.getProposal(created.id)?.title, "Persisted proposal");
});

test("proposal outbox reuses unresolved proposals for identical evidence", () => {
	const stateRoot = tempRoot();
	const store = new ProposalOutboxStore({
		stateRoot,
		now: () => new Date("2026-06-07T00:00:00.000Z"),
	});
	const input = {
		projectId: "idu-pi",
		sourceTrigger: "execution-director-tick",
		sourceEngine: "supervisor" as const,
		title: "Convert learning pressure into bounded project work",
		summary: "Learning loop has unresolved evidence pressure",
		hitoId: "hito-1",
		specId: "spec-supervisor-learning-loop",
		flowId: "supervisor-learning-loop",
		contractIds: ["agent"],
		evidenceRefs: [
			"structured-task-queue:learning-mentions=8",
			"structured-task-queue:failed=0",
		],
		risk: "low" as const,
		policyDecision: "auto" as const,
		recommendedAction: "create_task" as const,
	};

	const first = store.createProposal(input);
	const second = store.createProposal({
		...input,
		contractIds: [" agent ", "agent"],
		evidenceRefs: [
			" structured-task-queue:failed=0 ",
			"structured-task-queue:learning-mentions=8",
		],
	});

	assert.equal(second.id, first.id);
	assert.equal(store.listProposals().length, 1);
	assert.equal(
		readFileSync(proposalOutboxPath(stateRoot), "utf8").trim().split("\n")
			.length,
		1,
	);
});

test("proposal outbox keeps distinct unresolved proposals with different risk", () => {
	const store = new ProposalOutboxStore({
		stateRoot: tempRoot(),
		now: () => new Date("2026-06-07T00:00:00.000Z"),
	});
	const input = {
		projectId: "idu-pi",
		sourceTrigger: "execution-director-tick",
		sourceEngine: "supervisor" as const,
		title: "Convert learning pressure into bounded project work",
		summary: "Learning loop has unresolved evidence pressure",
		hitoId: "hito-1",
		specId: "spec-supervisor-learning-loop",
		flowId: "supervisor-learning-loop",
		contractIds: ["agent"],
		evidenceRefs: ["structured-task-queue:learning-mentions=8"],
		risk: "low" as const,
		policyDecision: "auto" as const,
		recommendedAction: "create_task" as const,
	};

	const low = store.createProposal(input);
	const blocker = store.createProposal({
		...input,
		risk: "blocker",
	});

	assert.notEqual(blocker.id, low.id);
	assert.equal(store.listProposals().length, 2);
});

test("proposal outbox keeps distinct unresolved proposals with different policy", () => {
	const store = new ProposalOutboxStore({
		stateRoot: tempRoot(),
		now: () => new Date("2026-06-07T00:00:00.000Z"),
	});
	const input = {
		projectId: "idu-pi",
		sourceTrigger: "execution-director-tick",
		sourceEngine: "supervisor" as const,
		title: "Convert learning pressure into bounded project work",
		summary: "Learning loop has unresolved evidence pressure",
		hitoId: "hito-1",
		specId: "spec-supervisor-learning-loop",
		flowId: "supervisor-learning-loop",
		contractIds: ["agent"],
		evidenceRefs: ["structured-task-queue:learning-mentions=8"],
		risk: "low" as const,
		policyDecision: "auto" as const,
		recommendedAction: "create_task" as const,
	};

	const auto = store.createProposal(input);
	const askHuman = store.createProposal({
		...input,
		policyDecision: "ask_human",
	});

	assert.notEqual(askHuman.id, auto.id);
	assert.equal(store.listProposals().length, 2);
});

test("proposal outbox rejects missing lifecycle binding", () => {
	const store = new ProposalOutboxStore({ stateRoot: tempRoot() });
	assert.throws(
		() =>
			store.createProposal({
				projectId: "idu-pi",
				sourceTrigger: "manual-tick",
				sourceEngine: "supervisor",
				title: "Invalid proposal",
				summary: "Missing flow binding.",
				hitoId: "hito-1",
				specId: "spec-flow-bound-proposals",
				flowId: "",
				contractIds: ["agent"],
				evidenceRefs: ["proposal-outbox:invalid"],
				risk: "low",
				policyDecision: "auto",
				recommendedAction: "create_task",
			}),
		/flowId is required/u,
	);
});

test("proposal outbox rejects proposals without evidence refs", () => {
	const store = new ProposalOutboxStore({ stateRoot: tempRoot() });
	assert.throws(
		() =>
			store.createProposal({
				projectId: "idu-pi",
				sourceTrigger: "manual-tick",
				sourceEngine: "supervisor",
				title: "Invalid proposal",
				summary: "Missing evidence refs.",
				hitoId: "hito-1",
				specId: "spec-flow-bound-proposals",
				flowId: "execution-director-loop",
				contractIds: ["agent"],
				evidenceRefs: [" ", ""],
				risk: "low",
				policyDecision: "auto",
				recommendedAction: "create_task",
			}),
		/evidenceRefs must include at least one evidence reference/u,
	);
});
