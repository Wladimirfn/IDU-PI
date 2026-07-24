import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./helpers/temp.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import type {
	SkillInsert,
	SourceInsert,
	DigestInsert,
	RatingInsert,
	ProposalInsert,
} from "../src/bibliotecario-types.js";

describe("T2.2 — LabDbRepository B0 methods", () => {
	let tempDir: string;
	let dbPath: string;
	let repo: LabDbRepository;

	beforeEach(() => {
		tempDir = makeTempDir("bibliotecario-repo-");
		dbPath = join(tempDir, "lab.db");
		repo = new LabDbRepository(dbPath, {
			bibliotecarioProjectId: "test-project",
		});
		// Initialize the database
		repo.init();
	});

	describe("appendSkill and listSkills", () => {
		it("appends a skill and retrieves it", () => {
			const skillInsert: SkillInsert = {
				id: "skill-1",
				name: "test-skill",
				version: "0.1.0",
				status: "draft",
			};

			const inserted = repo.appendSkill(skillInsert);

			assert.equal(inserted.id, "skill-1");
			assert.equal(inserted.name, "test-skill");
			assert.equal(inserted.version, "0.1.0");
			assert.equal(inserted.status, "draft");
			assert.ok(inserted.createdAt);
			assert.ok(inserted.updatedAt);

			const skills = repo.listSkills();
			assert.equal(skills.length, 1);
			assert.equal(skills[0].id, "skill-1");
		});

		it("listSkills returns skills ordered by updated_at DESC", () => {
			repo.appendSkill({
				id: "skill-1",
				name: "skill-one",
				version: "0.1.0",
				status: "draft",
			});

			// Small delay to ensure different timestamps
			const delay = (ms: number) =>
				new Promise((resolve) => setTimeout(resolve, ms));

			return delay(10).then(() => {
				repo.appendSkill({
					id: "skill-2",
					name: "skill-two",
					version: "0.2.0",
					status: "draft",
				});

				const skills = repo.listSkills();
				assert.equal(skills.length, 2);
				// Most recent should be first (DESC order)
				assert.equal(skills[0].id, "skill-2");
				assert.equal(skills[1].id, "skill-1");
			});
		});

		it("emits lab_write event when appending skill", () => {
			const eventsPath = join(tempDir, "events.jsonl");

			repo.appendSkill({
				id: "skill-1",
				name: "test-skill",
				version: "0.1.0",
				status: "draft",
			});

			assert.ok(existsSync(eventsPath));
			const eventsContent = readFileSync(eventsPath, "utf-8");
			const events = eventsContent
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));

			const labWriteEvents = events.filter((e) => e.kind === "lab_write");
			assert.ok(labWriteEvents.length > 0);

			const skillEvent = labWriteEvents.find(
				(e) => e.payload.table === "skills" && e.payload.operation === "insert",
			);
			assert.ok(skillEvent, "Should have lab_write event for skills table");
			assert.equal(skillEvent.payload.rowId, "skill-1");
		});
	});

	describe("appendSource and listSources", () => {
		it("appends a source and retrieves it", () => {
			const sourceInsert: SourceInsert = {
				id: "source-1",
				kind: "markdown",
				path: "/path/to/file.md",
			};

			const inserted = repo.appendSource(sourceInsert);

			assert.equal(inserted.id, "source-1");
			assert.equal(inserted.kind, "markdown");
			assert.equal(inserted.path, "/path/to/file.md");
			assert.ok(inserted.addedAt);
			assert.equal(inserted.status, "pending");

			const sources = repo.listSources();
			assert.equal(sources.length, 1);
			assert.equal(sources[0].id, "source-1");
		});

		it("emits lab_write event when appending source", () => {
			const eventsPath = join(tempDir, "events.jsonl");

			repo.appendSource({
				id: "source-1",
				kind: "pdf",
				path: "/path/to/file.pdf",
			});

			assert.ok(existsSync(eventsPath));
			const eventsContent = readFileSync(eventsPath, "utf-8");
			const events = eventsContent
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));

			const sourceEvent = events.find(
				(e) =>
					e.kind === "lab_write" &&
					e.payload.table === "sources" &&
					e.payload.operation === "insert",
			);
			assert.ok(sourceEvent, "Should have lab_write event for sources table");
		});
	});

	describe("appendDigest and listDigests", () => {
		it("appends a digest and retrieves it", () => {
			// First insert a source
			repo.appendSource({
				id: "source-1",
				kind: "markdown",
				path: "/path/to/file.md",
			});

			const digestInsert: DigestInsert = {
				id: "digest-1",
				sourceId: "source-1",
				body: "digest content",
			};

			const inserted = repo.appendDigest(digestInsert);

			assert.equal(inserted.id, "digest-1");
			assert.equal(inserted.sourceId, "source-1");
			assert.equal(inserted.body, "digest content");
			assert.ok(inserted.generatedAt);

			const digests = repo.listDigests();
			assert.equal(digests.length, 1);
			assert.equal(digests[0].id, "digest-1");
		});

		it("listDigests filters by sourceId when provided", () => {
			repo.appendSource({
				id: "source-1",
				kind: "markdown",
				path: "/path/to/file1.md",
			});
			repo.appendSource({
				id: "source-2",
				kind: "pdf",
				path: "/path/to/file2.pdf",
			});

			repo.appendDigest({
				id: "digest-1",
				sourceId: "source-1",
				body: "digest for source 1",
			});
			repo.appendDigest({
				id: "digest-2",
				sourceId: "source-2",
				body: "digest for source 2",
			});
			repo.appendDigest({
				id: "digest-3",
				sourceId: "source-1",
				body: "another digest for source 1",
			});

			const allDigests = repo.listDigests();
			assert.equal(allDigests.length, 3);

			const source1Digests = repo.listDigests("source-1");
			assert.equal(source1Digests.length, 2);
			assert.ok(source1Digests.every((d) => d.sourceId === "source-1"));

			const source2Digests = repo.listDigests("source-2");
			assert.equal(source2Digests.length, 1);
			assert.equal(source2Digests[0].sourceId, "source-2");
		});

		it("emits lab_write event when appending digest", () => {
			const eventsPath = join(tempDir, "events.jsonl");

			repo.appendSource({
				id: "source-1",
				kind: "markdown",
				path: "/path/to/file.md",
			});

			repo.appendDigest({
				id: "digest-1",
				sourceId: "source-1",
				body: "digest content",
			});

			const eventsContent = readFileSync(eventsPath, "utf-8");
			const events = eventsContent
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));

			const digestEvent = events.find(
				(e) =>
					e.kind === "lab_write" &&
					e.payload.table === "digests" &&
					e.payload.operation === "insert",
			);
			assert.ok(digestEvent, "Should have lab_write event for digests table");
		});
	});

	describe("appendRating", () => {
		it("appends a rating with valid score", () => {
			const ratingInsert: RatingInsert = {
				id: "rating-1",
				targetId: "skill-1",
				targetKind: "skill",
				score: 8,
			};

			const inserted = repo.appendRating(ratingInsert);

			assert.equal(inserted.id, "rating-1");
			assert.equal(inserted.targetId, "skill-1");
			assert.equal(inserted.targetKind, "skill");
			assert.equal(inserted.score, 8);
			assert.ok(inserted.ratedAt);
		});

		it("validates score is between 0 and 10", () => {
			assert.throws(() => {
				repo.appendRating({
					id: "rating-1",
					targetId: "skill-1",
					targetKind: "skill",
					score: -1,
				});
			}, /score must be between 0 and 10/);

			assert.throws(() => {
				repo.appendRating({
					id: "rating-2",
					targetId: "skill-1",
					targetKind: "skill",
					score: 11,
				});
			}, /score must be between 0 and 10/);
		});

		it("accepts boundary scores 0 and 10", () => {
			const rating0 = repo.appendRating({
				id: "rating-0",
				targetId: "skill-1",
				targetKind: "skill",
				score: 0,
			});
			assert.equal(rating0.score, 0);

			const rating10 = repo.appendRating({
				id: "rating-10",
				targetId: "skill-2",
				targetKind: "skill",
				score: 10,
			});
			assert.equal(rating10.score, 10);
		});

		it("emits lab_write event when appending rating", () => {
			const eventsPath = join(tempDir, "events.jsonl");

			repo.appendRating({
				id: "rating-1",
				targetId: "skill-1",
				targetKind: "skill",
				score: 8,
			});

			const eventsContent = readFileSync(eventsPath, "utf-8");
			const events = eventsContent
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));

			const ratingEvent = events.find(
				(e) =>
					e.kind === "lab_write" &&
					e.payload.table === "ratings" &&
					e.payload.operation === "insert",
			);
			assert.ok(ratingEvent, "Should have lab_write event for ratings table");
		});
	});

	describe("appendProposal and listProposals", () => {
		it("appends a proposal and retrieves it", () => {
			const proposalInsert: ProposalInsert = {
				id: "proposal-1",
				kind: "skill_promote",
				payload: '{"skillId":"skill-1","reason":"ready for production"}',
			};

			const inserted = repo.appendProposal(proposalInsert);

			assert.equal(inserted.id, "proposal-1");
			assert.equal(inserted.kind, "skill_promote");
			assert.equal(
				inserted.payload,
				'{"skillId":"skill-1","reason":"ready for production"}',
			);
			assert.ok(inserted.createdAt);
			assert.equal(inserted.status, "proposed");

			const proposals = repo.listProposals();
			assert.equal(proposals.length, 1);
			assert.equal(proposals[0].id, "proposal-1");
		});

		it("listProposals returns proposals ordered by created_at DESC", () => {
			repo.appendProposal({
				id: "proposal-1",
				kind: "manual",
				payload: '{"test":1}',
			});

			const delay = (ms: number) =>
				new Promise((resolve) => setTimeout(resolve, ms));

			return delay(10).then(() => {
				repo.appendProposal({
					id: "proposal-2",
					kind: "manual",
					payload: '{"test":2}',
				});

				const proposals = repo.listProposals();
				assert.equal(proposals.length, 2);
				// Most recent should be first (DESC order)
				assert.equal(proposals[0].id, "proposal-2");
				assert.equal(proposals[1].id, "proposal-1");
			});
		});

		it("emits lab_write event when appending proposal", () => {
			const eventsPath = join(tempDir, "events.jsonl");

			repo.appendProposal({
				id: "proposal-1",
				kind: "manual",
				payload: '{"test":true}',
			});

			const eventsContent = readFileSync(eventsPath, "utf-8");
			const events = eventsContent
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));

			const proposalEvent = events.find(
				(e) =>
					e.kind === "lab_write" &&
					e.payload.table === "bibliotecario_proposals" &&
					e.payload.operation === "insert",
			);
			assert.ok(
				proposalEvent,
				"Should have lab_write event for bibliotecario_proposals table",
			);
		});
	});
});
