import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The style gate used to be prose: a full render could ship without a lane,
// without an art-direction contract and without an approved e00. These cases
// drive the shipped binary and assert the refusal happens before anything is
// rendered.
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

function project(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-style-gate-"));
	writeFileSync(
		join(dir, "index.html"),
		'<div data-composition-id="t" data-width="640" data-height="360" data-duration="5"></div>',
		"utf8",
	);
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, "utf8");
	}
	return dir;
}

function render(dir: string) {
	return spawnSync(process.execPath, [CLI, "video", "render", "--project", dir], {
		encoding: "utf8",
	});
}

function assertRefused(dir: string, pattern: RegExp) {
	try {
		const res = render(dir);
		assert.notEqual(res.status, 0, "a full render without the style gate must fail");
		assert.match(`${res.stdout ?? ""}${res.stderr ?? ""}`, pattern);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("video render refuses a full render with no style-brief.md", () => {
	assertRefused(project({}), /falta style-brief\.md/);
});

test("video render refuses a brief that never declares the intent", () => {
	// The lane names a technique. Without the intent every piece is produced and
	// judged as a narrated explainer, so a complete brief minus `Intent:` fails.
	assertRefused(
		project({
			"style-brief.md": "# Style Brief\n- Lane: vector-explainer\n- Approved e00: yes\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the intent check fails first",
		}),
		/no declara `Intent:`/,
	);
});

test("video render refuses an intent that is not in video-lanes.json", () => {
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Intent: explainer\n- Lane: vector-explainer\n- Approved e00: yes\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the intent check fails first",
		}),
		/intent desconocido "explainer".*presentation, story, experience/,
	);
});

test("video render does not read an empty intent from the next line", () => {
	// "- Intent:" with nothing after it is a missing decision. The value must
	// come from the same line, never from whatever the next line starts with.
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Intent:\nstory notes go here\n- Lane: vector-explainer\n- Approved e00: yes\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the intent check fails first",
		}),
		/no declara `Intent:`/,
	);
});

test("video render does not read the intent from a fenced template", () => {
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Lane: vector-explainer\n- Approved e00: yes\n\n```markdown\n- Intent: presentation\n```\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the intent check fails first",
		}),
		/no declara `Intent:`/,
	);
});

test("video render reports an unfilled or non-ASCII intent whole", () => {
	// The refusal must name what was written, not a truncated prefix of it.
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Intent: presentación\n- Lane: vector-explainer\n- Approved e00: yes\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the intent check fails first",
		}),
		/intent desconocido "presentación"/,
	);
});

test("video render refuses a lane that is not in video-lanes.json", () => {
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Intent: presentation\n- Lane: not-a-lane\n- Approved e00: yes\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the lane check fails first",
		}),
		/lane desconocida "not-a-lane"/,
	);
});

test("video render refuses an unapproved e00", () => {
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Intent: story\n- Lane: vector-explainer\n- Approved e00: no\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the approval check fails first",
		}),
		/e00 no aprobado/,
	);
});

test("video render refuses a missing art-direction contract", () => {
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- Intent: experience\n- Lane: vector-explainer\n- Approved e00: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the art-direction check fails first",
		}),
		/falta art-direction\.md/,
	);
});

test("video render reads a markdown-formatted brief", () => {
	// "- **Intent:** ...", "- **Lane:** ..." and "- **Approved e00:** yes" must
	// parse; the refusal has to be the missing contract, not a formatting false
	// negative.
	assertRefused(
		project({
			"style-brief.md":
				"# Style Brief\n- **Intent:** `Presentation`; the viewer must be able to restate it.\n- **Lane:** vector-explainer with a 2.5D finish.\n- **Approved e00:** yes (2026-11-09).\n",
			"keyframes/e00-styleboard.png": "not inspected: the art-direction check fails first",
		}),
		/falta art-direction\.md/,
	);
});
