# Hito-Driven Living Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first executable slice of Idu-pi's living project loop: lifecycle binding, proposal outbox, and a manual execution-director tick that produces flow-bound proposals without implementing code.

**Architecture:** Add small pure modules first, then wire them into CLI/MCP. The slice does not run AgentLabs, mutate skills, fetch news, or execute worker tasks yet; it creates the auditable foundation those engines will use. Every proposal must bind to hito/spec/flow/contracts or be blocked as missing lifecycle binding.

**Tech Stack:** TypeScript, Node test runner, stateRoot JSONL storage, existing Master Plan task tree, existing CLI/MCP envelope conventions.

---

## Scope

This plan implements Slice 1-3 from the design:

1. Lifecycle binding model.
2. Proposal outbox storage.
3. Manual execution director tick.
4. CLI/MCP read/write surfaces for the tick and outbox.

Deferred hitos:

- Bibliotecario Continuous Intelligence heartbeat.
- AgentLabs auto audit policy.
- Skill adaptation loop.
- Scheduled heartbeat/cron.

## File Structure

- Create: `src/lifecycle-binding.ts`
  - Types and validation for hito/spec/flow/contract binding.
  - Pure functions only.

- Create: `src/proposal-outbox.ts`
  - StateRoot JSONL proposal store.
  - Create/list/detail/update status.
  - No repo writes.

- Create: `src/execution-director-tick.ts`
  - Pure decision builder that reads task tree + self-maintenance signals and returns one or more flow-bound proposals or blocked/noop evidence.

- Modify: `src/cli.ts`
  - Add runtime methods and CLI commands:
    - `idu-execution-director-tick`
    - `idu-proposal-outbox`
    - `idu-proposal-detail <id>`

- Modify: `src/mcp-server.ts`
  - Add MCP tools:
    - `idu_execution_director_tick`
    - `idu_proposal_outbox`
    - `idu_proposal_detail`

- Modify: `src/command-catalog.ts`
  - Add command metadata.

- Test: `test/lifecycle-binding.test.ts`
- Test: `test/proposal-outbox.test.ts`
- Test: `test/execution-director-tick.test.ts`
- Modify: `test/idu-command-wiring.test.ts` or nearest command catalog/wiring test.
- Modify: `test/mcp-server.test.ts`

---

## Task 1: Add lifecycle binding model

**Files:**
- Create: `src/lifecycle-binding.ts`
- Test: `test/lifecycle-binding.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/lifecycle-binding.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
	buildLifecycleBinding,
	validateLifecycleBinding,
} from "../src/lifecycle-binding.js";
import type { MasterPlanTaskTree } from "../src/master-plan-task-tree.js";

const readyTree: MasterPlanTaskTree = {
	version: 1,
	status: "ready",
	projectId: "idu-pi",
	objective: "Idu-pi supervises a living project loop.",
	blockingReasons: [],
	hitos: [
		{
			id: "hito-1",
			title: "Hito 1 — Bibliotecario Continuous Intelligence",
			goal: "Monitor sources and create flow-bound proposals.",
			tasks: [
				{
					id: "hito-1-task-1",
					hitoId: "hito-1",
					title: "Create flow-bound proposal generation",
					acceptanceCriteria: ["Proposals include flow and contract evidence."],
					subtasks: [],
				},
			],
		},
	],
};

test("lifecycle binding validates hito spec flow and contracts", () => {
	const binding = buildLifecycleBinding({
		taskTree: readyTree,
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "dependency-governance",
		contractIds: ["security", "agent"],
	});

	assert.equal(binding.status, "bound");
	assert.deepEqual(binding.blockingReasons, []);
	assert.equal(binding.hitoId, "hito-1");
	assert.equal(binding.specId, "spec-flow-bound-proposals");
	assert.equal(binding.flowId, "dependency-governance");
});

test("lifecycle binding blocks when hito is missing", () => {
	const binding = buildLifecycleBinding({
		taskTree: readyTree,
		hitoId: "missing-hito",
		specId: "spec-flow-bound-proposals",
		flowId: "dependency-governance",
		contractIds: ["security"],
	});

	assert.equal(binding.status, "blocked_missing_lifecycle_binding");
	assert.ok(binding.blockingReasons.some((reason) => /hito/u.test(reason)));
});

test("lifecycle binding blocks empty flow and contract ids", () => {
	const binding = validateLifecycleBinding({
		hitoId: "hito-1",
		specId: "spec-flow-bound-proposals",
		flowId: "",
		contractIds: [],
	});

	assert.equal(binding.status, "blocked_missing_lifecycle_binding");
	assert.ok(binding.blockingReasons.some((reason) => /flowId/u.test(reason)));
	assert.ok(binding.blockingReasons.some((reason) => /contractIds/u.test(reason)));
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/lifecycle-binding.test.js
```

