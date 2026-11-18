import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_DIR } from "./video-audit.js";

/* Gate técnico + STT para audio de video narrado.

   Complementa `video-audit.ts` (que audita keyframes visuales) y `validar_motion.py`:
   corre `validar_video_audio.py` + `voz_validator.py` (Whisper offline cuando está
   disponible) y guarda `audit/audio-qa.json` atado por SHA-256 a `index.html`,
   `guion.md` y cada archivo de voz/música. */

export const AUDIO_QA_FILE = "audio-qa.json";
export const AUDIO_QA_VERSION = 1;

export type AudioSceneVerdict = "pass" | "revise" | "block";

export interface AudioQaScene {
	id: string;
	clipId?: string;
	src: string;
	durationSec?: number;
	declaredDurationSec?: number;
	expected?: string | null;
	transcript?: string | null;
	wer?: number | null;
	tailInsertions?: string[];
	missingAnchors?: Array<{ token: string; best_match?: string; score?: number }>;
	tailAnomaly?: { has_anomaly?: boolean; kind?: string | null };
	verdict: AudioSceneVerdict;
	errors: string[];
	warnings: string[];
}

export interface AudioQaInputs {
	indexHtml: string | null;
	guionMd: string | null;
	voices: Record<string, string>;
	music?: Record<string, string>;
	partitura?: string | null;
}

export interface AudioQaFile {
	version: number;
	createdAt: string;
	sttEngine: string;
	inputs: AudioQaInputs;
	scenes: AudioQaScene[];
	musicErrors?: string[];
	musicWarnings?: string[];
}

export interface AudioValidatorOptions {
	guion?: string;
	transcribir?: boolean;
	noStt?: boolean;
	requireStt?: boolean;
	sttPython?: string;
	noQa?: boolean;
	json?: boolean;
}

const AUDIO_TAG_RE = /<[a-zA-Z][\w-]*\b([^>]*)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function audioQaFilePath(project: string): string {
	return join(project, AUDIT_DIR, AUDIO_QA_FILE);
}

/* Python cambia de nombre según plataforma e instalación. Se comparte entre el
   validador de motion y el validador de voz/audio. */
export function resolvePython(): string | null {
	const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
	for (const cmd of candidates) {
		const probe = spawnSync(cmd, ["--version"], { stdio: "ignore" });
		if (!probe.error && probe.status === 0) return cmd;
	}
	return null;
}

export function resolveVoiceValidator(): string | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const candidate = join(root, "skills-bundle", "voice-narration", "validar_video_audio.py");
	return existsSync(candidate) ? candidate : null;
}

function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseTagAttrs(tagAttrs: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const match of tagAttrs.matchAll(ATTR_RE)) {
		out[match[1]] = match[2] ?? match[3] ?? "";
	}
	return out;
}

export function listDeclaredAudioTags(project: string): {
	voices: Array<{ id: string; src: string }>;
	bgmSrc: string | null;
	hasBgm: boolean;
} {
	const htmlPath = join(project, "index.html");
	if (!existsSync(htmlPath)) return { voices: [], bgmSrc: null, hasBgm: false };
	const html = readFileSync(htmlPath, "utf8");
	const voices: Array<{ id: string; src: string }> = [];
	let bgmSrc: string | null = null;
	let hasBgm = false;
	for (const match of html.matchAll(AUDIO_TAG_RE)) {
		const attrs = parseTagAttrs(match[1]);
		const id = attrs.id ?? "";
		if (/^vo\d+$/i.test(id)) {
			if (attrs.src) voices.push({ id, src: attrs.src });
		} else if (/^bgm$/i.test(id)) {
			hasBgm = true;
			if (!bgmSrc && attrs.src) bgmSrc = attrs.src;
		}
	}
	return { voices, bgmSrc, hasBgm };
}

export function hasDeclaredAudioClips(project: string): boolean {
	const { voices, hasBgm } = listDeclaredAudioTags(project);
	return voices.length > 0 || hasBgm;
}

export function collectAudioQaInputs(project: string): AudioQaInputs {
	const indexPath = join(project, "index.html");
	const guionPath = join(project, "guion.md");
	const { voices: voiceTags, bgmSrc } = listDeclaredAudioTags(project);
	const voices: Record<string, string> = {};
	for (const tag of voiceTags) {
		const wavPath = join(project, tag.src);
		if (existsSync(wavPath)) voices[tag.src] = hashFile(wavPath);
	}
	const music: Record<string, string> = {};
	let partitura: string | null = null;
	if (bgmSrc) {
		const bgmPath = join(project, bgmSrc);
		if (existsSync(bgmPath)) music[bgmSrc] = hashFile(bgmPath);
		const partPath = join(dirname(bgmPath), "partitura.json");
		if (existsSync(partPath)) partitura = hashFile(partPath);
	}
	return {
		indexHtml: existsSync(indexPath) ? hashFile(indexPath) : null,
		guionMd: existsSync(guionPath) ? hashFile(guionPath) : null,
		voices,
		music,
		partitura,
	};
}

