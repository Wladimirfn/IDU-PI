import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { addSourceLibraryItem } from "../src/source-library.js";
import {
	buildContextPruningAdvisoryReport,
	formatContextPruningAdvisoryPanel,
} from "../src/context-pruning-advisory.js";
import {
	contextQualityEventFromSupervisorContextPack,
	contextQualityEventsPath,
	recordContextQualityEvent,
} from "../src/context-quality-events.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "context-pruning-advisory-"));
}

function now(): Date {
	return new Date("2026-06-04T12:00:00.000Z");
}

test("semantic debt advisory report keeps safety flags and detects context bloat", async () => {
	const temp = tempRoot();
	try {
		const repoRoot = join(temp, "repo");
		const stateRoot = join(temp, "state", "projects", "demo");
		mkdirSync(repoRoot, { recursive: true });
		const path = contextQualityEventsPath(stateRoot);
		mkdirSync(dirname(path), { recursive: true });
		await recordContextQualityEvent(
			stateRoot,
			contextQualityEventFromSupervisorContextPack("Demo", {
				contextBudget: {
					profile: "supervisor_context_pack",
					maxTotalChars: 10000,
					usedChars: 10000,
					truncated: true,
					omitted: [
						{ path: "goals.humanVision", reason: "max_chars" },
						{ path: "requiredReads", reason: "max_items" },
					],
					generatedAt: "deterministic",
					advisoryOnly: true,
					contractPromotionAllowed: false,
				},
				goals: {
					humanVision: "compact vision",
					planObjective: "approved objective",
					taskGoal: "small goal",
				},
				contracts: ["agent"],
				requiredReads: ["Plan Maestro"],
				risks: ["risk"],
				autonomyGates: ["postflight"],
				skipNoiseGuidance: ["skip raw docs"],
				taskPackage: { id: "pkg" },
				taskContext: { recommendation: "warn" },
			}),
		);

		const report = buildContextPruningAdvisoryReport({
			stateRoot,
			projectId: "Demo",
			repoRoot,
			now,
		});
		assert.equal(report.mode, "advisory_only");
		assert.equal(report.noDeletion, true);
		assert.equal(report.noAutoDelete, true);
		assert.equal(report.noContractPromotion, true);
		assert.equal(report.rawPromptsStored, false);
		assert.equal(report.rawDocsStored, false);
		assert.equal(report.remoteAnalytics, false);
		assert.equal(report.totals.contextQualityEvents, 1);
		assert.equal(report.totals.truncatedContextEvents, 1);
		assert.ok(
			report.signals.some((signal) => signal.category === "context_bloat"),
		);
		const serialized = JSON.stringify(report);
		for (const forbidden of [
			"Secret prompt content",
			"rawPromptText",
			"rawDocumentText",
			"headers",
			"tokenCount",
			"costUsd",
		]) {
			assert.equal(serialized.includes(forbidden), false, forbidden);
		}
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("semantic debt advisory reports Pi prompt context pressure without raw content", () => {
	const temp = tempRoot();
	try {
		const repoRoot = join(temp, "repo");
		const stateRoot = join(temp, "state", "projects", "demo");
		const promptSnapshotPath = join(temp, "prompt-context-snapshot.json");
		mkdirSync(repoRoot, { recursive: true });
		writeFileSync(
			promptSnapshotPath,
			JSON.stringify({
				version: 1,
				mode: "tui",
				generatedAt: "2026-06-05T00:00:00.000Z",
				rawContentIncluded: false,
				contextFiles: {
					count: 7,
					paths: ["AGENTS.md", "context.md", "docs/architecture.md"],
					totalChars: 85_000,
				},
				skills: { count: 6, names: ["skill-a", "skill-b"] },
				tools: { count: 42 },
				limitations: ["metadata only"],
				systemPrompt: "RAW_SYSTEM_PROMPT_MUST_NOT_LEAK",
				content: "RAW_CONTEXT_MUST_NOT_LEAK",
			}),
			"utf8",
		);

		const report = buildContextPruningAdvisoryReport({
			stateRoot,
			projectId: "Demo",
			repoRoot,
			now,
			promptContextSnapshotPath: promptSnapshotPath,
		});

		assert.equal(report.totals.piPromptContextFiles, 7);
		assert.equal(report.totals.piPromptContextChars, 85_000);
		const signal = report.signals.find(
			(candidate) => candidate.id === "pi-prompt-context-pressure",
		);
		assert.ok(signal);
		assert.equal(signal.severity, "high");
		assert.equal(signal.source, "pi_prompt_context");
		assert.ok(signal.evidenceRefs.includes("piPromptContextFiles:7"));
		assert.ok(signal.evidenceRefs.includes("piPromptContextChars:85000"));
		assert.ok(signal.evidenceRefs.includes("piPromptMode:tui"));
		const serialized = JSON.stringify(report);
		assert.equal(serialized.includes("RAW_SYSTEM_PROMPT_MUST_NOT_LEAK"), false);
		assert.equal(serialized.includes("RAW_CONTEXT_MUST_NOT_LEAK"), false);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("semantic debt advisory reports stale sources, missing digest, and librarian actions", () => {
	const temp = tempRoot();
	try {
		const repoRoot = join(temp, "repo");
		const stateRoot = join(temp, "state", "projects", "demo");
		mkdirSync(repoRoot, { recursive: true });
		const text = join(temp, "notes.txt");
		writeFileSync(text, "source v1", "utf8");
		const addedText = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: text,
			now,
		});
		writeFileSync(
			join(addedText.paths.root, addedText.addedSource!.storedPath),
			"source v2",
			"utf8",
		);
		const pdf = join(temp, "manual.pdf");
		writeFileSync(pdf, "%PDF fake", "utf8");
		addSourceLibraryItem({ stateRoot, projectId: "Demo", inputPath: pdf, now });

		const report = buildContextPruningAdvisoryReport({
			stateRoot,
			projectId: "Demo",
			repoRoot,
			now,
		});
		assert.equal(report.totals.staleSources, 1);
		assert.equal(report.totals.missingDigests, 2);
		assert.equal(report.totals.requiredSourceReads, 1);
		assert.ok(
			report.signals.some((signal) => signal.category === "stale_evidence"),
		);
		assert.ok(
			report.signals.some((signal) => signal.category === "stale_digest"),
		);
		assert.ok(
			report.signals.every((signal) =>
				signal.blockedBy.includes("orchestrator review"),
			),
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("semantic debt advisory uses plan/spec metadata without storing document text", () => {
	const temp = tempRoot();
	try {
		const repoRoot = join(temp, "repo");
		const stateRoot = join(temp, "state", "projects", "demo");
		const planDir = join(repoRoot, "docs", "superpowers", "plans");
		const specDir = join(repoRoot, "docs", "superpowers", "specs");
		const artifactDir = join(repoRoot, "subagent-artifacts");
		mkdirSync(planDir, { recursive: true });
		mkdirSync(specDir, { recursive: true });
		mkdirSync(artifactDir, { recursive: true });
		writeFileSync(
			join(planDir, "2026-01-01-old-feature.md"),
			"# Secret implementation prompt\n- [ ] open item\n- [ ] another item\n",
			"utf8",
		);
		writeFileSync(
			join(specDir, "2026-01-01-old-feature-design.md"),
			"# Secret design docs\n",
			"utf8",
		);
		writeFileSync(
			join(artifactDir, "old-worker-output.md"),
			"artifact text not copied",
			"utf8",
		);

		const report = buildContextPruningAdvisoryReport({
			stateRoot,
			projectId: "Demo",
			repoRoot,
			now,
		});
		assert.equal(report.totals.oldPlans, 2);
		assert.ok(report.totals.noisyArtifacts >= 1);
		assert.ok(
			report.signals.some((signal) => signal.category === "old_plan_or_spec"),
		);
		const serialized = JSON.stringify(report);
		assert.equal(serialized.includes("Secret implementation prompt"), false);
		assert.equal(serialized.includes("Secret design docs"), false);
		assert.equal(serialized.includes("open item"), false);
		assert.equal(serialized.includes("openCheckboxes"), false);

		const panel = formatContextPruningAdvisoryPanel(report);
		assert.match(panel, /Deuda semántica local/u);
		assert.match(panel, /borrado automático: no/u);
		assert.equal(panel.includes("Secret implementation prompt"), false);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
