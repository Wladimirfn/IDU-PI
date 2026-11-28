import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { readBriefField } from "./video-audit.js";
import {
	buildVideoToolEnv,
	resolveBlenderBin,
	resolveFfmpegBin,
	resolveManimPython,
	resolveRemotionCli,
} from "./video-binaries.js";

export type VideoEngineId = "hyperframes" | "blender" | "remotion" | "manim";

export const VALID_VIDEO_ENGINES: readonly VideoEngineId[] = [
	"hyperframes",
	"blender",
	"remotion",
	"manim",
];

export interface VideoLaneSpec {
	primaryEngine?: string;
	[key: string]: unknown;
}

export interface VideoEngineMeta {
	status?: string;
	skill?: string;
	renderer?: string;
	deterministic?: boolean;
	[key: string]: unknown;
}

export interface VideoLanesDocument {
	lanes?: Record<string, VideoLaneSpec>;
	intents?: Record<string, unknown>;
	engines?: Record<string, VideoEngineMeta>;
	audit?: { profiles?: string[] };
}

export interface EngineResolution {
	engine: VideoEngineId | null;
	declaredEngine: string | null;
	lane: string | null;
	source: "brief" | "legacy-hyperframes" | "lane" | "default" | "invalid";
	error?: string;
}

export interface ProjectEngineConfig {
	blender?: {
		blendFile?: string;
		script?: string;
		device?: "OPTIX" | "CUDA" | "CPU";
		samples?: number;
		framesDir?: string;
	};
	remotion?: {
		entry?: string;
		compositionId?: string;
		concurrency?: number;
	};
	manim?: {
		file?: string;
		scenes?: string[];
		quality?: "l" | "m" | "h" | "k";
		renderer?: "cairo" | "opengl";
	};
}

export interface TimelineScene {
	id: string;
	start?: number;
	end?: number;
	fin_voz?: number;
	reviewAt?: number;
	quietWindow?: [number, number];
	sceneClass?: string;
	frases?: Array<{ end?: number }>;
}

export interface TimelineDocument {
	total?: number;
	fps?: number;
	width?: number;
	height?: number;
	scenes?: TimelineScene[];
}

export interface EngineRenderRequest {
	projectRoot: string;
	out: string;
	end: number;
	audio: string | null;
	width?: string;
	height?: string;
	gpu: boolean;
	angle?: string;
	playwright?: string | null;
	frameRenderer?: string | null;
}

export function isValidVideoEngine(value: string): value is VideoEngineId {
	return (VALID_VIDEO_ENGINES as readonly string[]).includes(value);
}

/* Lee `- Engine:` igual que `readBriefField`: sin bloques cercados y tomando
   el primer token de la misma línea. */
export function readBriefEngine(briefText: string): string | null {
	const value = readBriefField(briefText, "Engine");
	return value ? value.split(/[\s;:,.]+/)[0].toLowerCase() || null : null;
}

export function readBriefLane(briefText: string): string | null {
	const value = readBriefField(briefText, "Lane");
	return value ? value.split(/[\s;:,.]+/)[0].toLowerCase() || null : null;
}

function hasHyperframesCompositionHtml(project: string): boolean {
	const indexPath = join(project, "index.html");
	if (!existsSync(indexPath)) return false;
	try {
		const html = readFileSync(indexPath, "utf8");
		return /\bdata-composition-id\b/i.test(html);
	} catch {
		return false;
	}
}

