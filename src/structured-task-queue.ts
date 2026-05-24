import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	classifyIntentWithContext,
	type IntentAction,
	type IntentConcept,
	type IntentKind,
	type IntentRiskHint,
} from "./human-intent.js";
import type { ProjectPreflightRisk } from "./project-preflight.js";
import { analyzeUserSignal } from "./user-signal.js";

export type StructuredTaskStatus = "pending" | "running" | "done" | "failed";
export type StructuredTaskGuardStatus =
	| "clear"
	| "needs_confirmation"
	| "approved"
	| "rejected";

export type StructuredTask = {
	id: string;
	text: string;
	category: string;
	priority: number;
	status: StructuredTaskStatus;
	createdAt: string;
	updatedAt: string;
	emotion?: string;
	source?: string;
	projectId?: string;
	failureReason?: string;
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
	category: string;
	priority?: number;
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
			status: "pending",
			createdAt: timestamp,
			updatedAt: timestamp,
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

	markDone(id: string): StructuredTask | undefined {
		return this.updateStatus(id, "done");
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
		const task = this.tasks.find((candidate) =>
			candidate.id.startsWith(idOrPrefix),
		);
		return task ? { ...task } : undefined;
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
	): StructuredTask | undefined {
		const task = this.findTaskById(id);
		if (!task) return undefined;
		task.status = status;
		task.updatedAt = this.now().toISOString();
		if (status === "failed") {
			task.failureReason = failureReason?.trim() || "failed";
		} else {
			delete task.failureReason;
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
		return `task-${this.now().getTime().toString(36)}-${this.sequence}`;
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
		analyzer?: UserSignalAnalyzer;
	} = {},
): StructuredTaskInput {
	const signal = analyzeStructuredTaskSignal(text, options.analyzer);
	const category = options.category?.trim() || structuredTaskCategory(text);
	const intent = classifyIntentWithContext(text, { taskCategory: category });
	return {
		text,
		category,
		priority: signal.emotion === "neutral" ? 3 : signal.urgency,
		emotion: signal.emotion,
		intentKind: intent.kind,
		intentAction: intent.action,
		intentConcepts: intent.concepts,
		intentRiskHint: intent.riskHint,
		intentConfidence: intent.confidence,
		intentEvidence: intent.evidence,
		...(options.source ? { source: options.source } : {}),
		...(options.projectId ? { projectId: options.projectId } : {}),
	};
}

export function formatStructuredTaskQueueDetail(
	tasks: StructuredTask[],
): string {
	if (!tasks.length) return "Cola estructurada vacía.";
	return `Cola estructurada (${tasks.length}):\n\n${tasks
		.map((task) => {
			const primaryConcept = primaryIntentConcept(task.intentConcepts);
			const intent = task.intentKind
				? ` | intent: ${task.intentKind}/${primaryConcept}/${task.intentRiskHint ?? "low"}`
				: "";
			const guard = task.guardStatus
				? ` | guard: ${task.guardStatus}${task.guardRisk ? `/${task.guardRisk}` : ""}`
				: "";
			const approvalHint =
				task.guardStatus === "needs_confirmation"
					? `\nAprobar: /queue_approve ${task.id}\nRechazar: /queue_reject ${task.id}`
					: "";
			return `${task.id.slice(0, 12)} | ${task.status} | P${task.priority} | ${task.category} | ${task.emotion ?? "neutral"}${intent}${guard} | ${task.createdAt}\n${summarizeTaskText(task.text)}${approvalHint}`;
		})
		.join("\n\n")}`;
}

function primaryIntentConcept(concepts: string[] | undefined): string {
	return (
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
