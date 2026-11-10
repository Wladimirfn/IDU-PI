import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/* Auditoría artística independiente de un proyecto de video.

   `references/visual-qa.md` era prosa: el mismo modelo que armaba una escena la
   aprobaba. Acá vive lo que vuelve ese veredicto verificable: el encargo que
   recibe el auditor, el parseo de su respuesta, y la evaluación del archivo
   `audit/visual-qa.json` que hace el gate de render.

   El archivo queda atado a los bytes auditados (SHA-256 de cada keyframe y del
   contrato de dirección artística). Un keyframe que cambia después de la
   auditoría la invalida. El gate protege contra saltearse la auditoría, no
   contra falsificar el archivo a mano. */

export const AUDIT_DIR = "audit";
export const AUDIT_FILE = "visual-qa.json";
export const AUDIT_VERSION = 1;

export type SceneVerdict = "pass" | "revise" | "block";

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

export function auditFilePath(project: string): string {
	return join(project, AUDIT_DIR, AUDIT_FILE);
}

/* Una escena es un keyframe aprobado `keyframes/eNN.png`. `e00-styleboard.png`
   es el artefacto del gate de estilo, no una escena. */
export function listSceneKeyframes(project: string): string[] {
	const dir = join(project, "keyframes");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((name) => /^(e\d{2,})\.png$/i.exec(name)?.[1].toLowerCase())
		.filter((id): id is string => Boolean(id) && id !== "e00")
		.sort();
}

export function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function collectAuditInputs(project: string, sceneIds: string[]): AuditInputs {
	const keyframes: Record<string, string> = {};
	for (const id of sceneIds) keyframes[id] = hashFile(join(project, "keyframes", `${id}.png`));
	const contract = join(project, "art-direction.md");
	return { keyframes, artDirection: existsSync(contract) ? hashFile(contract) : null };
}

const HARNESS_ALIASES: Record<string, string> = {
	"claude-code": "claude",
	agy: "antigravity",
	cmdc: "commandcode",
	"command-code": "commandcode",
	gshell: "gentle-shell",
};

/* El mismo harness aparece con varios nombres según quién lo escriba. Dos
   nombres del mismo harness no son dos auditores. */
export function normalizeHarness(name: string): string {
	/* `claude-code/fable (nota)` y `claude-code` nombran el mismo harness. */
	const key = name.trim().toLowerCase().split(/[\s/]+/)[0];
	return HARNESS_ALIASES[key] ?? key;
}

/* Lee `- Field: value` del brief, con o sin negrita. El valor sale de la misma
   línea; un campo vacío no toma el de la siguiente. */
export function readBriefField(text: string, field: string): string | null {
	const clean = text.replace(/```[\s\S]*?```/g, "").replace(/\*\*|`/g, "");
	const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = clean.match(new RegExp(`^[ \\t]*-[ \\t]*${escaped}:[ \\t]*(\\S.*)$`, "im"));
	return match ? match[1].trim() : null;
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
		`Include one entry per scene, with these exact ids: ${sceneIds.join(", ")}. \`failed\` holds check numbers from the contract and is empty on \`pass\`.`,
	].join("\n");
}

function asText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/* El auditor razona en prosa y cierra con un bloque JSON. Se toma el último
   bloque cercado; si no hay, el último objeto que parsee. */
