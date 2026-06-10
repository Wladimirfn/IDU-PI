// bibliotecario-types.ts
// B0 PR2 T2.1: Pure type definitions for the bibliotecario lab.db tables.
// No I/O, no DB calls. Pure TypeScript types.

// Record types (full rows from the database)
export type SkillRecord = {
	id: string;
	name: string;
	version: string;
	status: "draft" | "proposed" | "active" | "archived";
	createdAt: string;
	updatedAt: string;
};

export type SourceRecord = {
	id: string;
	kind: "markdown" | "pdf" | "txt" | "code" | "external";
	path: string;
	addedAt: string;
	status: "pending" | "extracted" | "digested" | "failed";
};

export type DigestRecord = {
	id: string;
	sourceId: string;
	generatedAt: string;
	body: string;
};

export type RatingRecord = {
	id: string;
	targetId: string;
	targetKind: "skill" | "source" | "digest" | "proposal";
	score: number; // 0..10
	ratedAt: string;
};

export type ProposalRecord = {
	id: string;
	kind: string;
	payload: string; // JSON-encoded
	createdAt: string;
	status: "proposed" | "approved" | "rejected" | "deferred";
};

// Insert shapes (for creating new rows, timestamps are optional)
export type SkillInsert = {
	id: string;
	name: string;
	version: string;
	status: SkillRecord["status"];
	createdAt?: string;
	updatedAt?: string;
};

export type SourceInsert = {
	id: string;
	kind: SourceRecord["kind"];
	path: string;
	addedAt?: string;
	status?: SourceRecord["status"];
};

export type DigestInsert = {
	id: string;
	sourceId: string;
	generatedAt?: string;
	body: string;
};

export type RatingInsert = {
	id: string;
	targetId: string;
	targetKind: RatingRecord["targetKind"];
	score: number; // 0..10, validated by caller
	ratedAt?: string;
};

export type ProposalInsert = {
	id: string;
	kind: string;
	payload: string; // JSON-encoded
	createdAt?: string;
	status?: ProposalRecord["status"];
};