export function resolveVideoEngine(
	project: string,
	lanesDoc: VideoLanesDocument | null,
): EngineResolution {
	const briefPath = join(project, "style-brief.md");
	const briefText = existsSync(briefPath) ? readFileSync(briefPath, "utf8") : "";
	const declaredEngine = briefText ? readBriefEngine(briefText) : null;
	const lane = briefText ? readBriefLane(briefText) : null;

	if (declaredEngine) {
		if (!isValidVideoEngine(declaredEngine)) {
			return {
				engine: null,
				declaredEngine,
				lane,
				source: "invalid",
				error: `engine desconocido "${declaredEngine}". Valores válidos: ${VALID_VIDEO_ENGINES.join(", ")}.`,
			};
		}
		return { engine: declaredEngine, declaredEngine, lane, source: "brief" };
	}

	/* Compatibilidad hacia atrás: proyectos existentes que declaran una
	   composición HyperFrames en index.html sin `- Engine:` siguen corriendo por
	   HyperFrames incluso si `motion-graphics` ahora enruta a Remotion. */
	if (hasHyperframesCompositionHtml(project)) {
		return { engine: "hyperframes", declaredEngine: null, lane, source: "legacy-hyperframes" };
	}

	const laneEngine = lane ? lanesDoc?.lanes?.[lane]?.primaryEngine?.toLowerCase() : undefined;
	if (laneEngine) {
		if (!isValidVideoEngine(laneEngine)) {
			return {
				engine: null,
				declaredEngine: laneEngine,
				lane,
				source: "invalid",
				error: `primaryEngine desconocido "${laneEngine}" en lane "${lane}".`,
			};
		}
		return { engine: laneEngine, declaredEngine: null, lane, source: "lane" };
	}

	return { engine: "hyperframes", declaredEngine: null, lane, source: "default" };
}

export function readProjectEngineConfig(project: string): ProjectEngineConfig {
	const file = join(project, "video-engine.json");
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8")) as ProjectEngineConfig;
	} catch {
		return {};
	}
}

export function readTimelineDocument(project: string): TimelineDocument | null {
	const file = join(project, "timeline.json");
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as TimelineDocument;
	} catch {
		return null;
	}
}

export function mapTimeToFrame(timeSec: number, fps: number, totalDurationSec?: number | null): number {
	const clampedTime =
		typeof totalDurationSec === "number" && totalDurationSec > 0
			? Math.min(Math.max(0, timeSec), totalDurationSec)
			: Math.max(0, timeSec);
	const rawFrame = Math.round(clampedTime * fps);
	if (typeof totalDurationSec === "number" && totalDurationSec > 0) {
		const maxFrame = Math.max(0, Math.round(totalDurationSec * fps) - 1);
		return Math.min(Math.max(0, rawFrame), maxFrame);
	}
	return Math.max(0, rawFrame);
}

export function muxVideoWithAudio(
	ffmpegBin: string,
	silentVideo: string,
	audioFile: string,
	outMp4: string,
	env: NodeJS.ProcessEnv,
): number {
	const ext = extname(audioFile).toLowerCase();
	const audioCodec =
		ext === ".mp4" || ext === ".m4a" || ext === ".aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"];
	const res = spawnSync(
		ffmpegBin,
		[
			"-y",
			"-v",
			"error",
			"-i",
			silentVideo,
			"-i",
			audioFile,
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
			outMp4,
		],
		{ stdio: "inherit", env },
	);
	return res.status ?? 1;
}

function detectRemotionEntry(project: string, cfg: ProjectEngineConfig): string | null {
	const candidates = [
		cfg.remotion?.entry,
		"src/index.ts",
		"src/index.tsx",
		"remotion/index.ts",
		"remotion/index.tsx",
		"index.ts",
		"index.tsx",
	].filter((v): v is string => Boolean(v));
	for (const rel of candidates) {
		const full = resolve(project, rel);
		if (existsSync(full)) return full;
	}
	return null;
}

function detectBlenderEntry(project: string, cfg: ProjectEngineConfig): {
	blendFile: string | null;
	script: string | null;
} {
	const blendCand = [cfg.blender?.blendFile, "scene.blend", "main.blend"].filter((v): v is string => Boolean(v));
	const scriptCand = [cfg.blender?.script, "render_blender.py", "scene.py"].filter((v): v is string => Boolean(v));
	const blendFile = blendCand.map((r) => resolve(project, r)).find((p) => existsSync(p)) ?? null;
	const script = scriptCand.map((r) => resolve(project, r)).find((p) => existsSync(p)) ?? null;
	return { blendFile, script };
}

