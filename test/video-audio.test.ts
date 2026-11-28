import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	AUDIO_QA_VERSION,
	type AudioQaFile,
	audioQaFilePath,
	checkAudioGate,
	collectAudioQaInputs,
	evaluateAudioQa,
	hasDeclaredAudioClips,
	listDeclaredAudioTags,
} from "../src/video-audio.js";

function sha(text: string): string {
	return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function project(extra: Record<string, string> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-video-audio-"));
	const files: Record<string, string> = {
		"index.html":
			'<div data-composition-id="t" data-duration="5"></div>\n' +
			'<audio id="bgm" src="assets/soundtrack.wav" data-start="0" data-duration="5" data-volume="0.11"></audio>\n' +
			'<audio id="vo1" src="assets/voz/e01.wav" data-start="0.5" data-duration="3.0"></audio>\n',
		"guion.md": "### e01 · Demo\nHola mundo.\n",
		"assets/voz/e01.wav": "fake-wav-one",
		"assets/soundtrack.wav": "fake-bgm",
		"assets/partitura.json": '{"titulo":"P","tempo":80,"progresion":["Am"]}',
		...extra,
	};
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, "utf8");
	}
	return dir;
}

function writeAudioQa(dir: string, change: (qa: AudioQaFile) => void = () => {}): void {
	const qa: AudioQaFile = {
		version: AUDIO_QA_VERSION,
		createdAt: "2026-11-17T00:00:00.000Z",
		sttEngine: "whisper:openai/whisper-base",
		inputs: collectAudioQaInputs(dir),
		scenes: [
			{
				id: "e01",
				clipId: "vo1",
				src: "assets/voz/e01.wav",
				verdict: "pass",
				errors: [],
				warnings: [],
			},
		],
		musicErrors: [],
		musicWarnings: [],
	};
	change(qa);
	const out = audioQaFilePath(dir);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(qa, null, 2), "utf8");
}

test("listDeclaredAudioTags parses voN and bgm regardless of attribute order", () => {
	const dir = project();
	try {
		assert.equal(hasDeclaredAudioClips(dir), true);
		const parsed = listDeclaredAudioTags(dir);
		assert.equal(parsed.hasBgm, true);
		assert.equal(parsed.bgmSrc, "assets/soundtrack.wav");
		assert.deepEqual(parsed.voices, [{ id: "vo1", src: "assets/voz/e01.wav" }]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("hasDeclaredAudioClips returns false for silent visual compositions", () => {
	const dir = project({
		"index.html": '<div data-composition-id="silent" data-duration="5"></div>',
	});
	try {
		assert.equal(hasDeclaredAudioClips(dir), false);
		assert.equal(checkAudioGate(dir, false, () => 1), 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("evaluateAudioQa accepts fresh passing audio-qa.json and flags stale voice or guion", () => {
	const dir = project();
	try {
		writeAudioQa(dir);
		const fresh = evaluateAudioQa(dir);
		assert.equal(fresh.stale, false);
		assert.deepEqual(fresh.errors, []);

		// Changing the voice WAV invalidates audio-qa.json.
		writeFileSync(join(dir, "assets", "voz", "e01.wav"), "fake-wav-changed", "utf8");
		const staleWav = evaluateAudioQa(dir);
		assert.equal(staleWav.stale, true);
		assert.match(staleWav.errors.join("\n"), /assets\/voz\/e01\.wav cambió/);

		writeAudioQa(dir);
		assert.equal(evaluateAudioQa(dir).stale, false);

		// Changing guion.md invalidates audio-qa.json.
		writeFileSync(join(dir, "guion.md"), "### e01 · Demo\nTexto distinto.\n", "utf8");
		assert.equal(evaluateAudioQa(dir).stale, true);
		assert.equal(sha("a") !== sha("b"), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("evaluateAudioQa blocks when a scene has errors or hallucination verdict", () => {
	const dir = project();
	try {
		writeAudioQa(dir, (qa) => {
			qa.scenes[0].verdict = "block";
			qa.scenes[0].errors = ['hallucinated tail words after script ended: "es similia"'];
		});
		const res = evaluateAudioQa(dir);
		assert.equal(res.stale, false);
		assert.match(res.errors.join("\n"), /voz e01: hallucinated tail words/);
		assert.equal(checkAudioGate(dir, false, () => 0), 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("checkAudioGate runs the validator when audio-qa.json is missing or stale", () => {
	const dir = project();
	try {
		let calls = 0;
		const status = checkAudioGate(dir, false, (target) => {
			calls++;
			writeAudioQa(target);
			return 0;
		});
		assert.equal(calls, 1);
		assert.equal(status, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("listDeclaredAudioTags reads audio-manifest.json when index.html is absent", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-video-audio-manifest-"));
	try {
		writeFileSync(
			join(dir, "audio-manifest.json"),
			JSON.stringify({
				voices: [{ id: "vo1", src: "voz/e01.wav", start: 0.5, duration: 2.0 }],
				bgm: { src: "soundtrack.wav", start: 0, duration: 10, volume: 0.12 },
			}),
			"utf8",
		);
		assert.equal(hasDeclaredAudioClips(dir), true);
		const parsed = listDeclaredAudioTags(dir);
		assert.equal(parsed.hasBgm, true);
		assert.equal(parsed.bgmSrc, "soundtrack.wav");
		assert.deepEqual(parsed.voices, [{ id: "vo1", src: "voz/e01.wav" }]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
