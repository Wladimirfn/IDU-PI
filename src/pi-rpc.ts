import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { buildPrompt, createChildEnv } from "./pi.js";

export type PiRpcOptions = {
	piBin: string;
	piArgs?: string[];
	cwd: string;
	modePrefix?: string;
	sessionPath?: string;
};

export type PiRpcPromptResult = {
	ok: boolean;
	output: string;
};

export type PiRpcProgressEvent =
	| { type: "started" }
	| { type: "accepted" }
	| { type: "tool"; toolName: string }
	| { type: "assistant_delta"; delta: string }
	| { type: "ui_request"; request: PiRpcUiRequest }
	| { type: "ended" };

export type PiRpcUiRequest = {
	id: string;
	method:
		| "select"
		| "confirm"
		| "input"
		| "editor"
		| "notify"
		| "setStatus"
		| "setWidget"
		| "setTitle"
		| "set_editor_text";
	title?: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	statusKey?: string;
	statusText?: string;
	widgetKey?: string;
	widgetLines?: string[];
};

type PendingPrompt = {
	id: string;
	resolve: (result: PiRpcPromptResult) => void;
	reject: (error: Error) => void;
	text: string;
	accepted: boolean;
};

export class PiRpcSession {
	private child: ChildProcessWithoutNullStreams | undefined;
	private buffer = "";
	private pending: PendingPrompt | undefined;
	private pendingCommand:
		| {
				id: string;
				resolve: (value: unknown) => void;
				reject: (error: Error) => void;
		  }
		| undefined;
	private starting = false;
	private generation = 0;
	private onProgress: ((event: PiRpcProgressEvent) => void) | undefined;

	constructor(private options: PiRpcOptions) {}

	get cwd(): string {
		return this.options.cwd;
	}

	get running(): boolean {
		return Boolean(this.child && !this.child.killed);
	}

	get busy(): boolean {
		return Boolean(this.pending);
	}

	start(): void {
		this.ensureStarted();
	}