function detectManimEntry(project: string, cfg: ProjectEngineConfig): string | null {
	const candidates = [cfg.manim?.file, "scene.py", "scenes.py", "main.py"].filter((v): v is string => Boolean(v));
	for (const rel of candidates) {
		const full = resolve(project, rel);
		if (existsSync(full)) return full;
	}
	return null;
}

function findNewestPng(dir: string): string | null {
	if (!existsSync(dir)) return null;
	let best: { path: string; mtime: number } | null = null;
	const stack = [dir];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const entry of readdirSync(cur, { withFileTypes: true })) {
			const full = join(cur, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.name.toLowerCase().endsWith(".png")) {
				const { mtimeMs } = readFileStatSafe(full);
				if (!best || mtimeMs > best.mtime) best = { path: full, mtime: mtimeMs };
			}
		}
	}
	return best?.path ?? null;
}

function readFileStatSafe(path: string): { mtimeMs: number } {
	try {
		return statSync(path);
	} catch {
		return { mtimeMs: 0 };
	}
}

export function launchEngineStudio(
	engine: VideoEngineId,
	projectRoot: string,
	options: { port?: string } = {},
): number {
	const env = buildVideoToolEnv(process.env, projectRoot);
	const cfg = readProjectEngineConfig(projectRoot);

	if (engine === "remotion") {
		const cli = resolveRemotionCli(projectRoot);
		if (!cli) {
			console.error("No encontré @remotion/cli. Instalalo en el proyecto o en ~/.idu/tools/remotion.");
			return 1;
		}
		const entry = detectRemotionEntry(projectRoot, cfg);
		const args = [cli, "studio"];
		if (entry) args.push(entry);
		if (options.port) args.push("--port", options.port);
		const res = spawnSync(process.execPath, args, { stdio: "inherit", env, cwd: projectRoot });
		return res.status ?? 1;
	}

	if (engine === "blender") {
		const blender = resolveBlenderBin();
		if (!blender) {
			console.error("No encontré Blender. Instalalo o configurá IDU_BLENDER.");
			return 1;
		}
		const { blendFile } = detectBlenderEntry(projectRoot, cfg);
		const args = blendFile ? [blendFile] : [];
		const child = spawn(blender, args, { detached: true, stdio: "ignore", env, cwd: projectRoot });
		child.unref();
		console.log(`Blender Studio abierto (${blender}${blendFile ? ` -> ${blendFile}` : ""}). Activá 'Start MCP Server' en el panel N -> MCP for Blender si querés editarlo por MCP.`);
		return 0;
	}

	if (engine === "manim") {
		console.error("Manim no tiene servidor Studio interactivo. Usá `idu-pi video keyframes --project ...` o `python -m manim -pql scene.py <Escena>`.");
		return 1;
	}

	return 1;
}

export function printEngineStatus(engine: VideoEngineId, projectRoot: string): number {
	const cfg = readProjectEngineConfig(projectRoot);
	const tl = readTimelineDocument(projectRoot);
	console.log(`=== video status (${engine}) ===`);
	console.log(`project: ${projectRoot}`);
	console.log(`style-brief.md: ${existsSync(join(projectRoot, "style-brief.md")) ? "ok" : "missing"}`);
	console.log(`art-direction.md: ${existsSync(join(projectRoot, "art-direction.md")) ? "ok" : "missing"}`);
	console.log(`timeline.json: ${tl ? `ok (${tl.scenes?.length ?? 0} escenas, ${tl.total ?? "?"}s)` : "missing"}`);
	if (engine === "blender") {
		const { blendFile, script } = detectBlenderEntry(projectRoot, cfg);
		console.log(`blender binary: ${resolveBlenderBin() ?? "missing"}`);
		console.log(`blendFile: ${blendFile ?? "none"} | script: ${script ?? "none"}`);
	} else if (engine === "remotion") {
		console.log(`remotion cli: ${resolveRemotionCli(projectRoot) ?? "missing"}`);
		console.log(`entry: ${detectRemotionEntry(projectRoot, cfg) ?? "missing"} | composition: ${cfg.remotion?.compositionId ?? "Main"}`);
	} else if (engine === "manim") {
		console.log(`manim python: ${resolveManimPython(projectRoot) ?? "missing"}`);
		console.log(`file: ${detectManimEntry(projectRoot, cfg) ?? "missing"}`);
	}
	return 0;
}

