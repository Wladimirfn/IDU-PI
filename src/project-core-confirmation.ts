import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	loadProjectCore,
	type ProjectCore,
	validateProjectCore,
} from "./project-core.js";
import { reviewProjectCoreResearchDraft } from "./project-core-research.js";
import {
	assertAllowedWrite,
	ensureScratchDir,
	scratchPath,
} from "./idu-scratch.js";
import { readIdPathWithMigration } from "./hygiene-migrate.js";

const DRAFT_PREFIX = "project-core-research-draft-";
const DRAFT_SUFFIX = ".json";
const CRITICAL_FIELDS = [
	"projectName",
	"projectGoal",
	"problemStatement",
	"targetUsers",
	"includedScope",
	"excludedScope",
	"successCriteria",
] as const;

type CriticalField = (typeof CRITICAL_FIELDS)[number];

export type ProjectCoreConfirmationResult = {
	ok: boolean;
	action: "confirmed" | "rejected" | "blocked" | "already_confirmed";
	status?: ProjectCore["status"];
	path?: string;
	backupPath?: string;
	researchDraftPath?: string;
	missingFields: string[];
	criticalOpenQuestions: string[];
	fieldsResearchCouldComplete: string[];
	alreadyConfirmed: boolean;
	errors: string[];
	message: string;
};

export type ProjectCoreDiffResult = {
	ok: boolean;
	path: string;
	status?: ProjectCore["status"];
	completeFields: string[];
	incompleteFields: string[];
	openQuestions: string[];
	researchDraftPath?: string;
	fieldsResearchCouldComplete: string[];
	differences: string[];
	errors: string[];
};

export type ProjectCoreConfirmationOptions = {
	projectPath: string;
	stateRoot: string;
	reportsDir: string;
	research?: string;
	reason?: string;
	now?: () => Date;
};

export function confirmProjectCore(
	options: ProjectCoreConfirmationOptions,
): ProjectCoreConfirmationResult {
	const corePath = projectCorePath(options.projectPath);
	const now = (options.now ?? (() => new Date()))();
	const base = baseResult("blocked", corePath);
	// Migration guard: prefer <repo>/.idu/config/project-core.json; if not
	// found, attempt to migrate from <repo>/config/project-core.json.
	const migrated = readIdPathWithMigration(
		options.projectPath,
		"project-core.json",
	);
	if (migrated.content === null) {
		return {
			...base,
			errors: [
				"No existe config/project-core.json. Ejecuta /idu_define_project primero.",
			],
			message:
				"No existe config/project-core.json. Ejecuta /idu_define_project primero.",
		};
	}

	const core = loadProjectCore(options.projectPath);
	if (core.status === "confirmed") {
		return {
			...baseResult("already_confirmed", corePath),
			ok: true,
			status: "confirmed",
			alreadyConfirmed: true,
			message:
				"Project Core ya está confirmado. Usá /idu_core_diff si querés revisarlo.",
		};
	}

	const research = resolveResearch(options.research, options.reportsDir);
	if (research.errors.length) {
		return {
			...base,
			errors: research.errors,
			message: research.errors.join("\n"),
		};
	}

	const candidate = research.path
		? applyStructuredResearchPatch(core, research.path)
		: core;
	const missingFields = missingCriticalFields(candidate);
	const criticalOpenQuestions = criticalQuestions(candidate.openQuestions);
	if (missingFields.length || criticalOpenQuestions.length) {
		return {
			...base,
			status: core.status,
			researchDraftPath: research.path,
			missingFields,
			criticalOpenQuestions,
			fieldsResearchCouldComplete: research.fieldsResearchCouldComplete,
			errors: [
				...(missingFields.length
					? [`Faltan campos críticos: ${missingFields.join(", ")}`]
					: []),
				...(criticalOpenQuestions.length
					? [
							`Hay preguntas abiertas críticas: ${criticalOpenQuestions.join(" | ")}`,
						]
					: []),
			],
			message: "No puedo confirmar Project Core todavía.",
		};
	}

	const confirmedAt = now.toISOString();
	const updatedCore: ProjectCore = {
		...candidate,
		status: "confirmed",
		updatedAt: confirmedAt,
		openQuestions: removeConfirmationQuestions(candidate.openQuestions),
		humanDecisions: [
			...candidate.humanDecisions,
			{
				decision: "confirmed_project_core",
				confirmedAt,
				source: "telegram",
				...(research.path ? { researchDraftPath: research.path } : {}),
			},
		],
	};
	const validation = validateProjectCore(updatedCore);
	if (!validation.ok) {
		return {
			...base,
			status: core.status,
			researchDraftPath: research.path,
			errors: validation.errors,
			message: `Project Core inválido: ${validation.errors.join("; ")}`,
		};
	}
	const backupPath = backupProjectCore(
		options.projectPath,
		options.stateRoot,
		now,
	);
	writeProjectCore(options.projectPath, options.stateRoot, validation.core);
	return {
		...baseResult("confirmed", corePath),
		ok: true,
		status: "confirmed",
		backupPath,
		researchDraftPath: research.path,
		fieldsResearchCouldComplete: research.fieldsResearchCouldComplete,
		message: "Project Core confirmado por humano.",
	};
}

