import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
import type { BugFindingInput, ProposalInput } from "../src/lab-db.js";
import { parseLabDuration, runTestLab } from "../src/lab.js";
import { LabReportStore, type LabRunRecord } from "../src/lab-reports.js";
import type { PiRpcOptions, PiRpcPromptResult } from "../src/pi-rpc.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-lab-runner-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

class FakeLabRunRecorder {
	records: LabRunRecord[] = [];
	findings: Array<{ finding: BugFindingInput; proposal?: ProposalInput }> = [];

	recordLabRun(record: LabRunRecord): void {
		this.records.push(record);
	}

	recordFindingWithProposal(input: {
		finding: BugFindingInput;
		proposal?: ProposalInput;
	}): void {
		this.findings.push(input);
	}
}

class FailingLabRunRecorder {
	recordLabRun(): void {
		throw new Error("sqlite unavailable");
	}
}

class JsonlOrderRecorder extends FakeLabRunRecorder {
	jsonlPresentDuringRecord = false;
	constructor(private workspaceRoot: string) {
		super();
	}

	recordLabRun(record: LabRunRecord): void {
		this.jsonlPresentDuringRecord = readFileSync(
			join(this.workspaceRoot, "reports", "lab-runs.jsonl"),
			"utf8",
		).includes(`"id":"${record.id}"`);
		super.recordLabRun(record);
	}
}

class FakeSession implements AgentSession {
	running = false;
	cancelled = false;
	promptText = "";
	constructor(
		public cwd: string,
		public busy = false,
		private output = "tests pass",
	) {}
	start(): void {
		this.running = true;
	}
	async prompt(message: string): Promise<PiRpcPromptResult> {
		this.running = true;
		this.promptText = message;
		return { ok: true, output: this.output };
	}
	answerUiRequest(): boolean {
		return true;
	}
	cancel(): boolean {
		this.cancelled = true;
		return true;
	}
	stop(): void {}
}

const quickDepth = parseLabDuration("quick")!;

function routerWithSession(
	session: FakeSession,
	workspaceKind: "direct" | "clone" = "clone",
) {
	const router = new AgentRouter({
		piBin: "node",
		basePiArgs: ["pi-cli.js"],
		profiles: [
			{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
			{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
		],
		defaultProjectId: "p",
		defaultCwd: "C:/p",
		workspaceMode: workspaceKind === "clone" ? "clone" : "direct",
		workspaceRoot: "C:/w",
		resolveWorkspace: () => session.cwd,
		createSession: (_options: PiRpcOptions) => session,
	});
	return router;
}

test("runTestLab persists completed report and prompt constraints", async () => {
	const session = new FakeSession("C:/w/spark");
	const store = new LabReportStore(tempDir());
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
	});

	assert.equal(record.status, "completed");
	assert.match(session.promptText, /No hagas commit/);
	assert.equal(store.get(record.id)?.rawOutput, "tests pass");
});

test("runTestLab records secondary SQLite copy after JSONL", async () => {
	const session = new FakeSession("C:/w/spark");
	const workspaceRoot = tempDir();
	const store = new LabReportStore(workspaceRoot);
	const labRunRecorder = new FakeLabRunRecorder();
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
	});

	const jsonl = readFileSync(
		join(workspaceRoot, "reports", "lab-runs.jsonl"),
		"utf8",
	);
	assert.match(jsonl, new RegExp(`"id":"${record.id}"`, "u"));
	assert.deepEqual(labRunRecorder.records, [record]);
});

test("runTestLab records parsed finding after secondary lab run copy", async () => {
	const session = new FakeSession(
		"C:/w/spark",
		false,
		JSON.stringify({
			findings: [
				{
					title: "Build fails",
					description: "Build exits with TypeScript errors.",
					evidence: "corepack pnpm build exited with code 2",
					severity: "medium",
					confidence: "medium",
					proposal: {
						proposalType: "fix",
						summary: "Export the missing type.",
					},
				},
			],
		}),
	);
	const store = new LabReportStore(tempDir());
	const labRunRecorder = new FakeLabRunRecorder();
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
	});

	assert.equal(labRunRecorder.records[0], record);
	assert.equal(labRunRecorder.findings.length, 1);
	assert.equal(labRunRecorder.findings[0].finding.title, "Build fails");
	assert.equal(
		labRunRecorder.findings[0].proposal?.summary,
		"Export the missing type.",
	);
});

test("runTestLab allows valid finding registration after rule validation", async () => {
	const session = new FakeSession(
		"C:/w/spark",
		false,
		JSON.stringify({
			role: "general",
			summary: "Machine issue.",
			findings: [
				{
					title: "Machine dashboard fails",
					description: "The machines module shows stale data.",
					evidence: "corepack pnpm test failed on machines dashboard test",
					severity: "medium",
					confidence: "high",
					category: "code_quality",
					proposal: {
						summary: "Fix machines dashboard refresh.",
						steps: ["Update machines dashboard data read"],
						risk: "Low.",
						requiresHumanApproval: false,
					},
				},
			],
		}),
	);
	const store = new LabReportStore(tempDir());
	const labRunRecorder = new FakeLabRunRecorder();
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
	});

	assert.equal(labRunRecorder.findings.length, 1);
	assert.equal(
		labRunRecorder.findings[0].proposal?.summary,
		"Fix machines dashboard refresh.",
	);
});

