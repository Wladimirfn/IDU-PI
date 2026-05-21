import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { recordUserSignal } from "../src/lab-db.js";
import type { FindingStatus } from "../src/lab-db.js";
import type { LabRunRecord } from "../src/lab-reports.js";

async function withTempDb(
	fn: (dbPath: string, repository: LabDbRepository) => void | Promise<void>,
): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "idu-pi-lab-repo-"));
	try {
		const dbPath = join(dir, "lab.db");
		await fn(dbPath, new LabDbRepository(dbPath));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function queryProposals(dbPath: string): Array<Record<string, unknown>> {
	const output = execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			"SELECT id, finding_id, proposal_type, summary, details, priority, status FROM proposals ORDER BY id;",
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trim();
	return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
}

function queryLabRuns(dbPath: string): Array<Record<string, unknown>> {
	const output = execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			"SELECT id, project_id, project_path, agent_id, agent_label, workspace, duration_label, duration_ms, status, summary, raw_output, error, started_at, finished_at FROM lab_runs ORDER BY id;",
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trim();
	return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
}

function queryUserSignalEvents(dbPath: string): Array<Record<string, unknown>> {
	const output = execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			"SELECT id, project_id, source, raw_text, detected_emotion, urgency, confidence, matched_keywords FROM user_signal_events ORDER BY id;",
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trim();
	return output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [];
}

function tableExists(dbPath: string, tableName: string): boolean {
	const output = execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}';`,
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trim();
	return output
		? (JSON.parse(output) as Array<Record<string, unknown>>).length > 0
		: false;
}

function createLabRunRecord(
	overrides: Partial<LabRunRecord> = {},
): LabRunRecord {
	return {
		id: "run-1",
		projectId: "pi-telegram-bridge",
		projectPath: "/workspace/pi-telegram-bridge",
		agentId: "oracle",
		agentLabel: "Oracle",
		workspace: "main",
		durationLabel: "1.2s",
		durationMs: 1200,
		status: "completed",
		summary: "Lab run completed",
		startedAt: "2026-05-20T10:00:00.000Z",
		finishedAt: "2026-05-20T10:00:01.200Z",
		...overrides,
	};
}

test("LabDbRepository initializes a temporary database", async () => {
	await withTempDb((dbPath, repository) => {
		const result = repository.init();

		assert.equal(result.dbPath, dbPath);
		assert.equal(result.created, true);
		assert.equal(existsSync(dbPath), true);
	});
});

test("LabDbRepository init creates user_signal_events table", async () => {
	await withTempDb((dbPath, repository) => {
		repository.init();

		assert.equal(tableExists(dbPath, "user_signal_events"), true);
	});
});

test("LabDbRepository init is idempotent", async () => {
	await withTempDb((_dbPath, repository) => {
		assert.equal(repository.init().created, true);
		assert.equal(repository.init().created, false);
	});
});

test("LabDbRepository records and lists open findings", async () => {
	await withTempDb((_dbPath, repository) => {
		repository.recordBugFinding({
			id: "finding-1",
			projectId: "pi-telegram-bridge",
			title: "Corepack required",
			description: "pnpm is not directly available in PATH.",
			severity: "medium",
			confidence: "high",
			evidence: "corepack pnpm test passes",
			affectedFiles: ["package.json", "README.md"],
			dedupeKey: "corepack-required",
		});

		const findings = repository.listOpenFindings("pi-telegram-bridge");

		assert.equal(findings.length, 1);
		assert.equal(findings[0].id, "finding-1");
		assert.deepEqual(findings[0].affectedFiles, ["package.json", "README.md"]);
	});
});

