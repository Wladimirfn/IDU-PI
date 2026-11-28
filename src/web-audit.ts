import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAgentProfile } from "./fleets.js";
import {
	AUDIT_DIR,
	type AuditDelegateRequest,
	type AuditDelegateResult,
	hashFile,
	normalizeHarness,
	parseJsonVerdictWith,
	readBriefField,
	readBriefIntent,
} from "./video-audit.js";
import { resolveChromeBin, resolvePlaywrightEntry } from "./video-binaries.js";

export const WEB_AUDIT_FILE = "web-visual-qa.json";
export const WEB_AUDIT_VERSION = 1;
export const WEB_CAPTURES_DIR = "web-captures";
export const WEB_BLOCKING_CHECKS = [4, 9, 10];
export const REQUIRED_WEB_VIEWS = [
	"desktop-hero",
	"desktop-mid",
	"desktop-low",
	"desktop-full",
	"mobile-hero",
	"mobile-mid",
] as const;

export type WebDeliveryMode = "single-file" | "app-stack";
export type WebViewVerdict = "pass" | "revise" | "block";

export interface WebAuditView {
	id: string;
	verdict: WebViewVerdict;
	failed: number[];
	evidence: string;
	fix: string;
}

export interface WebAuditPiece {
	intent: "delivered" | "fell-back";
	became: string;
	variety: "pass" | "revise";
	rhythm: string;
	deliveryCompliant: boolean;
}

export interface WebAuditReply {
	piece: WebAuditPiece;
	views: WebAuditView[];
}

export interface WebAuditInputs {
	captures: Record<string, string>;
	metrics: string | null;
	artDirection: string | null;
	entry: string | null;
}

export interface WebAuditFile extends WebAuditReply {
	version: number;
	createdAt: string;
	intent: string;
	delivery: WebDeliveryMode;
	author: string;
	auditor: { profile: string; harness: string; model: string; runId: string };
	inputs: WebAuditInputs;
}

export interface WebCaptureMetrics {
	consoleErrors?: string[];
	pageErrors?: string[];
	failedRequests?: string[];
	desktopOverflowPx?: number;
	mobileOverflowPx?: number;
	brokenImages?: number;
	canvasCount?: number;
	zeroSizeCanvases?: number;
}

export interface WebAuditOptions {
	auditProfiles: string[];
	profiles: Record<string, { harness?: string }>;
	resolveContractPath: () => string | null;
	captureViews: (project: string, url?: string) => number;
	delegate: (request: AuditDelegateRequest) => Promise<AuditDelegateResult>;
	evaluateGate: (project: string) => { errors: string[]; warnings: string[] };
	log?: (message: string) => void;
	error?: (message: string) => void;
}

export function webAuditFilePath(project: string): string {
	return join(project, AUDIT_DIR, WEB_AUDIT_FILE);
}

export function webCapturesDir(project: string): string {
	return join(project, AUDIT_DIR, WEB_CAPTURES_DIR);
}

export function readWebBrief(project: string): {
	path: string | null;
	text: string;
	intent: string | null;
	author: string | null;
	delivery: string | null;
} {
	for (const name of ["web-brief.md", "style-brief.md"]) {
		const path = join(project, name);
		if (!existsSync(path)) continue;
		const text = readFileSync(path, "utf8");
		const rawDelivery = readBriefField(text, "Delivery");
		const delivery = rawDelivery ? rawDelivery.split(/[\s;:,.]+/)[0].toLowerCase() || null : null;
		return {
			path,
			text,
			intent: readBriefIntent(text),
			author: readBriefField(text, "Author"),
			delivery,
		};
	}
	return { path: null, text: "", intent: null, author: null, delivery: null };
}

export function isValidWebDelivery(value: string | null): value is WebDeliveryMode {
	return value === "single-file" || value === "app-stack";
}

