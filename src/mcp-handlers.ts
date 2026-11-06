import { execSync } from "node:child_process";
import { arbitrateAndRecord } from "./arbitration-run.js";
import { looksLikeHighRiskMitigation, normalizeThreshold } from "./arbitration.js";
import { IDU_HOME } from "./config.js";
import { listDecisions, recordDecision } from "./decision-ledger.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { runPostflight, runPreflight, type ChangeMode } from "./quality.js";
import { DEFAULT_DELEGATE_TIMEOUT_MS } from "./timeouts.js";

/**
 * One handler per registered MCP tool.
 *
 * The dispatcher used to be a chain of `if (name === ...)` blocks inside
 * `handleMcpMethod`. A tool added to `TOOLS` without a matching branch was
 * listed to every client and answered 'Unknown tool' at runtime, which read
 * like a client mistake instead of a server defect. With the handlers in a
 * table, `TOOL_HANDLERS` is the single place a name becomes callable, and
 * check-tool-handlers.mjs compares it against `TOOLS` on every verify.
 */

const manager = CrossCliProcessManager.getInstance();

type HandlerArgs = Record<string, unknown>;

export async function handleStatus(args: HandlerArgs): Promise<unknown> {
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

export async function handlePreflight(args: HandlerArgs): Promise<unknown> {
	const request = String(args.request || "");
	const expectedFiles = Array.isArray(args.expected_files) ? args.expected_files.map(String) : [];
	const changeMode = (args.change_mode as ChangeMode) || "modification";
	const cwd = args.working_dir ? String(args.working_dir) : args.cwd ? String(args.cwd) : undefined;
	const result = runPreflight({ request, expectedFiles, changeMode, cwd });
	return {
		content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
	};
}

export async function handlePostflight(args: HandlerArgs): Promise<unknown> {
	const taskId = String(args.task_id || "unspecified");
	const expectedFiles = Array.isArray(args.expected_files) ? args.expected_files.map(String) : [];
	const cwd = args.working_dir ? String(args.working_dir) : args.cwd ? String(args.cwd) : undefined;
	const result = runPostflight({ taskId, expectedFiles, cwd });
	return {
		content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
	};
}

export async function handleDecisionRecord(args: HandlerArgs): Promise<unknown> {
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

export async function handleDecisionList(args: HandlerArgs): Promise<unknown> {
	const projectId = args.project_id ? String(args.project_id) : undefined;
	const limit = typeof args.limit === "number" ? args.limit : 20;
	const list = listDecisions({ projectId, limit });
	return {
		content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
	};
}

export async function handleCapabilities(args: HandlerArgs): Promise<unknown> {
	// only_quota implies the quota read: asking for "just the quota" and
	// getting a payload without it would be a worse lie than a big one.
	const onlyQuota = args.only_quota === true;
	const caps = await manager.getCapabilities({
		includeQuota: onlyQuota || args.include_quota === true,
		freshQuota: args.fresh_quota === true,
	});
	const payload = onlyQuota ? { quota: caps.quota ?? [] } : caps;
	return {
		content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
	};
}

export async function handleDelegate(args: HandlerArgs): Promise<unknown> {
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
	const force = Boolean(args.force);

	const result = await manager.delegate(
		{
			task,
			profile,
			// profile is a required arg here, so the caller always
			// named it: never inherit the session's profile.
			profileExplicit: true,
			force,
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

export async function handleDelegateParallel(args: HandlerArgs): Promise<unknown> {
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

export async function handleWorkerStatus(args: HandlerArgs): Promise<unknown> {
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

export async function handleWorkerResult(args: HandlerArgs): Promise<unknown> {
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

export async function handleWorkerWait(args: HandlerArgs): Promise<unknown> {
	const runId = String(args.run_id || "");
	const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : DEFAULT_DELEGATE_TIMEOUT_MS;
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

export async function handleSessionList(args: HandlerArgs): Promise<unknown> {
	const sessions = manager.listSessions();
	return {
		content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
	};
}

export async function handleArbitrate(args: HandlerArgs): Promise<unknown> {
	const rawOptions = Array.isArray(args.options) ? args.options : [];
	const optionsList: Array<{ id: string; description: string; isHighRiskMitigation?: boolean }> = [];
	for (let idx = 0; idx < rawOptions.length; idx++) {
		const opt = rawOptions[idx];
		if (typeof opt === "string") {
			const sep = opt.indexOf(":");
			if (sep !== -1) {
				optionsList.push({
					id: opt.slice(0, sep).trim(),
					description: opt.slice(sep + 1).trim(),
					isHighRiskMitigation: looksLikeHighRiskMitigation(opt),
				});
			} else {
				optionsList.push({ id: opt, description: opt });
			}
		} else if (typeof opt === "object" && opt !== null) {
			const obj = opt as Record<string, unknown>;
			optionsList.push({
				id: String(obj.id || `opt_${idx + 1}`),
				description: String(obj.description || obj.id || `Option ${idx + 1}`),
				isHighRiskMitigation: obj.isHighRiskMitigation === true,
			});
		}
	}

	if (optionsList.length === 0) {
		return {
			isError: true,
			content: [{ type: "text", text: "At least one option is required for idu_arbitrate." }],
		};
	}

	const stateSummary = String(args.state_summary || args.stateSummary || "Workspace arbitration");
	const threshold = normalizeThreshold(args.threshold);
	const cwd = args.working_dir ? String(args.working_dir) : args.cwd ? String(args.cwd) : undefined;

	const decision = await arbitrateAndRecord({
		label: "idu_arbitrate",
		decidedByPrefix: "idu_arbitrate",
		stateSummary,
		options: optionsList,
		confidenceThreshold: threshold,
		cwd,
		offline: args.offline === true,
	});

	return {
		content: [{ type: "text", text: JSON.stringify(decision, null, 2) }],
	};
}

export const TOOL_HANDLERS: Record<string, (args: HandlerArgs) => Promise<unknown>> = {
	idu_status: handleStatus,
	idu_project_status: handleStatus,
	idu_preflight: handlePreflight,
	idu_postflight: handlePostflight,
	idu_decision_record: handleDecisionRecord,
	idu_decision_list: handleDecisionList,
	idu_capabilities: handleCapabilities,
	idu_delegate: handleDelegate,
	idu_delegate_parallel: handleDelegateParallel,
	idu_worker_status: handleWorkerStatus,
	idu_worker_result: handleWorkerResult,
	idu_worker_wait: handleWorkerWait,
	idu_session_list: handleSessionList,
	idu_arbitrate: handleArbitrate,
};
