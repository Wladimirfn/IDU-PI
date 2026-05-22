import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	createDefaultProjectCore,
	loadProjectCore,
	summarizeProjectCore,
	validateProjectCore,
	type ProjectCore,
	type ProjectCoreComplexityLevel,
	type ProjectCoreDataSensitivity,
	type ProjectCoreDeploymentTarget,
	type ProjectCoreSecurityLevel,
} from "./project-core.js";

export type ProjectCoreWizardAnswers = {
	projectGoal?: string;
	problemStatement?: string;
	targetUsers?: string;
	complexityLevel?: string;
	deploymentTarget?: string;
	securityLevel?: string;
	dataSensitivity?: string;
	initialModules?: string;
	excludedScope?: string;
	successCriteria?: string;
};

export type ProjectCoreWizardState = {
	projectId: string;
	projectPath: string;
	currentStep: number;
	status: "active" | "completed";
	answers: ProjectCoreWizardAnswers;
	createdAt: string;
	updatedAt: string;
};

export type ProjectCoreWizardOptions = {
	projectId: string;
	projectPath: string;
	workspaceRoot: string;
	projectName?: string;
	now?: () => Date;
};

export type ProjectCoreWizardResult = {
	state: ProjectCoreWizardState;
	message: string;
	completed: boolean;
	core?: ProjectCore;
};

type WizardStep = {
	key: keyof ProjectCoreWizardAnswers;
	prompt: string;
};

const STEPS: WizardStep[] = [
	{ key: "projectGoal", prompt: "1/10 ¿Qué quieres construir?" },
	{ key: "problemStatement", prompt: "2/10 ¿Qué problema resuelve?" },
	{ key: "targetUsers", prompt: "3/10 ¿Quiénes serán los usuarios?" },
	{
		key: "complexityLevel",
		prompt: "4/10 ¿Será simple, mediano, escalable o enterprise?",
	},
	{
		key: "deploymentTarget",
		prompt: "5/10 ¿Dónde vivirá: local, servidor, cloud o híbrido?",
	},
	{ key: "securityLevel", prompt: "6/10 ¿Qué nivel de seguridad requiere?" },
	{
		key: "dataSensitivity",
		prompt: "7/10 ¿Qué datos sensibles manejará?",
	},
	{
		key: "initialModules",
		prompt: "8/10 ¿Qué módulos imaginas al inicio?",
	},
	{ key: "excludedScope", prompt: "9/10 ¿Qué queda fuera del alcance?" },
	{
		key: "successCriteria",
		prompt: "10/10 ¿Qué criterios dirían que el proyecto fue exitoso?",
	},
];

export function startProjectCoreWizard(
	options: ProjectCoreWizardOptions,
): ProjectCoreWizardResult {
	const existing = readWizardState(options);
	if (existing?.status === "active") {
		return {
			state: existing,
			message: formatProjectCoreWizardPrompt(existing),
			completed: false,
		};
	}
	const now = currentIso(options);
	const state: ProjectCoreWizardState = {
		projectId: options.projectId,
		projectPath: options.projectPath,
		currentStep: 0,
		status: "active",
		answers: {},
		createdAt: now,
		updatedAt: now,
	};
	writeWizardState(options, state);
	return {
		state,
		message: formatProjectCoreWizardPrompt(state),
		completed: false,
	};
}

export function answerProjectCoreWizard(
	options: ProjectCoreWizardOptions,
	answer: string,
): ProjectCoreWizardResult {
	const state =
		readWizardState(options) ?? startProjectCoreWizard(options).state;
	if (state.status !== "active") {
		return {
			state,
			message:
				"El wizard Project Core no está activo. Usá /idu_define_project para iniciar.",
			completed: state.status === "completed",
		};
	}
	const step = STEPS[state.currentStep];
	if (!step) return completeWizard(options, state);
	const normalizedAnswer = answer.trim();
	if (!normalizedAnswer) {
		return {
			state,
			message: `${formatProjectCoreWizardPrompt(state)}\n\nRespondé con texto libre para continuar.`,
			completed: false,
		};
	}
	const nextState: ProjectCoreWizardState = {
		...state,
		answers: { ...state.answers, [step.key]: normalizedAnswer },
		currentStep: state.currentStep + 1,
		updatedAt: currentIso(options),
	};
	if (nextState.currentStep >= STEPS.length)
		return completeWizard(options, nextState);
	writeWizardState(options, nextState);
	return {
		state: nextState,
		message: formatProjectCoreWizardPrompt(nextState),
		completed: false,
	};
}