export function validateWebDelivery(
	project: string,
	delivery: string | null,
	url?: string,
): string | null {
	if (!delivery) {
		return "el brief web no declara `Delivery:` (`single-file` o `app-stack`).";
	}
	if (!isValidWebDelivery(delivery)) {
		return `delivery desconocido "${delivery}". Valores válidos: single-file, app-stack.`;
	}
	if (delivery === "single-file") {
		if (!url && !existsSync(join(project, "index.html"))) {
			return "Delivery `single-file` requiere `index.html` en la raíz del proyecto.";
		}
		return null;
	}
	if (!existsSync(join(project, "package.json"))) {
		return "Delivery `app-stack` requiere `package.json` con dependencias curadas (no HTML monolítico).";
	}
	if (!url && !existsSync(join(project, "dist", "index.html")) && !existsSync(join(project, "index.html"))) {
		return "Delivery `app-stack` requiere `dist/index.html` compilado (`npm run build`) o `--url`.";
	}
	return null;
}

export function listCapturedWebViews(project: string): Map<string, string> {
	const dir = webCapturesDir(project);
	const files = new Map<string, string>();
	if (!existsSync(dir)) return files;
	for (const name of readdirSync(dir).sort()) {
		const m = /^([a-z0-9-]+)\.png$/i.exec(name);
		if (m) files.set(m[1].toLowerCase(), name);
	}
	return files;
}

export function collectWebAuditInputs(project: string, viewIds: string[]): WebAuditInputs {
	const dir = webCapturesDir(project);
	const files = listCapturedWebViews(project);
	const captures: Record<string, string> = {};
	for (const id of viewIds) {
		const file = files.get(id) ?? `${id}.png`;
		const full = join(dir, file);
		if (existsSync(full)) captures[id] = hashFile(full);
	}
	const metricsPath = join(dir, "metrics.json");
	const contractPath = join(project, "art-direction.md");
	const entryCandidate = existsSync(join(project, "package.json"))
		? join(project, "package.json")
		: existsSync(join(project, "index.html"))
			? join(project, "index.html")
			: null;
	return {
		captures,
		metrics: existsSync(metricsPath) ? hashFile(metricsPath) : null,
		artDirection: existsSync(contractPath) ? hashFile(contractPath) : null,
		entry: entryCandidate ? hashFile(entryCandidate) : null,
	};
}

export function resolveWebCaptureScript(): string | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const cand = join(root, "skills-bundle", "web-craft", "capture_web.mjs");
	return existsSync(cand) ? cand : null;
}

export function resolveWebQaContract(): string | null {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const cand = join(root, "skills-bundle", "web-craft", "references", "web-visual-qa.md");
	return existsSync(cand) ? cand : null;
}

export function runWebCapture(project: string, url?: string): number {
	const script = resolveWebCaptureScript();
	if (!script) {
		console.error("No encontré skills-bundle/web-craft/capture_web.mjs en el paquete.");
		return 1;
	}
	const args = [script, "--project", project];
	if (url) args.push("--url", url);
	const playwright = resolvePlaywrightEntry(project);
	if (playwright) args.push("--playwright", playwright);
	const chrome = resolveChromeBin();
	if (chrome) args.push("--chrome", chrome);
	const res = spawnSync(process.execPath, args, { stdio: "inherit", cwd: project });
	return res.status ?? 1;
}