test("LabDbRepository hides closed findings and returns open statuses", async () => {
	await withTempDb((_dbPath, repository) => {
		const statuses: FindingStatus[] = [
			"new",
			"triaged",
			"accepted",
			"deferred",
			"fixed",
			"ignored",
			"duplicate",
		];
		for (const status of statuses) {
			repository.recordBugFinding({
				id: `finding-${status}`,
				projectId: "pi-telegram-bridge",
				title: `Finding ${status}`,
				description: `Status ${status}`,
				severity: "low",
				confidence: "medium",
				status,
			});
		}

		const openStatuses = repository
			.listOpenFindings("pi-telegram-bridge")
			.map((finding) => finding.status)
			.sort();

		assert.deepEqual(openStatuses, ["accepted", "deferred", "new", "triaged"]);
	});
});

test("LabDbRepository records a proposal associated to a finding", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordFindingWithProposal({
			finding: {
				id: "finding-with-proposal",
				projectId: "pi-telegram-bridge",
				title: "Build fails",
				description: "Build exits with TypeScript errors.",
				severity: "high",
				confidence: "medium",
				evidence: "corepack pnpm build exited with code 2",
				dedupeKey: "pi-telegram-bridge:spark:build-fails",
			},
			proposal: {
				id: "proposal-1",
				proposalType: "fix",
				summary: "Export the missing type.",
				details: "Add the export from the module barrel.",
				priority: 2,
				createdByAgentId: "spark",
			},
		});

		assert.deepEqual(queryProposals(dbPath), [
			{
				id: "proposal-1",
				finding_id: "finding-with-proposal",
				proposal_type: "fix",
				summary: "Export the missing type.",
				details: "Add the export from the module barrel.",
				priority: 2,
				status: "proposed",
			},
		]);
	});
});

test("LabDbRepository does not duplicate finding when dedupeKey matches", async () => {
	await withTempDb((_dbPath, repository) => {
		const finding = {
			projectId: "pi-telegram-bridge",
			title: "Build fails",
			description: "Build exits with TypeScript errors.",
			severity: "high" as const,
			confidence: "medium" as const,
			evidence: "corepack pnpm build exited with code 2",
			dedupeKey: "pi-telegram-bridge:spark:build-fails",
		};

		repository.recordFindingWithProposal({
			finding: { ...finding, id: "finding-1" },
		});
		repository.recordFindingWithProposal({
			finding: {
				...finding,
				id: "finding-2",
				description: "Updated description.",
			},
		});

		const findings = repository.listOpenFindings("pi-telegram-bridge");
		assert.equal(findings.length, 1);
		assert.equal(findings[0].description, "Updated description.");
	});
});

test("LabDbRepository records finding when proposal is absent", async () => {
	await withTempDb((_dbPath, repository) => {
		repository.recordFindingWithProposal({
			finding: {
				id: "finding-no-proposal",
				projectId: "pi-telegram-bridge",
				title: "No proposal",
				description: "Finding has no proposal yet.",
				severity: "info",
				confidence: "low",
				evidence: "Agent reported an informational issue.",
			},
		});

		const findings = repository.listOpenFindings("pi-telegram-bridge");
		assert.equal(findings.length, 1);
		assert.equal(findings[0].id, "finding-no-proposal");
	});
});

test("LabDbRepository records a completed lab run", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordLabRun(createLabRunRecord());

		assert.deepEqual(queryLabRuns(dbPath), [
			{
				id: "run-1",
				project_id: "pi-telegram-bridge",
				project_path: "/workspace/pi-telegram-bridge",
				agent_id: "oracle",
				agent_label: "Oracle",
				workspace: "main",
				duration_label: "1.2s",
				duration_ms: 1200,
				status: "completed",
				summary: "Lab run completed",
				raw_output: null,
				error: null,
				started_at: "2026-05-20T10:00:00.000Z",
				finished_at: "2026-05-20T10:00:01.200Z",
			},
		]);
	});
});

test("LabDbRepository records a failed lab run with error", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordLabRun(
			createLabRunRecord({
				id: "run-failed",
				status: "failed",
				summary: "Lab run failed",
				error: "Agent exited with code 1",
			}),
		);

		const [row] = queryLabRuns(dbPath);
		assert.equal(row.id, "run-failed");
		assert.equal(row.status, "failed");
		assert.equal(row.error, "Agent exited with code 1");
	});
});

