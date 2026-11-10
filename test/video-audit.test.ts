import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	AUDIT_VERSION,
	type AuditFile,
	auditFilePath,
	buildAuditPrompt,
	collectAuditInputs,
	evaluateAudit,
	listSceneKeyframes,
	normalizeHarness,
	parseAuditReply,
	readBriefField,
} from "../src/video-audit.js";

// The artistic audit used to be prose that the authoring model approved for
// itself. These cases pin the two things that make it a real verdict: a reply
// that does not cover every scene is rejected, and an audit file that no longer
// matches the keyframes, or that the author signed, does not open the gate.

const SCENES = ["e01", "e02"];

function reply(overrides: { piece?: object; scenes?: object[] } = {}): string {
	const body = {
		piece: { intent: "delivered", became: "", variety: "pass", rhythm: "steady", capabilityGaps: [] },
		scenes: [
			{ id: "e01", verdict: "pass", failed: [], evidence: "a terminal fills the frame", fix: "" },
			{ id: "e02", verdict: "pass", failed: [], evidence: "one diagram, centred", fix: "" },
		],
		...overrides,
	};
	return `The piece reads as declared.\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
}

function project(): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-video-audit-"));
	const files: Record<string, string> = {
		"style-brief.md": "# Style Brief\n- Intent: presentation\n- Author: claude-code/fable\n- Lane: custom\n",
		"art-direction.md": "# Art Direction\n- Approved: yes\n",
		"keyframes/e00-styleboard.png": "styleboard",
		"keyframes/e01.png": "frame one",
		"keyframes/e02.png": "frame two",
	};
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, "utf8");
	}
	return dir;
}

function writeAudit(dir: string, change: (audit: AuditFile) => void = () => {}): void {
	const parsed = parseAuditReply(reply(), SCENES);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) return;
	const audit: AuditFile = {
		version: AUDIT_VERSION,
		createdAt: "2026-11-10T00:00:00.000Z",
		intent: "presentation",
		author: "claude-code/fable",
		auditor: { profile: "consult-gemini38", harness: "antigravity", model: "gemini", runId: "IDU-test" },
		inputs: collectAuditInputs(dir, SCENES),
		...parsed.reply,
	};
	change(audit);
	const path = auditFilePath(dir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(audit), "utf8");
}

function withProject(run: (dir: string) => void): void {
	const dir = project();
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("listSceneKeyframes returns the scenes and leaves the styleboard out", () => {
	withProject((dir) => assert.deepEqual(listSceneKeyframes(dir), SCENES));
});

test("parseAuditReply accepts a verdict that covers every scene", () => {
	const parsed = parseAuditReply(reply(), SCENES);
	assert.equal(parsed.ok, true);
	if (parsed.ok) assert.equal(parsed.reply.scenes.length, 2);
});

test("parseAuditReply rejects a verdict that skips a scene", () => {
	const parsed = parseAuditReply(
		reply({ scenes: [{ id: "e01", verdict: "pass", failed: [], evidence: "x", fix: "" }] }),
		SCENES,
	);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.match(parsed.error, /no cubre: e02/);
});

test("parseAuditReply rejects a verdict outside pass, revise, block", () => {
	const parsed = parseAuditReply(
		reply({
			scenes: [
				{ id: "e01", verdict: "looks fine", failed: [], evidence: "x", fix: "" },
				{ id: "e02", verdict: "pass", failed: [], evidence: "x", fix: "" },
			],
		}),
		SCENES,
	);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.match(parsed.error, /veredicto inválido en e01/);
});

test("parseAuditReply rejects a failing verdict with no evidence", () => {
	// "block" with nothing on screen to point at is an opinion, not an audit.
	const parsed = parseAuditReply(
		reply({
			scenes: [
				{ id: "e01", verdict: "block", failed: [4], evidence: "", fix: "change it" },
				{ id: "e02", verdict: "pass", failed: [], evidence: "x", fix: "" },
			],
		}),
		SCENES,
	);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.match(parsed.error, /sin evidencia en: e01/);
});

test("parseAuditReply rejects a scene list with a non-scene entry instead of throwing", () => {
	const parsed = parseAuditReply(reply({ scenes: [null as unknown as object] }), SCENES);
	assert.equal(parsed.ok, false);
});

test("parseAuditReply rejects a scene judged twice", () => {
	// A block followed by a pass for the same id must not resolve to the pass.
	const parsed = parseAuditReply(
		reply({
			scenes: [
				{ id: "e01", verdict: "block", failed: [4], evidence: "same skeleton", fix: "close-up" },
				{ id: "e01", verdict: "pass", failed: [], evidence: "x", fix: "" },
				{ id: "e02", verdict: "pass", failed: [], evidence: "x", fix: "" },
			],
		}),
		SCENES,
	);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.match(parsed.error, /más de un veredicto: e01/);
});

test("parseAuditReply rejects a pass that lists failed checks", () => {
	const parsed = parseAuditReply(
		reply({
			scenes: [
				{ id: "e01", verdict: "pass", failed: [4, 10], evidence: "x", fix: "" },
				{ id: "e02", verdict: "pass", failed: [], evidence: "x", fix: "" },
			],
		}),
		SCENES,
	);
	assert.equal(parsed.ok, false);
	if (!parsed.ok) assert.match(parsed.error, /pass con checks fallidos: e01/);
});

test("parseAuditReply finds the verdict among other JSON blocks", () => {
	const parsed = parseAuditReply(`${reply()}\nFor reference:\n\`\`\`json\n{"example": 1}\n\`\`\`\n`, SCENES);
	assert.equal(parsed.ok, true);
});

