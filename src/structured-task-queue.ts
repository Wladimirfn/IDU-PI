import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	classifyHumanIntentWithContext,
	type IntentAction,
	type IntentConcept,
	type IntentKind,
	type IntentRiskHint,
} from "./human-intent.js";
import type { ProjectPreflightRisk } from "./project-preflight.js";
import { analyzeUserSignal, type UserEmotion } from "./user-signal.js";

export type StructuredTaskStatus = "pending" | "running" | "done" | "failed";
export type StructuredTaskGuardStatus =
	| "clear"
	| "needs_confirmation"
	| "approved"
	| "rejected";

export type StructuredTask = {
	id: string;
	text: string;
	originalText?: string;
	category: string;
	priority: number;
	semanticPriority?: number;
	status: StructuredTaskStatus;
	createdAt: string;
	updatedAt: string;
	emotion?: string;
	source?: string;
	projectId?: string;
	failureReason?: string;
	completionEvidence?: string;
	guardRisk?: ProjectPreflightRisk;
	guardStatus?: StructuredTaskGuardStatus;
	guardReason?: string;
	intentKind?: IntentKind;
	intentAction?: IntentAction;
	intentConcepts?: IntentConcept[];
	intentRiskHint?: IntentRiskHint;
	intentConfidence?: string;
	intentEvidence?: string[];
};

export type StructuredTaskInput = {
	text: string;
	originalText?: string;
	category: string;
	priority?: number;
	semanticPriority?: number;
	emotion?: string;
	source?: string;
	projectId?: string;
	intentKind?: IntentKind;
	intentAction?: IntentAction;
	intentConcepts?: IntentConcept[];
	intentRiskHint?: IntentRiskHint;
	intentConfidence?: string;
	intentEvidence?: string[];
};

export type StructuredTaskQueueOptions = {
	workspaceRoot?: string;
	filePath?: string;
	now?: () => Date;
};

export type UserSignalAnalyzer = typeof analyzeUserSignal;

export class StructuredTaskQueue {
	private tasks: StructuredTask[];
	private sequence: number;
	private readonly filePath?: string;
	private readonly now: () => Date;

	constructor(options: StructuredTaskQueueOptions = {}) {
		this.filePath = options.filePath ?? defaultFilePath(options.workspaceRoot);
		this.now = options.now ?? (() => new Date());
		this.tasks = this.load();
		this.sequence = this.tasks.length;
	}

	enqueueTask(input: StructuredTaskInput): StructuredTask {
		const text = input.text.trim();
		if (!text) throw new Error("task text is required");
		const category = input.category.trim();
		if (!category) throw new Error("task category is required");
		const timestamp = this.now().toISOString();
		const task: StructuredTask = {
			id: this.nextId(),
			text,
			category,
			priority: input.priority ?? 100,
			...(typeof input.semanticPriority === "number"
				? { semanticPriority: input.semanticPriority }
				: {}),
			status: "pending",
			createdAt: timestamp,
			updatedAt: timestamp,
			...(input.originalText ? { originalText: input.originalText } : {}),
			...(input.emotion ? { emotion: input.emotion } : {}),
			...(input.source ? { source: input.source } : {}),
			...(input.projectId ? { projectId: input.projectId } : {}),
			...(input.intentKind ? { intentKind: input.intentKind } : {}),
			...(input.intentAction ? { intentAction: input.intentAction } : {}),
			...(input.intentConcepts?.length
				? { intentConcepts: input.intentConcepts }
				: {}),
			...(input.intentRiskHint ? { intentRiskHint: input.intentRiskHint } : {}),
			...(input.intentConfidence
				? { intentConfidence: input.intentConfidence }
				: {}),
			...(input.intentEvidence?.length
				? { intentEvidence: input.intentEvidence }
				: {}),
		};
		this.tasks.push(task);
		this.persist();
		return { ...task };
	}

	dequeueTask(): StructuredTask | undefined {
		const task = this.pendingTasks()[0];
		if (!task) return undefined;
		return this.updateStatus(task.id, "running");
	}

	listTasks(): StructuredTask[] {
		return this.tasks.map((task) => ({ ...task }));
	}

	clear(): number {
		const count = this.tasks.length;
		this.tasks = [];
		this.persist();
		return count;
	}

	clearPersisted(): number {
		const count = this.tasks.length;
		this.tasks = [];
		this.sequence = 0;
		if (this.filePath) rmSync(this.filePath, { force: true });
		return count;
	}