test("runTestLab allows finding registration when rule validation warns", async () => {
	const session = new FakeSession(
		"C:/w/spark",
		false,
		JSON.stringify({
			role: "general",
			summary: "Billing issue.",
			findings: [
				{
					title: "Billing module fails",
					description: "The billing module shows stale data.",
					evidence: "corepack pnpm test failed on billing dashboard test",
					severity: "medium",
					confidence: "high",
					category: "code_quality",
					proposal: {
						summary: "Investigate billing module refresh.",
						steps: ["Inspect billing module"],
						risk: "Medium.",
						requiresHumanApproval: false,
					},
				},
			],
		}),
	);
	const store = new LabReportStore(tempDir());
	const labRunRecorder = new FakeLabRunRecorder();
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
	});

	assert.equal(labRunRecorder.findings.length, 1);
	assert.equal(
		labRunRecorder.findings[0].finding.title,
		"Billing module fails",
	);
});

test("runTestLab blocks dangerous proposal when rule validation fails critically", async () => {
	const session = new FakeSession(
		"C:/w/spark",
		false,
		JSON.stringify({
			findings: [
				{
					title: "Critical store change",
					description: "operations-db needs a dangerous migration.",
					evidence: "corepack pnpm test failed on persistence migration",
					severity: "critical",
					confidence: "high",
					proposal: {
						summary: "Change operations-db persistence format.",
						details: "Migrate operations-db records",
						risk: "Critical.",
						requiresHumanApproval: false,
					},
				},
			],
		}),
	);
	const store = new LabReportStore(tempDir());
	const labRunRecorder = new FakeLabRunRecorder();
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
	});

	assert.equal(record.status, "completed");
	assert.equal(labRunRecorder.findings.length, 1);
	assert.equal(labRunRecorder.findings[0].proposal, undefined);
});

test("runTestLab keeps registering findings when blueprint or flows fail to load", async () => {
	for (const configName of ["project-blueprint.json", "project-flows.json"]) {
		const projectPath = tempDir();
		mkdirSync(join(projectPath, "config"), { recursive: true });
		writeFileSync(join(projectPath, "config", configName), "{ invalid");
		const session = new FakeSession(
			"C:/w/spark",
			false,
			JSON.stringify({
				findings: [
					{
						title: "Build fails",
						description: "Build exits with TypeScript errors.",
						evidence: "corepack pnpm build exited with code 2",
						severity: "medium",
						confidence: "medium",
						proposal: { summary: "Export the missing type." },
					},
				],
			}),
		);
		const store = new LabReportStore(tempDir());
		const labRunRecorder = new FakeLabRunRecorder();
		const router = routerWithSession(session);
		const profile = router.labProfiles()[0];

		const record = await runTestLab({
			router,
			profile,
			duration: quickDepth,
			projectId: "p",
			projectPath,
			// Slice 2/5: blueprint + flows read from stateRoot. For this
			// test the broken JSON must live at stateRoot so the loader
			// actually sees it and fails — stateRoot === projectPath
			// preserves the no-op behavior.
			stateRoot: projectPath,
			store,
			labRunRecorder,
		});

		assert.equal(record.status, "completed");
		assert.equal(labRunRecorder.findings.length, 1);
		assert.equal(
			labRunRecorder.findings[0].proposal?.summary,
			"Export the missing type.",
		);
	}
});

test("runTestLab keeps registering findings when rule validation throws", async () => {
	const session = new FakeSession(
		"C:/w/spark",
		false,
		JSON.stringify({
			findings: [
				{
					title: "Build fails",
					description: "Build exits with TypeScript errors.",
					evidence: "corepack pnpm build exited with code 2",
					severity: "medium",
					confidence: "medium",
					proposal: { summary: "Export the missing type." },
				},
			],
		}),
	);
	const store = new LabReportStore(tempDir());
	const labRunRecorder = new FakeLabRunRecorder();
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
		ruleValidator: () => {
			throw new Error("validator unavailable");
		},
	});

	assert.equal(record.status, "completed");
	assert.equal(labRunRecorder.findings.length, 1);
	assert.equal(
		labRunRecorder.findings[0].proposal?.summary,
		"Export the missing type.",
	);
});

test("runTestLab writes JSONL before secondary rule validation and SQLite", async () => {
	const session = new FakeSession("C:/w/spark");
	const workspaceRoot = tempDir();
	const store = new LabReportStore(workspaceRoot);
	const labRunRecorder = new JsonlOrderRecorder(workspaceRoot);
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder,
	});

	assert.equal(labRunRecorder.jsonlPresentDuringRecord, true);
});

test("runTestLab ignores SQLite failure and preserves JSONL and visible result", async () => {
	const session = new FakeSession("C:/w/spark", false, "tests pass");
	const workspaceRoot = tempDir();
	const store = new LabReportStore(workspaceRoot);
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
		labRunRecorder: new FailingLabRunRecorder(),
	});

	assert.equal(record.status, "completed");
	assert.equal(record.rawOutput, "tests pass");
	assert.equal(store.get(record.id)?.rawOutput, "tests pass");
	const jsonlRecords = readFileSync(
		join(workspaceRoot, "reports", "lab-runs.jsonl"),
		"utf8",
	)
		.split(/\r?\n/u)
		.filter(Boolean);
	assert.equal(jsonlRecords.length, 1);
});

test("runTestLab skips busy agent and persists skipped report", async () => {
	const session = new FakeSession("C:/w/spark", true);
	const store = new LabReportStore(tempDir());
	const router = routerWithSession(session);
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
	});

	assert.equal(record.status, "skipped");
	assert.match(record.summary, /ocupado/);
});

test("runTestLab skips direct workspace", async () => {
	const session = new FakeSession("C:/p");
	const store = new LabReportStore(tempDir());
	const router = routerWithSession(session, "direct");
	const profile = router.labProfiles()[0];

	const record = await runTestLab({
		router,
		profile,
		duration: quickDepth,
		projectId: "p",
		projectPath: "C:/p",
		stateRoot: "C:/p",
		store,
	});

	assert.equal(record.status, "skipped");
	assert.match(record.summary, /no usa workspace clone/);
});
