export type TaskTemplateKind = "bug" | "feature" | "refactor" | "docs";

const taskKinds = new Set<TaskTemplateKind>([
	"bug",
	"feature",
	"refactor",
	"docs",
]);

export function parseTaskTemplateCommand(
	text: string,
): { kind: TaskTemplateKind; details: string } | undefined {
	const match = text.trim().match(/^\/task(?:\s+(\S+))?(?:\s+([\s\S]+))?$/iu);
	if (!match) return undefined;
	const rawKind = (match[1] ?? "").toLowerCase();
	if (!taskKinds.has(rawKind as TaskTemplateKind)) return undefined;
	return {
		kind: rawKind as TaskTemplateKind,
		details: (match[2] ?? "").trim(),
	};
}

export function inferTaskTemplateKind(text: string): TaskTemplateKind {
	const normalized = text.toLocaleLowerCase("es");
	const mentionsDatabase =
		/\b(base de datos|bases de datos|db|database|sqlite|tabla|tablas|schema)\b/u.test(
			normalized,
		);
	const mentionsFailure =
		/\b(bug|fall[aoó]s?|falla|fallas|error|rompi[oó]|rompe|roto|no funciona|crash|problema|arreglar|resolver)\b/u.test(
			normalized,
		);
	if (mentionsDatabase && mentionsFailure) return "bug";
	if (
		/\b(bug|fall[aoó]s?|falla|fallas|error|rompi[oó]|rompe|roto|no funciona|crash|problema|login)\b/u.test(
			normalized,
		)
	)
		return "bug";
	if (/\b(refactor|refactorizar|reestructurar|limpiar)\b/u.test(normalized))
		return "refactor";
	if (/\b(readme|docs?|documentaci[oó]n|gu[ií]a)\b/u.test(normalized))
		return "docs";
	if (
		/\b(feature|funcionalidad|agregar|agrega|crear|crea|implementar|implementa|nuevo|nueva)\b/u.test(
			normalized,
		)
	)
		return "feature";
	return "feature";
}

export function formatTaskTemplateHelp(): string {
	return `Plantillas de tarea:

/task bug <síntoma o error>
/task feature <objetivo de producto>
/task refactor <área a mejorar>
/task docs <documento o tema>

Ejemplo:
/task bug el botón de decisión no responde en Telegram`;
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
		default:
			return undefined;
	}
}
