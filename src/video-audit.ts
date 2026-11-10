import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* Auditoría artística independiente de un proyecto de video.

   `references/visual-qa.md` era prosa: el mismo modelo que armaba una escena la
   aprobaba. Acá vive lo que vuelve ese veredicto verificable: el encargo que
   recibe el auditor, el parseo de su respuesta, y la evaluación del archivo
   `audit/visual-qa.json` que hace el gate de render.

   El archivo queda atado a lo que se auditó: el SHA-256 de cada keyframe y del
   contrato de dirección artística, y el intent y el autor que declaraba el
   brief. Si algo de eso cambia después, la auditoría vence. El gate protege
   contra saltearse la auditoría, no contra falsificar el archivo a mano. */

export const AUDIT_DIR = "audit";
export const AUDIT_FILE = "visual-qa.json";
export const AUDIT_VERSION = 1;

export type SceneVerdict = "pass" | "revise" | "block";

/* Los dos defectos que hacen que una pieza parezca una plantilla: un esqueleto
   repetido (check 4) y un artefacto real dibujado en vez de mostrado (check 10).
   Un `revise` que falle alguno frena el render igual que un `block`; el resto de
   los `revise` son avisos. */
export const BLOCKING_CHECKS = [4, 10];

export interface AuditScene {
	id: string;
	verdict: SceneVerdict;
	failed: number[];
	evidence: string;
	fix: string;
}

export interface AuditPiece {
	intent: "delivered" | "fell-back";
	became: string;
	variety: "pass" | "revise";
	rhythm: string;
	capabilityGaps: string[];
}

export interface AuditReply {
	piece: AuditPiece;
	scenes: AuditScene[];
}

export interface AuditInputs {
	keyframes: Record<string, string>;
	artDirection: string | null;
}

export interface AuditFile extends AuditReply {
	version: number;
	createdAt: string;
	intent: string;
	author: string;
	auditor: { profile: string; harness: string; model: string; runId: string };
	inputs: AuditInputs;
}

type ParseResult = { ok: true; reply: AuditReply } | { ok: false; error: string };

export function auditFilePath(project: string): string {
	return join(project, AUDIT_DIR, AUDIT_FILE);
}

/* Una escena es un keyframe aprobado `keyframes/eNN.png`. `e00-styleboard.png`
   es el artefacto del gate de estilo, no una escena. El id va en minúsculas; el
   nombre real del archivo se conserva porque en un disco que distingue
   mayúsculas `E01.PNG` no se abre como `e01.png`. */
function sceneKeyframeFiles(project: string): Map<string, string> {
	const dir = join(project, "keyframes");
	const files = new Map<string, string>();
	if (!existsSync(dir)) return files;
	for (const name of readdirSync(dir).sort()) {
		const id = /^(e\d{2,})\.png$/i.exec(name)?.[1].toLowerCase();
		if (id && id !== "e00" && !files.has(id)) files.set(id, name);
	}
	return files;
}

export function listSceneKeyframes(project: string): string[] {
	return [...sceneKeyframeFiles(project).keys()].sort();
}

export function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function collectAuditInputs(project: string, sceneIds: string[]): AuditInputs {
	const files = sceneKeyframeFiles(project);
	const keyframes: Record<string, string> = {};
	for (const id of sceneIds) {
		keyframes[id] = hashFile(join(project, "keyframes", files.get(id) ?? `${id}.png`));
	}
	const contract = join(project, "art-direction.md");
	return { keyframes, artDirection: existsSync(contract) ? hashFile(contract) : null };
}

const HARNESSES: Record<string, string> = {
	claude: "claude",
	"claude-code": "claude",
	antigravity: "antigravity",
	agy: "antigravity",
	commandcode: "commandcode",
	"command-code": "commandcode",
	cmdc: "commandcode",
	"gentle-shell": "gentle-shell",
	gshell: "gentle-shell",
	opencode: "opencode",
	codex: "codex",
	mcode: "mcode",
	pi: "pi",
	kimi: "kimi",
	qwen: "qwen",
};

/* El mismo harness aparece con varios nombres según quién lo escriba
   (`claude-code/fable`, `Command Code`, `opencode (nota)`). Dos nombres del
   mismo harness no son dos auditores: se busca el prefijo de palabras más largo
   que sea un harness conocido y, si no hay, se toma la primera palabra. */
