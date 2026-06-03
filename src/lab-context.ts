import {
	formatBlueprintForPrompt,
	loadProjectBlueprint,
} from "./project-blueprint.js";
import {
	formatFlowsForPrompt,
	loadProjectFlows,
	type ProjectFlows,
} from "./project-flows.js";
import {
	mergeContextBudgetUsage,
	sliceTextToBudget,
	type ContextBudgetUsage,
} from "./context-budget.js";
import {
	scanProjectMap,
	type ProjectMapScanFinding,
	type ProjectMapScanResult,
} from "./project-map-scanner.js";

export type LabProjectContext = {
	text: string;
	contextBudget: ContextBudgetUsage;
};

const MAX_CONTEXT_CHARS = 1800;

export function loadLabProjectContext(
	projectPath: string,
): LabProjectContext | undefined {
	try {
		const flows = loadProjectFlows(projectPath);
		return formatLabProjectContext(
			formatBlueprintForPrompt(loadProjectBlueprint(projectPath)),
			formatFlowsForPrompt(flows),
			safeScanProjectMapForPrompt(projectPath, flows),
		);
	} catch {
		return undefined;
	}
}

export function formatLabProjectContext(
	blueprintText: string,
	flowsText: string,
	scanText?: string,
): LabProjectContext {
	const sectionBudget = Math.floor(
		(MAX_CONTEXT_CHARS - 240) / (scanText ? 3 : 2),
	);
	const blueprint = budgetedSection("Blueprint", blueprintText, sectionBudget);
	const flows = budgetedSection("Project flows", flowsText, sectionBudget);
	const scan = scanText
		? budgetedSection("Scan project map", scanText, sectionBudget)
		: undefined;
	const sections = [
		"Contexto resumido del proyecto real para orientar la revisión:",
		blueprint.text,
		flows.text,
		...(scan ? [scan.text] : []),
	];
	return {
		text: sections.join("\n"),
		contextBudget: mergeContextBudgetUsage(
			"agentlab_project_context",
			[blueprint.usage, flows.usage, ...(scan ? [scan.usage] : [])],
		),
	};
}

function safeScanProjectMapForPrompt(
	projectPath: string,
	flows: ProjectFlows,
): string | undefined {
	try {
		return formatProjectMapScanForPrompt(scanProjectMap(projectPath, flows));
	} catch {
		return undefined;
	}
}

export function formatProjectMapScanForPrompt(
	scan: ProjectMapScanResult,
): string {
	const lines = [
		`Archivos escaneados: ${scan.scannedFiles.length}`,
		`HTML detectados: ${scan.detected.htmlFiles.length}`,
		findingSummary(
			"Pantallas reales no mapeadas",
			scan.findings,
			"Pantalla real no declarada",
		),
		findingSummary(
			"UI elements no mapeados",
			scan.findings,
			"UI element detectado no mapeado",
		),
		findingSummary(
			"Selectores faltantes",
			scan.findings,
			"Flow referencia selector que no aparece",
		),
		findingSummary(
			"dataStores no mapeados",
			scan.findings,
			"dataStore detectado no mapeado",
		),
		findingSummary(
			"Funciones no usadas en flows",
			scan.findings,
			"Función detectada no usada en flows",
		),
		findingSummary("Botones duplicados", scan.findings, "Botón duplicado"),
		findingSummary(
			"Exceso onclick inline",
			scan.findings,
			"HTML con muchos onclick inline",
		),
		"Nota: el scanner solo informa; no decide ni reemplaza a AgentLabs.",
	];
	return lines.join("\n");
}

function findingSummary(
	label: string,
	findings: ProjectMapScanFinding[],
	prefix: string,
): string {
	const matches = findings.filter((finding) =>
		finding.message.startsWith(prefix),
	);
	if (!matches.length) return `${label}: ninguno`;
	return `${label}: ${matches
		.slice(0, 3)
		.map((finding) => shortFinding(finding.message))
		.join(" | ")}${matches.length > 3 ? ` | +${matches.length - 3} más` : ""}`;
}

function shortFinding(message: string): string {
	return message
		.replace(/^.*?:\s*/u, "")
		.replace(/\([^)]*\)/gu, "")
		.trim()
		.slice(0, 120);
}

function budgetedSection(
	title: string,
	value: string,
	maxChars: number,
): { text: string; usage: ContextBudgetUsage } {
	const budgeted = sliceTextToBudget({
		text: redact(value),
		profile: "agentlab_project_context",
		path: title,
		maxChars,
	});
	return {
		text: `${title}:\n${budgeted.text}`,
		usage: budgeted.usage,
	};
}

function redact(value: string): string {
	return value.replace(
		/(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/giu,
		"$1: [redacted]",
	);
}
