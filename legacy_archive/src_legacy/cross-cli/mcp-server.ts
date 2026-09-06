#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { CrossCliProcessManager } from "./process-manager.js";

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: string | number | null;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

const manager = CrossCliProcessManager.getInstance();

const TOOLS = [
	{
		name: "idu_delegate",
		description:
			"Delegates a task to an external terminal CLI worker using a configured profile (e.g. cheap-explore, cheap-debug, coding, architecture, deep-refactor, fast). Enforces the ONE ORCHESTRATOR RULE (IDU_WORKER=true) to strictly prevent recursive sub-delegation loops.",
		inputSchema: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description: "Actionable instructions and prompt for the delegated worker.",
				},
				profile: {
					type: "string",
					description:
						"Target profile defined in ~/.idu/profiles.json (e.g., 'cheap-explore', 'cheap-debug', 'coding', 'architecture', 'deep-refactor', 'fast').",
				},
				working_dir: {
					type: "string",
					description: "Working directory for the target CLI process (defaults to current directory).",
				},
				async: {
					type: "boolean",
					description: "If true, returns immediately with run_id without waiting for completion. Default false.",
				},
				timeout_ms: {
					type: "number",
					description: "Maximum execution time in milliseconds (default: 300,000ms = 5m).",
				},
				context_files: {
					type: "array",
					items: { type: "string" },
					description: "Optional list of file paths relevant for the worker's task.",
				},
			},
			required: ["task", "profile"],
		},
	},
	{
		name: "idu_delegate_parallel",
		description: "Spawns multiple terminal CLI workers concurrently across different profiles.",
		inputSchema: {
			type: "object",
			properties: {
				tasks: {
					type: "array",
					description: "Array of tasks to delegate in parallel.",
					items: {
						type: "object",
						properties: {
							task: { type: "string" },
							profile: { type: "string" },
							working_dir: { type: "string" },
						},
						required: ["task", "profile"],
					},
				},
			},
			required: ["tasks"],
		},
	},
	{
		name: "idu_status",
		description: "Checks the real-time execution status and recent logs of a delegated run_id.",
		inputSchema: {
			type: "object",
			properties: {
				run_id: {
					type: "string",
					description: "Unique identifier of the run (returned by idu_delegate).",
				},
			},
			required: ["run_id"],
		},
	},
	{
		name: "idu_result",
		description: "Retrieves the full outcome, output summary, and execution details for a run_id.",
		inputSchema: {
			type: "object",
			properties: {
				run_id: {
					type: "string",
					description: "Unique identifier of the run.",
				},
			},
			required: ["run_id"],
		},
	},
	{
		name: "idu_capabilities",
		description:
			"Lists available worker profiles in ~/.idu/profiles.json, detects installed CLIs on the system (Claude, OpenCode, Pi, Codex), and reports the active ONE ORCHESTRATOR rule configuration.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
];

function sendResponse(response: JsonRpcResponse): void {
	stdout.write(JSON.stringify(response) + "\n");
}

async function handleMethod(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
	switch (method) {
		case "initialize":
			return {
				protocolVersion: "2024-11-05",
				capabilities: {
					tools: {},
				},
				serverInfo: {
					name: "idu-cross-cli",
					version: "1.0.0",
				},
			};

		case "notifications/initialized":
			return null;

		case "tools/list":
			return { tools: TOOLS };

		case "tools/call": {
			const name = String(params?.name || "");
			const args = (params?.arguments || {}) as Record<string, unknown>;

			if (name === "idu_capabilities") {
				const caps = manager.getCapabilities();
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(caps, null, 2),
						},
					],
				};
			}

			if (name === "idu_delegate") {
				const task = String(args.task || "");
				const profile = String(args.profile || "");
				const workingDir = args.working_dir ? String(args.working_dir) : undefined;
				const asyncExec = Boolean(args.async);
				const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;
				const contextFiles = Array.isArray(args.context_files) ? args.context_files.map(String) : [];

				const result = await manager.delegate(
					{
						task,
						profile,
						workingDir,
						parentOrchestrator: "orchestrator",
						timeoutMs,
						contextFiles,
					},
					asyncExec,
				);

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			}

			if (name === "idu_delegate_parallel") {
				const tasks = Array.isArray(args.tasks) ? (args.tasks as Array<Record<string, unknown>>) : [];
				const promises = tasks.map((t) =>
					manager.delegate(
						{
							task: String(t.task || ""),
							profile: String(t.profile || ""),
							workingDir: t.working_dir ? String(t.working_dir) : undefined,
							parentOrchestrator: "orchestrator",
						},
						true, // Start all in parallel asynchronously
					),
				);
				const results = await Promise.all(promises);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(results, null, 2),
						},
					],
				};
			}

			if (name === "idu_status") {
				const runId = String(args.run_id || "");
				const status = manager.getStatus(runId);
				if (!status) {
					return {
						isError: true,
						content: [{ type: "text", text: `Run ID "${runId}" not found in ~/.idu/sessions.` }],
					};
				}
				return {
					content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
				};
			}

			if (name === "idu_result") {
				const runId = String(args.run_id || "");
				const res = manager.getResult(runId);
				if (!res) {
					return {
						isError: true,
						content: [{ type: "text", text: `Run ID "${runId}" not found in ~/.idu/sessions.` }],
					};
				}
				return {
					content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
				};
			}

			return {
				isError: true,
				content: [{ type: "text", text: `Unknown tool: ${name}` }],
			};
		}

		default:
			throw {
				code: -32601,
				message: `Method not found: ${method}`,
			};
	}
}

export function startMcpServer(): void {
	let buffer = "";
	stdin.setEncoding("utf8");

	stdin.on("data", async (chunk: string) => {
		buffer += chunk;
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (line) {
				try {
					const req = JSON.parse(line) as JsonRpcRequest;
					if (req.method) {
						try {
							const result = await handleMethod(req.method, req.params);
							if (req.id !== undefined) {
								sendResponse({ jsonrpc: "2.0", id: req.id, result });
							}
						} catch (err: unknown) {
							const error =
								typeof err === "object" && err !== null && "code" in err
									? (err as { code: number; message: string })
									: { code: -32000, message: err instanceof Error ? err.message : String(err) };
							if (req.id !== undefined) {
								sendResponse({ jsonrpc: "2.0", id: req.id, error });
							}
						}
					}
				} catch {
					// Invalid JSON line, ignore or return parse error
				}
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	startMcpServer();
}