export function captureEngineKeyframes(
	engine: VideoEngineId,
	projectRoot: string,
	onlyScene?: string,
): number {
	const env = buildVideoToolEnv(process.env, projectRoot);
	const cfg = readProjectEngineConfig(projectRoot);
	const tl = readTimelineDocument(projectRoot);
	const fps = tl?.fps ?? 30;
	const kfDir = join(projectRoot, "keyframes");
	mkdirSync(kfDir, { recursive: true });
	const scenes = (tl?.scenes ?? []).filter((s) => !onlyScene || s.id === onlyScene);

	if (engine === "remotion") {
		const cli = resolveRemotionCli(projectRoot);
		const entry = detectRemotionEntry(projectRoot, cfg);
		if (!cli || !entry) {
			console.error("Remotion keyframes requiere @remotion/cli y un entry point (src/index.ts).");
			return 1;
		}
		const compId = cfg.remotion?.compositionId ?? "Main";
		if (scenes.length === 0) {
			const target = join(kfDir, onlyScene === "e00" ? "e00-styleboard.png" : `${onlyScene ?? "e00-styleboard"}.png`);
			const res = spawnSync(process.execPath, [cli, "still", entry, compId, target, "--frame=0"], {
				stdio: "inherit",
				env,
				cwd: projectRoot,
			});
			return res.status ?? 1;
		}
		for (const scene of scenes) {
			const t = scene.reviewAt ?? Math.max(0, (scene.fin_voz ?? scene.end ?? 0) - 0.1);
			const frame = mapTimeToFrame(t, fps, tl?.total);
			const out = join(kfDir, `${scene.id}.png`);
			const res = spawnSync(process.execPath, [cli, "still", entry, compId, out, `--frame=${frame}`], {
				stdio: "inherit",
				env,
				cwd: projectRoot,
			});
			if (res.status !== 0) return res.status ?? 1;
		}
		return 0;
	}

	if (engine === "blender") {
		const blender = resolveBlenderBin();
		if (!blender) {
			console.error("No encontré Blender para capturar keyframes.");
			return 1;
		}
		const { blendFile, script } = detectBlenderEntry(projectRoot, cfg);
		if (!blendFile && !script) {
			console.error("Blender requiere `scene.blend` o `render_blender.py`.");
			return 1;
		}
		const targets =
			scenes.length > 0
				? scenes.map((s) => ({
						id: s.id,
						frame: mapTimeToFrame(s.reviewAt ?? Math.max(0, (s.fin_voz ?? s.end ?? 0) - 0.1), fps, tl?.total),
					}))
				: [{ id: onlyScene ?? "e00-styleboard", frame: 0 }];

		for (const item of targets) {
			const out = join(kfDir, `${item.id === "e00" ? "e00-styleboard" : item.id}.png`);
			const args = ["-b"];
			if (blendFile) args.push(blendFile);
			if (script) {
				args.push("--python", script, "--", "--still", item.id, "--frame", String(item.frame), "--out", out);
			} else {
				const outNoExt = out.replace(/\.png$/i, "");
				args.push("-o", `${outNoExt}_####`, "-F", "PNG", "-f", String(item.frame));
			}
			const res = spawnSync(blender, args, { stdio: "inherit", env, cwd: projectRoot });
			if (res.status !== 0) return res.status ?? 1;
			if (!script) {
				const padded = `${out.replace(/\.png$/i, "")}_${String(item.frame).padStart(4, "0")}.png`;
				if (existsSync(padded)) copyFileSync(padded, out);
			}
		}
		return 0;
	}

	if (engine === "manim") {
		const manimPy = resolveManimPython(projectRoot);
		const file = detectManimEntry(projectRoot, cfg);
		if (!manimPy || !file) {
			console.error("Manim keyframes requiere venv Manim y `scene.py`.");
			return 1;
		}
		const targets =
			scenes.length > 0
				? scenes.map((s) => ({ id: s.id, cls: s.sceneClass ?? s.id }))
				: (cfg.manim?.scenes ?? []).map((cls, i) => ({ id: onlyScene ?? `e${String(i + 1).padStart(2, "0")}`, cls }));
		if (targets.length === 0) {
			console.error("No hay escenas en timeline.json ni `manim.scenes` en video-engine.json.");
			return 1;
		}
		const mediaDir = mkdtempSync(join(tmpdir(), "idu-manim-kf-"));
		try {
			for (const item of targets) {
				const res = spawnSync(
					manimPy,
					["-m", "manim", "render", file, item.cls, "-s", "--format=png", "--media_dir", mediaDir],
					{
						stdio: "inherit",
						env: { ...env, PYTHONNOUSERSITE: "1" },
						cwd: projectRoot,
					},
				);
				if (res.status !== 0) return res.status ?? 1;
				const png = findNewestPng(mediaDir);
				if (!png) {
					console.error(`Manim no generó PNG para ${item.cls}.`);
					return 1;
				}
				copyFileSync(png, join(kfDir, `${item.id === "e00" ? "e00-styleboard" : item.id}.png`));
			}
		} finally {
			rmSync(mediaDir, { recursive: true, force: true });
		}
		return 0;
	}

	console.error("Para HyperFrames usá Studio / Playwright para capturar keyframes/eNN.png.");
	return 1;
}

