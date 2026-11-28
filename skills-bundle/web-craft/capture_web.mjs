#!/usr/bin/env node
/**
 * Captures multi-viewport screenshots and DOM/runtime diagnostics for `idu-pi web audit`.
 *
 * Usage:
 *   node capture_web.mjs --project <dir> [--url <http|file>] [--out-dir <dir>] [--playwright <path>] [--chrome <path>]
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
}

const projectRoot = resolve(arg("project", process.cwd()));
const outDir = resolve(arg("out-dir", join(projectRoot, "audit", "web-captures")));
const explicitUrl = arg("url", "");
mkdirSync(outDir, { recursive: true });

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
};

async function loadChromium() {
	const explicit = arg("playwright", "") || process.env.PLAYWRIGHT_PATH;
	if (explicit) return (await import(pathToFileURL(explicit).href)).chromium;
	try {
		return (await import("playwright")).chromium;
	} catch {
		const home = homedir();
		const homeDirect = join(home, "node_modules", "playwright", "index.mjs");
		if (existsSync(homeDirect)) return (await import(pathToFileURL(homeDirect).href)).chromium;
		const homePnpm = join(home, "node_modules", ".pnpm");
		if (existsSync(homePnpm)) {
			for (const entry of readdirSync(homePnpm)) {
				if (!entry.startsWith("playwright@")) continue;
				const cand = join(homePnpm, entry, "node_modules", "playwright", "index.mjs");
				if (existsSync(cand)) return (await import(pathToFileURL(cand).href)).chromium;
			}
		}
		console.error("Playwright not found. Install it or pass --playwright <path>.");
		process.exit(1);
	}
}

function findChrome() {
	const explicit = arg("chrome", "") || process.env.CHROME_PATH;
	if (explicit && existsSync(explicit)) return explicit;
	const candidates =
		process.platform === "win32"
			? [
					"C:/Program Files/Google/Chrome/Application/chrome.exe",
					"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
					"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
					"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
				]
			: process.platform === "darwin"
				? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
				: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
	return candidates.find(existsSync);
}

function startStaticServer(rootDir) {
	return new Promise((resolveServer, reject) => {
		const server = createServer((req, res) => {
			const cleanUrl = (req.url || "/").split("?")[0].split("#")[0];
			const rel = decodeURIComponent(cleanUrl).replace(/^\/+/, "");
			let target = resolve(rootDir, rel || "index.html");
			if (!target.startsWith(resolve(rootDir))) {
				res.writeHead(403);
				res.end("Forbidden");
				return;
			}
			if (existsSync(target) && statSync(target).isDirectory()) {
				target = join(target, "index.html");
			}
			if (!existsSync(target)) {
				if (rel === "favicon.ico") {
					res.writeHead(204);
					res.end();
					return;
				}
				const fallback = join(rootDir, "index.html");
				if (existsSync(fallback) && !extname(target)) {
					target = fallback;
				} else {
					res.writeHead(404);
					res.end("Not found");
					return;
				}
			}
			const ext = extname(target).toLowerCase();
			res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
			res.end(readFileSync(target));
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			resolveServer({ server, url: `http://127.0.0.1:${addr.port}/` });
		});
	});
}

let staticHandle = null;
let targetUrl = explicitUrl;
let entrySource = "url";

if (!targetUrl) {
	const distIndex = join(projectRoot, "dist", "index.html");
	const rootIndex = join(projectRoot, "index.html");
	if (existsSync(distIndex)) {
		staticHandle = await startStaticServer(join(projectRoot, "dist"));
		targetUrl = staticHandle.url;
		entrySource = "dist";
	} else if (existsSync(rootIndex)) {
		targetUrl = pathToFileURL(rootIndex).href;
		entrySource = "index.html";
	} else {
		console.error("No dist/index.html or index.html found to capture. Run build or pass --url.");
		process.exit(1);
	}
}

const chromium = await loadChromium();
const chrome = findChrome();
const browser = await chromium.launch({
	...(chrome ? { executablePath: chrome } : {}),
	args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
});

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

try {
	const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
	const page = await desktop.newPage();
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => pageErrors.push(err.message));
	page.on("requestfailed", (req) => failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText || "failed"})`));

	await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => page.goto(targetUrl, { waitUntil: "load" }));
	await page.evaluate(() => document.fonts?.ready).catch(() => {});
	await page.waitForTimeout(700);
	await page.screenshot({ path: join(outDir, "desktop-hero.png") });

	const scrollHeight = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
	await page.evaluate((y) => window.scrollTo(0, y), Math.round(Math.max(0, (scrollHeight - 900) * 0.45)));
	await page.waitForTimeout(650);
	await page.screenshot({ path: join(outDir, "desktop-mid.png") });

	await page.evaluate((y) => window.scrollTo(0, y), Math.round(Math.max(0, (scrollHeight - 900) * 0.85)));
	await page.waitForTimeout(650);
	await page.screenshot({ path: join(outDir, "desktop-low.png") });

	await page.evaluate(() => window.scrollTo(0, 0));
	await page.waitForTimeout(300);
	await page.screenshot({ path: join(outDir, "desktop-full.png"), fullPage: true });

	const desktopDiag = await page.evaluate(() => {
		const imgs = [...document.querySelectorAll("img")];
		const brokenImages = imgs.filter((im) => im.complete && im.naturalWidth === 0).length;
		const canvases = [...document.querySelectorAll("canvas")];
		const zeroSizeCanvases = canvases.filter((c) => {
			const r = c.getBoundingClientRect();
			return r.width < 2 || r.height < 2;
		}).length;
		const interactiveCount = document.querySelectorAll("button, a[href], input, select, [role='button']").length;
		return {
			desktopOverflowPx: Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth)),
			brokenImages,
			canvasCount: canvases.length,
			zeroSizeCanvases,
			interactiveCount,
			scrollHeight: Math.round(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)),
		};
	});
	await desktop.close();

	const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
	const mPage = await mobile.newPage();
	mPage.on("pageerror", (err) => pageErrors.push(`mobile: ${err.message}`));
	await mPage.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => mPage.goto(targetUrl, { waitUntil: "load" }));
	await mPage.evaluate(() => document.fonts?.ready).catch(() => {});
	await mPage.waitForTimeout(700);
	await mPage.screenshot({ path: join(outDir, "mobile-hero.png") });

	const mScroll = await mPage.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
	await mPage.evaluate((y) => window.scrollTo(0, y), Math.round(Math.max(0, (mScroll - 844) * 0.45)));
	await mPage.waitForTimeout(650);
	await mPage.screenshot({ path: join(outDir, "mobile-mid.png") });

	const mobileOverflowPx = await mPage.evaluate(() => Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth)));
	await mPage.emulateMedia({ reducedMotion: "reduce" });
	await mPage.waitForTimeout(200);
	await mobile.close();

	const metrics = {
		url: targetUrl,
		entrySource,
		capturedAt: new Date().toISOString(),
		consoleErrors,
		pageErrors,
		failedRequests,
		...desktopDiag,
		mobileOverflowPx,
		reducedMotionTested: true,
	};
	writeFileSync(join(outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
	console.log(
		`web capture: ok (${outDir}) | overflow desktop=${metrics.desktopOverflowPx}px mobile=${metrics.mobileOverflowPx}px | errors=${consoleErrors.length + pageErrors.length}`,
	);
} finally {
	await browser.close();
	if (staticHandle) staticHandle.server.close();
}