test("LabDbRepository records optional raw output", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordLabRun(
			createLabRunRecord({ rawOutput: "## Agent output\nDone" }),
		);

		const [row] = queryLabRuns(dbPath);
		assert.equal(row.raw_output, "## Agent output\nDone");
	});
});

test("LabDbRepository records a user signal event", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordUserSignal({
			id: "signal-1",
			projectId: "pi-telegram-bridge",
			source: "telegram",
			rawText: "Urgente, no funciona",
			detectedEmotion: "urgente",
			urgency: 5,
			confidence: "high",
			matchedKeywords: ["urgente", "no funciona"],
		});

		assert.deepEqual(queryUserSignalEvents(dbPath), [
			{
				id: "signal-1",
				project_id: "pi-telegram-bridge",
				source: "telegram",
				raw_text: "Urgente, no funciona",
				detected_emotion: "urgente",
				urgency: 5,
				confidence: "high",
				matched_keywords: '["urgente","no funciona"]',
			},
		]);
	});
});

test("recordUserSignal stores matchedKeywords as JSON array", async () => {
	await withTempDb((dbPath) => {
		recordUserSignal(dbPath, {
			id: "signal-json",
			projectId: "pi-telegram-bridge",
			source: "manual-test",
			rawText: "Gracias, perfecto",
			detectedEmotion: "feliz",
			urgency: 2,
			confidence: "high",
			matchedKeywords: ["gracias", "perfecto"],
		});

		const [row] = queryUserSignalEvents(dbPath);
		assert.deepEqual(JSON.parse(row.matched_keywords as string), [
			"gracias",
			"perfecto",
		]);
	});
});

test("LabDbRepository rejects user signal urgency outside 1 to 5", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordBugFinding({
			id: "finding-before-unsafe-signal",
			projectId: "pi-telegram-bridge",
			title: "Existing finding",
			description: "Must survive unsafe signal input.",
			severity: "low",
			confidence: "high",
		});

		assert.throws(
			() =>
				repository.recordUserSignal({
					id: "signal-bad",
					projectId: "pi-telegram-bridge",
					source: "telegram",
					rawText: "bad",
					detectedEmotion: "neutral",
					urgency: 6,
					confidence: "low",
					matchedKeywords: [],
				}),
			/urgency/u,
		);

		assert.equal(queryUserSignalEvents(dbPath).length, 0);
		assert.equal(repository.listOpenFindings("pi-telegram-bridge").length, 1);
	});
});

test("LabDbRepository upserts lab runs without duplicating ids", async () => {
	await withTempDb((dbPath, repository) => {
		repository.recordLabRun(createLabRunRecord({ summary: "First" }));
		repository.recordLabRun(createLabRunRecord({ summary: "Updated" }));

		const rows = queryLabRuns(dbPath);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].summary, "Updated");
	});
});

test("LabDbRepository recordLabRun keeps init idempotent", async () => {
	await withTempDb((_dbPath, repository) => {
		assert.equal(repository.init().created, true);
		repository.recordLabRun(createLabRunRecord());
		assert.equal(repository.init().created, false);
	});
});

test("LabDbRepository rejects unsafe durationMs without damaging existing tables", async () => {
	await withTempDb((_dbPath, repository) => {
		repository.recordBugFinding({
			id: "finding-before-unsafe-run",
			projectId: "pi-telegram-bridge",
			title: "Existing finding",
			description: "Must survive unsafe lab run input.",
			severity: "low",
			confidence: "high",
		});

		assert.throws(
			() =>
				repository.recordLabRun(
					createLabRunRecord({
						durationMs: "0); DROP TABLE bug_findings; --" as unknown as number,
					}),
				),
			/durationMs/u,
		);

		assert.equal(repository.listOpenFindings("pi-telegram-bridge").length, 1);
	});
});
