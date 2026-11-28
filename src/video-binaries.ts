import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { getIduHome } from "./config-defaults.js";

export interface ResolvedBinary {
	path: string | null;
	version: string | null;
	source: string | null;
}

export interface VideoToolchainProbe {
	ffmpeg: ResolvedBinary;
	ffprobe: ResolvedBinary;
	blender: ResolvedBinary & { addonInstalled: boolean; addonPath: string | null };
	uvx: ResolvedBinary;
	manim: { python: string | null; version: string | null; rough: string | null; latex: boolean };
	remotion: { cli: string | null; version: string | null };
	iduframe: { cli: string | null; version: string | null };
	playwright: { entry: string | null };
	python: ResolvedBinary;
}

let cachedRegistryDirs: string[] | null = null;

function readWindowsRegistryPathDirs(): string[] {
	if (process.platform !== "win32") return [];
	if (cachedRegistryDirs) return cachedRegistryDirs;
	const dirs: string[] = [];
	const keys = [
		"HKCU\\Environment",
		"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
	];
	for (const key of keys) {
		const res = spawnSync("reg", ["query", key, "/v", "Path"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		if (res.status !== 0 || !res.stdout) continue;
		const match = res.stdout.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im);
		if (!match) continue;
		for (const raw of match[1].split(";")) {
			const expanded = expandWindowsEnvVars(raw.trim());
			if (expanded && !dirs.some((d) => d.toLowerCase() === expanded.toLowerCase())) {
				dirs.push(expanded);
			}
		}
	}
	cachedRegistryDirs = dirs;
	return dirs;
}

function expandWindowsEnvVars(value: string): string {
	return value.replace(/%([^%]+)%/g, (full, name: string) => {
		const found = process.env[name] ?? process.env[name.toUpperCase()];
		return found ?? full;
	});
}

function searchPathDirs(names: string[], extraDirs: string[] = []): string | null {
	const pathDirs = [
		...(process.env.PATH ?? process.env.Path ?? "").split(delimiter),
		...readWindowsRegistryPathDirs(),
		...extraDirs,
	]
		.map((d) => d.trim())
		.filter(Boolean);
	const seen = new Set<string>();
	for (const dir of pathDirs) {
		const norm = process.platform === "win32" ? dir.toLowerCase() : dir;
		if (seen.has(norm)) continue;
		seen.add(norm);
		for (const name of names) {
			const candidate = join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

function findWingetFfmpegExe(exeName: string): string | null {
	if (process.platform !== "win32") return null;
	const localApp = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
	const packagesDir = join(localApp, "Microsoft", "WinGet", "Packages");
	if (!existsSync(packagesDir)) return null;
	try {
		const dirs = readdirSync(packagesDir).filter((d) => /ffmpeg/i.test(d)).sort().reverse();
		for (const pkg of dirs) {
			const pkgRoot = join(packagesDir, pkg);
			const subDirs = readdirSync(pkgRoot).sort().reverse();
			for (const sub of subDirs) {
				const cand = join(pkgRoot, sub, "bin", exeName);
				if (existsSync(cand)) return cand;
			}
		}
	} catch {
		return null;
	}
	return null;
}

function readFirstLineVersion(cmd: string, args: string[], env?: NodeJS.ProcessEnv): string | null {
	try {
		const res = spawnSync(cmd, args, {
			encoding: "utf8",
			env: env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 10_000,
		});
		if (res.status !== 0) return null;
		const text = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
		return text.split(/\r?\n/)[0]?.trim() || null;
	} catch {
		return null;
	}
}

export function resolveFfmpegBin(): string | null {
	const envVal = process.env.IDU_FFMPEG?.trim();
	if (envVal && existsSync(envVal)) return envVal;
	const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const extra =
		process.platform === "win32"
			? [
					join(homedir(), "scoop", "apps", "ffmpeg", "current", "bin"),
					"C:\\ffmpeg\\bin",
					"C:\\ProgramData\\chocolatey\\bin",
				]
			: ["/usr/local/bin", "/opt/homebrew/bin"];
	return searchPathDirs([exe], extra) ?? findWingetFfmpegExe(exe);
}

export function resolveFfprobeBin(): string | null {
	const envVal = process.env.IDU_FFPROBE?.trim();
	if (envVal && existsSync(envVal)) return envVal;
	const exe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
	const ffmpegPath = resolveFfmpegBin();
	if (ffmpegPath) {
		const sibling = join(dirname(ffmpegPath), exe);
		if (existsSync(sibling)) return sibling;
	}
	const extra =
		process.platform === "win32"
			? [
					join(homedir(), "scoop", "apps", "ffmpeg", "current", "bin"),
					"C:\\ffmpeg\\bin",
					"C:\\ProgramData\\chocolatey\\bin",
				]
			: ["/usr/local/bin", "/opt/homebrew/bin"];
	return searchPathDirs([exe], extra) ?? findWingetFfmpegExe(exe);
}

function parseSemverNumbers(label: string): number[] {
	const match = label.match(/(\d+(?:\.\d+)*)/);
	return match ? match[1].split(".").map((n) => Number.parseInt(n, 10) || 0) : [0];
}

function compareVersionsDesc(a: string, b: string): number {
	const pa = parseSemverNumbers(a);
	const pb = parseSemverNumbers(b);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

export function resolveBlenderBin(): string | null {
	const envVal = process.env.IDU_BLENDER?.trim();
	if (envVal && existsSync(envVal)) return envVal;
	const exe = process.platform === "win32" ? "blender.exe" : "blender";
	const candidates: string[] = [];

	const iduTools = join(getIduHome(), "tools");
	if (existsSync(iduTools)) {
		try {
			const dirs = readdirSync(iduTools)
				.filter((d) => /^blender/i.test(d))
				.sort(compareVersionsDesc);
			for (const d of dirs) {
				const cand = join(iduTools, d, exe);
				if (existsSync(cand)) candidates.push(cand);
			}
		} catch {
			// ignore
		}
	}
	if (process.platform === "win32") {
		for (const base of [
			process.env.ProgramFiles ?? "C:\\Program Files",
			join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Programs"),
		]) {
			const bf = join(base, "Blender Foundation");
			if (!existsSync(bf)) continue;
			try {
				const dirs = readdirSync(bf).filter((d) => /^blender/i.test(d)).sort(compareVersionsDesc);
				for (const d of dirs) {
					const cand = join(bf, d, exe);
					if (existsSync(cand)) candidates.push(cand);
				}
			} catch {
				// ignore
			}
		}
	}
	if (candidates.length > 0) return candidates[0];
	return searchPathDirs([exe], process.platform === "darwin" ? ["/Applications/Blender.app/Contents/MacOS"] : []);
}

export function resolveBlenderAddonInfo(blenderVersionLine: string | null): {
	installed: boolean;
	path: string | null;
} {
	const versionMatch = blenderVersionLine?.match(/Blender\s+(\d+\.\d+)/i);
	const majorMinor = versionMatch?.[1];
	const base =
		process.platform === "win32"
			? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Blender Foundation", "Blender")
			: process.platform === "darwin"
				? join(homedir(), "Library", "Application Support", "Blender")
				: join(homedir(), ".config", "blender");
	if (!existsSync(base)) return { installed: false, path: null };
	const versions = majorMinor
		? [majorMinor]
		: readdirSync(base).filter((d) => /^\d+\.\d+/.test(d)).sort(compareVersionsDesc);
	for (const v of versions) {
		const addonFile = join(base, v, "scripts", "addons", "blender_mcp.py");
		if (existsSync(addonFile)) return { installed: true, path: addonFile };
		const addonPkg = join(base, v, "scripts", "addons", "blender_mcp", "__init__.py");
		if (existsSync(addonPkg)) return { installed: true, path: addonPkg };
	}
	return { installed: false, path: null };
}

export function resolveUvxBin(): string | null {
	const envVal = process.env.IDU_UVX?.trim();
	if (envVal && existsSync(envVal)) return envVal;
	const exe = process.platform === "win32" ? "uvx.exe" : "uvx";
	return searchPathDirs([exe], [join(homedir(), ".local", "bin")]);
}

function hasPythonModule(pythonExe: string, moduleName: string): boolean {
	const res = spawnSync(pythonExe, ["-c", `import ${moduleName}`], {
		env: { ...process.env, PYTHONNOUSERSITE: "1" },
		stdio: "ignore",
		timeout: 10_000,
	});
	return res.status === 0;
}

export function resolveSystemPython(requiredModule?: string): string | null {
	const envVal = process.env.IDU_PYTHON?.trim();
	const candidates: string[] = [];
	if (envVal && existsSync(envVal)) candidates.push(envVal);
	if (process.platform === "win32") {
		const localApp = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
		for (const ver of ["Python312", "Python311", "Python313"]) {
			const p = join(localApp, "Programs", "Python", ver, "python.exe");
			if (existsSync(p)) candidates.push(p);
		}
		const fromPath = searchPathDirs(["python.exe"]);
		if (fromPath) candidates.push(fromPath);
	} else {
		for (const bin of ["python3", "python"]) {
			const fromPath = searchPathDirs([bin]);
			if (fromPath) candidates.push(fromPath);
		}
	}
	for (const cand of candidates) {
		if (!requiredModule) return cand;
		const res = spawnSync(cand, ["-c", `import ${requiredModule}`], {
			stdio: "ignore",
			timeout: 10_000,
		});
		if (res.status === 0) return cand;
	}
	return candidates[0] ?? null;
}

export function resolveManimPython(projectRoot?: string): string | null {
	const envVal = process.env.IDU_MANIM_PYTHON?.trim();
	if (envVal && existsSync(envVal)) return envVal;
	const relExe = process.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python");
	const candidates: string[] = [];
	if (projectRoot) {
		candidates.push(join(projectRoot, ".venv", relExe), join(projectRoot, "venv", relExe));
	}
	candidates.push(join(getIduHome(), "venvs", "manim", relExe));
	for (const cand of candidates) {
		if (existsSync(cand) && hasPythonModule(cand, "manim")) return cand;
	}
	const sysPy = resolveSystemPython();
	if (sysPy && hasPythonModule(sysPy, "manim")) return sysPy;
	return null;
}

function resolveRemotionBinFromDir(baseDir: string): string | null {
	const pkgJsonPath = join(baseDir, "node_modules", "@remotion", "cli", "package.json");
	if (!existsSync(pkgJsonPath)) return null;
	try {
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
			bin?: string | Record<string, string>;
		};
		const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.remotion;
		if (!rel) return null;
		const full = resolve(dirname(pkgJsonPath), rel);
		return existsSync(full) ? full : null;
	} catch {
		return null;
	}
}

export function resolveRemotionCli(projectRoot?: string): string | null {
	const envVal = process.env.IDU_REMOTION_CLI?.trim();
	if (envVal && existsSync(envVal)) return envVal;
	if (projectRoot) {
		const local = resolveRemotionBinFromDir(projectRoot);
		if (local) return local;
	}
	const cached = resolveRemotionBinFromDir(join(getIduHome(), "tools", "remotion"));
	if (cached) return cached;
	if (process.platform === "win32" && process.env.APPDATA) {
		const globalRem = join(process.env.APPDATA, "npm", "node_modules", "@remotion", "cli", "remotion-cli.js");
		if (existsSync(globalRem)) return globalRem;
	}
	return null;
}

/* Resuelve el entry real de iduframe. En Windows un .cmd no es ejecutable por
   CreateProcess sin shell, asi que se apunta al .mjs y se corre con node: cero
   quoting de shell sobre rutas de proyecto con espacios. */
export function resolveIduframeEntry(explicit?: string): string | null {
	const target = explicit ?? process.env.IDUFRAME_CLI;
	if (target && existsSync(target)) return target;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const candidates = [
		process.env.APPDATA
			? join(process.env.APPDATA, "npm", "node_modules", "@wladimirfn", "iduframe", "src", "cli.mjs")
			: "",
		"/usr/local/lib/node_modules/@wladimirfn/iduframe/src/cli.mjs",
		"/usr/lib/node_modules/@wladimirfn/iduframe/src/cli.mjs",
		home ? join(home, ".npm-global", "lib", "node_modules", "@wladimirfn", "iduframe", "src", "cli.mjs") : "",
	].filter(Boolean);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/* Playwright puede estar instalado en el proyecto, user home (npm/pnpm), global o en cache de npx. */
export function resolvePlaywrightEntry(project: string): string | null {
	const explicit = process.env.PLAYWRIGHT_PATH;
	if (explicit && existsSync(explicit)) return explicit;
	const local = join(project, "node_modules", "playwright", "index.mjs");
	if (existsSync(local)) return local;
	const homeDir = process.env.USERPROFILE ?? process.env.HOME ?? "";
	if (homeDir) {
		const homeDirect = join(homeDir, "node_modules", "playwright", "index.mjs");
		if (existsSync(homeDirect)) return homeDirect;
		const homePnpm = join(homeDir, "node_modules", ".pnpm");
		if (existsSync(homePnpm)) {
			for (const entry of readdirSync(homePnpm)) {
				if (!entry.startsWith("playwright@")) continue;
				const candidate = join(homePnpm, entry, "node_modules", "playwright", "index.mjs");
				if (existsSync(candidate)) return candidate;
			}
		}
	}
	const npx = process.env.LOCALAPPDATA
		? join(process.env.LOCALAPPDATA, "npm-cache", "_npx")
		: join(process.env.HOME ?? "", ".npm", "_npx");
	if (existsSync(npx)) {
		for (const dir of readdirSync(npx)) {
			const candidate = join(npx, dir, "node_modules", "playwright", "index.mjs");
			if (existsSync(candidate)) return candidate;
		}
	}
	const globalNpm = process.env.APPDATA
		? join(process.env.APPDATA, "npm", "node_modules", "playwright", "index.mjs")
		: "";
	if (globalNpm && existsSync(globalNpm)) return globalNpm;
	return null;
}

export function buildVideoToolEnv(baseEnv: NodeJS.ProcessEnv = process.env, projectRoot?: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...baseEnv, PYTHONUTF8: "1" };
	const extraDirs: string[] = [];
	const ffmpeg = resolveFfmpegBin();
	const ffprobe = resolveFfprobeBin();
	const blender = resolveBlenderBin();
	const uvx = resolveUvxBin();
	const manimPy = resolveManimPython(projectRoot);
	if (ffmpeg) {
		env.IDU_FFMPEG = ffmpeg;
		extraDirs.push(dirname(ffmpeg));
	}
	if (ffprobe) {
		env.IDU_FFPROBE = ffprobe;
		extraDirs.push(dirname(ffprobe));
	}
	if (blender) {
		env.IDU_BLENDER = blender;
		extraDirs.push(dirname(blender));
	}
	if (uvx) {
		env.IDU_UVX = uvx;
		extraDirs.push(dirname(uvx));
	}
	if (manimPy) {
		env.IDU_MANIM_PYTHON = manimPy;
	}
	const existingPath = env.PATH ?? env.Path ?? "";
	const merged = [...new Set([...extraDirs, ...existingPath.split(delimiter).filter(Boolean)])].join(delimiter);
	env.PATH = merged;
	if ("Path" in env) env.Path = merged;
	return env;
}

export function probeVideoToolchain(projectRoot: string): VideoToolchainProbe {
	const ffmpegPath = resolveFfmpegBin();
	const ffprobePath = resolveFfprobeBin();
	const blenderPath = resolveBlenderBin();
	const blenderVer = blenderPath ? readFirstLineVersion(blenderPath, ["--version"]) : null;
	const addon = resolveBlenderAddonInfo(blenderVer);
	const uvxPath = resolveUvxBin();
	const manimPy = resolveManimPython(projectRoot);
	const manimEnv = manimPy ? { ...process.env, PYTHONNOUSERSITE: "1", PYTHONUTF8: "1" } : undefined;
	const manimVer = manimPy ? readFirstLineVersion(manimPy, ["-m", "manim", "--version"], manimEnv) : null;
	const roughVer = manimPy
		? readFirstLineVersion(manimPy, ["-c", "import importlib.metadata as m; print(m.version('rough'))"], manimEnv)
		: null;
	const latexBin = searchPathDirs(
		process.platform === "win32" ? ["pdflatex.exe", "xelatex.exe"] : ["pdflatex", "xelatex"],
	);
	const remotionCli = resolveRemotionCli(projectRoot);
	let remotionVer: string | null = null;
	if (remotionCli) {
		const remPkg = join(dirname(remotionCli), "package.json");
		if (existsSync(remPkg)) {
			try {
				remotionVer = (JSON.parse(readFileSync(remPkg, "utf8")) as { version?: string }).version ?? null;
			} catch {
				remotionVer = null;
			}
		}
		remotionVer ??= readFirstLineVersion(process.execPath, [remotionCli, "--version"]);
	}
	const iduframeCli = resolveIduframeEntry();
	let iduframeVer: string | null = null;
	if (iduframeCli) {
		const pkg = join(dirname(iduframeCli), "..", "package.json");
		if (existsSync(pkg)) {
			try {
				iduframeVer = (JSON.parse(readFileSync(pkg, "utf8")) as { version?: string }).version ?? null;
			} catch {
				iduframeVer = null;
			}
		}
	}
	const pyPath = resolveSystemPython("numpy") ?? resolveSystemPython();
	const pyVer = pyPath ? readFirstLineVersion(pyPath, ["--version"]) : null;

	return {
		ffmpeg: { path: ffmpegPath, version: ffmpegPath ? readFirstLineVersion(ffmpegPath, ["-version"]) : null, source: ffmpegPath ? "resolved" : null },
		ffprobe: { path: ffprobePath, version: ffprobePath ? readFirstLineVersion(ffprobePath, ["-version"]) : null, source: ffprobePath ? "resolved" : null },
		blender: { path: blenderPath, version: blenderVer, source: blenderPath ? "resolved" : null, addonInstalled: addon.installed, addonPath: addon.path },
		uvx: { path: uvxPath, version: uvxPath ? readFirstLineVersion(uvxPath, ["--version"]) : null, source: uvxPath ? "resolved" : null },
		manim: { python: manimPy, version: manimVer, rough: roughVer, latex: Boolean(latexBin) },
		remotion: { cli: remotionCli, version: remotionVer },
		iduframe: { cli: iduframeCli, version: iduframeVer },
		playwright: { entry: resolvePlaywrightEntry(projectRoot) },
		python: { path: pyPath, version: pyVer, source: pyPath ? "resolved" : null },
	};
}

export function formatToolchainProbe(probe: VideoToolchainProbe): string {
	const mark = (ok: boolean) => (ok ? "[OK]" : "[MISSING]");
	return [
		"=== idu-pi video toolchain ===",
		`  ${mark(Boolean(probe.ffmpeg.path))} ffmpeg     ${probe.ffmpeg.version ?? "not found"}${probe.ffmpeg.path ? ` (${probe.ffmpeg.path})` : ""}`,
		`  ${mark(Boolean(probe.ffprobe.path))} ffprobe    ${probe.ffprobe.version ?? "not found"}${probe.ffprobe.path ? ` (${probe.ffprobe.path})` : ""}`,
		`  ${mark(Boolean(probe.blender.path))} blender    ${probe.blender.version ?? "not found"}${probe.blender.path ? ` (${probe.blender.path})` : ""}`,
		`  ${mark(probe.blender.addonInstalled)} blenderMCP ${probe.blender.addonPath ?? "addon not installed (run: uvx mcp-for-blender install-addon)"}`,
		`  ${mark(Boolean(probe.uvx.path))} uvx        ${probe.uvx.version ?? "not found"}${probe.uvx.path ? ` (${probe.uvx.path})` : ""}`,
		`  ${mark(Boolean(probe.remotion.cli))} remotion   ${probe.remotion.version ?? "not found"}${probe.remotion.cli ? ` (${probe.remotion.cli})` : ""}`,
		`  ${mark(Boolean(probe.manim.python))} manim      ${probe.manim.version ?? "not found"}${probe.manim.rough ? ` + rough ${probe.manim.rough}` : ""} (latex: ${probe.manim.latex ? "yes" : "no"})`,
		`  ${mark(Boolean(probe.iduframe.cli))} iduframe   ${probe.iduframe.version ?? "not found"}${probe.iduframe.cli ? ` (${probe.iduframe.cli})` : ""}`,
		`  ${mark(Boolean(probe.playwright.entry))} playwright ${probe.playwright.entry ?? "not found"}`,
		`  ${mark(Boolean(probe.python.path))} python     ${probe.python.version ?? "not found"}${probe.python.path ? ` (${probe.python.path})` : ""}`,
	].join("\n");
}
