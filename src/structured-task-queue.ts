import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyzeUserSignal } from "./user-signal.js";

export type StructuredTaskStatus = "pending" | "running" | "done" | "failed";

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
};

export type StructuredTaskInput = {
	text: string;
	category: string;
	priority?: number;
	emotion?: string;
	source?: string;
	projectId?: string;
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

	markRunning(id: string): StructuredTask | undefined {
		return this.updateStatus(id, "running");
	}

	markDone(id: string): StructuredTask | undefined {
		return this.updateStatus(id, "done");
	}

	markFailed(id: string, reason: string): StructuredTask | undefined {
		return this.updateStatus(id, "failed", reason);
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
		const task = this.tasks.find((candidate) => candidate.id === id);
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
		analyzer?: UserSignalAnalyzer;
	} = {},
): StructuredTaskInput {
	const signal = analyzeStructuredTaskSignal(text, options.analyzer);
	return {
		text,
		category: structuredTaskCategory(text),
		priority: signal.emotion === "neutral" ? 3 : signal.urgency,
		emotion: signal.emotion,
		...(options.source ? { source: options.source } : {}),
		...(options.projectId ? { projectId: options.projectId } : {}),
	};
}

export function formatStructuredTaskQueueDetail(
	tasks: StructuredTask[],
): string {
	if (!tasks.length) return "Cola estructurada vacía.";
	return `Cola estructurada (${tasks.length}):\n\n${tasks
		.map(
			(task) =>
				`${task.id.slice(0, 12)} | ${task.status} | P${task.priority} | ${task.category} | ${task.emotion ?? "neutral"} | ${task.createdAt}\n${summarizeTaskText(task.text)}`,
		)
		.join("\n\n")}`;
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
