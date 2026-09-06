import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type {
	SkillRecord,
	SourceRecord,
	DigestRecord,
	RatingRecord,
	ProposalRecord,
	SkillInsert,
	SourceInsert,
	DigestInsert,
	RatingInsert,
	ProposalInsert,
} from "../src/bibliotecario-types.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

describe("T2.1 — bibliotecario-types module", () => {
	it("exports record types that compile", () => {
		const skill: SkillRecord = {
			id: "skill-1",
			name: "test-skill",
			version: "0.1.0",
			status: "draft",
			createdAt: "2026-06-10T00:00:00.000Z",
			updatedAt: "2026-06-10T00:00:00.000Z",
		};
		assert.equal(skill.id, "skill-1");
		assert.equal(skill.status, "draft");
	});

	it("exports insert shapes that compile", () => {
		const skillInsert: SkillInsert = {
			id: "skill-2",
			name: "test-skill-2",
			version: "0.2.0",
			status: "draft",
		};
		assert.equal(skillInsert.id, "skill-2");
	});

	it("exports source types that compile", () => {
		const source: SourceRecord = {
			id: "source-1",
			kind: "markdown",
			path: "/path/to/file.md",
			addedAt: "2026-06-10T00:00:00.000Z",
			status: "pending",
		};
		assert.equal(source.id, "source-1");

		const sourceInsert: SourceInsert = {
			id: "source-2",
			kind: "pdf",
			path: "/path/to/file.pdf",
		};
		assert.equal(sourceInsert.id, "source-2");
	});

	it("exports digest types that compile", () => {
		const digest: DigestRecord = {
			id: "digest-1",
			sourceId: "source-1",
			generatedAt: "2026-06-10T00:00:00.000Z",
			body: "digest content",
		};
		assert.equal(digest.id, "digest-1");

		const digestInsert: DigestInsert = {
			id: "digest-2",
			sourceId: "source-2",
			body: "another digest",
		};
		assert.equal(digestInsert.id, "digest-2");
	});

	it("exports rating types that compile", () => {
		const rating: RatingRecord = {
			id: "rating-1",
			targetId: "skill-1",
			targetKind: "skill",
			score: 8,
			ratedAt: "2026-06-10T00:00:00.000Z",
		};
		assert.equal(rating.score, 8);

		const ratingInsert: RatingInsert = {
			id: "rating-2",
			targetId: "source-1",
			targetKind: "source",
			score: 5,
		};
		assert.equal(ratingInsert.score, 5);
	});

	it("exports proposal types that compile", () => {
		const proposal: ProposalRecord = {
			id: "proposal-1",
			kind: "skill_promote",
			payload: '{"skillId":"skill-1"}',
			createdAt: "2026-06-10T00:00:00.000Z",
			status: "proposed",
		};
		assert.equal(proposal.kind, "skill_promote");

		const proposalInsert: ProposalInsert = {
			id: "proposal-2",
			kind: "manual",
			payload: '{"test":true}',
		};
		assert.equal(proposalInsert.kind, "manual");
	});

	it("types are reachable from LabDbRepository context", () => {
		// This test verifies that the types can be imported in the same
		// context as LabDbRepository, ensuring they work together.
		const repo = new LabDbRepository(":memory:");
		assert.ok(repo);

		// Type-only assertion: these should compile without error
		const skillInsert: SkillInsert = {
			id: "skill-test",
			name: "test",
			version: "0.0.0",
			status: "draft",
		};
		assert.ok(skillInsert);
	});
});