test("parseAuditReply reads an unfenced verdict surrounded by prose", () => {
	const body = reply().split("```json")[1].split("```")[0];
	const parsed = parseAuditReply(`I used {braces} while thinking.\n${body}\nHope this helps.`, SCENES);
	assert.equal(parsed.ok, true);
});

test("parseAuditReply rejects a reply with no JSON verdict", () => {
	const parsed = parseAuditReply("Everything looks great, approved.", SCENES);
	assert.equal(parsed.ok, false);
});

test("normalizeHarness treats aliases of one harness as the same auditor", () => {
	assert.equal(normalizeHarness("claude-code/fable"), normalizeHarness("claude"));
	assert.equal(normalizeHarness("agy"), normalizeHarness("antigravity"));
	// A note after the harness must not turn it into a different auditor.
	assert.equal(normalizeHarness("opencode (model not recorded)"), "opencode");
	// A spaced spelling of a harness is still that harness.
	assert.equal(normalizeHarness("Command Code/deepseek"), normalizeHarness("commandcode"));
	assert.equal(normalizeHarness("Gentle Shell/glm"), normalizeHarness("gentle-shell"));
	assert.notEqual(normalizeHarness("claude-code/fable"), normalizeHarness("antigravity"));
});

test("readBriefField reads a bold field and ignores an empty one", () => {
	assert.equal(readBriefField("- **Author:** claude-code/fable\n", "Author"), "claude-code/fable");
	assert.equal(readBriefField("- Author:\n- Lane: custom\n", "Author"), null);
});

test("buildAuditPrompt names every keyframe and the declared intent", () => {
	const prompt = buildAuditPrompt({
		intent: "story",
		sceneIds: SCENES,
		hasScript: false,
		hasTimeline: true,
		contractPath: "/skills/visual-qa.md",
	});
	assert.match(prompt, /keyframes\/e01\.png, keyframes\/e02\.png/);
	assert.match(prompt, /declares the intent `story`/);
	assert.doesNotMatch(prompt, /guion\.md/);
});

test("evaluateAudit refuses a project nobody audited", () => {
	withProject((dir) => {
		const { errors } = evaluateAudit(dir);
		assert.match(errors.join("\n"), /falta audit\/visual-qa\.json/);
	});
});

test("evaluateAudit accepts a fresh independent audit that passes", () => {
	withProject((dir) => {
		writeAudit(dir);
		assert.deepEqual(evaluateAudit(dir), { errors: [], warnings: [] });
	});
});

test("evaluateAudit refuses an audit older than a keyframe", () => {
	withProject((dir) => {
		writeAudit(dir);
		writeFileSync(join(dir, "keyframes", "e02.png"), "frame two, redesigned", "utf8");
		assert.match(evaluateAudit(dir).errors.join("\n"), /auditoría vencida: e02/);
	});
});

test("evaluateAudit refuses an audit older than the art direction", () => {
	withProject((dir) => {
		writeAudit(dir);
		writeFileSync(join(dir, "art-direction.md"), "# Art Direction\n- Approved: yes\n- changed\n", "utf8");
		assert.match(evaluateAudit(dir).errors.join("\n"), /art-direction\.md cambió/);
	});
});

