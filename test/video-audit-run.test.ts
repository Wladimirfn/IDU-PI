import test from "node:test";
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
import {
	runVideoAuditCore,
	type AuditDelegateResult,
	type VideoAuditOptions,
} from "../src/video-audit.js";

const VALID_REPLY = JSON.stringify(
	{
		piece: {
			intent: "delivered",
			became: "",
			variety: "pass",
			rhythm: "steady",
			capabilityGaps: [],
		},
		scenes: [
			{ id: "e01", verdict: "pass", failed: [], evidence: "beat reads", fix: "" },
			{ id: "e02", verdict: "pass", failed: [], evidence: "beat reads", fix: "" },
		],
	},
	null,
	2,
);

function project(): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-audit-run-"));
	mkdirSync(join(dir, "keyframes"), { recursive: true });
	writeFileSync(
		join(dir, "style-brief.md"),
		"# Style Brief\n- Intent: presentation\n- Author: opencode/deepseek-v4.1-flash\n",
		"utf8",
	);
	writeFileSync(join(dir, "art-direction.md"), "# Art Direction\n", "utf8");
	writeFileSync(join(dir, "keyframes", "e01.png"), "one", "utf8");
	writeFileSync(join(dir, "keyframes", "e02.png"), "two", "utf8");
	return dir;
}

function result(overrides: Partial<AuditDelegateResult> = {}): AuditDelegateResult {
	return {
		status: "completed",
		summary: VALID_REPLY,
		logPath: "/tmp/audit.log",
		harness: "antigravity",
		model: "fake-model",
		runId: "run-1",
		...overrides,
	};
}

function options(overrides: Partial<VideoAuditOptions> = {}): VideoAuditOptions {
	return {
		validIntentIds: ["presentation"],
		auditProfiles: ["fake-auditor"],
		profiles: { "fake-auditor": { harness: "antigravity" } },
		resolveContractPath: () => "/fake/visual-qa.md",
		delegate: async () => result(),
		checkAuditGate: () => 0,
		log: () => {},
		error: () => {},
		...overrides,
	};
}

test("video audit refuses a worker that did not complete", async () => {
	const dir = project();
	const errors: string[] = [];
	try {
		const code = await runVideoAuditCore(
			dir,
			"fake-auditor",
			undefined,
			options({
				delegate: async () => result({ status: "failed", summary: "" }),
				error: (message) => errors.push(message),
			}),
		);
		assert.equal(code, 1);
		assert.match(errors.join("\n"), /terminó en "failed"/);
		assert.equal(existsSync(join(dir, "audit", "visual-qa.json")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("video audit saves an unreadable reply and writes no verdict", async () => {
	const dir = project();
	const errors: string[] = [];
	try {
		const code = await runVideoAuditCore(
			dir,
			"fake-auditor",
			undefined,
			options({
				delegate: async () => result({ summary: "Everything looks great, approved." }),
				error: (message) => errors.push(message),
			}),
		);
		assert.equal(code, 1);
		const raw = join(dir, "audit", "visual-qa.raw.txt");
		assert.ok(existsSync(raw), "the raw reply must be kept for diagnosis");
		assert.equal(readFileSync(raw, "utf8"), "Everything looks great, approved.");
		assert.equal(existsSync(join(dir, "audit", "visual-qa.json")), false);
		assert.match(errors.join("\n"), /no trae un bloque JSON/);
		assert.match(errors.join("\n"), /visual-qa\.raw\.txt/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("video audit refuses when the worker cannot be dispatched", async () => {
	const dir = project();
	const errors: string[] = [];
	try {
		const code = await runVideoAuditCore(
			dir,
			"fake-auditor",
			undefined,
			options({
				delegate: async () => {
					throw new Error("spawn ENOENT");
				},
				error: (message) => errors.push(message),
			}),
		);
		assert.equal(code, 1);
		assert.match(errors.join("\n"), /no se pudo despachar el auditor: spawn ENOENT/);
		assert.equal(existsSync(join(dir, "audit", "visual-qa.json")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("video audit writes the verdict and reaches the gate on a valid reply", async () => {
	const dir = project();
	const logs: string[] = [];
	try {
		const code = await runVideoAuditCore(
			dir,
			"fake-auditor",
			undefined,
			options({ log: (message) => logs.push(message) }),
		);
		assert.equal(code, 0);
		const file = join(dir, "audit", "visual-qa.json");
		assert.ok(existsSync(file));
		const audit = JSON.parse(readFileSync(file, "utf8")) as {
			intent: string;
			author: string;
			auditor: { harness: string; profile: string };
			scenes: Array<{ id: string }>;
		};
		assert.equal(audit.intent, "presentation");
		assert.equal(audit.author, "opencode/deepseek-v4.1-flash");
		assert.equal(audit.auditor.harness, "antigravity");
		assert.equal(audit.auditor.profile, "fake-auditor");
		assert.deepEqual(
			audit.scenes.map((scene) => scene.id),
			["e01", "e02"],
		);
		assert.match(logs.join("\n"), /veredicto en/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
