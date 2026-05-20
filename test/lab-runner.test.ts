import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AgentRouter, type AgentSession } from "../src/agent-router.js";
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

	recordLabRun(record: LabRunRecord): void {
		this.records.push(record);
	}
}

class FailingLabRunRecorder {
	recordLabRun(): void {
		throw new Error("sqlite unavailable");
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
		store,
	});

	assert.equal(record.status, "skipped");
	assert.match(record.summary, /no usa workspace clone/);
});
