#!/usr/bin/env node
import { execSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { CrossCliProcessManager } from "./process-manager.js";
import { IDU_HOME } from "./config.js";
import { runPreflight, runPostflight, type ChangeMode } from "./quality.js";
import { recordDecision, listDecisions } from "./decision-ledger.js";

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

export const TOOLS = [
	{
		name: "idu_status",
		description:
			"Returns current workspace status, active Git branch, dirty working tree files, and system health.",
		inputSchema: {
			type: "object",
			properties: {
				project_path: {
					type: "string",
					description: "Optional project path to check (defaults to current working directory).",
				},
				projectPath: {
					type: "string",
					description: "Alias for project_path.",
				},
			},
		},
	},
	{
		name: "idu_project_status",
		description: "Alias for idu_status: reports workspace path, git status, and IDU configuration path.",
		inputSchema: {
			type: "object",
			properties: {
				project_path: {
					type: "string",
					description: "Optional project path to check (defaults to current working directory).",
				},
				projectPath: {
					type: "string",
					description: "Alias for project_path.",
				},
			},
		},
	},
	{
		name: "idu_preflight",
		description:
			"Pre-flight safety analysis before modifying code. Assesses risk, checks uncommitted changes, locked files, and potential blast radius.",
		inputSchema: {
			type: "object",
			properties: {
				request: {
					type: "string",
					description: "Description of the intended change or task.",
				},
				expected_files: {
					type: "array",
					items: { type: "string" },
					description: "List of files expected to be created or modified.",
				},
				change_mode: {
					type: "string",
					enum: ["additive", "refactor", "modification", "destructive"],
					description: "The intended mode of change.",
				},
				working_dir: {
					type: "string",
					description: "Target workspace directory. If omitted, uses current process directory.",
				},
				cwd: {
					type: "string",
					description: "Alias for working_dir.",
				},
			},
			required: ["request"],
		},
	},
	{
		name: "idu_postflight",
		description:
			"Post-flight verification after modifying code. Compares observed git diff against expected files, detects unexpected changes outside the blast radius, and verifies tree hygiene.",
		inputSchema: {
			type: "object",
			properties: {
				task_id: {
					type: "string",
					description: "Identifier or name of the completed task.",
				},
				expected_files: {
					type: "array",
					items: { type: "string" },
					description: "Files that were expected to change.",
				},
				working_dir: {
					type: "string",
					description: "Target workspace directory. If omitted, uses current process directory.",
				},
				cwd: {
					type: "string",
					description: "Alias for working_dir.",
				},
			},
			required: ["task_id", "expected_files"],
		},
	},
	{
		name: "idu_decision_record",
		description:
			"Records an architectural, design, or operator decision into the durable IDU decision ledger.",
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "Project identifier." },
				decision: { type: "string", description: "Summary of the decision." },
				decided_by: { type: "string", description: "Deciding agent or operator name." },
				target_kind: { type: "string", description: "Target component (e.g. 'mcp', 'router', 'db')." },
				target_id: { type: "string", description: "Identifier of the target subject." },
				rationale: { type: "string", description: "Technical justification for the decision." },
				profile_ref: { type: "string", description: "Optional profile reference." },
			},
			required: ["project_id", "decision", "decided_by", "target_kind", "target_id"],
		},
	},
	{
		name: "idu_decision_list",
		description: "Retrieves recent decisions from the durable IDU decision ledger.",
		inputSchema: {
			type: "object",
			properties: {
				project_id: { type: "string", description: "Project identifier filter." },
				limit: { type: "number", description: "Maximum number of decisions to return (default: 20)." },
			},
		},
	},
	{
		name: "idu_delegate",
		description:
			"Cross-CLI Task Delegation: Spawns an external terminal worker (Claude, OpenCode, Codex, Pi) using a configured profile (e.g. cheap-explore, cheap-debug, coding, architecture, deep-refactor, fast). Enforces the ONE ORCHESTRATOR RULE (IDU_WORKER=true) to prevent recursive sub-agent loops.",
		inputSchema: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description: "Instructions and prompt for the delegated worker.",
				},
				profile: {
					type: "string",
					description:
						"Target profile from ~/.idu/profiles.json (e.g. 'cheap-explore', 'cheap-debug', 'coding', 'architecture', 'deep-refactor', 'fast').",
				},
				working_dir: {
					type: "string",
					description: "Working directory for the target CLI process.",
				},
				cwd: {
					type: "string",
					description: "Alias for working_dir.",
				},
				async: {
					type: "boolean",
					description:
						"If true, starts worker in detached background daemon and returns run_id immediately. Recommended for tasks taking > 15s. IMPORTANT: After calling with async=true, stay blocked in terminal by executing `node dist/src/cli.js wait <run_id> --timeout 540000` without token bloat (do NOT use --follow). DO NOT end turn prematurely.",
				},
				timeout_ms: {
					type: "number",
					description: "Maximum execution timeout in milliseconds (default: 300,000ms = 5m).",
				},
				context_files: {
					type: "array",
					items: { type: "string" },
					description: "Files to supply as context for the worker.",
				},
				verbose: {
					type: "boolean",
					description:
						"If true, includes full raw stdout/stderr logs in the response. Default is false (returns compact summary and logPath only to save tokens and prevent context bloat).",
				},
				session_id: {
					type: "string",
					description:
						"Optional session ID (UUID) to resume an existing conversation and leverage prompt caching. If omitted, a fresh session is allocated.",
				},
				parent_session_id: {
					type: "string",
					description:
						"Optional parent session ID to track hierarchy in the session tree.",
				},
				fork: {
					type: "boolean",
					description:
						"If true, branches/forks from the specified session_id, inheriting prompt cache and conversation context without altering the parent session.",
				},
			},
			required: ["task", "profile"],
		},
	},
	{
		name: "idu_delegate_parallel",
		description: "Concurrently spawns multiple terminal CLI workers across different profiles.",
		inputSchema: {
			type: "object",
			properties: {
				tasks: {
					type: "array",
					description: "Array of task delegation requests.",
					items: {
						type: "object",
						properties: {
							task: { type: "string" },
							profile: { type: "string" },
							working_dir: { type: "string" },
							verbose: { type: "boolean" },
							session_id: { type: "string" },
							parent_session_id: { type: "string" },
							fork: { type: "boolean" },
						},
						required: ["task", "profile"],
					},
				},
			},
			required: ["tasks"],
		},
	},
	{
		name: "idu_worker_status",
		description: "Checks real-time execution status, running duration, and recent logs of a delegated run_id.",
		inputSchema: {
			type: "object",
			properties: {
				run_id: {
					type: "string",
					description: "Unique run ID returned by idu_delegate.",
				},
			},
			required: ["run_id"],
		},
	},
	{
		name: "idu_worker_result",
		description: "Retrieves the complete result, output summary, and log transcript for a completed run_id.",
		inputSchema: {
			type: "object",
			properties: {
				run_id: {
					type: "string",
					description: "Unique run ID.",
				},
				verbose: {
					type: "boolean",
					description:
						"If true, includes full raw stdout/stderr in the response. Default is false (returns clean summary and logPath only).",
				},
			},
			required: ["run_id"],
		},
	},
	{
		name: "idu_worker_wait",
		description:
			"Blocks until a background delegated worker (run_id) finishes (completed, failed, or timeout) and returns the full final result. NOTE: If the wait expires before the worker finishes, the worker process is NOT terminated; it remains active in the background. The caller can safely re-invoke idu_worker_wait to continue waiting, inspect real-time progress via idu_worker_status, or execute `node dist/src/cli.js wait <run_id> --timeout 540000` in terminal.",
		inputSchema: {
			type: "object",
			properties: {
				run_id: {
					type: "string",
					description: "Unique run ID returned by idu_delegate.",
				},
				timeout_ms: {
					type: "number",
					description: "Maximum milliseconds to wait before returning current state (default: 900000ms / 15 min).",
				},
				verbose: {
					type: "boolean",
					description: "If true, includes full raw stdout/stderr in the response.",
				},
			},
			required: ["run_id"],
		},
	},
	{
		name: "idu_capabilities",
		description:
			"Lists available worker profiles in ~/.idu/profiles.json, detects installed terminal CLIs (Claude, OpenCode, Pi, Codex), and reports the active ONE ORCHESTRATOR rule status.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "idu_session_list",
		description:
			"Lists all tracked sessions and their hierarchy (parent/child relationships, turns, profile, and timestamps). Compatible with IDUPI Screen.SESSIONS.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
];

