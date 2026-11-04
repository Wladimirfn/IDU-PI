#!/usr/bin/env node
// Hoja de contacto: muchos fotogramas en una sola imagen, para revisar un video
// de un vistazo (revision.md §2 y §3). Funciona con cualquier motor de render
// porque trabaja sobre el resultado: un MP4 o una carpeta de imágenes.
//
//   node hoja-de-contacto.mjs borrador.mp4 [--cada 4 | --tiempos 1.5,8,12.2]
//   node hoja-de-contacto.mjs keyframes/
//   opciones: --columnas 4  --ancho 480  --salida hoja.png
//
// Requiere ffmpeg y ffprobe en el PATH. Escribe también <salida>.txt con qué
// celda es qué segundo o qué archivo, porque la hoja no lleva rótulos (dibujar
// texto exige una fuente instalada, y en Windows no siempre la hay).

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

function parseArgs(argv) {
	const opts = { columnas: 4, ancho: 480, salida: "hoja.png", cada: null, tiempos: null, entrada: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => {
			if (i + 1 >= argv.length) throw new Error(`falta el valor de ${a}`);
			return argv[++i];
		};
		if (a === "--columnas") opts.columnas = Number(next());
		else if (a === "--ancho") opts.ancho = Number(next());
		else if (a === "--salida") opts.salida = next();
		else if (a === "--cada") opts.cada = Number(next());
		else if (a === "--tiempos") opts.tiempos = next().split(",").map(Number);
		else if (a === "--help" || a === "-h") opts.ayuda = true;
		else if (!opts.entrada) opts.entrada = a;
		else throw new Error(`argumento desconocido: ${a}`);
	}
	for (const [k, v] of Object.entries({ columnas: opts.columnas, ancho: opts.ancho })) {
		if (!Number.isInteger(v) || v < 1) throw new Error(`--${k} debe ser un entero positivo`);
	}
	if (opts.cada !== null && !(opts.cada > 0)) throw new Error("--cada debe ser un número positivo");
	if (opts.tiempos && opts.tiempos.some((t) => !Number.isFinite(t) || t < 0)) {
		throw new Error("--tiempos debe ser una lista de segundos, por ejemplo 1.5,8,12");
	}
	return opts;
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function duracion(video) {
	const out = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]);
	const d = Number(out.trim());
	if (!(d > 0)) throw new Error(`no pude leer la duración de ${video}`);
	return d;
}

// Every cell has the same 16:9 size so `tile` can join them; anything else is
// letterboxed inside it rather than distorted.
function celda(ancho) {
	const alto = Math.round((ancho * 9) / 16 / 2) * 2;
	return `scale=${ancho}:${alto}:force_original_aspect_ratio=decrease,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2:color=0x101010`;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.ayuda || !opts.entrada) {
		console.log("uso: node hoja-de-contacto.mjs <video.mp4|carpeta> [--cada N | --tiempos a,b,c] [--columnas 4] [--ancho 480] [--salida hoja.png]");
		process.exit(opts.ayuda ? 0 : 1);
	}
	const entrada = resolve(opts.entrada);
	if (!existsSync(entrada)) throw new Error(`no existe: ${entrada}`);

	const tmp = mkdtempSync(join(tmpdir(), "hoja-"));
	const leyenda = [];
	try {
		if (statSync(entrada).isDirectory()) {
			const imagenes = readdirSync(entrada)
				.filter((f) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(f).toLowerCase()))
				.filter((f) => resolve(entrada, f) !== resolve(opts.salida))
				.sort();
			if (!imagenes.length) throw new Error(`no hay imágenes en ${entrada}`);
			imagenes.forEach((f, i) => {
				run("ffmpeg", ["-y", "-loglevel", "error", "-i", join(entrada, f), "-vf", celda(opts.ancho), join(tmp, `f_${String(i).padStart(4, "0")}.png`)]);
				leyenda.push(`${i + 1}\t${f}`);
			});
		} else {
			const d = duracion(entrada);
			let tiempos = opts.tiempos;
			if (!tiempos) {
				const paso = opts.cada ?? d / 12;
				tiempos = [];
				for (let t = paso / 2; t < d; t += paso) tiempos.push(Number(t.toFixed(2)));
			}
			const fuera = tiempos.filter((t) => t >= d);
			if (fuera.length) console.warn(`aviso: descarto ${fuera.join(", ")} s: el video dura ${d.toFixed(2)} s`);
			tiempos = tiempos.filter((t) => t < d);
			if (!tiempos.length) throw new Error("ningún tiempo cae dentro del video");
			tiempos.forEach((t, i) => {
				run("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(t), "-i", entrada, "-frames:v", "1", "-vf", celda(opts.ancho), join(tmp, `f_${String(i).padStart(4, "0")}.png`)]);
				leyenda.push(`${i + 1}\t${t.toFixed(2)} s`);
			});
		}

		const n = leyenda.length;
		const cols = Math.min(opts.columnas, n);
		const filas = Math.ceil(n / cols);
		run("ffmpeg", [
			"-y", "-loglevel", "error",
			"-framerate", "1", "-i", join(tmp, "f_%04d.png"),
			"-filter_complex", `tile=${cols}x${filas}:padding=8:margin=8:color=0x101010`,
			"-frames:v", "1", resolve(opts.salida),
		]);
		writeFileSync(`${resolve(opts.salida)}.txt`, `celda\torigen (de izquierda a derecha, fila por fila)\n${leyenda.join("\n")}\n`, "utf8");
		console.log(`hoja: ${resolve(opts.salida)} (${n} fotograma${n === 1 ? "" : "s"}, ${cols}×${filas})`);
		console.log(`leyenda: ${resolve(opts.salida)}.txt`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

try {
	main();
} catch (err) {
	console.error(`error: ${err.message}`);
	process.exit(1);
}