export function rejectProjectCore(
	options: ProjectCoreConfirmationOptions,
): ProjectCoreConfirmationResult {
	const corePath = projectCorePath(options.projectPath);
	const now = (options.now ?? (() => new Date()))();
	const base = baseResult("blocked", corePath);
	if (!existsSync(corePath)) {
		return {
			...base,
			errors: [
				"No existe config/project-core.json. Ejecuta /idu_define_project primero.",
			],
			message:
				"No existe config/project-core.json. Ejecuta /idu_define_project primero.",
		};
	}
	const core = loadProjectCore(options.projectPath);
	const rejectedAt = now.toISOString();
	const updatedCore: ProjectCore = {
		...core,
		status: "stale",
		updatedAt: rejectedAt,
		humanDecisions: [
			...core.humanDecisions,
			{
				decision: "rejected_project_core",
				rejectedAt,
				source: "telegram",
				...(options.reason?.trim() ? { reason: options.reason.trim() } : {}),
			},
		],
	};
	const validation = validateProjectCore(updatedCore);
	if (!validation.ok) {
		return {
			...base,
			errors: validation.errors,
			message: `Project Core inválido: ${validation.errors.join("; ")}`,
		};
	}
	const backupPath = backupProjectCore(
		options.projectPath,
		options.stateRoot,
		now,
	);
	writeProjectCore(options.projectPath, options.stateRoot, validation.core);
	return {
		...baseResult("rejected", corePath),
		ok: true,
		status: validation.core.status,
		backupPath,
		message:
			"Project Core rechazado. Podés usar /idu_define_project o /idu_research_core para revisarlo.",
	};
}

export function diffProjectCore(
	options: ProjectCoreConfirmationOptions,
): ProjectCoreDiffResult {
	const corePath = projectCorePath(options.projectPath);
	const result: ProjectCoreDiffResult = {
		ok: false,
		path: corePath,
		completeFields: [],
		incompleteFields: [],
		openQuestions: [],
		fieldsResearchCouldComplete: [],
		differences: [],
		errors: [],
	};
	if (!existsSync(corePath)) {
		result.errors.push(
			"No existe config/project-core.json. Ejecuta /idu_define_project primero.",
		);
		return result;
	}
	const core = loadProjectCore(options.projectPath);
	result.ok = true;
	result.status = core.status;
	result.completeFields = CRITICAL_FIELDS.filter((field) =>
		isComplete(core, field),
	);
	result.incompleteFields = CRITICAL_FIELDS.filter(
		(field) => !isComplete(core, field),
	);
	result.openQuestions = core.openQuestions;
	const latest = resolveResearch("latest_research", options.reportsDir);
	if (latest.path) {
		result.researchDraftPath = latest.path;
		result.fieldsResearchCouldComplete = latest.fieldsResearchCouldComplete;
		result.differences = latest.fieldsResearchCouldComplete.map(
			(field) => `Research sugiere revisar ${field}`,
		);
	}
	if (latest.errors.length) result.errors.push(...latest.errors);
	return result;
}

export function formatProjectCoreConfirmationResult(
	result: ProjectCoreConfirmationResult,
): string {
	if (!result.ok) {
		return [
			result.message,
			...(result.missingFields.length
				? [`Campos faltantes: ${result.missingFields.join(", ")}`]
				: []),
			...(result.criticalOpenQuestions.length
				? [`Preguntas críticas: ${result.criticalOpenQuestions.join(" | ")}`]
				: []),
			...(result.errors.length
				? [`Errores: ${result.errors.join(" | ")}`]
				: []),
		].join("\n");
	}
	if (result.alreadyConfirmed) return result.message;
	return [
		result.message,
		`Estado: ${result.status ?? "—"}`,
		...(result.researchDraftPath
			? [`Research usado: ${result.researchDraftPath}`]
			: []),
		...(result.backupPath ? [`Backup: ${result.backupPath}`] : []),
		"No usé IA ni modifiqué blueprint/flows.",
	].join("\n");
}

export function formatProjectCoreDiff(result: ProjectCoreDiffResult): string {
	if (!result.ok) return result.errors.join("\n");
	return [
		"Project Core diff",
		`status actual: ${result.status ?? "—"}`,
		`campos completos: ${formatList(result.completeFields)}`,
		`campos incompletos: ${formatList(result.incompleteFields)}`,
		`preguntas abiertas: ${formatList(result.openQuestions)}`,
		...(result.researchDraftPath
			? [
					`research latest: ${result.researchDraftPath}`,
					`diferencias: ${formatList(result.differences)}`,
					`campos podría completar: ${formatList(result.fieldsResearchCouldComplete)}`,
				]
			: ["research latest: —", "campos podría completar: —"]),
		...(result.errors.length
			? [`errores research: ${result.errors.join(" | ")}`]
			: []),
		"No escribí archivos.",
	].join("\n");
}