test("evaluateAudit refuses an audit made for another intent", () => {
	// The piece was judged as a presentation; relabelling it afterwards must
	// not carry the verdict over.
	withProject((dir) => {
		writeAudit(dir);
		writeFileSync(
			join(dir, "style-brief.md"),
			"# Style Brief\n- Intent: story\n- Author: claude-code/fable\n- Lane: custom\n",
			"utf8",
		);
		assert.match(evaluateAudit(dir).errors.join("\n"), /auditoría vencida: el brief declara intent `story`/);
	});
});

test("evaluateAudit refuses an audit whose author was renamed to match nobody", () => {
	withProject((dir) => {
		writeAudit(dir);
		writeFileSync(
			join(dir, "style-brief.md"),
			"# Style Brief\n- Intent: presentation\n- Author: antigravity/gemini\n- Lane: custom\n",
			"utf8",
		);
		assert.match(evaluateAudit(dir).errors.join("\n"), /no independiente/);
	});
});

test("evaluateAudit refuses an audit that covered a scene since removed", () => {
	withProject((dir) => {
		writeAudit(dir);
		rmSync(join(dir, "keyframes", "e02.png"));
		assert.match(evaluateAudit(dir).errors.join("\n"), /auditoría vencida: e02/);
	});
});

test("evaluateAudit blocks on a verdict written in another case", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.scenes[1] = { id: "e02", verdict: "BLOCK" as never, failed: [4], evidence: "same skeleton", fix: "" };
		});
		assert.match(evaluateAudit(dir).errors.join("\n"), /escena bloqueada e02/);
	});
});

test("evaluateAudit refuses an audit signed by the author's own harness", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.auditor = { profile: "audit-claude", harness: "claude", model: "opus", runId: "IDU-test" };
		});
		assert.match(evaluateAudit(dir).errors.join("\n"), /no independiente/);
	});
});

test("evaluateAudit refuses a piece that did not deliver its intent", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.piece.intent = "fell-back";
			audit.piece.became = "a narrated slide deck";
		});
		assert.match(evaluateAudit(dir).errors.join("\n"), /no cumple su intent `presentation`.*slide deck/);
	});
});

test("evaluateAudit blocks a revise that fails the repeated-skeleton check", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.scenes[1] = { id: "e02", verdict: "revise", failed: [4], evidence: "same skeleton as e01", fix: "close-up" };
		});
		const { errors } = evaluateAudit(dir);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /escena a corregir e02 \(checks 4\).*bloquea el render/);
	});
});

test("evaluateAudit blocks a revise that fails the proof check", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.scenes[0] = { id: "e01", verdict: "revise", failed: [2, 10], evidence: "a box named tests", fix: "show the run" };
		});
		assert.match(evaluateAudit(dir).errors.join("\n"), /escena a corregir e01 \(checks 2, 10\)/);
	});
});

test("evaluateAudit blocks a piece whose variety is revise", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.piece.variety = "revise";
			audit.piece.rhythm = "three scenes repeat one layout";
		});
		assert.match(evaluateAudit(dir).errors.join("\n"), /variedad: three scenes repeat one layout/);
	});
});

test("evaluateAudit reads a record whose scene has no failed list", () => {
	// A record written by another version of the command must not crash the
	// render gate; the verdict still decides.
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.scenes[1] = { id: "e02", verdict: "block", evidence: "same skeleton as e01" } as never;
		});
		assert.match(evaluateAudit(dir).errors.join("\n"), /escena bloqueada e02: same skeleton/);
	});
});

test("evaluateAudit blocks on a blocked scene and only warns on revise", () => {
	withProject((dir) => {
		writeAudit(dir, (audit) => {
			audit.scenes[0] = { id: "e01", verdict: "revise", failed: [2], evidence: "two focal points", fix: "shrink the label" };
			audit.scenes[1] = { id: "e02", verdict: "block", failed: [4], evidence: "same skeleton as e01", fix: "use a close-up" };
		});
		const { errors, warnings } = evaluateAudit(dir);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /escena bloqueada e02 \(checks 4\)/);
		assert.match(warnings.join("\n"), /a revisar e01/);
	});
});