function asText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function validateWebVerdict(
	raw: unknown,
	viewIds: string[],
): { ok: true; reply: WebAuditReply } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object") return { ok: false, error: "el bloque no es un objeto" };
	const data = raw as { piece?: Record<string, unknown>; views?: unknown };
	const piece = data.piece;
	if (!piece || typeof piece !== "object") return { ok: false, error: "falta `piece` en el veredicto" };
	const intent = asText(piece.intent).toLowerCase();
	if (intent !== "delivered" && intent !== "fell-back") {
		return { ok: false, error: `\`piece.intent\` inválido: "${asText(piece.intent)}"` };
	}
	const variety = asText(piece.variety).toLowerCase();
	if (variety !== "pass" && variety !== "revise") {
		return { ok: false, error: `\`piece.variety\` inválido: "${asText(piece.variety)}"` };
	}
	if (!Array.isArray(data.views)) return { ok: false, error: "falta `views` en el veredicto" };

	const views: WebAuditView[] = [];
	for (const entry of data.views as Array<Record<string, unknown> | null>) {
		if (!entry || typeof entry !== "object") {
			return { ok: false, error: "`views` trae una entrada que no es una vista" };
		}
		const id = asText(entry.id).toLowerCase();
		const verdict = asText(entry.verdict).toLowerCase();
		if (verdict !== "pass" && verdict !== "revise" && verdict !== "block") {
			return { ok: false, error: `veredicto inválido en ${id || "vista sin id"}: "${asText(entry.verdict)}"` };
		}
		const failed = Array.isArray(entry.failed)
			? entry.failed.map(Number).filter((n) => Number.isInteger(n) && n > 0)
			: [];
		views.push({ id, verdict, failed, evidence: asText(entry.evidence), fix: asText(entry.fix) });
	}

	const repeated = [...new Set(views.map((v) => v.id).filter((id, i, all) => all.indexOf(id) !== i))];
	if (repeated.length > 0) return { ok: false, error: `más de un veredicto: ${repeated.join(", ")}` };

	const seen = new Set(views.map((v) => v.id));
	const missing = viewIds.filter((id) => !seen.has(id));
	if (missing.length > 0) return { ok: false, error: `el veredicto no cubre: ${missing.join(", ")}` };

	const contradictory = views.filter((v) => v.verdict === "pass" && v.failed.length > 0);
	if (contradictory.length > 0) {
		return { ok: false, error: `pass con checks fallidos: ${contradictory.map((v) => v.id).join(", ")}` };
	}
	const unsupported = views.filter((v) => v.verdict !== "pass" && !v.evidence);
	if (unsupported.length > 0) {
		return { ok: false, error: `veredicto sin evidencia en: ${unsupported.map((v) => v.id).join(", ")}` };
	}

	return {
		ok: true,
		reply: {
			piece: {
				intent,
				became: asText(piece.became),
				variety,
				rhythm: asText(piece.rhythm),
				deliveryCompliant: piece.deliveryCompliant !== false,
			},
			views: views.filter((v) => viewIds.includes(v.id)),
		},
	};
}

export function parseWebAuditReply(
	text: string,
	viewIds: string[],
): { ok: true; reply: WebAuditReply } | { ok: false; error: string } {
	return parseJsonVerdictWith(text, (raw) => validateWebVerdict(raw, viewIds));
}

export function buildWebAuditPrompt(options: {
	briefName: string;
	intent: string;
	delivery: WebDeliveryMode;
	viewIds: string[];
	contractPath: string;
}): string {
	const captures = options.viewIds.map((id) => `audit/web-captures/${id}.png`).join(", ");
	return [
		"READ-ONLY artistic and craft audit of a web project. Do not edit, create or delete any file.",
		"",
		"You are the independent cross-harness auditor of this website/app. The authoring model cannot approve its own UI.",
		`Declared intent: \`${options.intent}\`. Declared delivery mode: \`${options.delivery}\`.`,
		"",
		"Do this in order:",
		`1. Read the web QA contract at \`${options.contractPath}\` (defines checks 1-10, responsive check 4, delivery mode check 9, proof check 10).`,
		`2. Read \`${options.briefName}\`, \`art-direction.md\`, \`audit/web-captures/metrics.json\`, and \`${options.delivery === "app-stack" ? "package.json" : "index.html"}\`.`,
		`3. Inspect EVERY captured screenshot pixel-by-pixel: ${captures}. Do not infer visual appearance from HTML/CSS code.`,
		"4. Audit each captured view and the whole site for focal hierarchy, 6-axis fidelity, responsive integrity (desktop vs mobile), section variety (same-card test), icon craft, and delivery-mode compliance.",
		"",
		"Reply with up to 10 lines of reasoning, then end with exactly one fenced JSON block:",
		"",
		"```json",
		"{",
		'  "piece": {',
		'    "intent": "delivered | fell-back",',
		'    "became": "what it fell back to if fell-back, else empty",',
		'    "variety": "pass | revise",',
		'    "rhythm": "one paragraph on section variety and pacing",',
		'    "deliveryCompliant": true',
		"  },",
		'  "views": [',
		'    { "id": "desktop-hero", "verdict": "pass | revise | block", "failed": [], "evidence": "what is visible", "fix": "" }',
		"  ]",
		"}",
		"```",
		"",
		`Include one entry per view id: ${options.viewIds.join(", ")}.`,
	].join("\n");
}