export function normalizeHarness(name: string): string {
	const words = name
		.toLowerCase()
		.split("/")[0]
		.replace(/\(.*?\)/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	for (let count = words.length; count > 0; count--) {
		const known = HARNESSES[words.slice(0, count).join("-")] ?? HARNESSES[words.slice(0, count).join("")];
		if (known) return known;
	}
	return words[0] ?? "";
}

/* Lee `- Field: value` del brief, con o sin negrita. El valor sale de la misma
   línea; un campo vacío no toma el de la siguiente. */
export function readBriefField(text: string, field: string): string | null {
	const clean = text.replace(/```[\s\S]*?```/g, "").replace(/\*\*|`/g, "");
	const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = clean.match(new RegExp(`^[ \\t]*-[ \\t]*${escaped}:[ \\t]*(\\S.*)$`, "im"));
	return match ? match[1].trim() : null;
}

/* El intent es la primera palabra de su línea; el resto es la razón. */
export function readBriefIntent(text: string): string | null {
	const value = readBriefField(text, "Intent");
	return value ? value.split(/[\s;:,.]+/)[0].toLowerCase() || null : null;
}

export function buildAuditPrompt(options: {
	intent: string;
	sceneIds: string[];
	hasScript: boolean;
	hasTimeline: boolean;
	contractPath: string;
}): string {
	const { intent, sceneIds, hasScript, hasTimeline, contractPath } = options;
	const frames = sceneIds.map((id) => `keyframes/${id}.png`).join(", ");
	const reads = [
		"`style-brief.md` (the decisions, including the declared intent)",
		"`art-direction.md` (visual language, shot sheet, acceptance criteria)",
		hasScript ? "`guion.md` (the narration, verbatim)" : null,
		hasTimeline ? "`timeline.json` (beat timings)" : null,
	].filter(Boolean);
	return [
		"READ-ONLY artistic audit of a video project. Do not edit, create or delete any file.",
		"",
		"You are the independent auditor of this piece. It was built by a different model, which is not allowed to approve its own work: a full render is refused until you return a verdict. Your verdict is useful only if it is strict. A lenient pass ships a generic video; a `block` costs the author one more iteration.",
		"",
		`The piece declares the intent \`${intent}\`. Judge it as that kind of piece, not as an explainer by default.`,
		"",
		"Do this, in order:",
		`1. Read the audit contract at \`${contractPath}\`. It defines the ten checks, how check 1 is read for each intent, the same-card test, the intent test, and when a scene is \`pass\`, \`revise\` or \`block\`.`,
		`2. Read from the current directory: ${reads.join("; ")}.`,
		`3. Look at every keyframe image: ${frames}. Look at the pixels; do not infer the frame from the HTML or from the script. Also look at \`keyframes/e00-styleboard.png\` to know the approved look.`,
		"4. Audit each scene against its narration or beat, its row in the shot sheet, and its neighbours. Then audit the piece as a whole: variety across scenes, rhythm, and whether it delivers the declared intent or fell back to a narrated slide deck.",
		"",
		"Rules for the verdict:",
		"- Evidence is what is on screen, in concrete terms (what is where, what dominates). Never what the author intended.",
		"- Three or more scenes that share one layout skeleton fail check 4 on every scene that repeats it, unless the art direction names the repetition as a motif.",
		"- A beat that asserts the behaviour of a real command, test run, UI or file fails check 10 if the frame shows a labelled box or an invented stand-in instead of the artifact or its real output.",
		"- `block` is for a scene that misreads its beat, breaks the declared language, or duplicates a neighbour. Taste is never a reason.",
		"- A scene with any failed check is `revise` or `block`, never `pass`.",
		"- A failed check 4 (repeated skeleton) or check 10 (a real artifact drawn instead of shown) stops the render even on a `revise` scene, so list those check numbers in `failed` whenever they apply. Do not soften a verdict to avoid stopping the render.",
		"",
		"Reply with your reasoning in at most ten lines, then end with exactly one fenced JSON block in this shape and nothing after it:",
		"",
		"```json",
		"{",
		'  "piece": {',
		'    "intent": "delivered | fell-back",',
		'    "became": "what the piece became if it fell back, else empty",',
		'    "variety": "pass | revise",',
		'    "rhythm": "one paragraph: where it breathes, where it repeats",',
		'    "capabilityGaps": ["a shot the harness could not produce", "..."]',
		"  },",
		'  "scenes": [',
		'    { "id": "e01", "verdict": "pass | revise | block", "failed": [4, 10], "evidence": "what is on screen", "fix": "one concrete change, empty when pass" }',
		"  ]",
		"}",
		"```",
		"",
		`Include exactly one entry per scene, with these exact ids: ${sceneIds.join(", ")}. \`failed\` holds check numbers from the contract and is empty on \`pass\`.`,
	].join("\n");
}

function asText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function validateVerdict(raw: unknown, sceneIds: string[]): ParseResult {
	if (!raw || typeof raw !== "object") return { ok: false, error: "el bloque no es un objeto" };
	const data = raw as { piece?: Record<string, unknown>; scenes?: unknown };
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
	if (!Array.isArray(data.scenes)) return { ok: false, error: "falta `scenes` en el veredicto" };

	const scenes: AuditScene[] = [];
	for (const entry of data.scenes as Array<Record<string, unknown> | null>) {
		if (!entry || typeof entry !== "object") {
			return { ok: false, error: "`scenes` trae una entrada que no es una escena" };
		}
		const id = asText(entry.id).toLowerCase();
		const verdict = asText(entry.verdict).toLowerCase();
		if (verdict !== "pass" && verdict !== "revise" && verdict !== "block") {
			return { ok: false, error: `veredicto inválido en ${id || "una escena sin id"}: "${asText(entry.verdict)}"` };
		}
		const failed = Array.isArray(entry.failed)
			? entry.failed.map(Number).filter((n) => Number.isInteger(n) && n > 0)
			: [];
		scenes.push({ id, verdict, failed, evidence: asText(entry.evidence), fix: asText(entry.fix) });
	}

	/* Dos veredictos para una escena dejan al lector elegir cuál vale; un
	   `block` seguido de un `pass` no puede resolverse como `pass`. */
	const repeated = [...new Set(scenes.map((s) => s.id).filter((id, i, all) => all.indexOf(id) !== i))];
	if (repeated.length > 0) {
		return { ok: false, error: `más de un veredicto: ${repeated.join(", ")}` };
	}
	const seen = new Set(scenes.map((scene) => scene.id));
	const missing = sceneIds.filter((id) => !seen.has(id));
	if (missing.length > 0) return { ok: false, error: `el veredicto no cubre: ${missing.join(", ")}` };

	const contradictory = scenes.filter((scene) => scene.verdict === "pass" && scene.failed.length > 0);
	if (contradictory.length > 0) {
		return { ok: false, error: `pass con checks fallidos: ${contradictory.map((s) => s.id).join(", ")}` };
	}
	const unsupported = scenes.filter((scene) => scene.verdict !== "pass" && !scene.evidence);
	if (unsupported.length > 0) {
		return { ok: false, error: `veredicto sin evidencia en: ${unsupported.map((s) => s.id).join(", ")}` };
	}
	return {
		ok: true,
		reply: {
			piece: {
				intent,
				became: asText(piece.became),
				variety,
				rhythm: asText(piece.rhythm),
				capabilityGaps: Array.isArray(piece.capabilityGaps)
					? piece.capabilityGaps.map(asText).filter(Boolean)
					: [],
			},
			scenes: scenes.filter((scene) => sceneIds.includes(scene.id)),
		},
	};
}

/* El auditor razona en prosa y cierra con un bloque JSON. Se prueban los
   bloques cercados del último al primero y, si ninguno sirve, cada objeto que
   empiece en una llave del texto. Vale el primero que parsea y valida: un
   ejemplo suelto o una llave en la prosa no tapan el veredicto. */
export function parseAuditReply(text: string, sceneIds: string[]): ParseResult {
	const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim()).reverse();
	const lastBrace = text.lastIndexOf("}");
	for (let start = text.indexOf("{"); start !== -1 && start < lastBrace; start = text.indexOf("{", start + 1)) {
		candidates.push(text.slice(start, lastBrace + 1));
	}
	let firstError: string | null = null;
	for (const candidate of candidates) {
		let raw: unknown;
		try {
			raw = JSON.parse(candidate);
		} catch {
			continue;
		}
		const result = validateVerdict(raw, sceneIds);
		if (result.ok) return result;
		firstError ??= result.error;
	}
	return { ok: false, error: firstError ?? "la respuesta no trae un bloque JSON con el veredicto" };
}

