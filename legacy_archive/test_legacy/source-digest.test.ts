import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addSourceLibraryItem } from "../src/source-library.js";
import {
	createSourceDigest,
	getSourceDigestStatus,
	getSourceRequiredActions,
	readSourceChunk,
	recommendSourcesForTask,
} from "../src/source-digest.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "source-digest-"));
}

function now(): Date {
	return new Date("2026-06-01T12:00:00.000Z");
}

test("digest chunks large readable source and writes librarian index", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const source = join(temp, "python-db.md");
		writeFileSync(
			source,
			Array.from(
				{ length: 80 },
				(_, index) =>
					`Python database pooling secrets transactions evidencia ${index}`,
			).join("\n"),
			"utf8",
		);
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: source,
			now,
		});
		const digest = createSourceDigest({
			stateRoot,
			projectId: "Demo",
			sourceId: added.addedSource!.id,
			chunkChars: 1_000,
			overlapChars: 100,
			now,
		});
		assert.equal(digest.contractPromotionAllowed, false);
		assert.equal(digest.processingMode, "chunked");
		assert.ok(digest.chunks.length > 1);
		assert.ok(digest.topics.includes("python"));
		const first = digest.chunks[0]!;
		assert.ok(existsSync(join(stateRoot, "Doc", "demo", first.path)));
		assert.equal(first.contractPromotionAllowed, false);
		const chunk = readSourceChunk({
			stateRoot,
			projectId: "Demo",
			sourceId: added.addedSource!.id,
			chunkId: first.chunkId,
		});
		assert.match(chunk.content, /Python database/u);
		const status = getSourceDigestStatus({ stateRoot, projectId: "Demo" });
		assert.equal(status.libraryIndexExists, true);
		assert.equal(status.digests[0]?.status, "ready");
		const libraryIndex = readFileSync(status.paths.libraryIndexPath, "utf8");
		assert.match(libraryIndex, /python-db\.md/u);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("digest chunks beyond source read preview limit", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const source = join(temp, "huge.md");
		writeFileSync(
			source,
			`${"early context\n".repeat(5_000)}final-marker database pooling`,
			"utf8",
		);
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: source,
			now,
		});
		const digest = createSourceDigest({
			stateRoot,
			projectId: "Demo",
			sourceId: added.addedSource!.id,
			chunkChars: 10_000,
			overlapChars: 100,
			now,
		});
		assert.ok(digest.chunks.length > 5);
		const lastChunk = readSourceChunk({
			stateRoot,
			projectId: "Demo",
			sourceId: added.addedSource!.id,
			chunkId: digest.chunks.at(-1)!.chunkId,
		});
		assert.match(lastChunk.content, /final-marker|database|pooling/u);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("recommendation uses local digest index and returns orchestrator read instructions", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const source = join(temp, "python-db.md");
		writeFileSync(
			source,
			"Python database connection pooling secrets transactions rollback",
			"utf8",
		);
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: source,
			now,
		});
		createSourceDigest({
			stateRoot,
			projectId: "Demo",
			sourceId: added.addedSource!.id,
			now,
		});
		const report = recommendSourcesForTask({
			stateRoot,
			projectId: "Demo",
			request: "crear módulo Python que conecte a database con pooling",
			now,
		});
		assert.equal(report.contractPromotionAllowed, false);
		assert.equal(report.matches.length, 1);
		assert.equal(report.matches[0]!.sourceId, added.addedSource!.id);
		assert.match(report.matches[0]!.orchestratorInstruction, /scout|reviewer/u);
		assert.match(report.matches[0]!.whyRelevant, /python|database|pooling/u);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("unreadable PDF digest requires librarian reader without semantic claims", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const pdf = join(temp, "scan.pdf");
		writeFileSync(pdf, "%PDF fake binary", "utf8");
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: pdf,
			now,
		});
		const digest = createSourceDigest({
			stateRoot,
			projectId: "Demo",
			sourceId: added.addedSource!.id,
			now,
		});
		assert.equal(digest.processingMode, "requires_specialized_reader");
		assert.deepEqual(digest.chunks, []);
		assert.deepEqual(digest.topics, []);
		assert.deepEqual(digest.useWhen, []);
		assert.deepEqual(digest.recommendedReads, []);
		assert.match(digest.summary, /Documento no leído/u);
		assert.equal(digest.requiredAction?.owner, "orchestrator");
		assert.equal(digest.requiredAction?.recommendedAgent, "librarian");
		assert.match(
			digest.requiredAction?.instructions ?? "",
			/subagente bibliotecario/u,
		);
		assert.match(
			digest.limitations.join("\n"),
			/sin texto legible|metadata_only/u,
		);
		assert.equal(digest.contractPromotionAllowed, false);
		const actions = getSourceRequiredActions({
			stateRoot,
			projectId: "Demo",
			now,
		});
		assert.equal(actions.actions.length, 1);
		assert.equal(actions.actions[0]!.sourceId, added.addedSource!.id);
		assert.equal(
			actions.actions[0]!.requiredAction.action,
			"dispatch_librarian_reader",
		);
		const report = recommendSourcesForTask({
			stateRoot,
			projectId: "Demo",
			request: "scan pdf",
			now,
		});
		assert.equal(report.matches.length, 0);
		assert.match(report.missingKnowledge.join("\n"), /No hay digest/u);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
