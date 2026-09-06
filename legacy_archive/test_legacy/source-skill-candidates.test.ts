import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createSourceSkillCandidates,
	formatSourceSkillCandidateCreationResult,
	reviewSourceSkillCandidates,
} from "../src/source-skill-candidates.js";
import { sourceLibraryPaths } from "../src/source-library.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-source-skill-candidates-"));
}

function writeDigest(
	stateRoot: string,
	projectId: string,
	sourceId: string,
	overrides: Record<string, unknown> = {},
): void {
	const paths = sourceLibraryPaths(stateRoot, projectId);
	mkdirSync(paths.root, { recursive: true });
	mkdirSync(paths.digestsDir, { recursive: true });
	mkdirSync(paths.chunksDir, { recursive: true });
	const chunkDir = join(paths.chunksDir, sourceId);
	mkdirSync(chunkDir, { recursive: true });
	writeFileSync(
		join(chunkDir, "chunk-001.md"),
		"Use small focused JavaScript modules with explicit tests.",
		"utf8",
	);
	writeFileSync(
		paths.libraryIndexPath,
		JSON.stringify({
			version: 1,
			projectId,
			updatedAt: "2026-06-03T00:00:00.000Z",
			contractPromotionAllowed: false,
			entries: [
				{
					sourceId,
					title: "JavaScript engineering practices",
					kind: "manual_doc",
					topics: ["JavaScript", "testing", "engineering"],
					useWhen: ["JavaScript refactor", "frontend module", "API logic"],
					recommendedReads: ["chunk-001"],
					limitations: [],
					updatedAt: "2026-06-03T00:00:00.000Z",
				},
			],
		}),
		"utf8",
	);
	writeFileSync(
		join(paths.digestsDir, `${sourceId}.json`),
		JSON.stringify({
			version: 1,
			projectId,
			sourceId,
			title: "JavaScript engineering practices",
			kind: "manual_doc",
			generatedAt: "2026-06-03T00:00:00.000Z",
			processingMode: "direct",
			summary:
				"Reusable JavaScript engineering practices for maintainable modules and tests.",
			topics: ["JavaScript", "testing", "engineering"],
			useWhen: ["JavaScript refactor", "frontend module", "API logic"],
			chunks: [
				{
					chunkId: "chunk-001",
					title: "Engineering practice",
					path: join(chunkDir, "chunk-001.md"),
					summary: "Use focused modules and explicit tests.",
					topics: ["JavaScript", "testing"],
				},
			],
			recommendedReads: ["chunk-001"],
			limitations: [],
			contractPromotionAllowed: false,
			...overrides,
		}),
		"utf8",
	);
}

test("source skill candidates reports missing source index without creating skills", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		const result = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		assert.equal(result.ok, true);
		assert.equal(result.report.candidates.length, 0);
		assert.match(result.report.limitations.join("\n"), /source library index/i);
		assert.equal(existsSync(join(root, ".agents")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates create reports-only draft preview from digest evidence", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-js");
		const result = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		assert.equal(result.ok, true);
		assert.equal(result.report.candidates.length, 1);
		const candidate = result.report.candidates[0]!;
		assert.equal(candidate.requiresHumanApproval, true);
		assert.equal(candidate.contractPromotionAllowed, false);
		assert.equal(candidate.tokensCostMeasured, false);
		assert.equal(candidate.efficiencyEvidence, "no medido");
		assert.deepEqual(candidate.sourceIds, ["source-js"]);
		assert.deepEqual(candidate.chunkIds, ["chunk-001"]);
		assert.match(candidate.draftPreview, /^---\nname: /u);
		assert.match(candidate.draftPreview, /Source evidence/u);
		assert.equal(existsSync(join(root, ".agents")), false);
		assert.equal(existsSync(result.path), true);
		assert.match(
			formatSourceSkillCandidateCreationResult(result),
			/Reports-only/u,
		);
		assert.match(
			formatSourceSkillCandidateCreationResult(result),
			/tokens\/cost: no medido/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates skip specialized-reader digests", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-pdf", {
			processingMode: "requires_specialized_reader",
			requiredAction: {
				type: "dispatch_librarian_reader",
				sourceId: "source-pdf",
				reason: "PDF requires reader",
			},
		});
		const result = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		assert.equal(result.report.candidates.length, 0);
		assert.match(result.report.requiredActions.join("\n"), /source-pdf/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates create rejects reports path outside stateRoot", () => {
	const root = tempRoot();
	const outside = tempRoot();
	try {
		assert.throws(
			() =>
				createSourceSkillCandidates({
					stateRoot: root,
					reportsPath: join(outside, "reports"),
					projectId: "idu-pi",
					now: new Date("2026-06-03T12:00:00.000Z"),
				}),
			/reportsPath must stay inside stateRoot/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("source skill candidates review rejects unsafe candidate advisory fields", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-js");
		const created = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		const raw = JSON.parse(readFileSync(created.path, "utf8"));
		raw.candidates[0].contractPromotionAllowed = true;
		raw.candidates[0].tokensCostMeasured = true;
		raw.candidates[0].draftTargetPath = join(
			root,
			".agents",
			"bad",
			"SKILL.md",
		);
		writeFileSync(created.path, JSON.stringify(raw, null, 2), "utf8");

		const review = reviewSourceSkillCandidates("latest", reportsPath);
		assert.equal(review.ok, false);
		assert.match(review.errors.join("\n"), /candidate advisory invariants/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates review rejects draft target traversal", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-js");
		const created = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		const raw = JSON.parse(readFileSync(created.path, "utf8"));
		raw.candidates[0].draftTargetPath = ".agents/skills/../../outside/SKILL.md";
		writeFileSync(created.path, JSON.stringify(raw, null, 2), "utf8");

		const review = reviewSourceSkillCandidates("latest", reportsPath);
		assert.equal(review.ok, false);
		assert.match(review.errors.join("\n"), /candidate advisory invariants/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates review latest validates reports and rejects unsafe paths", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-js");
		const created = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		const review = reviewSourceSkillCandidates("latest", reportsPath);
		assert.equal(review.ok, true);
		assert.equal(review.path, created.path);
		assert.equal(review.report?.candidates.length, 1);
		const unsafe = reviewSourceSkillCandidates(
			join(root, "outside.json"),
			reportsPath,
		);
		assert.equal(unsafe.ok, false);
		assert.match(unsafe.errors.join("\n"), /outside reports/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