	markRunning(id: string): StructuredTask | undefined {
		return this.updateStatus(id, "running");
	}

	markDone(id: string, evidence?: string): StructuredTask | undefined {
		return this.updateStatus(id, "done", undefined, evidence);
	}

	markFailed(id: string, reason: string): StructuredTask | undefined {
		return this.updateStatus(id, "failed", reason);
	}

	findByText(text: string): StructuredTask | undefined {
		const task = this.tasks.find(
			(candidate) => candidate.text === text && candidate.status === "pending",
		);
		return task ? { ...task } : undefined;
	}

	getTask(id: string): StructuredTask | undefined {
		const task = this.findTaskById(id);
		return task ? { ...task } : undefined;
	}

	findByIdPrefix(idOrPrefix: string): StructuredTask | undefined {
		return this.findUniqueByIdPrefix(idOrPrefix);
	}

	findUniqueByIdPrefix(idOrPrefix: string): StructuredTask | undefined {
		const prefix = idOrPrefix.trim();
		if (!prefix) return undefined;
		const matches = this.tasks.filter((candidate) =>
			candidate.id.startsWith(prefix),
		);
		return matches.length === 1 ? { ...matches[0] } : undefined;
	}

	markGuardClear(
		id: string,
		guardRisk: ProjectPreflightRisk,
		guardReason?: string,
	): StructuredTask | undefined {
		return this.updateGuard(id, "clear", guardRisk, guardReason);
	}

	markNeedsConfirmation(
		id: string,
		options: { guardRisk: ProjectPreflightRisk; guardReason: string },
	): StructuredTask | undefined {
		return this.updateGuard(
			id,
			"needs_confirmation",
			options.guardRisk,
			options.guardReason,
		);
	}

	markGuardApproved(id: string): StructuredTask | undefined {
		return this.updateGuard(id, "approved");
	}

	markGuardRejected(id: string, reason: string): StructuredTask | undefined {
		const task = this.updateGuard(id, "rejected", undefined, reason);
		return task ? this.updateStatus(id, "failed", reason) : undefined;
	}

	private pendingTasks(): StructuredTask[] {
		return this.tasks
			.filter((task) => task.status === "pending")
			.sort((left, right) =>
				left.priority === right.priority
					? left.createdAt.localeCompare(right.createdAt)
					: left.priority - right.priority,
			);
	}

	private updateStatus(
		id: string,
		status: StructuredTaskStatus,
		failureReason?: string,
		completionEvidence?: string,
	): StructuredTask | undefined {
		const task = this.findTaskById(id);
		if (!task) return undefined;
		task.status = status;
		task.updatedAt = this.now().toISOString();
		if (status === "failed") {
			task.failureReason = failureReason?.trim() || "failed";
			delete task.completionEvidence;
		} else {
			delete task.failureReason;
		}
		if (status === "done" && completionEvidence?.trim()) {
			task.completionEvidence = completionEvidence.trim();
			delete task.guardStatus;
			delete task.guardRisk;
			delete task.guardReason;
		} else if (status !== "done") {
			delete task.completionEvidence;
		}
		this.persist();
		return { ...task };
	}

	private updateGuard(
		id: string,
		guardStatus: StructuredTaskGuardStatus,
		guardRisk?: ProjectPreflightRisk,
		guardReason?: string,
	): StructuredTask | undefined {
		const task = this.findTaskById(id);
		if (!task) return undefined;
		task.guardStatus = guardStatus;
		task.updatedAt = this.now().toISOString();
		if (guardRisk) task.guardRisk = guardRisk;
		if (guardReason?.trim()) task.guardReason = guardReason.trim();
		this.persist();
		return { ...task };
	}

	private findTaskById(id: string): StructuredTask | undefined {
		return this.tasks.find((candidate) => candidate.id === id);
	}

	private nextId(): string {
		this.sequence += 1;
		const timestamp = this.now().getTime().toString(36).padStart(11, "0");
		const sequence = this.sequence.toString(36).padStart(4, "0");
		return `task-${timestamp}-${sequence}`;
	}

	private load(): StructuredTask[] {
		if (!this.filePath || !existsSync(this.filePath)) return [];
		const text = readFileSync(this.filePath, "utf8");
		return text
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as StructuredTask);
	}

	private persist(): void {
		if (!this.filePath) return;
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(
			this.filePath,
			this.tasks.map((task) => JSON.stringify(task)).join("\n") +
				(this.tasks.length ? "\n" : ""),
		);
	}
}

