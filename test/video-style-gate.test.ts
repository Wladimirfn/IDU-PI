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

test("video render refuses a lane that is not in video-lanes.json", () => {
	assertRefused(
		project({
			"style-brief.md": "# Style Brief\n- Lane: not-a-lane\n- Approved e00: yes\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the lane check fails first",
		}),
		/lane desconocida "not-a-lane"/,
	);
});

test("video render refuses an unapproved e00", () => {
	assertRefused(
		project({
			"style-brief.md": "# Style Brief\n- Lane: vector-explainer\n- Approved e00: no\n",
			"art-direction.md": "# Art Direction\n- Approved: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the approval check fails first",
		}),
		/e00 no aprobado/,
	);
});

test("video render refuses a missing art-direction contract", () => {
	assertRefused(
		project({
			"style-brief.md": "# Style Brief\n- Lane: vector-explainer\n- Approved e00: yes\n",
			"keyframes/e00-styleboard.png": "not inspected: the art-direction check fails first",
		}),
		/falta art-direction\.md/,
	);
});
