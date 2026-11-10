#!/usr/bin/env node
// Render determinista frame por frame para composiciones que exponen
// window.seek(t). Playwright captura cada cuadro como PNG y ffmpeg lo encodea.
//
// Uso:
//   node render_frames.mjs --url <file|http> --end 185 --out video.mp4 \
//     [--start 0] [--fps 30] [--crf 16] [--audio approved.mp4] \
//     [--width 1920] [--height 1080] [--gpu] [--angle d3d11] \
//     [--chrome <ruta>] [--playwright <ruta a playwright/index.mjs>]
//
// Resolucion: si no se pasan --width/--height, se leen data-width y
// data-height del elemento con data-composition-id. Asi un proyecto 9:16
// renderiza a su propio tamano sin tocar el script.
//
// Determinismo: por defecto usa render por software (--disable-gpu). --gpu
// acelera WebGL/3D pero puede variar entre maquinas; validalo con el gate de
// motion antes de usarlo para entrega.
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
const widthArg = Number(arg("width", NaN));
const heightArg = Number(arg("height", NaN));
const useGpu = has("gpu");
const angle = arg("angle");

if (!url || !out || !Number.isFinite(end)) {
	console.error(
		"Uso: node render_frames.mjs --url <file|http> --end <segundos> --out <mp4> " +
			"[--start 0] [--fps 30] [--crf 16] [--audio <archivo>] " +
			"[--width 1920] [--height 1080] [--gpu] [--angle d3d11] " +
			"[--chrome <ruta>] [--playwright <ruta>]",
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
const launchArgs = ["--force-device-scale-factor=1", "--hide-scrollbars"];
if (useGpu) {
	launchArgs.push("--use-gl=angle");
	if (angle) launchArgs.push(`--use-angle=${angle}`);
} else {
	launchArgs.push("--disable-gpu");
}
const browser = await chromium.launch({
	...(chrome ? { executablePath: chrome } : {}),
	args: launchArgs,
});
const page = await browser.newPage({
	viewport: {
		width: Number.isFinite(widthArg) ? widthArg : 1920,
		height: Number.isFinite(heightArg) ? heightArg : 1080,
	},
	deviceScaleFactor: 1,
});
await page.goto(url, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

/* La composicion declara su tamano; el renderer lo respeta salvo override. */
const declared = await page.evaluate(() => {
	const el = document.querySelector("[data-composition-id]");
	if (!el) return null;
	const w = Number(el.getAttribute("data-width"));
	const h = Number(el.getAttribute("data-height"));
	return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
});
const width = Number.isFinite(widthArg) ? widthArg : declared?.width ?? 1920;
const height = Number.isFinite(heightArg) ? heightArg : declared?.height ?? 1080;
if (width <= 0 || height <= 0 || width % 2 !== 0 || height % 2 !== 0) {
	await browser.close();
	console.error(
		`error: resolución inválida ${width}x${height}. yuv420p exige dimensiones ` +
			"positivas y pares; ajustá --width/--height o data-width/data-height.",
	);
	process.exit(1);
}
await page.setViewportSize({ width, height });
console.log(`resolución: ${width}x${height}${useGpu ? " (gpu)" : " (software)"}`);

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

/* Attach before the loop: a short render can finish ffmpeg before the final
   await attaches its listeners, leaving an unsettled top-level await. */
const ffDone = new Promise((resolve, reject) => {
	ff.on("close", (code) =>
		code === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${code}`)),
	);
	ff.on("error", reject);
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
await ffDone;

if (audio) {
	console.log("muxeando audio…");
	/* Si el audio aprobado ya es AAC, se copia sin generación extra. */
	const audioExt = audio.split(".").pop()?.toLowerCase() ?? "";
	const audioCodec =
		audioExt === "mp4" || audioExt === "m4a" || audioExt === "aac"
			? ["-c:a", "copy"]
			: ["-c:a", "aac", "-b:a", "192k"];
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
			...audioCodec,
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