export function evaluateWebAudit(project: string): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const rerun = `Corré \`idu-pi web audit --project "${project}"\`.`;
	const file = webAuditFilePath(project);
	if (!existsSync(file)) {
		return { errors: [`falta ${AUDIT_DIR}/${WEB_AUDIT_FILE}. ${rerun}`], warnings };
	}
	let audit: WebAuditFile;
	try {
		audit = JSON.parse(readFileSync(file, "utf8")) as WebAuditFile;
	} catch {
		return { errors: [`${AUDIT_DIR}/${WEB_AUDIT_FILE} no es JSON válido. ${rerun}`], warnings };
	}
	if (!audit || audit.version !== WEB_AUDIT_VERSION || !audit.piece || !Array.isArray(audit.views) || !audit.inputs) {
		return { errors: [`${AUDIT_DIR}/${WEB_AUDIT_FILE} tiene un formato inválido. ${rerun}`], warnings };
	}

	const captured = listCapturedWebViews(project);
	const viewIds = [...captured.keys()].sort();
	if (viewIds.length === 0) {
		return { errors: [`no hay capturas en ${AUDIT_DIR}/${WEB_CAPTURES_DIR}/. ${rerun}`], warnings };
	}
	const current = collectWebAuditInputs(project, viewIds);
	const auditedCaps = audit.inputs.captures ?? {};
	const staleCaps = [
		...viewIds.filter((id) => auditedCaps[id] !== current.captures[id]),
		...Object.keys(auditedCaps).filter((id) => !viewIds.includes(id)),
	];
	if (staleCaps.length > 0) {
		errors.push(`web audit vencida: captura(s) ${staleCaps.join(", ")} cambió/cambiaron. ${rerun}`);
	}
	if (audit.inputs.artDirection !== current.artDirection) {
		errors.push(`web audit vencida: art-direction.md cambió después de auditar. ${rerun}`);
	}
	if (audit.inputs.metrics !== current.metrics) {
		errors.push(`web audit vencida: metrics.json cambió después de auditar. ${rerun}`);
	}
	if (audit.inputs.entry !== current.entry) {
		errors.push(`web audit vencida: archivo de entrada cambió después de auditar. ${rerun}`);
	}

	const brief = readWebBrief(project);
	if (brief.intent && brief.intent !== asText(audit.intent).toLowerCase()) {
		errors.push(`web audit vencida: el brief declara intent \`${brief.intent}\`, auditado como \`${audit.intent}\`. ${rerun}`);
	}
	if (brief.delivery && brief.delivery !== asText(audit.delivery).toLowerCase()) {
		errors.push(`web audit vencida: el brief declara delivery \`${brief.delivery}\`, auditado como \`${audit.delivery}\`. ${rerun}`);
	}
	const author = brief.author ?? asText(audit.author);
	const auditorHarness = asText(audit.auditor?.harness);
	if (!author || !auditorHarness) {
		errors.push("web audit sin autor o auditor: no se puede verificar independencia.");
	} else if (normalizeHarness(author) === normalizeHarness(auditorHarness)) {
		errors.push(`web audit no independiente: autor (${author}) y auditor (${auditorHarness}) comparten harness.`);
	}

	// Deterministic runtime checks from metrics.json
	const metricsPath = join(webCapturesDir(project), "metrics.json");
	if (existsSync(metricsPath)) {
		try {
			const m = JSON.parse(readFileSync(metricsPath, "utf8")) as WebCaptureMetrics;
			if ((m.consoleErrors?.length ?? 0) > 0) {
				errors.push(`runtime console error(s): ${m.consoleErrors!.slice(0, 3).join("; ")}`);
			}
			if ((m.pageErrors?.length ?? 0) > 0) {
				errors.push(`runtime page error(s): ${m.pageErrors!.slice(0, 3).join("; ")}`);
			}
			if ((m.brokenImages ?? 0) > 0) {
				errors.push(`imágenes rotas en runtime: ${m.brokenImages}`);
			}
			if ((m.mobileOverflowPx ?? 0) > 2) {
				errors.push(`overflow horizontal en mobile: ${m.mobileOverflowPx}px`);
			}
			if ((m.desktopOverflowPx ?? 0) > 2) {
				warnings.push(`overflow horizontal en desktop: ${m.desktopOverflowPx}px`);
			}
			if ((m.zeroSizeCanvases ?? 0) > 0) {
				warnings.push(`canvas sin tamaño visible: ${m.zeroSizeCanvases}`);
			}
		} catch {
			errors.push("metrics.json no es JSON válido.");
		}
	}

	if (errors.length > 0) return { errors, warnings };

	if (asText(audit.piece.intent).toLowerCase() !== "delivered") {
		errors.push(`web audit: la pieza no cumplió su intent \`${audit.intent}\`${audit.piece.became ? `: quedó como ${audit.piece.became}` : ""}.`);
	}
	if (audit.piece.deliveryCompliant === false) {
		errors.push(`web audit: incumple el modo Delivery \`${audit.delivery}\`.`);
	}
	if (asText(audit.piece.variety).toLowerCase() === "revise") {
		errors.push(`web audit variedad: ${asText(audit.piece.rhythm)}`);
	}

	const byId = new Map<string, WebAuditView>();
	for (const view of audit.views) {
		if (!view || typeof view !== "object") continue;
		const id = asText(view.id).toLowerCase();
		const prev = byId.get(id);
		if (!prev || asText(view.verdict).toLowerCase() === "block") byId.set(id, view);
	}
	for (const id of viewIds) {
		const view = byId.get(id);
		if (!view) {
			errors.push(`web audit no cubre la vista ${id}. ${rerun}`);
			continue;
		}
		const verdict = asText(view.verdict).toLowerCase();
		const failed = Array.isArray(view.failed) ? view.failed : [];
		const checks = failed.length > 0 ? ` (checks ${failed.join(", ")})` : "";
		const line = `${id}${checks}: ${asText(view.evidence)}${view.fix ? ` -> ${view.fix}` : ""}`;
		if (verdict === "block") errors.push(`vista bloqueada ${line}`);
		else if (verdict === "revise" && failed.some((n) => WEB_BLOCKING_CHECKS.includes(Number(n)))) {
			errors.push(`vista a corregir ${line} (check bloqueante)`);
		} else if (verdict === "revise") {
			warnings.push(`a revisar ${line}`);
		} else if (verdict !== "pass") {
			errors.push(`veredicto desconocido "${asText(view.verdict)}" en ${id}`);
		}
	}

	return { errors, warnings };
}