export function renderWithEngine(engine: VideoEngineId, req: EngineRenderRequest): number {
	const env = buildVideoToolEnv(process.env, req.projectRoot);
	const cfg = readProjectEngineConfig(req.projectRoot);
	const tl = readTimelineDocument(req.projectRoot);

	if (engine === "hyperframes") {
		if (!req.frameRenderer) {
			console.error("No encontré skills-bundle/video-production/render_frames.mjs en el paquete.");
			return 1;
		}
		const indexUrl = new URL(`file:///${join(req.projectRoot, "index.html").replace(/\\/g, "/")}`).href;
		const renderArgs = [req.frameRenderer, "--url", indexUrl, "--end", String(req.end), "--out", req.out];
		if (req.audio) renderArgs.push("--audio", req.audio);
		if (req.playwright) renderArgs.push("--playwright", req.playwright);
		if (req.width) renderArgs.push("--width", req.width);
		if (req.height) renderArgs.push("--height", req.height);
		if (req.gpu) renderArgs.push("--gpu");
		if (req.angle) renderArgs.push("--angle", req.angle);
		const res = spawnSync(process.execPath, renderArgs, { stdio: "inherit", env, cwd: req.projectRoot });
		return res.status ?? 1;
	}

	const ffmpeg = resolveFfmpegBin();
	if (!ffmpeg) {
		console.error("No encontré ffmpeg en PATH ni en WinGet/Scoop. Instalalo o definí IDU_FFMPEG.");
		return 1;
	}

	if (engine === "remotion") {
		const cli = resolveRemotionCli(req.projectRoot);
		const entry = detectRemotionEntry(req.projectRoot, cfg);
		if (!cli || !entry) {
			console.error("Remotion render requiere @remotion/cli y un entry point (src/index.ts).");
			return 1;
		}
		const compId = cfg.remotion?.compositionId ?? "Main";
		const fps = tl?.fps ?? 30;
		const silentOut = req.audio ? join(dirname(req.out), `.${Date.now()}-remotion-silent.mp4`) : req.out;
		const args = [cli, "render", entry, compId, silentOut];
		if (req.width) args.push(`--width=${req.width}`);
		if (req.height) args.push(`--height=${req.height}`);
		if (req.gpu) args.push(`--gl=${req.angle ?? "angle"}`);
		if (req.end && tl?.total && req.end < tl.total - 0.01) {
			args.push(`--frames=0-${Math.max(0, Math.round(req.end * fps) - 1)}`);
		}
		const res = spawnSync(process.execPath, args, { stdio: "inherit", env, cwd: req.projectRoot });
		if (res.status !== 0) return res.status ?? 1;
		if (req.audio) {
			const muxRc = muxVideoWithAudio(ffmpeg, silentOut, req.audio, req.out, env);
			rmSync(silentOut, { force: true });
			return muxRc;
		}
		return 0;
	}

	if (engine === "blender") {
		const blender = resolveBlenderBin();
		if (!blender) {
			console.error("No encontré Blender 5.x. Instalalo o definí IDU_BLENDER.");
			return 1;
		}
		const { blendFile, script } = detectBlenderEntry(req.projectRoot, cfg);
		if (!blendFile && !script) {
			console.error("Blender render requiere `scene.blend` o `render_blender.py` en el proyecto.");
			return 1;
		}
		if (req.gpu) {
			const gpuCheck = spawnSync(
				blender,
				[
					"-b",
					"--python-expr",
					"import bpy; cp=bpy.context.preferences.addons['cycles'].preferences; cp.refresh_devices(); print('GPU_OK:', any(d.type in ('OPTIX','CUDA') for d in cp.devices))",
				],
				{ encoding: "utf8", env },
			);
			if (gpuCheck.status !== 0 || !gpuCheck.stdout.includes("GPU_OK: True")) {
				console.error("blender --gpu pedido, pero no hay dispositivo OPTIX/CUDA disponible (sin fallback silencioso a CPU).");
				return 1;
			}
		}
		const fps = tl?.fps ?? 30;
		const totalFrames = Math.max(1, Math.round(req.end * fps));
		const framesDir = mkdtempSync(join(tmpdir(), "idu-blender-frames-"));
		const silentOut = req.audio ? join(dirname(req.out), `.${Date.now()}-blender-silent.mp4`) : req.out;
		try {
			const args = ["-b"];
			if (blendFile) args.push(blendFile);
			if (script) {
				args.push(
					"--python",
					script,
					"--",
					"--frames-dir",
					framesDir,
					"--end-frame",
					String(totalFrames),
					"--fps",
					String(fps),
				);
				if (req.width) args.push("--width", req.width);
				if (req.height) args.push("--height", req.height);
				if (req.gpu) args.push("--gpu");
			} else {
				args.push("-o", join(framesDir, "frame_####"), "-F", "PNG", "-s", "1", "-e", String(totalFrames), "-a");
			}
			const res = spawnSync(blender, args, { stdio: "inherit", env, cwd: req.projectRoot });
			if (res.status !== 0) return res.status ?? 1;
			const pngs = readdirSync(framesDir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
			if (pngs.length === 0) {
				console.error("Blender no generó frames PNG para codificar.");
				return 1;
			}
			const pattern = join(framesDir, "frame_%04d.png");
			const firstZero = existsSync(join(framesDir, "frame_0000.png"));
			const ffArgs = [
				"-y",
				"-v",
				"error",
				"-framerate",
				String(fps),
				...(firstZero ? ["-start_number", "0"] : ["-start_number", "1"]),
				"-i",
				existsSync(join(framesDir, pngs[0])) && /^frame_\d{4}\.png$/i.test(pngs[0])
					? pattern
					: join(framesDir, "%04d.png"),
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-crf",
				"16",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				silentOut,
			];
			const enc = spawnSync(ffmpeg, ffArgs, { stdio: "inherit", env });
			if (enc.status !== 0) return enc.status ?? 1;
			if (req.audio) {
				const muxRc = muxVideoWithAudio(ffmpeg, silentOut, req.audio, req.out, env);
				rmSync(silentOut, { force: true });
				return muxRc;
			}
			return 0;
		} finally {
			rmSync(framesDir, { recursive: true, force: true });
		}
	}

	if (engine === "manim") {
		const manimPy = resolveManimPython(req.projectRoot);
		const file = detectManimEntry(req.projectRoot, cfg);
		if (!manimPy || !file) {
			console.error("Manim render requiere venv Manim y `scene.py`.");
			return 1;
		}
		const sceneClasses =
			cfg.manim?.scenes ??
			(tl?.scenes?.map((s) => s.sceneClass ?? s.id).filter(Boolean) ?? []);
		if (sceneClasses.length === 0) {
			console.error("Definí `manim.scenes` en video-engine.json o `sceneClass` en timeline.json.");
			return 1;
		}
		const fps = tl?.fps ?? 30;
		const w = req.width ?? String(tl?.width ?? 1920);
		const h = req.height ?? String(tl?.height ?? 1080);
		const mediaDir = mkdtempSync(join(tmpdir(), "idu-manim-render-"));
		const silentOut = req.audio ? join(dirname(req.out), `.${Date.now()}-manim-silent.mp4`) : req.out;
		try {
			const clips: string[] = [];
			for (const cls of sceneClasses) {
				const args = [
					"-m",
					"manim",
					"render",
					file,
					cls,
					"--format=mp4",
					"-r",
					`${w},${h}`,
					"--fps",
					String(fps),
					"--media_dir",
					mediaDir,
				];
				const res = spawnSync(manimPy, args, {
					stdio: "inherit",
					env: { ...env, PYTHONNOUSERSITE: "1" },
					cwd: req.projectRoot,
				});
				if (res.status !== 0) return res.status ?? 1;
				const clip = findNewestMp4(mediaDir, cls);
				if (!clip) {
					console.error(`Manim no produjo MP4 para ${cls}.`);
					return 1;
				}
				clips.push(clip);
			}
			const listFile = join(mediaDir, "concat.txt");
			writeFileSync(
				listFile,
				clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"),
				"utf8",
			);
			const ffArgs = [
				"-y",
				"-v",
				"error",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				listFile,
				"-t",
				String(req.end),
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-crf",
				"16",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"+faststart",
				silentOut,
			];
			const enc = spawnSync(ffmpeg, ffArgs, { stdio: "inherit", env });
			if (enc.status !== 0) return enc.status ?? 1;
			if (req.audio) {
				const muxRc = muxVideoWithAudio(ffmpeg, silentOut, req.audio, req.out, env);
				rmSync(silentOut, { force: true });
				return muxRc;
			}
			return 0;
		} finally {
			rmSync(mediaDir, { recursive: true, force: true });
		}
	}

	return 1;
}

function findNewestMp4(dir: string, sceneName: string): string | null {
	let best: { path: string; mtime: number } | null = null;
	const stack = [dir];
	while (stack.length > 0) {
		const cur = stack.pop()!;
		for (const entry of readdirSync(cur, { withFileTypes: true })) {
			const full = join(cur, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (
				entry.name.toLowerCase().endsWith(".mp4") &&
				basename(entry.name, ".mp4").toLowerCase() === sceneName.toLowerCase()
			) {
				const { mtimeMs } = readFileStatSafe(full);
				if (!best || mtimeMs > best.mtime) best = { path: full, mtime: mtimeMs };
			}
		}
	}
	return best?.path ?? null;
}