export function parseAuditReply(
	text: string,
	sceneIds: string[],
): { ok: true; reply: AuditReply } | { ok: false; error: string } {
	const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim());
	const candidates = fenced.length > 0 ? fenced.reverse() : [text.slice(text.indexOf("{"))];
	let raw: unknown;
	for (const candidate of candidates) {
		try {
			raw = JSON.parse(candidate);
			break;
		} catch {
			/* se prueba el anterior */
		}
	}
	if (!raw || typeof raw !== "object") {
		return { ok: false, error: "la respuesta no trae un bloque JSON con el veredicto" };
	}
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
		const verdict = asText(entry?.verdict).toLowerCase();
		if (verdict !== "pass" && verdict !== "revise" && verdict !== "block") {
			return { ok: false, error: `veredicto inválido en ${id || "una escena sin id"}: "${asText(entry?.verdict)}"` };
		}
		const failed = Array.isArray(entry.failed)
			? entry.failed.map(Number).filter((n) => Number.isInteger(n) && n > 0)
			: [];
		scenes.push({ id, verdict, failed, evidence: asText(entry.evidence), fix: asText(entry.fix) });
	}
	const seen = new Set(scenes.map((scene) => scene.id));
	const missing = sceneIds.filter((id) => !seen.has(id));
	if (missing.length > 0) {
		return { ok: false, error: `el veredicto no cubre: ${missing.join(", ")}` };
	}
	const unsupported = scenes.filter((scene) => scene.verdict !== "pass" && !scene.evidence);
	if (unsupported.length > 0) {
		return {
			ok: false,
			error: `veredicto sin evidencia en: ${unsupported.map((scene) => scene.id).join(", ")}`,
		};
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
	if (audit.version !== AUDIT_VERSION || !audit.piece || !Array.isArray(audit.scenes) || !audit.inputs) {
		return { errors: [`${AUDIT_DIR}/${AUDIT_FILE} tiene un formato que este gate no reconoce. ${rerun}`], warnings };
	}

	const sceneIds = listSceneKeyframes(project);
	if (sceneIds.length === 0) {
		return { errors: ["no hay keyframes/eNN.png: no hay escenas que auditar."], warnings };
	}
	const current = collectAuditInputs(project, sceneIds);
	const stale = sceneIds.filter((id) => audit.inputs.keyframes?.[id] !== current.keyframes[id]);
	if (stale.length > 0) {
		errors.push(`auditoría vencida: ${stale.join(", ")} cambió o no fue auditada. ${rerun}`);
	}
	if (audit.inputs.artDirection !== current.artDirection) {
		errors.push(`auditoría vencida: art-direction.md cambió después de auditar. ${rerun}`);
	}

	const author = asText(audit.author);
	const auditorHarness = asText(audit.auditor?.harness);
	if (!author || !auditorHarness) {
		errors.push("la auditoría no registra autor y auditor: no se puede comprobar que sean distintos.");
	} else if (normalizeHarness(author) === normalizeHarness(auditorHarness)) {
		errors.push(
			`auditoría no independiente: el autor (${author}) y el auditor (${audit.auditor.profile}) usan el mismo harness. Auditá con otro perfil.`,
		);
	}

	if (errors.length > 0) return { errors, warnings };

	if (audit.piece.intent !== "delivered") {
		errors.push(
			`el auditor dice que la pieza no cumple su intent \`${audit.intent}\`${audit.piece.became ? `: quedó como ${audit.piece.became}` : ""}.`,
		);
	}
	const byId = new Map(
		audit.scenes.filter((scene) => scene && typeof scene === "object").map((scene) => [scene.id, scene]),
	);
	for (const id of sceneIds) {
		const scene = byId.get(id);
		if (!scene) {
			errors.push(`la auditoría no trae veredicto para ${id}. ${rerun}`);
			continue;
		}
		/* El archivo pudo escribirse con otra versión del comando: un campo
		   ausente no debe tirar el gate, solo dejar de imprimirse. */
		const failed = Array.isArray(scene.failed) ? scene.failed : [];
		const checks = failed.length > 0 ? ` (checks ${failed.join(", ")})` : "";
		const line = `${id}${checks}: ${asText(scene.evidence)}${scene.fix ? ` -> ${scene.fix}` : ""}`;
		if (scene.verdict === "block") errors.push(`escena bloqueada ${line}`);
		else if (scene.verdict === "revise") warnings.push(`a revisar ${line}`);
	}
	if (audit.piece.variety === "revise") warnings.push(`variedad a revisar: ${audit.piece.rhythm}`);
	return { errors, warnings };
}
