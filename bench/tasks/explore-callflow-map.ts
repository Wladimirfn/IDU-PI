import {
	evaluateReadOnlyHygiene,
	extractLastJsonValue,
	includesAnyPattern,
	normalizeRepoPath,
	repoFileExists,
	summarizeTaskChecks,
} from "./eval-helpers.js";
import type { BenchmarkTaskDef, EvalCheckResult, EvalContext } from "../types.js";

const INDEX_MJS = `import { IngressQueue } from "./pipeline/ingress.mjs";
import { PolicyEvaluator } from "./pipeline/policy.mjs";
import { dispatchViaRegistry } from "./adapters/registry.mjs";

/**
 * Primary active entrypoint for multi-channel notification delivery.
 */
export function createNotificationRouter(config = {}) {
  const queue = new IngressQueue();
  const evaluator = new PolicyEvaluator(config);

  return {
    async submit(event) {
      queue.enqueue(event);
      const batch = queue.drainBatch();
      const results = [];
      for (const item of batch) {
        const verdict = evaluator.evaluateDispatch(item);
        if (!verdict.allowed) {
          results.push({ id: item.id, status: "blocked", reason: verdict.reason });
          continue;
        }
        const delivery = await dispatchViaRegistry(item, verdict.maxAttempts);
        results.push({ id: item.id, status: "sent", delivery });
      }
      return results;
    },
  };
}
`;

const INGRESS_MJS = `export class IngressQueue {
  constructor() {
    this.items = [];
  }

  enqueue(event) {
    this.items.push(event);
  }

  drainBatch(limit = 50) {
    return this.items.splice(0, limit);
  }
}
`;

const POLICY_MJS = `export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 3,
  blockedTypes: new Set(["spam_probe"]),
};

export class PolicyEvaluator {
  constructor(config = {}) {
    this.maxAttempts = config.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts;
  }

  evaluateDispatch(event) {
    if (DEFAULT_RETRY_POLICY.blockedTypes.has(event?.type)) {
      return { allowed: false, reason: "blocked_type", maxAttempts: 0 };
    }
    return { allowed: true, maxAttempts: this.maxAttempts };
  }
}
`;

const REGISTRY_MJS = `import { smtpAdapter } from "./smtp.mjs";
import { httpWebhookAdapter } from "./webhook.mjs";

export const ADAPTER_REGISTRY = {
  email: smtpAdapter,
  webhook: httpWebhookAdapter,
};

export async function dispatchViaRegistry(event, maxAttempts) {
  const handler = ADAPTER_REGISTRY[event.channel];
  if (!handler) {
    throw new Error(\`Unsupported channel: \${event.channel}\`);
  }
  return handler(event, { maxAttempts });
}
`;

const SMTP_MJS = `export async function smtpAdapter(event, opts) {
  return { transport: "smtp", to: event.recipient, attemptsBudget: opts.maxAttempts };
}
`;

const WEBHOOK_MJS = `export async function httpWebhookAdapter(event, opts) {
  return { transport: "https", url: event.recipient, attemptsBudget: opts.maxAttempts };
}
`;

const LEGACY_MJS = `// Unused legacy module kept around after v1 rewrite (not imported anywhere at runtime).
export const DEFAULT_MAX_RETRIES = 5;

export function smsLegacyAdapter(event) {
  return { transport: "sms-v1", to: event.recipient };
}

export function legacyDispatchSync(event) {
  return smsLegacyAdapter(event);
}
`;

interface ExploreCallflowOutput {
	entryPoint?: { file?: string; symbol?: string };
	activeOrderedPipeline?: Array<{ file?: string; symbol?: string }>;
	activeAdapters?: Array<{ channel?: string; file?: string; symbol?: string }>;
	effectiveMaxAttempts?: number;
	deadCodeExports?: Array<{ file?: string; symbol?: string }>;
}

