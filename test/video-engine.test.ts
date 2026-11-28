import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapTimeToFrame, resolveVideoEngine, type VideoLanesDocument } from "../src/video-engine.js";
import { probeVideoToolchain } from "../src/video-binaries.js";

const LANES: VideoLanesDocument = {
	engines: {
		hyperframes: { status: "available" },
		blender: { status: "available" },
		remotion: { status: "available" },
		manim: { status: "available" },
	},
	lanes: {
		"vector-explainer": { primaryEngine: "hyperframes" },
		"motion-graphics": { primaryEngine: "remotion" },
		"blender-3d": { primaryEngine: "blender" },
		"manim-explainer": { primaryEngine: "manim" },
	},
};

function makeProject(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-video-engine-"));
	for (const [rel, content] of Object.entries(files)) {
		const full = join(dir, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content, "utf8");
	}
	return dir;
}

test("resolveVideoEngine respects explicit Engine field including markdown formatting", () => {
	const dir = makeProject({
		"style-brief.md":
			"# Style Brief\n- Intent: experience\n- Lane: custom\n- **Engine:** `blender` (Cycles RTX)\n",
	});
	try {
		const res = resolveVideoEngine(dir, LANES);
		assert.equal(res.engine, "blender");
		assert.equal(res.source, "brief");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveVideoEngine rejects unknown Engine values", () => {
	const dir = makeProject({
		"style-brief.md": "# Style Brief\n- Intent: presentation\n- Lane: custom\n- Engine: aftereffects\n",
	});
	try {
		const res = resolveVideoEngine(dir, LANES);
		assert.equal(res.engine, null);
		assert.equal(res.source, "invalid");
		assert.match(res.error ?? "", /engine desconocido "aftereffects"/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveVideoEngine routes new projects by Lane primaryEngine", () => {
	for (const [lane, expected] of [
		["blender-3d", "blender"],
		["manim-explainer", "manim"],
		["motion-graphics", "remotion"],
		["vector-explainer", "hyperframes"],
	] as const) {
		const dir = makeProject({
			"style-brief.md": `# Style Brief\n- Intent: presentation\n- Lane: ${lane}\n`,
		});
		try {
			const res = resolveVideoEngine(dir, LANES);
			assert.equal(res.engine, expected);
			assert.equal(res.source, "lane");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test("resolveVideoEngine keeps legacy HyperFrames HTML compositions on hyperframes when Engine is omitted", () => {
	const dir = makeProject({
		"style-brief.md": "# Style Brief\n- Intent: presentation\n- Lane: motion-graphics\n",
		"index.html": '<div data-composition-id="legacy" data-duration="10"></div>',
	});
	try {
		const res = resolveVideoEngine(dir, LANES);
		assert.equal(res.engine, "hyperframes");
		assert.equal(res.source, "legacy-hyperframes");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("mapTimeToFrame clamps frame indices inside total composition range", () => {
	assert.equal(mapTimeToFrame(0, 30, 5), 0);
	assert.equal(mapTimeToFrame(2.5, 30, 5), 75);
	assert.equal(mapTimeToFrame(9.0, 30, 5), 149);
});

test("probeVideoToolchain returns complete toolchain probe shape", () => {
	const dir = makeProject({});
	try {
		const probe = probeVideoToolchain(dir);
		assert.ok("ffmpeg" in probe);
		assert.ok("blender" in probe);
		assert.ok("remotion" in probe);
		assert.ok("manim" in probe);
		assert.ok("iduframe" in probe);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