Expected: FAIL because `src/lifecycle-binding.ts` does not exist.

- [ ] **Step 3: Implement lifecycle binding**

Create `src/lifecycle-binding.ts`:

```ts
import type { MasterPlanTaskTree } from "./master-plan-task-tree.js";

export type LifecycleBindingStatus =
	| "bound"
	| "blocked_missing_lifecycle_binding";

export type LifecycleBindingInput = {
	hitoId?: string;
	specId?: string;
	flowId?: string;
	contractIds?: readonly string[];
};

export type LifecycleBinding = {
	version: 1;
	status: LifecycleBindingStatus;
	hitoId?: string;
	specId?: string;
	flowId?: string;
	contractIds: string[];
	blockingReasons: string[];
};

export type BuildLifecycleBindingInput = LifecycleBindingInput & {
	taskTree?: MasterPlanTaskTree;
};

export function buildLifecycleBinding(
	input: BuildLifecycleBindingInput,
): LifecycleBinding {
	const base = validateLifecycleBinding(input);
	if (base.status !== "bound" || !input.taskTree) return base;
	if (!input.taskTree.hitos.some((hito) => hito.id === base.hitoId)) {
		return {
			...base,
			status: "blocked_missing_lifecycle_binding",
			blockingReasons: [
				...base.blockingReasons,
				`hitoId '${base.hitoId}' was not found in the Master Plan task tree.`,
			],
		};
	}
	return base;
}

export function validateLifecycleBinding(
	input: LifecycleBindingInput,
): LifecycleBinding {
	const hitoId = clean(input.hitoId);
	const specId = clean(input.specId);
	const flowId = clean(input.flowId);
	const contractIds = [...new Set((input.contractIds ?? []).map(clean).filter(Boolean))];
	const blockingReasons: string[] = [];
	if (!hitoId) blockingReasons.push("hitoId is required.");
	if (!specId) blockingReasons.push("specId is required.");
	if (!flowId) blockingReasons.push("flowId is required.");
	if (contractIds.length === 0) blockingReasons.push("contractIds must include at least one contract.");
	return {
		version: 1,
		status:
			blockingReasons.length === 0
				? "bound"
				: "blocked_missing_lifecycle_binding",
		...(hitoId ? { hitoId } : {}),
		...(specId ? { specId } : {}),
		...(flowId ? { flowId } : {}),
		contractIds,
		blockingReasons,
	};
}

function clean(value: string | undefined): string {
	return (value ?? "").trim();
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/lifecycle-binding.test.js
```

Expected: PASS.

---

## Task 2: Add proposal outbox store

**Files:**
- Create: `src/proposal-outbox.ts`
- Test: `test/proposal-outbox.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/proposal-outbox.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
		contractIds: ["agent"],
		evidenceRefs: ["supervisor:signal"],
		risk: "low",
		policyDecision: "auto",
		recommendedAction: "create_task",
	});

	assert.ok(proposal.id.startsWith("proposal-"));
	assert.equal(proposal.status, "proposed");
	assert.equal(proposal.createdAt, "2026-06-07T00:00:00.000Z");
	assert.equal(store.listProposals().length, 1);
	assert.equal(store.getProposal(proposal.id)?.flowId, "execution-director-loop");
	assert.ok(proposalOutboxPath(stateRoot).endsWith("reports/proposals.jsonl"));
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
				evidenceRefs: [],
				risk: "low",
				policyDecision: "auto",
				recommendedAction: "create_task",
			}),
		/flowId is required/u,
	);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/proposal-outbox.test.js
```

Expected: FAIL because `src/proposal-outbox.ts` does not exist.

- [ ] **Step 3: Implement proposal outbox**

Create `src/proposal-outbox.ts`:

```ts
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
	filePath?: string;
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
		this.filePath = options.filePath ?? proposalOutboxPath(options.stateRoot);
		this.now = options.now ?? (() => new Date());
		this.proposals = this.load();
	}

	createProposal(input: FlowBoundProposalInput): FlowBoundProposal {
		const binding = validateLifecycleBinding(input);
		if (binding.status !== "bound") {
			throw new Error(binding.blockingReasons.join(" "));
		}
		const timestamp = this.now().toISOString();
		const proposal: FlowBoundProposal = {
			version: 1,
			id: this.nextId(),
			...input,
			contractIds: [...new Set(input.contractIds)],
			evidenceRefs: [...new Set(input.evidenceRefs)],
			status: "proposed",
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.proposals.push(proposal);
		this.persist();
		return { ...proposal };
	}

	listProposals(): FlowBoundProposal[] {
		return this.proposals.map((proposal) => ({ ...proposal }));
	}

	getProposal(id: string): FlowBoundProposal | undefined {
		const proposal = this.proposals.find((candidate) => candidate.id === id);
		return proposal ? { ...proposal } : undefined;
	}

	private nextId(): string {
		const suffix = (this.proposals.length + 1).toString().padStart(4, "0");
		return `proposal-${Date.now().toString(36)}-${suffix}`;
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
			this.proposals.map((proposal) => JSON.stringify(proposal)).join("\n") + "\n",
			"utf8",
		);
	}
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/proposal-outbox.test.js
```

Expected: PASS.

---

## Task 3: Add execution director tick

**Files:**
- Create: `src/execution-director-tick.ts`
- Test: `test/execution-director-tick.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/execution-director-tick.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionDirectorTick } from "../src/execution-director-tick.js";
import type { MasterPlanTaskTree } from "../src/master-plan-task-tree.js";

const taskTree: MasterPlanTaskTree = {
	version: 1,
	status: "ready",
	projectId: "idu-pi",
	objective: "Keep the project alive under the Master Plan.",
	blockingReasons: [],
	hitos: [
		{
			id: "hito-1",
			title: "Hito 1 — Continuous Supervisor Quality",
			goal: "Keep supervisor pressure actionable.",
			tasks: [],
		},
	],
};

test("execution director tick creates a flow-bound proposal from advisory pressure", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree,
		selfMaintenanceSignals: [
			{
				id: "learning-loop-pressure",
				category: "learning_loop_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:learning-mentions=7"],
				summary: "Learning loop has unresolved evidence pressure",
				recommendedActions: ["Convert repeated lessons into explicit tests."],
			},
		],
	});

	assert.equal(tick.status, "proposal_created");
	assert.equal(tick.proposals.length, 1);
	assert.equal(tick.proposals[0].hitoId, "hito-1");
	assert.equal(tick.proposals[0].flowId, "supervisor-learning-loop");
	assert.equal(tick.proposals[0].policyDecision, "auto");
});

test("execution director tick blocks when task tree has no ready hito", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree: { ...taskTree, status: "empty", hitos: [], blockingReasons: ["empty"] },
		selfMaintenanceSignals: [],
	});

	assert.equal(tick.status, "blocked_missing_lifecycle_binding");
	assert.ok(tick.blockingReasons.some((reason) => /hito/u.test(reason)));
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/execution-director-tick.test.js
```

Expected: FAIL because `src/execution-director-tick.ts` does not exist.

- [ ] **Step 3: Implement execution director tick**

Create `src/execution-director-tick.ts`:

```ts
import type { MasterPlanTaskTree } from "./master-plan-task-tree.js";
import type { FlowBoundProposalInput } from "./proposal-outbox.js";
import type { SupervisorSelfMaintenanceSignal } from "./supervisor-self-maintenance-advisory.js";

export type ExecutionDirectorTickStatus =
	| "proposal_created"
	| "noop"
	| "blocked_missing_lifecycle_binding";

export type ExecutionDirectorTickInput = {
	projectId: string;
	now?: Date;
	taskTree?: MasterPlanTaskTree;
	selfMaintenanceSignals: readonly SupervisorSelfMaintenanceSignal[];
};

export type ExecutionDirectorTickResult = {
	version: 1;
	authority: "advisory";
	projectId: string;
	generatedAt: string;
	status: ExecutionDirectorTickStatus;
	proposals: FlowBoundProposalInput[];
	blockingReasons: string[];
	evidenceRefs: string[];
	safeNotes: string[];
};

export function buildExecutionDirectorTick(
	input: ExecutionDirectorTickInput,
): ExecutionDirectorTickResult {
	const now = input.now ?? new Date();
	const hito = input.taskTree?.status === "ready" ? input.taskTree.hitos[0] : undefined;
	if (!hito) {
		return base(input, now, {
			status: "blocked_missing_lifecycle_binding",
			blockingReasons: ["A ready hito is required before creating living-loop proposals."],
		});
	}
	const signal = input.selfMaintenanceSignals.find(
		(candidate) => candidate.category === "learning_loop_pressure",
	);
	if (!signal) return base(input, now, { status: "noop" });
	return base(input, now, {
		status: "proposal_created",
		proposals: [
			{
				projectId: input.projectId,
				sourceTrigger: "execution-director-tick",
				sourceEngine: "supervisor",
				title: "Convert learning pressure into bounded project work",
				summary: signal.summary,
				hitoId: hito.id,
				specId: "spec-supervisor-learning-loop",
				flowId: "supervisor-learning-loop",
				contractIds: ["agent"],
				evidenceRefs: signal.evidenceRefs,
				risk: "low",
				policyDecision: "auto",
				recommendedAction: "create_task",
			},
		],
		evidenceRefs: signal.evidenceRefs,
	});
}

function base(
	input: ExecutionDirectorTickInput,
	now: Date,
	overrides: Partial<ExecutionDirectorTickResult>,
): ExecutionDirectorTickResult {
	return {
		version: 1,
		authority: "advisory",
		projectId: input.projectId,
		generatedAt: now.toISOString(),
		status: "noop",
		proposals: [],
		blockingReasons: [],
		evidenceRefs: [],
		safeNotes: [
			"Execution director tick is advisory: it creates proposals only and does not implement code.",
			"Every proposal must be bound to hito/spec/flow/contracts before execution.",
		],
		...overrides,
	};
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/execution-director-tick.test.js
```

