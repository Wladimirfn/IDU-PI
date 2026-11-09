#!/usr/bin/env node
// Render determinista frame por frame para composiciones que exponen
// window.seek(t). Playwright captura cada cuadro como PNG y ffmpeg lo encodea.
//
// Uso:
//   node render_frames.mjs --url <file|http> --end 185 --out video.mp4 \
//     [--start 0] [--fps 30] [--crf 16] [--audio approved.mp4] \
//     [--chrome <ruta>] [--playwright <ruta a playwright/index.mjs>]
//
// Por que existe: el render completo de HyperFrames 0.9.21/0.9.25 introduce un
// parpadeo periodico de texto en ventanas quietas (e01/e12 en idupi-explainer-v2).
// El clip corto no lo muestra; solo el render completo. Este camino captura el
// estado exacto que devuelve window.seek(t), sin la ruta de chunks del renderer
// de HyperFrames, y produce el video aprobado.
//
// Requisitos: Playwright (npm i playwright) o PLAYWRIGHT_PATH, Chrome/Chromium,
// y ffmpeg en PATH. La composicion debe definir window.seek(t) y ser estable:
// mismas entradas -> mismos frames.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
}

function has(name) {
	return process.argv.includes(`--${name}`);
}

const url = arg("url");
const out = arg("out");
const end = Number(arg("end", NaN));
const start = Number(arg("start", 0));
const fps = Number(arg("fps", 30));
const crf = String(arg("crf", 16));
const audio = arg("audio");

if (!url || !out || !Number.isFinite(end)) {
	console.error(
		"Uso: node render_frames.mjs --url <file|http> --end <segundos> --out <mp4> " +
			"[--start 0] [--fps 30] [--crf 16] [--audio <archivo>] [--chrome <ruta>] [--playwright <ruta>]",
	);
	process.exit(1);
}

const total = Math.round((end - start) * fps);
if (total <= 0) {
	console.error("error: el rango no produce frames");
	process.exit(1);
}

/* Playwright puede venir del proyecto o de una ruta explicita (cache de npx). */
async function loadChromium() {
	const explicit = arg("playwright") || process.env.PLAYWRIGHT_PATH;
	if (explicit) {
		const mod = await import(pathToFileURL(explicit).href);
		return mod.chromium;
	}
	try {
		const mod = await import("playwright");
		return mod.chromium;
	} catch {
		console.error(
			"No encontré Playwright. Instalalo en el proyecto (npm i playwright) " +
				"o pasá --playwright <ruta a playwright/index.mjs>.",
		);
		process.exit(1);
	}
}

/* Chrome del sistema si existe; si no, Playwright usa su Chromium. */
function findChrome() {
	const explicit = arg("chrome") || process.env.CHROME_PATH;
	if (explicit && existsSync(explicit)) return explicit;
	const candidates =
		process.platform === "win32"
			? [
					"C:/Program Files/Google/Chrome/Application/chrome.exe",
					"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
				]
			: process.platform === "darwin"
				? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
				: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
	return candidates.find(existsSync);
}

function runFfmpeg(args, label) {
	return new Promise((resolve, reject) => {
		const ff = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
		ff.on("error", reject);
		ff.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${label}: ffmpeg salió con ${code}`));
		});
	});
}

const chromium = await loadChromium();
const chrome = findChrome();
const browser = await chromium.launch({
	...(chrome ? { executablePath: chrome } : {}),
	args: ["--force-device-scale-factor=1", "--hide-scrollbars", "--disable-gpu"],
});
const page = await browser.newPage({
	viewport: { width: 1920, height: 1080 },
	deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const hasSeek = await page.evaluate(() => typeof window.seek === "function");
if (!hasSeek) {
	await browser.close();
	console.error(
		"error: la página no define window.seek(t). Cargá la composición directamente " +
			"(file://.../index.html) o agregá el puente GSAP antes de usar este renderer.",
	);
	process.exit(1);
}

/* Video mudo a un temporal; si hay --audio, se muxea al final. */
const silent = audio ? join(dirname(out), `.${Date.now()}-silent.mp4`) : out;
const ff = spawn(
	"ffmpeg",
	[
		"-y",
		"-v",
		"error",
		"-f",
		"image2pipe",
		"-framerate",
		String(fps),
		"-i",
		"-",
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-crf",
		crf,
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		silent,
	],
	{ stdio: ["pipe", "inherit", "inherit"] },
);

const write = (buf) =>
	new Promise((resolve) => {
		if (ff.stdin.write(buf)) resolve();
		else ff.stdin.once("drain", resolve);
	});

ff.stdin.on("error", (error) => {
	console.error(`error escribiendo a ffmpeg: ${error.message}`);
	process.exit(1);
});

const started = Date.now();
for (let i = 0; i < total; i++) {
	const t = start + i / fps;
	await page.evaluate((tt) => window.seek(tt), t);
	const buf = await page.screenshot({ type: "png" });
	await write(buf);
	if (i > 0 && i % 300 === 0) {
		const real = (i / ((Date.now() - started) / 1000)).toFixed(1);
		const eta = ((total - i) / Number(real) / 60).toFixed(1);
		console.log(`frame ${i}/${total}  ${real} fps  ETA ${eta} min`);
	}
}

ff.stdin.end();
await browser.close();
await new Promise((resolve, reject) => {
	ff.on("close", (code) =>
		code === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${code}`)),
	);
	ff.on("error", reject);
});

if (audio) {
	console.log("muxeando audio…");
	await runFfmpeg(
		[
			"-y",
			"-v",
			"error",
			"-i",
			silent,
			"-i",
			audio,
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-shortest",
			"-movflags",
			"+faststart",
			out,
		],
		"mux",
	);
	const { rmSync } = await import("node:fs");
	rmSync(silent, { force: true });
}

console.log(
	`listo: ${total} frames en ${((Date.now() - started) / 60000).toFixed(1)} min -> ${out}`,
);