export function getProjectCoreWizardStatus(options: ProjectCoreWizardOptions): {
	state?: ProjectCoreWizardState;
	core?: ProjectCore;
	text: string;
} {
	const state = readWizardState(options);
	const localCorePath = projectCorePath(options.projectPath);
	if (!existsSync(localCorePath)) {
		return {
			...(state ? { state } : {}),
			text: [
				"Project Core local: no existe",
				state ? formatWizardStateLine(state) : "Wizard Project Core: inactivo",
				"Siguiente recomendado: /idu_define_project",
			].join("\n"),
		};
	}
	const core = loadProjectCore(options.projectPath);
	return {
		...(state ? { state } : {}),
		core,
		text: [
			"Project Core local: existe",
			summarizeProjectCore(core),
			core.openQuestions.length
				? `Preguntas abiertas: ${core.openQuestions.join(" | ")}`
				: "Preguntas abiertas: —",
			state ? formatWizardStateLine(state) : "Wizard Project Core: inactivo",
		].join("\n"),
	};
}

export function formatProjectCoreWizardPrompt(
	state: ProjectCoreWizardState,
): string {
	const step = STEPS[state.currentStep];
	if (!step) return "Wizard Project Core completo.";
	return [
		"Wizard Project Core",
		`Proyecto: ${state.projectId}`,
		step.prompt,
		"Respondé con texto libre. La IA no propone; el humano define.",
	].join("\n");
}

export function formatProjectCoreWizardSummary(core: ProjectCore): string {
	return [
		"Project Core draft creado.",
		"",
		"Objetivo propuesto:",
		core.projectGoal,
		"",
		"Alcance incluido:",
		formatList(core.includedScope),
		"",
		"Alcance excluido:",
		formatList(core.excludedScope),
		"",
		"Estado:",
		core.status,
		"",
		"Siguiente recomendado:",
		"/idu_core_status",
		"Luego: etapa futura /idu_confirm_core",
	].join("\n");
}

function completeWizard(
	options: ProjectCoreWizardOptions,
	state: ProjectCoreWizardState,
): ProjectCoreWizardResult {
	const core = buildDraftCore(options, state);
	writeProjectCoreDraft(options.projectPath, core);
	const completedState: ProjectCoreWizardState = {
		...state,
		status: "completed",
		currentStep: STEPS.length,
		updatedAt: currentIso(options),
	};
	writeWizardState(options, completedState);
	return {
		state: completedState,
		message: formatProjectCoreWizardSummary(core),
		completed: true,
		core,
	};
}

function buildDraftCore(
	options: ProjectCoreWizardOptions,
	state: ProjectCoreWizardState,
): ProjectCore {
	const existing = readExistingLocalCore(options.projectPath);
	if (existing?.status === "confirmed") {
		throw new Error(
			"Project Core confirmed: no puedo sobreescribir una verdad confirmada.",
		);
	}
	const base =
		existing ??
		createDefaultProjectCore(options.projectName ?? state.projectId);
	const answers = state.answers;
	const projectGoal = requiredAnswer(answers.projectGoal, "projectGoal");
	const problemStatement = requiredAnswer(
		answers.problemStatement,
		"problemStatement",
	);
	const targetUsers = splitList(answers.targetUsers);
	const initialModules = splitList(answers.initialModules);
	const excludedScope = splitList(answers.excludedScope);
	const successCriteria = splitList(answers.successCriteria);
	const now = currentIso(options);
	return {
		...base,
		projectGoal,
		problemStatement,
		targetUsers,
		complexityLevel: parseComplexity(answers.complexityLevel),
		deploymentTarget: parseDeployment(answers.deploymentTarget),
		securityLevel: parseSecurity(answers.securityLevel),
		dataSensitivity: parseDataSensitivity(answers.dataSensitivity),
		includedScope: [projectGoal, ...initialModules],
		excludedScope,
		initialModules,
		criticalFlows: base.criticalFlows,
		successCriteria,
		humanDecisions: [
			"Project Core creado por wizard manual; falta confirmación humana futura.",
		],
		openQuestions: ["Confirmar Project Core en etapa futura /idu_confirm_core"],
		status: "draft",
		updatedAt: now,
	};
}