export async function runWebAuditCore(
	project: string,
	options: {
		profile?: string;
		url?: string;
		noCapture?: boolean;
		timeoutMs?: number;
	},
	deps: WebAuditOptions,
): Promise<number> {
	const log = deps.log ?? ((m: string) => console.log(m));
	const error = deps.error ?? ((m: string) => console.error(m));

	const brief = readWebBrief(project);
	if (!brief.path) {
		error("web audit: falta web-brief.md (o style-brief.md).");
		return 1;
	}
	if (!brief.intent) {
		error("web audit: el brief no declara `Intent:`.");
		return 1;
	}
	if (!brief.author) {
		error("web audit: el brief no declara `Author:`. Agregá `- Author: <harness>/<modelo>`.");
		return 1;
	}
	const deliveryErr = validateWebDelivery(project, brief.delivery, options.url);
	if (deliveryErr) {
		error(`web audit: ${deliveryErr}`);
		return 1;
	}
	if (!existsSync(join(project, "art-direction.md"))) {
		error("web audit: falta art-direction.md.");
		return 1;
	}
	const contractPath = deps.resolveContractPath();
	if (!contractPath) {
		error("web audit: no encontré references/web-visual-qa.md en el paquete.");
		return 1;
	}

	if (!options.noCapture) {
		const capCode = deps.captureViews(project, options.url);
		if (capCode !== 0) return capCode;
	}
	const viewIds = [...listCapturedWebViews(project).keys()].sort();
	if (viewIds.length === 0) {
		error("web audit: no hay capturas PNG en audit/web-captures/.");
		return 1;
	}

	const authorHarness = normalizeHarness(brief.author);
	const candidates = options.profile ? [options.profile] : deps.auditProfiles;
	let profileName: string | undefined;
	for (const candidate of candidates) {
		const resolved = resolveAgentProfile(deps.profiles, candidate);
		if (resolved?.profile?.harness && normalizeHarness(resolved.profile.harness) !== authorHarness) {
			profileName = resolved.resolvedName;
			break;
		}
	}
	if (!profileName) {
		error(`web audit: ningún perfil disponible es de un harness distinto del autor (${brief.author}).`);
		return 1;
	}

	const inputs = collectWebAuditInputs(project, viewIds);
	log(`web audit: ${viewIds.length} vista(s), delivery ${brief.delivery}, auditor ${profileName}...`);

	let result: AuditDelegateResult;
	try {
		result = await deps.delegate({
			task: buildWebAuditPrompt({
				briefName: brief.path.endsWith("web-brief.md") ? "web-brief.md" : "style-brief.md",
				intent: brief.intent,
				delivery: brief.delivery as WebDeliveryMode,
				viewIds,
				contractPath,
			}),
			profile: profileName,
			profileExplicit: true,
			parentOrchestrator: "cli",
			workingDir: project,
			timeoutMs: options.timeoutMs ?? 900_000,
		});
	} catch (err) {
		error(`web audit: no se pudo despachar el auditor: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
	if (result.status !== "completed") {
		error(`web audit: el auditor terminó en "${result.status}". Log: ${result.logPath}`);
		return 1;
	}

	const parsed = parseWebAuditReply(result.summary ?? "", viewIds);
	const auditDir = join(project, AUDIT_DIR);
	mkdirSync(auditDir, { recursive: true });
	if (!parsed.ok) {
		const rawPath = join(auditDir, "web-visual-qa.raw.txt");
		writeFileSync(rawPath, result.summary ?? "", "utf8");
		error(`web audit: ${parsed.error}. Respuesta guardada en ${rawPath}.`);
		return 1;
	}

	const record: WebAuditFile = {
		version: WEB_AUDIT_VERSION,
		createdAt: new Date().toISOString(),
		intent: brief.intent,
		delivery: brief.delivery as WebDeliveryMode,
		author: brief.author,
		auditor: {
			profile: profileName,
			harness: result.harness,
			model: result.model ?? "",
			runId: result.runId,
		},
		inputs,
		...parsed.reply,
	};
	writeFileSync(webAuditFilePath(project), `${JSON.stringify(record, null, 2)}\n`, "utf8");

	const { errors, warnings } = deps.evaluateGate(project);
	for (const w of warnings) log(`web audit (aviso): ${w}`);
	if (errors.length > 0) {
		for (const e of errors) error(`web audit: ${e}`);
		return 1;
	}
	log(`web audit: ok (${webAuditFilePath(project)})`);
	return 0;
}