export function validateToolInput(
	schema: Record<string, any> | undefined,
	args: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
	if (!schema || typeof schema !== "object") {
		return { valid: true, errors: [] };
	}

	const errors: string[] = [];
	const required = Array.isArray(schema.required) ? schema.required : [];
	const properties = (schema.properties || {}) as Record<string, any>;

	// 1. Required fields
	for (const reqField of required) {
		const val = args[reqField];
		if (val === undefined || val === null || val === "") {
			errors.push(`Missing required parameter: '${reqField}'`);
		}
	}

	// 2. Types, enums, and rejection of unknown parameters (strict closed schema)
	for (const [key, val] of Object.entries(args)) {
		if (val === undefined) continue;
		const propDef = properties[key];
		if (!propDef) {
			errors.push(`Unknown parameter '${key}' is not permitted for this tool`);
			continue;
		}

		if (propDef.type) {
			switch (propDef.type) {
				case "string":
					if (typeof val !== "string") {
						errors.push(`Parameter '${key}' must be a string, got ${typeof val}`);
					}
					break;
				case "number":
					if (typeof val !== "number" || isNaN(val)) {
						errors.push(`Parameter '${key}' must be a number, got ${typeof val}`);
					}
					break;
				case "boolean":
					if (typeof val !== "boolean") {
						errors.push(`Parameter '${key}' must be a boolean, got ${typeof val}`);
					}
					break;
				case "array":
					if (!Array.isArray(val)) {
						errors.push(`Parameter '${key}' must be an array, got ${typeof val}`);
					} else if (propDef.items?.type) {
						const itemType = propDef.items.type;
						for (let i = 0; i < val.length; i++) {
							if (typeof val[i] !== itemType) {
								errors.push(`Parameter '${key}[${i}]' must be a ${itemType}, got ${typeof val[i]}`);
							}
						}
					}
					break;
				case "object":
					if (typeof val !== "object" || val === null || Array.isArray(val)) {
						errors.push(`Parameter '${key}' must be an object`);
					}
					break;
			}
		}

		if (Array.isArray(propDef.enum) && !propDef.enum.includes(val)) {
			errors.push(`Parameter '${key}' must be one of: [${propDef.enum.join(", ")}], got '${val}'`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

function sendResponse(response: JsonRpcResponse): void {
	stdout.write(JSON.stringify(response) + "\n");
}

export async function handleMcpMethod(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
	switch (method) {
		case "initialize":
			return {
				protocolVersion: "2024-11-05",
				capabilities: {
					tools: {},
				},
				serverInfo: {
					name: "idu-cross-cli",
					version: "2.1.0",
				},
			};

		case "notifications/initialized":
			return null;

		case "tools/list":
			return { tools: TOOLS };

		case "tools/call": {
			const name = String(params?.name || "");
			const args = (params?.arguments || {}) as Record<string, unknown>;

			const tool = TOOLS.find((t) => t.name === name);
			if (!tool) {
				return {
					isError: true,
					content: [{ type: "text", text: `Unknown tool: '${name}'` }],
				};
			}

			const validation = validateToolInput(tool.inputSchema, args);
			if (!validation.valid) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Schema validation failed for tool '${name}':\n- ${validation.errors.join("\n- ")}`,
						},
					],
				};
			}

			if (name === "idu_status" || name === "idu_project_status") {
				const cwd = String(args.project_path || args.projectPath || process.cwd());
				let branch = "unknown";
				let dirtyFiles: string[] = [];
				try {
					branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
					const statusOut = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
					dirtyFiles = statusOut ? statusOut.split("\n").map((l) => l.trim()) : [];
				} catch {
					// Git unavailable or not initialized
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: true,
									cwd,
									branch,
									isClean: dirtyFiles.length === 0,
									dirtyFileCount: dirtyFiles.length,
									dirtyFiles: dirtyFiles.slice(0, 20),
									iduHome: IDU_HOME,
								},
								null,
								2,
							),
						},
					],
				};
			}

			if (name === "idu_preflight") {
				const request = String(args.request || "");
				const expectedFiles = Array.isArray(args.expected_files) ? args.expected_files.map(String) : [];
				const changeMode = (args.change_mode as ChangeMode) || "modification";
				const cwd = args.working_dir ? String(args.working_dir) : args.cwd ? String(args.cwd) : undefined;
				const result = runPreflight({ request, expectedFiles, changeMode, cwd });
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			}

			if (name === "idu_postflight") {
				const taskId = String(args.task_id || "unspecified");
				const expectedFiles = Array.isArray(args.expected_files) ? args.expected_files.map(String) : [];
				const cwd = args.working_dir ? String(args.working_dir) : args.cwd ? String(args.cwd) : undefined;
				const result = runPostflight({ taskId, expectedFiles, cwd });
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				};
			}

			if (name === "idu_decision_record") {
				const recorded = recordDecision({
					projectId: String(args.project_id || "default"),
					decidedBy: String(args.decided_by || "agent"),
					decision: String(args.decision || ""),
					targetKind: String(args.target_kind || "general"),
					targetId: String(args.target_id || "default"),
					rationale: args.rationale ? String(args.rationale) : undefined,
					profileRef: args.profile_ref ? String(args.profile_ref) : undefined,
				});
				return {
					content: [{ type: "text", text: JSON.stringify({ ok: true, recorded }, null, 2) }],
				};
			}

			if (name === "idu_decision_list") {
				const projectId = args.project_id ? String(args.project_id) : undefined;
				const limit = typeof args.limit === "number" ? args.limit : 20;
				const list = listDecisions({ projectId, limit });
				return {
					content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
				};
			}

			if (name === "idu_capabilities") {
				const caps = manager.getCapabilities();
				return {
					content: [{ type: "text", text: JSON.stringify(caps, null, 2) }],
				};
			}

			if (name === "idu_delegate") {
				const task = String(args.task || "");
				const profile = String(args.profile || "");
				const workingDir = args.working_dir ? String(args.working_dir) : (args.cwd ? String(args.cwd) : undefined);
				const asyncExec = Boolean(args.async);
				const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;
				const contextFiles = Array.isArray(args.context_files) ? args.context_files.map(String) : [];
				const verbose = Boolean(args.verbose);
				const sessionId = args.session_id ? String(args.session_id) : undefined;
				const parentSessionId = args.parent_session_id ? String(args.parent_session_id) : undefined;
				const fork = Boolean(args.fork);

				const result = await manager.delegate(
					{
						task,
						profile,
						workingDir,
						parentOrchestrator: "orchestrator",
						timeoutMs,
						contextFiles,
						verbose,
						sessionId,
						parentSessionId,
						fork,
					},
					asyncExec,
				);

				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
							verbose: Boolean(t.verbose),
							sessionId: t.session_id ? String(t.session_id) : undefined,
							parentSessionId: t.parent_session_id ? String(t.parent_session_id) : undefined,
							fork: Boolean(t.fork),
						},
						true,
					),
				);
				const results = await Promise.all(promises);
				return {
					content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
				};
			}

			if (name === "idu_worker_status") {
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

			if (name === "idu_worker_result") {
				const runId = String(args.run_id || "");
				const verbose = Boolean(args.verbose);
				const res = manager.getResult(runId, verbose);
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

			if (name === "idu_worker_wait") {
				const runId = String(args.run_id || "");
				const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 900_000;
				const verbose = Boolean(args.verbose);
				const res = await manager.waitForCompletion(runId, timeoutMs, verbose);
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

			if (name === "idu_session_list") {
				const sessions = manager.listSessions();
				return {
					content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
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

export function runMcpServer(): void {
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
							const result = await handleMcpMethod(req.method, req.params);
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
					// Invalid JSON line
				}
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runMcpServer();
}