export function evaluateAudioQa(project: string): { errors: string[]; warnings: string[]; stale: boolean } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const rerun = `Corré \`idu-pi video validate-audio --project "${project}"\`.`;
	const file = audioQaFilePath(project);

	if (!existsSync(file)) {
		return { errors: [`falta ${AUDIT_DIR}/${AUDIO_QA_FILE}. ${rerun}`], warnings, stale: true };
	}

	let report: AudioQaFile;
	try {
		report = JSON.parse(readFileSync(file, "utf8")) as AudioQaFile;
	} catch {
		return { errors: [`${AUDIT_DIR}/${AUDIO_QA_FILE} no es JSON válido. ${rerun}`], warnings, stale: true };
	}

	if (!report || report.version !== AUDIO_QA_VERSION || !report.inputs || !Array.isArray(report.scenes)) {
		return { errors: [`${AUDIT_DIR}/${AUDIO_QA_FILE} tiene un formato desconocido. ${rerun}`], warnings, stale: true };
	}

	const current = collectAudioQaInputs(project);
	const staleReasons: string[] = [];
	if (report.inputs.indexHtml !== current.indexHtml) staleReasons.push("index.html");
	if ((report.inputs.guionMd ?? null) !== current.guionMd) staleReasons.push("guion.md");

	const auditedVoices = report.inputs.voices ?? {};
	const currentKeys = Object.keys(current.voices);
	for (const src of currentKeys) {
		if (auditedVoices[src] !== current.voices[src]) staleReasons.push(src);
	}
	for (const src of Object.keys(auditedVoices)) {
		if (!(src in current.voices)) staleReasons.push(src);
	}
	if (report.inputs.music !== undefined) {
		const auditedMusic = report.inputs.music ?? {};
		const curMusic = current.music ?? {};
		for (const src of Object.keys(curMusic)) {
			if (auditedMusic[src] !== curMusic[src]) staleReasons.push(src);
		}
		for (const src of Object.keys(auditedMusic)) {
			if (!(src in curMusic)) staleReasons.push(src);
		}
	}
	if (report.inputs.partitura !== undefined && (report.inputs.partitura ?? null) !== (current.partitura ?? null)) {
		staleReasons.push("partitura.json");
	}
	if (staleReasons.length > 0) {
		errors.push(`audio qa vencido (${staleReasons.join(", ")} cambió después de validar). ${rerun}`);
		return { errors, warnings, stale: true };
	}

	for (const err of report.musicErrors ?? []) {
		errors.push(`música: ${err}`);
	}
	for (const warn of report.musicWarnings ?? []) {
		warnings.push(`música: ${warn}`);
	}

	for (const scene of report.scenes) {
		if (!scene || typeof scene !== "object") continue;
		const verdict = String(scene.verdict ?? "").toLowerCase();
		const label = `${scene.id || scene.src || "clip"}`;
		const sceneErrors = Array.isArray(scene.errors) ? scene.errors : [];
		const sceneWarnings = Array.isArray(scene.warnings) ? scene.warnings : [];

		if (verdict === "block" || sceneErrors.length > 0) {
			const detail = sceneErrors.join("; ") || "veredicto block";
			errors.push(`voz ${label}: ${detail}`);
		} else if (verdict === "revise" || sceneWarnings.length > 0) {
			const detail = sceneWarnings.join("; ") || "revisar pronunciación/cola";
			warnings.push(`voz ${label}: ${detail}`);
		}
	}

	return { errors, warnings, stale: false };
}

export function runAudioValidator(project: string, opts: AudioValidatorOptions = {}): number {
	const script = resolveVoiceValidator();
	if (!script) {
		console.error("No encontré skills-bundle/voice-narration/validar_video_audio.py en el paquete.");
		return 1;
	}
	const python = resolvePython();
	if (!python) {
		console.error("No encontré Python. Instalalo y agregá numpy: pip install numpy");
		return 1;
	}
	const args = [script, "--proyecto", project];
	if (opts.guion) args.push("--guion", opts.guion);
	if (opts.transcribir) args.push("--transcribir");
	if (opts.requireStt) args.push("--require-stt");
	if (opts.noStt) args.push("--no-stt");
	if (opts.sttPython) args.push("--stt-python", opts.sttPython);
	if (opts.noQa) args.push("--no-qa");
	if (opts.json) args.push("--json");
	const run = spawnSync(python, args, { stdio: "inherit", cwd: project });
	return run.status ?? 1;
}

/* Gate previo al render de entrega: si no hay <audio>, no bloquea piezas mudas.
   Si hay <audio> y audio-qa.json falta o está vencido, ejecuta el validador una
   vez (incluye física de onda, colas, música y STT local si está disponible). */
export function checkAudioGate(
	project: string,
	skip: boolean,
	runValidator: (p: string, o?: AudioValidatorOptions) => number = runAudioValidator,
): number {
	if (skip) {
		console.warn("audio gate omitido por --skip-audio-gate: NO PUBLICAR sin validar voz y música.");
		return 0;
	}
	if (!hasDeclaredAudioClips(project)) return 0;

	const initial = evaluateAudioQa(project);
	if (!initial.stale) {
		for (const w of initial.warnings) console.warn(`audio gate (aviso): ${w}`);
		if (initial.errors.length > 0) {
			for (const e of initial.errors) console.error(`audio gate: ${e}`);
			return 1;
		}
		console.log(`audio gate: ok (${AUDIT_DIR}/${AUDIO_QA_FILE}, ${initial.warnings.length} aviso(s))`);
		return 0;
	}

	const status = runValidator(project, {});
	if (status !== 0) return status;

	const post = evaluateAudioQa(project);
	if (post.errors.length > 0) {
		for (const e of post.errors) console.error(`audio gate: ${e}`);
		return 1;
	}
	return 0;
}