const ORACLE_SUMMARY = [
	"Read-only call-flow map extracted.",
	"```json",
	JSON.stringify(
		{
			entryPoint: { file: "src/index.mjs", symbol: "createNotificationRouter" },
			activeOrderedPipeline: [
				{ file: "src/index.mjs", symbol: "createNotificationRouter" },
				{ file: "src/pipeline/ingress.mjs", symbol: "IngressQueue" },
				{ file: "src/pipeline/policy.mjs", symbol: "PolicyEvaluator" },
				{ file: "src/adapters/registry.mjs", symbol: "dispatchViaRegistry" },
			],
			activeAdapters: [
				{ channel: "email", file: "src/adapters/smtp.mjs", symbol: "smtpAdapter" },
				{ channel: "webhook", file: "src/adapters/webhook.mjs", symbol: "httpWebhookAdapter" },
			],
			effectiveMaxAttempts: 3,
			deadCodeExports: [
				{ file: "src/legacy/deprecated-dispatcher.mjs", symbol: "legacyDispatchSync" },
				{ file: "src/legacy/deprecated-dispatcher.mjs", symbol: "smsLegacyAdapter" },
			],
		},
		null,
		2,
	),
	"```",
].join("\n");

export const exploreCallflowMapTask: BenchmarkTaskDef = {
	id: "explore-01-callflow-map",
	category: "explore-bench",
	title: "Codebase Call-Flow & Dead-Code Mapping (Read-Only)",
	description: "Measures fast, faithful repository exploration: real entrypoints, registry dispatch, effective defaults vs decoys, and dead-code separation.",
	timeoutMs: 420_000,
	permissionMode: "read-only",
	fixtureFiles: {
		"package.json": JSON.stringify({ name: "notify-router", type: "module", private: true }, null, 2) + "\n",
		"src/index.mjs": INDEX_MJS,
		"src/pipeline/ingress.mjs": INGRESS_MJS,
		"src/pipeline/policy.mjs": POLICY_MJS,
		"src/adapters/registry.mjs": REGISTRY_MJS,
		"src/adapters/smtp.mjs": SMTP_MJS,
		"src/adapters/webhook.mjs": WEBHOOK_MJS,
		"src/legacy/deprecated-dispatcher.mjs": LEGACY_MJS,
	},
	oraclePatchFiles: {},
	oracleSummary: ORACLE_SUMMARY,
	prompt: [
		"Map the active runtime call flow and identify unreferenced dead code in `src/`.",
		"CRITICAL CONSTRAINT: STRICTLY READ-ONLY. Do NOT modify, create, or delete any files.",
		"",
		"Return ONE ```json block matching this exact schema:",
		"{",
		'  "entryPoint": { "file": "src/...", "symbol": "..." },',
		'  "activeOrderedPipeline": [{ "file": "src/...", "symbol": "..." }],',
		'  "activeAdapters": [{ "channel": "...", "file": "src/...", "symbol": "..." }],',
		'  "effectiveMaxAttempts": 0,',
		'  "deadCodeExports": [{ "file": "src/...", "symbol": "..." }]',
		"}",
	].join("\n"),
	async evaluate(sandboxDir: string, ctx?: EvalContext) {
		const checks: EvalCheckResult[] = [];
		const hygiene = evaluateReadOnlyHygiene(sandboxDir, ctx);
		checks.push(hygiene.check);

		const parsed = extractLastJsonValue<ExploreCallflowOutput>(ctx?.summary ?? "", ["entryPoint", "activeOrderedPipeline"]);
		const pipeline = Array.isArray(parsed?.activeOrderedPipeline) ? parsed.activeOrderedPipeline : [];
		const adapters = Array.isArray(parsed?.activeAdapters) ? parsed.activeAdapters : [];
		const deadCode = Array.isArray(parsed?.deadCodeExports) ? parsed.deadCodeExports : [];

		// PASS_TO_PASS: legacy dead module must not appear inside active pipeline/adapters, and zero fake file paths
		const allCitedFiles = [
			parsed?.entryPoint?.file ?? "",
			...pipeline.map((p) => p?.file ?? ""),
			...adapters.map((a) => a?.file ?? ""),
			...deadCode.map((d) => d?.file ?? ""),
		]
			.map(normalizeRepoPath)
			.filter(Boolean);
		const badFiles = allCitedFiles.filter((f) => !repoFileExists(sandboxDir, f));
		const legacyMarkedActive = [...pipeline, ...adapters].some(
			(item) => normalizeRepoPath(String(item?.file ?? "")) === "src/legacy/deprecated-dispatcher.mjs",
		);
		checks.push({
			name: "pass_to_pass:no_dead_code_misclassified_and_valid_paths",
			kind: "pass_to_pass",
			passed: !legacyMarkedActive && badFiles.length === 0,
			detail: legacyMarkedActive
				? "Dead file src/legacy/deprecated-dispatcher.mjs misclassified as active runtime caller"
				: badFiles.length > 0
					? `Cited non-existent files: ${badFiles.join(", ")}`
					: undefined,
		});

		const pipelineFiles = pipeline.map((p) => normalizeRepoPath(String(p?.file ?? "")));
		const idxIngress = pipelineFiles.indexOf("src/pipeline/ingress.mjs");
		const idxPolicy = pipelineFiles.indexOf("src/pipeline/policy.mjs");
		const idxRegistry = pipelineFiles.indexOf("src/adapters/registry.mjs");
		const entryOk =
			normalizeRepoPath(String(parsed?.entryPoint?.file ?? "")) === "src/index.mjs" &&
			String(parsed?.entryPoint?.symbol ?? "").includes("createNotificationRouter");
		const orderedOk = idxIngress >= 0 && idxPolicy > idxIngress && idxRegistry > idxPolicy;
		checks.push({
			name: "fail_to_pass:entrypoint_and_ordered_pipeline",
			kind: "fail_to_pass",
			passed: entryOk && orderedOk,
			detail: entryOk && orderedOk ? undefined : "Missing entrypoint createNotificationRouter or incorrect active pipeline stage ordering.",
		});

		const hasSmtp = adapters.some(
			(a) =>
				normalizeRepoPath(String(a?.file ?? "")) === "src/adapters/smtp.mjs" &&
				includesAnyPattern(`${a?.channel ?? ""} ${a?.symbol ?? ""}`, [/email|smtpAdapter/i]),
		);
		const hasWebhook = adapters.some(
			(a) =>
				normalizeRepoPath(String(a?.file ?? "")) === "src/adapters/webhook.mjs" &&
				includesAnyPattern(`${a?.channel ?? ""} ${a?.symbol ?? ""}`, [/webhook|httpWebhookAdapter/i]),
		);
		const retriesOk = parsed?.effectiveMaxAttempts === 3;
		checks.push({
			name: "fail_to_pass:active_adapters_and_effective_max_attempts",
			kind: "fail_to_pass",
			passed: hasSmtp && hasWebhook && retriesOk,
			detail:
				hasSmtp && hasWebhook && retriesOk
					? undefined
					: `Expected smtp + webhook adapters and effectiveMaxAttempts=3 (got max=${String(parsed?.effectiveMaxAttempts)})`,
		});

		const deadOk = deadCode.some(
			(d) =>
				normalizeRepoPath(String(d?.file ?? "")) === "src/legacy/deprecated-dispatcher.mjs" &&
				includesAnyPattern(String(d?.symbol ?? ""), [/legacyDispatchSync|smsLegacyAdapter|DEFAULT_MAX_RETRIES/i]),
		);
		checks.push({
			name: "fail_to_pass:dead_code_identified",
			kind: "fail_to_pass",
			passed: deadOk,
			detail: deadOk ? undefined : "Failed to identify unreferenced exports in src/legacy/deprecated-dispatcher.mjs",
		});

		return summarizeTaskChecks(checks, hygiene.forbiddenTouches);
	},
};
