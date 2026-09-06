import {
	classifyHumanIntent,
	inferTaskCategoryFromIntent,
} from "./human-intent.js";

export type TaskTemplateKind =
	| "bug"
	| "feature"
	| "refactor"
	| "docs"
	| "review";

const taskKinds = new Set<TaskTemplateKind>([
	"bug",
	"feature",
	"refactor",
	"docs",
	"review",
]);

export function parseTaskTemplateCommand(
	text: string,
): { kind: TaskTemplateKind; details: string } | undefined {
	const match = text.trim().match(/^\/task(?:\s+([\s\S]+))?$/iu);
	if (!match) return undefined;
	const body = (match[1] ?? "").trim();
	if (!body) return undefined;
	const [rawKind = "", ...rest] = body.split(/\s+/u);
	const normalizedKind = rawKind.toLowerCase();
	if (taskKinds.has(normalizedKind as TaskTemplateKind)) {
		return {
			kind: normalizedKind as TaskTemplateKind,
			details: rest.join(" ").trim(),
		};
	}
	return {
		kind: inferTaskTemplateKind(body),
		details: body,
	};
}

export function inferTaskTemplateKind(text: string): TaskTemplateKind {
	const classification = classifyHumanIntent(text);
	const category = inferTaskCategoryFromIntent(classification);
	return category === "general" ? "feature" : category;
}

export function formatTaskTemplateHelp(): string {
	return `Plantillas de tarea:

/task [bug|feature|refactor|docs|review] <detalle>
/task <texto libre>

Ejemplos:
/task bug el botón de decisión no responde en Telegram
/task fallo el loggin
/task database keeps failing`;
}

export function buildTaskPrompt(
	kind: string,
	details: string,
): string | undefined {
	const scope =
		details.trim() ||
		"No details provided; ask concise clarifying questions before implementation.";
	switch (kind) {
		case "bug":
			return `Bug task. Symptom/context: ${scope}

Use systematic debugging and TDD. Reproduce or identify the failing behavior first, add/adjust a failing regression test when possible, implement the smallest safe fix, rerun targeted and full validation, and report evidence. Do not commit or push unless explicitly asked.`;
		case "feature":
			return `Feature task. Goal/context: ${scope}

Clarify acceptance criteria if needed, propose the smallest safe design, use TDD where practical, implement incrementally, update docs/tests, and report verification evidence. Do not commit or push unless explicitly asked.`;
		case "refactor":
			return `Refactor task. Area/context: ${scope}

Preserve behavior. Characterize existing behavior with tests or targeted checks before editing, make small structural improvements, avoid unrelated rewrites, rerun validation, and report what changed and why. Do not commit or push unless explicitly asked.`;
		case "docs":
			return `Documentation task. Topic/context: ${scope}

Improve documentation in Spanish unless the file/project convention says otherwise. Keep it concise, accurate, and actionable. Verify commands/examples against the current project where practical. Do not commit or push unless explicitly asked.`;
		case "review":
			return `Review task. Scope/context: ${scope}

Inspect the requested code or plan, identify blockers first, separate evidence from opinion, avoid edits unless explicitly asked, and report concise findings with verification suggestions. Do not commit or push unless explicitly asked.`;
		default:
			return undefined;
	}
}