	async prompt(
		message: string,
		onProgress?: (event: PiRpcProgressEvent) => void,
	): Promise<PiRpcPromptResult> {
		if (this.pending) throw new Error("Ya hay una tarea Pi corriendo.");
		this.onProgress = onProgress;
		this.ensureStarted();
		this.emitProgress({ type: "started" });

		const id = `telegram-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const text = buildPrompt(message, this.options.modePrefix);

		return new Promise((resolve, reject) => {
			this.pending = { id, resolve, reject, text: "", accepted: false };
			try {
				this.writeCommand({ id, type: "prompt", message: text });
			} catch (error) {
				this.pending = undefined;
				this.onProgress = undefined;
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	answerUiRequest(value: unknown): boolean {
		if (!this.child) return false;
		this.writeCommand(value as Record<string, unknown>);
		return true;
	}

	cancel(): boolean {
		const hadWork = Boolean(this.pending || this.child);
		if (this.child) {
			try {
				this.writeCommand({ id: `abort-${Date.now()}`, type: "abort" });
			} catch {
				// The process is already unhealthy; stop() below is the recovery path.
			}
		}
		this.stop("Cancelado por el usuario desde Telegram.");
		return hadWork;
	}

	stop(reason = "Sesión Pi RPC detenida."): void {
		const child = this.child;
		this.child = undefined;
		this.buffer = "";
		this.generation++;
		this.pending?.reject(new Error(reason));
		this.pending = undefined;
		this.pendingCommand?.reject(new Error(reason));
		this.pendingCommand = undefined;
		this.onProgress = undefined;
		if (!child) return;
		child.kill("SIGTERM");
		setTimeout(() => {
			if (!child.killed) child.kill("SIGKILL");
		}, 5_000).unref();
	}

	private ensureStarted(): void {
		if (this.child || this.starting) return;
		this.starting = true;

		const generation = ++this.generation;
		const sessionArgs = this.options.sessionPath
			? ["--session", this.options.sessionPath]
			: [];
		const child = spawn(
			this.options.piBin,
			[...(this.options.piArgs ?? []), ...sessionArgs, "--mode", "rpc"],
			{
				cwd: this.options.cwd,
				shell: false,
				windowsHide: true,
				env: createChildEnv(),
			},
		);

		this.child = child;
		this.starting = false;

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");

		child.stdout.on("data", (chunk) =>
			this.onStdout(String(chunk), generation),
		);
		child.stderr.on("data", (chunk) => {
			if (generation !== this.generation) return;
			const text = String(chunk).trim();
			if (text) console.error("[pi-rpc stderr]", text);
		});
		child.stdin.on("error", (error) => {
			if (generation === this.generation) this.failPending(error);
		});
		child.on("error", (error) => {
			if (generation === this.generation) this.failPending(error);
		});
		child.on("close", (code) => {
			if (generation !== this.generation) return;
			this.child = undefined;
			this.failPending(
				new Error(
					`Pi RPC se cerró${code === null ? "" : ` con código ${code}`}.`,
				),
			);
		});
	}

	private writeCommand(command: Record<string, unknown>): void {
		if (!this.child) throw new Error("Pi RPC no está iniciado.");
		const ok = this.child.stdin.write(
			`${JSON.stringify(command)}\n`,
			(error) => {
				if (error) this.failPending(error);
			},
		);
		if (!ok && this.child.stdin.destroyed) {
			throw new Error("No se pudo escribir al proceso Pi RPC.");
		}
	}

	private onStdout(chunk: string, generation: number): void {
		if (generation !== this.generation) return;
		this.buffer += chunk;
		let newlineIndex = this.buffer.indexOf("\n");

		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex).replace(/\r$/u, "");
			this.buffer = this.buffer.slice(newlineIndex + 1);
			this.handleLine(line);
			newlineIndex = this.buffer.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		if (!line.trim()) return;

		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			console.error("[pi-rpc non-json]", line);
			return;
		}

		const pendingCommand = this.pendingCommand;
		if (
			event.type === "response" &&
			pendingCommand &&
			event.id === pendingCommand.id
		) {
			this.pendingCommand = undefined;
			if (event.success === false || event.data?.cancelled) {
				pendingCommand.reject(
					new Error(event.errorMessage || "Pi rechazó el comando RPC."),
				);
			} else {
				pendingCommand.resolve(event.data ?? {});
			}
			return;
		}

		const pending = this.pending;
		if (
			event.type === "response" &&
			event.command === "prompt" &&
			pending &&
			event.id === pending.id
		) {
			pending.accepted = Boolean(event.success);
			if (event.success) this.emitProgress({ type: "accepted" });
			if (!event.success)
				this.finishPending(
					false,
					event.errorMessage || "Pi rechazó el prompt.",
				);
			return;
		}

		if (event.type === "extension_ui_request") {
			this.emitProgress({
				type: "ui_request",
				request: {
					id: event.id,
					method: event.method,
					title: event.title,
					message: event.message,
					options: event.options,
					placeholder: event.placeholder,
					prefill: event.prefill,
					statusKey: event.statusKey,
					statusText: event.statusText,
					widgetKey: event.widgetKey,
					widgetLines: event.widgetLines,
				},
			});
			return;
		}

		const delta = event.assistantMessageEvent;
		if (
			event.type === "message_update" &&
			delta?.type === "text_delta" &&
			this.pending
		) {
			const textDelta = delta.delta ?? "";
			this.pending.text += textDelta;
			if (textDelta) this.emitProgress({ type: "assistant_delta", delta: textDelta });
			return;
		}

		if (event.type === "tool_execution_start" && this.pending) {
			this.pending.text += `\n[tool:${event.toolName}] iniciando...\n`;
			this.emitProgress({ type: "tool", toolName: event.toolName ?? "tool" });
			return;
		}

		if (event.type === "agent_end" && this.pending) {
			this.emitProgress({ type: "ended" });
			this.finishPending(true, this.pending.text.trim() || "(sin salida)");
		}
	}

	private finishPending(ok: boolean, output: string): void {
		const pending = this.pending;
		if (!pending) return;
		this.pending = undefined;
		this.onProgress = undefined;
		pending.resolve({ ok, output });
	}

	private emitProgress(event: PiRpcProgressEvent): void {
		this.onProgress?.(event);
	}

	private failPending(error: Error): void {
		const pendingCommand = this.pendingCommand;
		if (pendingCommand) {
			this.pendingCommand = undefined;
			pendingCommand.reject(error);
		}
		const pending = this.pending;
		if (!pending) return;
		this.pending = undefined;
		this.onProgress = undefined;
		pending.reject(error);
	}
}