function baseResult(
	action: ProjectCoreConfirmationResult["action"],
	path: string,
): ProjectCoreConfirmationResult {
	return {
		ok: false,
		action,
		path,
		missingFields: [],
		criticalOpenQuestions: [],
		fieldsResearchCouldComplete: [],
		alreadyConfirmed: false,
		errors: [],
		message: "",
	};
}

function projectCorePath(projectPath: string): string {
	return join(projectPath, ".idu", "config", "project-core.json");
}

function writeProjectCore(
	projectPath: string,
	stateRoot: string,
	core: ProjectCore,
): void {
	const path = projectCorePath(projectPath);
	assertAllowedWrite(path, { stateRoot, repoRoot: projectPath });
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(core, null, 2)}\n`, "utf8");
}

function backupProjectCore(
	projectPath: string,
	stateRoot: string,
	now: Date,
): string {
	ensureScratchDir(stateRoot);
	const backupPath = scratchPath(
		stateRoot,
		`project-core.backup-${timestamp(now)}.json`,
	);
	assertAllowedWrite(backupPath, { stateRoot, repoRoot: projectPath });
	const migrated = readIdPathWithMigration(projectPath, "project-core.json");
	if (migrated.content !== null) {
		writeFileSync(backupPath, migrated.content, "utf8");
	}
	return backupPath;
}

function timestamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace("T", "-")
		.replace(/\.\d{3}Z$/u, "");
}

function missingCriticalFields(core: ProjectCore): string[] {
	return CRITICAL_FIELDS.filter((field) => !isComplete(core, field));
}

function isComplete(core: ProjectCore, field: CriticalField): boolean {
	const value = core[field];
	if (Array.isArray(value)) return value.length > 0;
	return typeof value === "string" && value.trim().length > 0;
}

function criticalQuestions(openQuestions: string[]): string[] {
	return openQuestions.filter(
		(question) => !/confirmar project core|\/idu_confirm_core/iu.test(question),
	);
}

function removeConfirmationQuestions(openQuestions: string[]): string[] {
	return openQuestions.filter(
		(question) =>
			/confirmar project core|\/idu_confirm_core/iu.test(question) === false,
	);
}

function resolveResearch(
	research: string | undefined,
	reportsDir: string,
): {
	path?: string;
	fieldsResearchCouldComplete: string[];
	errors: string[];
} {
	if (!research?.trim()) return { fieldsResearchCouldComplete: [], errors: [] };
	const requested =
		research.trim() === "latest_research" ? "latest" : research.trim();
	const path =
		requested === "latest"
			? latestResearchPath(reportsDir)
			: validateResearchPath(requested, reportsDir);
	if (!path) {
		return {
			fieldsResearchCouldComplete: [],
			errors: [
				requested === "latest"
					? "No encontré project-core-research-draft-*.json en reports/."
					: "Research inválido: debe estar dentro de reports/ y llamarse project-core-research-draft-*.json.",
			],
		};
	}
	const review = reviewProjectCoreResearchDraft(path, reportsDir);
	if (!review.validDraft) {
		return {
			path,
			fieldsResearchCouldComplete: review.projectCoreFieldsToComplete,
			errors: [
				`Research inválido: ${review.errors.join(" | ") || "no es un project-core-research draft válido"}`,
			],
		};
	}
	return {
		path,
		fieldsResearchCouldComplete: review.projectCoreFieldsToComplete,
		errors: [],
	};
}

function latestResearchPath(reportsDir: string): string | undefined {
	if (!existsSync(reportsDir)) return undefined;
	return readdirSync(reportsDir)
		.filter(
			(entry) => entry.startsWith(DRAFT_PREFIX) && entry.endsWith(DRAFT_SUFFIX),
		)
		.sort()
		.map((entry) => join(reportsDir, entry))
		.at(-1);
}

function validateResearchPath(
	path: string,
	reportsDir: string,
): string | undefined {
	const candidate = resolve(path);
	const reportsRoot = resolve(reportsDir);
	const relativeToReports = relative(reportsRoot, candidate);
	const isInsideReports =
		relativeToReports.length > 0 &&
		!relativeToReports.startsWith("..") &&
		!isAbsolute(relativeToReports);
	const name = basename(candidate);
	if (
		!isInsideReports ||
		!name.startsWith(DRAFT_PREFIX) ||
		!name.endsWith(DRAFT_SUFFIX)
	) {
		return undefined;
	}
	return candidate;
}

function applyStructuredResearchPatch(
	core: ProjectCore,
	researchPath: string,
): ProjectCore {
	const parsed = JSON.parse(readFileSync(researchPath, "utf8")) as {
		projectCorePatch?: Partial<ProjectCore>;
	};
	const patch = parsed.projectCorePatch;
	if (!patch) return core;
	let next = core;
	for (const field of CRITICAL_FIELDS) {
		if (isComplete(next, field)) continue;
		const value = patch[field];
		if (typeof value === "string" || Array.isArray(value)) {
			next = { ...next, [field]: value };
		}
	}
	return next;
}

function formatList(items: string[]): string {
	return items.length ? items.join(" | ") : "—";
}