function writeProjectCoreDraft(projectPath: string, core: ProjectCore): void {
	const validation = validateProjectCore(core);
	if (!validation.ok) {
		throw new Error(
			`Project Core draft inválido: ${validation.errors.join("; ")}`,
		);
	}
	const path = projectCorePath(projectPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(core, null, 2)}\n`);
}

function readExistingLocalCore(projectPath: string): ProjectCore | undefined {
	const path = projectCorePath(projectPath);
	if (!existsSync(path)) return undefined;
	return loadProjectCore(projectPath);
}

function readWizardState(
	options: ProjectCoreWizardOptions,
): ProjectCoreWizardState | undefined {
	const path = wizardStatePath(options.workspaceRoot);
	if (!existsSync(path)) return undefined;
	const parsed = JSON.parse(
		readFileSync(path, "utf8"),
	) as ProjectCoreWizardState;
	return parsed.projectId === options.projectId ? parsed : undefined;
}

function writeWizardState(
	options: ProjectCoreWizardOptions,
	state: ProjectCoreWizardState,
): void {
	const path = wizardStatePath(options.workspaceRoot);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function wizardStatePath(workspaceRoot: string): string {
	return join(workspaceRoot, "reports", "project-core-wizard-state.json");
}

function projectCorePath(projectPath: string): string {
	return join(projectPath, "config", "project-core.json");
}

function currentIso(options: ProjectCoreWizardOptions): string {
	return (options.now ?? (() => new Date()))().toISOString();
}

function requiredAnswer(value: string | undefined, field: string): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`Falta respuesta requerida: ${field}`);
	return trimmed;
}

function splitList(value: string | undefined): string[] {
	const parts = (value ?? "")
		.split(/[,;\n]/u)
		.map((item) => item.trim())
		.filter(Boolean);
	return parts.length ? parts : [requiredAnswer(value, "list")];
}

function parseComplexity(
	value: string | undefined,
): ProjectCoreComplexityLevel {
	const normalized = normalize(value);
	if (/enterprise/u.test(normalized)) return "enterprise";
	if (/escalable|scalable/u.test(normalized)) return "scalable";
	if (/mediano|medium/u.test(normalized)) return "medium";
	return "simple";
}

function parseDeployment(
	value: string | undefined,
): ProjectCoreDeploymentTarget {
	const normalized = normalize(value);
	if (/hibrido|hybrid/u.test(normalized)) return "hybrid";
	if (/cloud|nube/u.test(normalized)) return "cloud";
	if (/servidor|server/u.test(normalized)) return "server";
	if (/local/u.test(normalized)) return "local";
	return "unknown";
}

function parseSecurity(value: string | undefined): ProjectCoreSecurityLevel {
	const normalized = normalize(value);
	if (/critica|critical/u.test(normalized)) return "critical";
	if (/alta|high/u.test(normalized)) return "high";
	if (/baja|low/u.test(normalized)) return "low";
	return "medium";
}

function parseDataSensitivity(
	value: string | undefined,
): ProjectCoreDataSensitivity {
	const normalized = normalize(value);
	if (/critica|critical/u.test(normalized)) return "critical";
	if (/alta|high|personal|privad/u.test(normalized)) return "high";
	if (/media|medium/u.test(normalized)) return "medium";
	if (/baja|low/u.test(normalized)) return "low";
	if (/ningun|ningun|none|sin datos/u.test(normalized)) return "none";
	return "medium";
}

function normalize(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "");
}

function formatWizardStateLine(state: ProjectCoreWizardState): string {
	const label = state.status === "active" ? "activo" : "completado";
	return `Wizard Project Core ${label}: paso ${Math.min(state.currentStep + 1, STEPS.length)}/${STEPS.length}`;
}

function formatList(items: string[]): string {
	return items.length ? items.join(" | ") : "—";
}
