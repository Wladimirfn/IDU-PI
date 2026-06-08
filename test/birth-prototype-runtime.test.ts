import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	handleBirthPrototypeMaster,
	type BirthPrototypeDraftInput,
} from "../src/birth-prototype-runtime.js";
import { readBirthArtifact } from "../src/birth-artifacts.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-birth-proto-"));
	mkdirSync(join(root, "birth"), { recursive: true });
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

const validDraft: BirthPrototypeDraftInput = {
	productIntent:
		"Idu-pi supervises projects from CLI/MCP/Telegram, never implements without approval.",
	visualStyle:
		"Plain text CLI/TUI panels with status tables; no graphical UI required.",
	layoutBase: "Single CLI/MCP/Telegram interface; Project Core, Master Plan, and Birth artifacts drive every interaction.",
	stackRecommendation: {
		packageManager: "pnpm",
		runtime: "Node 20+ / TypeScript 5.x",
	},
	alternativesDiscarded: ["npm", "yarn"],
	dependencies: {
		allowed: ["@modelcontextprotocol/sdk", "node:test", "typescript"],
		risky: [],
	},
	motionRules: ["respect prefers-reduced-motion"],
	uiPatterns: ["status-table", "advisory-only-envelope"],
	forbiddenPatterns: [
		"inline onclick handlers",
		"auto-push to git remote",
		"auto-apply AgentLab recommendations",
		"telegram as sole interface",
	],
	bibliotecarioReferences: ["README.md", "docs/architecture.md"],
	scalingRules: [
		"keep stateRoot isolated from repo real",
		"keep AgentLab audit-only",
		"keep MCP advisory-only",
	],
};

test("handleBirthPrototypeMaster draft creates a draft in stateRoot/birth/prototype-master.json", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const result = handleBirthPrototypeMaster({
			action: "draft",
			projectId: "idu-pi",
			stateRoot,
			draft: validDraft,
		});
		assert.equal(result.kind, "birth_prototype_master");
		assert.equal(result.prototype.status, "draft");
		assert.equal(result.prototype.projectId, "idu-pi");
		assert.ok(result.prototype.productIntent.length > 0);
		const stored = readBirthArtifact<{ status: string }>(
			stateRoot,
			"prototype-master",
		);
		assert.equal(stored?.status, "draft");
	} finally {
		cleanup();
	}
});

test("handleBirthPrototypeMaster review moves status to reviewed", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		handleBirthPrototypeMaster({
			action: "draft",
			projectId: "idu-pi",
			stateRoot,
			draft: validDraft,
		});
		const reviewed = handleBirthPrototypeMaster({
			action: "review",
			projectId: "idu-pi",
			stateRoot,
		});
		assert.equal(reviewed.prototype.status, "reviewed");
	} finally {
		cleanup();
	}
});

test("handleBirthPrototypeMaster approve sets status=approved and approver", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		handleBirthPrototypeMaster({
			action: "draft",
			projectId: "idu-pi",
			stateRoot,
			draft: validDraft,
		});
		handleBirthPrototypeMaster({
			action: "review",
			projectId: "idu-pi",
			stateRoot,
		});
		const approved = handleBirthPrototypeMaster({
			action: "approve",
			projectId: "idu-pi",
			stateRoot,
			approvedBy: "elmas",
		});
		assert.equal(approved.prototype.status, "approved");
		assert.equal(approved.prototype.approvedBy, "elmas");
		assert.ok(approved.prototype.approvedAt);
	} finally {
		cleanup();
	}
});

test("handleBirthPrototypeMaster approve from draft status is blocked", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		handleBirthPrototypeMaster({
			action: "draft",
			projectId: "idu-pi",
			stateRoot,
			draft: validDraft,
		});
		assert.throws(
			() =>
				handleBirthPrototypeMaster({
					action: "approve",
					projectId: "idu-pi",
					stateRoot,
					approvedBy: "elmas",
				}),
			/cannot approve a prototype in status 'draft'/i,
		);
	} finally {
		cleanup();
	}
});

test("handleBirthPrototypeMaster rejects draft with missing required fields", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		assert.throws(
			() =>
				handleBirthPrototypeMaster({
					action: "draft",
					projectId: "idu-pi",
					stateRoot,
					draft: {
						...validDraft,
						productIntent: "",
						scalingRules: [],
					},
				}),
			/prototype failed validation/i,
		);
	} finally {
		cleanup();
	}
});