export function structuredTaskCategory(text: string): string {
	const normalized = text.trim().toLowerCase();
	if (normalized.startsWith("/task bug")) return "bug";
	if (normalized.startsWith("/task feature")) return "feature";
	if (normalized.startsWith("/task refactor")) return "refactor";
	if (normalized.startsWith("/task docs")) return "docs";
	if (normalized.startsWith("/task review")) return "review";
	return "general";
}

export function analyzeStructuredTaskSignal(
	text: string,
	analyzer: UserSignalAnalyzer = analyzeUserSignal,
): ReturnType<UserSignalAnalyzer> {
	try {
		return analyzer(text);
	} catch {
		return {
			emotion: "neutral",
			urgency: 3,
			confidence: "low",
			matchedKeywords: [],
		};
	}
}

export function structuredTaskPriority(
	text: string,
	analyzer: UserSignalAnalyzer = analyzeUserSignal,
): number {
	const signal = analyzeStructuredTaskSignal(text, analyzer);
	if (signal.emotion === "neutral") return 3;
	return signal.urgency >= 1 && signal.urgency <= 5 ? signal.urgency : 3;
}

export function structuredTaskInputForText(
	text: string,
	options: {
		source?: string;
		projectId?: string;
		category?: string;
		originalText?: string;
		analyzer?: UserSignalAnalyzer;
	} = {},
): StructuredTaskInput {
	const analysisText = options.originalText ?? text;
	const signal = analyzeStructuredTaskSignal(analysisText, options.analyzer);
	const inferredIntent = classifyHumanIntentWithContext(analysisText, {
		taskCategory: options.category,
	});
	const category =
		options.category?.trim() ||
		(inferredIntent.taskCategory === "general"
			? structuredTaskCategory(text)
			: inferredIntent.taskCategory);
	const intent =
		category === inferredIntent.taskCategory
			? inferredIntent
			: classifyHumanIntentWithContext(analysisText, {
					taskCategory: category,
				});
	const priority = priorityForIntentAndSignal(intent, signal.urgency);
	const emotion = emotionForIntentAndSignal(intent.riskHint, signal.emotion);
	return {
		text,
		...(options.originalText ? { originalText: options.originalText } : {}),
		category,
		priority,
		emotion,
		intentKind: intent.kind,
		intentAction: intent.action,
		intentConcepts: intent.concepts,
		intentRiskHint: intent.riskHint,
		intentConfidence: intent.confidence,
		intentEvidence: intent.matchedEvidence,
		...(options.source ? { source: options.source } : {}),
		...(options.projectId ? { projectId: options.projectId } : {}),
	};
}

export function formatStructuredTaskQueueDetail(
	tasks: StructuredTask[],
	options: {
		approveCommand?: (id: string) => string;
		rejectCommand?: (id: string) => string;
	} = {},
): string {
	if (!tasks.length) return "Cola estructurada vacía.";
	const approveCommand =
		options.approveCommand ?? ((id: string) => `/queue_approve ${id}`);
	const rejectCommand =
		options.rejectCommand ?? ((id: string) => `/queue_reject ${id}`);
	return `Cola estructurada (${tasks.length}):\n\n${tasks
		.map((task, index) => {
			const primaryConcept = primaryIntentConcept(task.intentConcepts);
			const intent = task.intentKind
				? ` | intent: ${task.intentKind}/${primaryConcept}/${task.intentRiskHint ?? "low"}`
				: "";
			const guard = task.guardStatus
				? ` | guard: ${task.guardStatus}${task.guardRisk ? `/${task.guardRisk}` : ""}`
				: "";
			const approvalHint =
				task.guardStatus === "needs_confirmation"
					? `\nAprobar: ${approveCommand(task.id)}\nRechazar: ${rejectCommand(task.id)}`
					: "";
			return `T${index + 1} ${task.id} | ${task.status} | ${formatPriorityLabel(task)} | ${task.category} | ${task.emotion ?? "neutral"}${intent}${guard} | ${task.createdAt}\n${summarizeTaskText(task.originalText ?? task.text)}${approvalHint}`;
		})
		.join("\n\n")}`;
}

export type TareasYColaRowOptions = {
	now?: () => Date;
	includeApprovalHint?: boolean;
};

export function formatTaskQueueRow(
	task: StructuredTask,
	options: TareasYColaRowOptions = {},
): string {
	const now = options.now ? options.now() : new Date();
	const truncatedId = task.id.slice(0, 12);
	const status = statusLabel(task);
	const guard = guardLabel(task);
	const priority = `P${task.priority}`;
	const age = formatTaskAge(task.createdAt, now);
	const category = task.category || "—";
	return `${truncatedId} | ${status} | ${guard} | ${priority} | ${age} | ${category}`;
}