Expected: PASS.

---

## Task 4: Persist tick proposals in outbox

**Files:**
- Modify: `src/execution-director-tick.ts`
- Test: `test/execution-director-tick.test.ts`

- [ ] **Step 1: Add failing test for store integration**

Append to `test/execution-director-tick.test.ts`:

```ts
import { ProposalOutboxStore } from "../src/proposal-outbox.js";

test("execution director tick proposals can be persisted to proposal outbox", () => {
	const tick = buildExecutionDirectorTick({
		projectId: "idu-pi",
		now: new Date("2026-06-07T00:00:00.000Z"),
		taskTree,
		selfMaintenanceSignals: [
			{
				id: "learning-loop-pressure",
				category: "learning_loop_pressure",
				severity: "warning",
				confidence: 0.7,
				evidenceRefs: ["structured-task-queue:learning-mentions=7"],
				summary: "Learning loop has unresolved evidence pressure",
				recommendedActions: ["Convert repeated lessons into explicit tests."],
			},
		],
	});
	const store = new ProposalOutboxStore({ stateRoot: mkdtempSync(join(tmpdir(), "idu-tick-outbox-")) });
	const saved = tick.proposals.map((proposal) => store.createProposal(proposal));

	assert.equal(saved.length, 1);
	assert.equal(store.listProposals()[0].specId, "spec-supervisor-learning-loop");
});
```

Also add imports if absent:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
corepack pnpm build && node --test dist/test/execution-director-tick.test.js dist/test/proposal-outbox.test.js
```

Expected: PASS after import corrections.

---

## Task 5: Wire CLI commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/command-catalog.ts`
- Test: command wiring test nearest existing Idu command tests.

- [ ] **Step 1: Add failing command wiring tests**

In the nearest command wiring test, add assertions that command catalog includes:

```ts
assert.ok(commands.some((command) => command.command.includes("execution-director")));
assert.ok(commands.some((command) => command.command.includes("proposal-outbox")));
```

Use the existing command catalog test pattern in this repo; do not invent a new testing style if a helper already exists.

- [ ] **Step 2: Add CLI runtime methods**

In `src/cli.ts`, import:

```ts
import { buildExecutionDirectorTick } from "./execution-director-tick.js";
import { ProposalOutboxStore } from "./proposal-outbox.js";
```

Add runtime methods following existing `activeRuntime` conventions:

```ts
executionDirectorTick: () => {
	const taskTree = buildMasterPlanTaskTree(activeRuntime.masterPlanStatus().currentPlan);
	const selfMaintenance = activeRuntime.supervisorSelfMaintenanceAdvisory();
	const tick = buildExecutionDirectorTick({
		projectId: context.projectId,
		now: new Date(),
		taskTree,
		selfMaintenanceSignals: selfMaintenance.report.signals,
	});
	const store = new ProposalOutboxStore({ stateRoot: context.stateRoot });
	const saved = tick.proposals.map((proposal) => store.createProposal(proposal));
	return { ...tick, savedProposals: saved };
},
proposalOutbox: () => new ProposalOutboxStore({ stateRoot: context.stateRoot }).listProposals(),
proposalDetail: (id: string) => new ProposalOutboxStore({ stateRoot: context.stateRoot }).getProposal(id),
```

Adapt property names to existing `CliRuntime` types and helpers. If `masterPlanStatus().currentPlan` is not available, use the existing plan loader already used by `automaticov1` wiring.

- [ ] **Step 3: Add CLI command cases**

Add switch cases:

```ts
case "idu-execution-director-tick":
case "execution-director-tick": {
	return printJson(activeRuntime.executionDirectorTick());
}
case "idu-proposal-outbox":
case "proposal-outbox": {
	return printJson(activeRuntime.proposalOutbox());
}
case "idu-proposal-detail":
case "proposal-detail": {
	const id = rest[0];
	if (!id) return fail("Uso: idu-pi proposal-detail <id>");
	return printJson(activeRuntime.proposalDetail(id));
}
```

Use the repo's existing JSON output helper. If it uses `console.log(JSON.stringify(..., null, 2))`, follow that.

- [ ] **Step 4: Run command tests**

Run:

```bash
corepack pnpm build && node --test dist/test/idu-command-wiring.test.js dist/test/command-catalog.test.js
```

Expected: PASS.

---

## Task 6: Wire MCP tools

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Add failing MCP list test**

In `test/mcp-server.test.ts`, add expected tool names:

```ts
assert.ok(toolNames.includes("idu_execution_director_tick"));
assert.ok(toolNames.includes("idu_proposal_outbox"));
assert.ok(toolNames.includes("idu_proposal_detail"));
```

- [ ] **Step 2: Add MCP handlers**

In `src/mcp-server.ts`, follow the existing MCP wrapper pattern. Add tools:

```ts
{
	name: "idu_execution_director_tick",
	description: "Runs one advisory execution-director tick and stores flow-bound proposals under stateRoot.",
	inputSchema: projectPathInputSchema,
}
```

Handler should:

```ts
const runtime = createCliRuntimeForProject(args.projectPath);
const result = runtime.executionDirectorTick();
return mcpJsonEnvelope("idu_execution_director_tick", result);
```

Add similar list/detail handlers for proposal outbox.

- [ ] **Step 3: Run MCP tests**

Run:

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js
```

Expected: PASS.

---

## Task 7: Full verification and supervisor postflight

**Files:**
- No new source files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
corepack pnpm build && node --test dist/test/lifecycle-binding.test.js dist/test/proposal-outbox.test.js dist/test/execution-director-tick.test.js dist/test/mcp-server.test.js
```

Expected: PASS.

- [ ] **Step 2: Run LSP diagnostics**

Run via Pi LSP tool for:

```text
src/lifecycle-binding.ts
src/proposal-outbox.ts
src/execution-director-tick.ts
src/cli.ts
src/mcp-server.ts
```

Expected: 0 diagnostics.

- [ ] **Step 3: Run full gate**

Run:

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: all tests pass, no diff-check errors.

- [ ] **Step 4: Run local postflight**

Run:

```bash
corepack pnpm cli -- idu-postflight
```

Expected:

```text
Advertencias: ninguno
shouldRunAgentLab: false
```

- [ ] **Step 5: Fresh review**

Dispatch a fresh reviewer with focus:

```text
Review lifecycle binding, proposal outbox, execution-director tick, CLI/MCP wiring. Verify no implementation authority was granted; engines only create proposals with hito/spec/flow/contracts/evidence.
```

Expected: PASS before commit.

- [ ] **Step 6: Commit only this work unit after approval**

Do not use `git add .`. Stage explicit paths:

```bash
git add \
  src/lifecycle-binding.ts \
  src/proposal-outbox.ts \
  src/execution-director-tick.ts \
  src/cli.ts \
  src/mcp-server.ts \
  src/command-catalog.ts \
  test/lifecycle-binding.test.ts \
  test/proposal-outbox.test.ts \
  test/execution-director-tick.test.ts \
  test/mcp-server.test.ts \
  test/idu-command-wiring.test.ts \
  test/command-catalog.test.ts

git commit -m "feat(idu): add living loop proposals"
```

If fewer tests/files changed, stage only changed files.

## Self-Review

### Spec coverage

Covered:

- Lifecycle binding: Task 1.
- Proposal outbox: Task 2.
- Execution director tick: Task 3.
- CLI/MCP surface: Tasks 5-6.
- Supervisor no-implementation boundary: Task 7 reviewer and postflight.

Deferred by design:

- Bibliotecario heartbeat.
- AgentLabs auto audit.
- Skill adaptation and curator.
- Scheduled heartbeat.
- Hito closure state machine.

These become follow-up hitos after the foundation exists.

### Placeholder scan

No task uses placeholder instructions. Deferred scope is explicitly listed as future hitos, not hidden implementation.

### Type consistency

The plan consistently uses:

- `LifecycleBinding`
- `FlowBoundProposal`
- `ProposalOutboxStore`
- `ExecutionDirectorTickResult`
- `buildExecutionDirectorTick`
