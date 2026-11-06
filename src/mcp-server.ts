#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { TOOL_HANDLERS } from "./mcp-handlers.js";

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

/**
 * A worker must not see idu-pi at all.
 *
 * The orchestrator hands a worker its own harness and nothing else: Pi keeps
 * gentle-ai, CommandCode keeps its own subagents, every CLI keeps codegraph,
 * engram and the rest. What a worker must never get is a way back into the
 * orchestrator, because that is the loop the ONE ORCHESTRATOR RULE exists to
 * prevent.
 *
 * Hiding the tools is stronger than letting the worker see them and fail at
 * call time. A tool the model cannot see is not a tool it reaches for, and it
 * costs no runtime error when it does try a name it was never offered.
 *
 * The guard in `delegate()` stays: it is the second line, and it still owns the
 * direct CLI path, which never touches this server.
 */
function isWorkerProcess(): boolean {
	return process.env.IDU_WORKER === "true";
}

const WORKER_HIDDEN_TOOL_ERROR =
	"idu-pi is not available inside a delegated worker. " +
	"Workers run on their own harness (native subagents, skills, codegraph, engram) and " +
	"cannot re-enter the orchestrator. Ask the orchestrator if you need something delegated.";

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
			"Cross-CLI Task Delegation: Spawns an external terminal worker (Claude, OpenCode, Codex, Pi) for advisory, audit, or secondary consultation. Enforces the ONE ORCHESTRATOR RULE (IDU_WORKER=true) and blocks external delegation of active SDD work units or primary implementation.",
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
						"If true, starts worker in detached background daemon and returns run_id immediately. Recommended for tasks taking > 15s. IMPORTANT: After calling with async=true, stay blocked in terminal by executing `idu-pi wait <run_id> --timeout 540000` without token bloat (do NOT use --follow). DO NOT end turn prematurely.",
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
				force: {
					type: "boolean",
					description:
						"If true, allows resuming a session with a profile whose harness differs from the one that created it. Off by default: the guard rejects cross-harness resumes because the new CLI cannot read a transcript it never wrote, which drops native session continuity. Use only when you accept a fresh conversation under the new harness.",
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
			"Blocks until a background delegated worker (run_id) finishes (completed, failed, or timeout) and returns the full final result. NOTE: If the wait expires before the worker finishes, the worker process is NOT terminated; it remains active in the background. The caller can safely re-invoke idu_worker_wait to continue waiting, inspect real-time progress via idu_worker_status, or execute `idu-pi wait <run_id> --timeout 540000` in terminal.",
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
			"Lists available worker profiles in ~/.idu/profiles.json, detects installed terminal CLIs (Claude, OpenCode, Pi, Codex), and reports the active ONE ORCHESTRATOR rule status. With include_quota, also reads each CLI's own account quota (remaining % and reset time per window) so you can avoid dispatching to a model that is nearly exhausted. Off by default: two of the quota sources cost a model call to answer. When you only want the quota, pass only_quota: it returns the quota array alone, without the profile list that is most of the payload.",
		inputSchema: {
			type: "object",
			properties: {
				only_quota: {
					type: "boolean",
					description:
					"Return ONLY the quota array, dropping the profile list and CLI detection. Measured here, the profile list alone is about 5100 of the 6800 bytes of the full response, so this flag removes roughly three quarters of the payload you did not ask for. Implies include_quota.",
				},
				include_quota: {
					type: "boolean",
					description:
					"When true, read each installed CLI's own account quota. Every figure is REMAINING, never used, and a CLI that cannot answer reports unknown with a reason instead of zero. Read from a 10 minute cache by default. stale=true means the reading came FROM that cache and is not expired: capturedAt is when it was taken, and any snapshot older than the TTL is re-read rather than served. fresh_quota re-reads now, which is free for codex and commandcode but costs one model call each for claude and antigravity.",
				},
				fresh_quota: {
					type: "boolean",
					description:
						"Ignore the quota cache and query the accounts now. Costs about eleven seconds and, for claude and antigravity, a model call each. Only needed when a cached reading is too old to reason with.",
				},
			},
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
	{
		name: "idu_arbitrate",
		description:
			"Autonomous decision arbitration via TypeSafe Jev (System One Model) or local Kev. Evaluates candidate options probabilistically against a state summary with calibrated confidence and fallback.",
		inputSchema: {
			type: "object",
			properties: {
				options: {
					type: "array",
					description:
						"List of candidate options to arbitrate between. Each option can be an object with 'id' and 'description' or a string 'id:description'.",
				},
				state_summary: {
					type: "string",
					description: "Summary of the current state, context, or decision problem.",
				},
				stateSummary: {
					type: "string",
					description: "Alias for state_summary.",
				},
				threshold: {
					type: "number",
					description:
						"Confidence threshold (0.0 to 1.0) above which Jev's choice is accepted without human review (defaults to 0.85).",
				},
				offline: {
					type: "boolean",
					description:
						"When true, skips local Kev and cloud Jev and returns the deterministic Risk-First policy with zero network I/O.",
				},
				working_dir: {
					type: "string",
					description: "Target workspace directory for resolving local .env config.",
				},
				cwd: {
					type: "string",
					description: "Alias for working_dir.",
				},
			},
			required: ["options"],
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
					version: "2.3.0",
				},
			};

		case "notifications/initialized":
			return null;

		case "tools/list":
			// A worker gets an empty catalogue. Not a filtered subset, and not an
			// error: the server answers normally, it simply offers nothing. Other
			// MCP servers this harness configured are untouched.
			return { tools: isWorkerProcess() ? [] : TOOLS };

		case "tools/call": {
			const name = String(params?.name || "");
			const args = (params?.arguments || {}) as Record<string, unknown>;

			// tools/list is advisory. A client that cached the orchestrator's
			// catalogue can still name a tool by hand, so the call itself is
			// refused rather than merely unlisted.
			if (isWorkerProcess()) {
				return {
					isError: true,
					content: [{ type: "text", text: WORKER_HIDDEN_TOOL_ERROR }],
				};
			}

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

			const handler = TOOL_HANDLERS[name];
			if (!handler) {
				// Registered in TOOLS but not dispatched: a server defect, not a
				// client mistake, so it must not read like one.
				return {
					isError: true,
					content: [{ type: "text", text: `Tool '${name}' is registered but has no handler (server defect).` }],
				};
			}
			return handler(args);
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