/* Veredicto del gate sobre el archivo de auditoría. Errores bloquean el render
   completo; avisos no. */
export function evaluateAudit(project: string): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const rerun = `Corré \`idu-pi video audit --project "${project}"\`.`;
	const file = auditFilePath(project);
	if (!existsSync(file)) {
		return { errors: [`falta ${AUDIT_DIR}/${AUDIT_FILE}: nadie más que el autor miró la pieza. ${rerun}`], warnings };
	}
	let audit: AuditFile;
	try {
		audit = JSON.parse(readFileSync(file, "utf8")) as AuditFile;
	} catch {
		return { errors: [`${AUDIT_DIR}/${AUDIT_FILE} no es JSON válido. ${rerun}`], warnings };
	}
	if (
		!audit ||
		audit.version !== AUDIT_VERSION ||
		!audit.piece ||
		!Array.isArray(audit.scenes) ||
		!audit.inputs
	) {
		return { errors: [`${AUDIT_DIR}/${AUDIT_FILE} tiene un formato que este gate no reconoce. ${rerun}`], warnings };
	}

	const sceneIds = listSceneKeyframes(project);
	if (sceneIds.length === 0) {
		return { errors: ["no hay keyframes/eNN.png: no hay escenas que auditar."], warnings };
	}
	const current = collectAuditInputs(project, sceneIds);
	const audited = audit.inputs.keyframes ?? {};
	/* Vence por una escena que cambió, una nueva, o una que se auditó y ya no
	   está: en los tres casos la pieza que se entrega no es la que se miró. */
	const stale = [
		...sceneIds.filter((id) => audited[id] !== current.keyframes[id]),
		...Object.keys(audited).filter((id) => !sceneIds.includes(id)),
	];
	if (stale.length > 0) {
		errors.push(`auditoría vencida: ${stale.join(", ")} cambió, se agregó o se quitó después de auditar. ${rerun}`);
	}
	if (audit.inputs.artDirection !== current.artDirection) {
		errors.push(`auditoría vencida: art-direction.md cambió después de auditar. ${rerun}`);
	}

	/* El brief manda sobre lo que quedó anotado: si hoy declara otro intent, la
	   pieza se juzgó como otra cosa; si hoy nombra otro autor, la independencia
	   se mide contra ese. */
	const briefPath = join(project, "style-brief.md");
	const briefText = existsSync(briefPath) ? readFileSync(briefPath, "utf8") : "";
	const briefIntent = readBriefIntent(briefText);
	if (briefIntent && briefIntent !== asText(audit.intent).toLowerCase()) {
		errors.push(
			`auditoría vencida: el brief declara intent \`${briefIntent}\` y la pieza se auditó como \`${asText(audit.intent)}\`. ${rerun}`,
		);
	}
	const author = readBriefField(briefText, "Author") ?? asText(audit.author);
	const auditorHarness = asText(audit.auditor?.harness);
	if (!author || !auditorHarness) {
		errors.push("la auditoría no registra autor y auditor: no se puede comprobar que sean distintos.");
	} else if (normalizeHarness(author) === normalizeHarness(auditorHarness)) {
		errors.push(
			`auditoría no independiente: el autor (${author}) y el auditor (${asText(audit.auditor?.profile) || auditorHarness}) usan el mismo harness. Auditá con otro perfil.`,
		);
	}

	if (errors.length > 0) return { errors, warnings };

	if (asText(audit.piece.intent).toLowerCase() !== "delivered") {
		errors.push(
			`el auditor dice que la pieza no cumple su intent \`${audit.intent}\`${audit.piece.became ? `: quedó como ${audit.piece.became}` : ""}.`,
		);
	}
	/* El archivo pudo escribirse con otra versión del comando: un campo ausente
	   o con otra caja no debe tirar el gate ni abrirlo. */
	const byId = new Map<string, AuditScene>();
	for (const scene of audit.scenes) {
		if (!scene || typeof scene !== "object") continue;
		const id = asText(scene.id).toLowerCase();
		const previous = byId.get(id);
		/* Ante dos entradas para una escena gana la más severa. */
		if (!previous || asText(scene.verdict).toLowerCase() === "block") byId.set(id, scene);
	}
	for (const id of sceneIds) {
		const scene = byId.get(id);
		if (!scene) {
			errors.push(`la auditoría no trae veredicto para ${id}. ${rerun}`);
			continue;
		}
		const verdict = asText(scene.verdict).toLowerCase();
		const failed = Array.isArray(scene.failed) ? scene.failed : [];
		const checks = failed.length > 0 ? ` (checks ${failed.join(", ")})` : "";
		const line = `${id}${checks}: ${asText(scene.evidence)}${scene.fix ? ` -> ${scene.fix}` : ""}`;
		if (verdict === "block") errors.push(`escena bloqueada ${line}`);
		else if (verdict === "revise" && failed.some((n) => BLOCKING_CHECKS.includes(Number(n)))) {
			errors.push(`escena a corregir ${line}. Esqueleto repetido o artefacto real sin mostrar: bloquea el render`);
		} else if (verdict === "revise") warnings.push(`a revisar ${line}`);
		else if (verdict !== "pass") errors.push(`veredicto desconocido "${asText(scene.verdict)}" en ${id}. ${rerun}`);
	}
	if (asText(audit.piece.variety).toLowerCase() === "revise") {
		errors.push(`variedad: ${asText(audit.piece.rhythm)}. Una pieza que repite su esqueleto bloquea el render`);
	}
	return { errors, warnings };
}