function statusLabel(task: StructuredTask): string {
	if (task.status === "done") return "done";
	if (task.status === "failed") return "blocked";
	if (task.status === "running") return "in_progress";
	// task.status === "pending"
	if (task.guardStatus === "needs_confirmation") return "paused";
	return "proposed";
}

function guardLabel(task: StructuredTask): string {
	if (!task.guardStatus) return "—";
	switch (task.guardRisk) {
		case "low":
			return "safe";
		case "medium":
			return "risky";
		case "high":
			return "risky";
		case "blocker":
			return "blocking";
		default:
			return "—";
	}
}

function formatTaskAge(createdAt: string, now: Date): string {
	const created = Date.parse(createdAt);
	if (Number.isNaN(created)) return "—";
	const diffMs = Math.max(0, now.getTime() - created);
	const totalMinutes = Math.floor(diffMs / 60_000);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0 || minutes > 0) return `${hours}h ${minutes}m`;
	return "0m";
}

export function formatTareasYCola(
	tasks: StructuredTask[],
	options: TareasYColaRowOptions = {},
): string {
	if (tasks.length === 0) return "no tasks in the queue";
	const header = `Tareas y cola (${tasks.length})`;
	const rows = tasks.map((task) => formatTaskQueueRow(task, options));
	return `${header}\n\n${rows.join("\n")}`;
}

function formatPriorityLabel(task: StructuredTask): string {
	const semanticPriority =
		task.semanticPriority ?? semanticPriorityFromTaskText(task.text);
	if (typeof semanticPriority === "number") {
		return `P${task.priority} (${semanticPriorityLabel(semanticPriority)} / semantic ${semanticPriority})`;
	}
	return `P${task.priority} (${humanPriorityLabel(task.priority)})`;
}

function semanticPriorityFromTaskText(text: string): number | undefined {
	const match = /Prioridad semántica: (\d+)/u.exec(text);
	return match?.[1] ? Number(match[1]) : undefined;
}

function semanticPriorityLabel(priority: number): string {
	if (priority >= 5) return "alta";
	if (priority === 4) return "media-alta";
	if (priority === 3) return "media";
	if (priority === 2) return "baja";
	return "muy baja";
}

function humanPriorityLabel(priority: number): string {
	if (priority >= 5) return "alta";
	if (priority === 4) return "media-alta";
	if (priority === 3) return "media";
	if (priority === 2) return "baja";
	return "muy baja";
}

function priorityForIntentAndSignal(
	intent: ReturnType<typeof classifyHumanIntentWithContext>,
	signalUrgency: number,
): number {
	const signalPriority =
		signalUrgency >= 1 && signalUrgency <= 5 ? signalUrgency : 3;
	const riskPriority = (() => {
		if (intent.riskHint === "blocker") return 5;
		if (
			intent.riskHint === "high" &&
			intent.intent === "bug_report" &&
			intent.concepts.some((concept) =>
				["auth", "database", "schema", "recurring_failure"].includes(concept),
			)
		) {
			return 5;
		}
		if (intent.riskHint === "high" && intent.intent === "bug_report") return 4;
		if (intent.riskHint === "high") return 4;
		if (intent.riskHint === "medium") return 3;
		return 3;
	})();
	return Math.max(signalPriority, riskPriority);
}

function emotionForIntentAndSignal(
	riskHint: IntentRiskHint,
	signalEmotion: UserEmotion,
): UserEmotion {
	if (signalEmotion !== "neutral") return signalEmotion;
	return riskHint === "high" || riskHint === "blocker"
		? "frustrado"
		: "neutral";
}

function primaryIntentConcept(concepts: string[] | undefined): string {
	return (
		concepts?.find((concept) => concept === "auth") ??
		concepts?.find((concept) => concept !== "task" && concept !== "queue") ??
		concepts?.[0] ??
		"unknown"
	);
}

function summarizeTaskText(text: string): string {
	const normalized = text.replace(/\s+/gu, " ").trim();
	return normalized.length > 120
		? `${normalized.slice(0, 117)}...`
		: normalized;
}

function defaultFilePath(
	workspaceRoot: string | undefined,
): string | undefined {
	return workspaceRoot
		? join(workspaceRoot, "reports", "tasks.jsonl")
		: undefined;
}
