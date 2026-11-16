import {
	evaluateReadOnlyHygiene,
	extractLastJsonValue,
	includesAnyPattern,
	normalizeRepoPath,
	repoFileExists,
	summarizeTaskChecks,
} from "./eval-helpers.js";
import type { BenchmarkTaskDef, EvalCheckResult, EvalContext } from "../types.js";

const JOB_DISPATCHER_MJS = `function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JobDispatcher {
  constructor(store, retryPolicy, ledger) {
    this.store = store;
    this.retryPolicy = retryPolicy;
    this.ledger = ledger;
  }

  /**
   * Buggy pattern A: lists pending jobs without an atomic claim/lease, then iterates.
   * Buggy pattern B: awaits retry backoff synchronously inside the single poll loop.
   */
  async pollAndRun(batchLimit = 25) {
    const pendingJobs = await this.store.listPending(batchLimit);
    for (const job of pendingJobs) {
      await this.store.markRunning(job.id);
      await this.dispatchSingleJob(job);
    }
  }

  async dispatchSingleJob(job) {
    try {
      await job.execute();
      await this.ledger.recordCompletion(job.idempotencyKey, job.payload);
      await this.store.markDone(job.id);
    } catch (err) {
      const decision = this.retryPolicy.nextDecision(job.attempts, err);
      if (decision.shouldRetry) {
        // Head-of-line blocking: halts entire poll loop while waiting out exponential backoff.
        await sleep(decision.delayMs);
        await this.store.requeuePending(job.id, job.attempts + 1);
      } else {
        await this.store.markDeadLetter(job.id, err?.message ?? String(err));
      }
    }
  }
}
`;

const LEDGER_STORE_MJS = `/**
 * Records completed outbox dispatches.
 */
export class LedgerStore {
  constructor() {
    this.entries = [];
    this.seenKeys = new Set();
  }

  /**
   * Buggy pattern C: appends duplicate completion entries because seenKeys is only
   * tracked for debug logging rather than enforcing idempotency, and never bounded/persisted.
   */
  async recordCompletion(idempotencyKey, payload) {
    const duplicate = this.seenKeys.has(idempotencyKey);
    this.seenKeys.add(idempotencyKey);
    this.entries.push({
      idempotencyKey,
      duplicateObserved: duplicate,
      payload,
      recordedAt: Date.now(),
    });
    return this.entries.length;
  }
}
`;

const RETRY_POLICY_MJS = `export class RetryPolicy {
  constructor(maxAttempts = 4, baseDelayMs = 200) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
  }

  nextDecision(attempts, _err) {
    if (attempts >= this.maxAttempts) {
      return { shouldRetry: false, delayMs: 0 };
    }
    const delayMs = this.baseDelayMs * Math.pow(2, attempts);
    return { shouldRetry: true, delayMs };
  }
}
`;

const METRICS_REPORTER_MJS = `/**
 * Non-culprit decoy: periodic lightweight telemetry emitter with safe error containment.
 */
export function startMetricsReporter(metricsSource, intervalMs = 5000) {
  const timer = setInterval(() => {
    try {
      metricsSource.flushMetrics();
    } catch {
      // Telemetry failures do not interrupt dispatcher loops.
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
`;

const INCIDENT_TRACE_LOG = `2026-11-10T14:01:02.114Z INFO worker-1 listPending returned 25 jobs (oldest job_881)
2026-11-10T14:01:02.116Z INFO worker-2 listPending returned 25 jobs (oldest job_881)
2026-11-10T14:01:02.418Z WARN ledger duplicateObserved=true for key=order-90421 (charged twice)
2026-11-10T14:01:02.920Z WARN dispatcher job_882 failed attempt=3; sleeping 1600ms inline before continuing batch
2026-11-10T14:01:04.525Z ERROR queue backlog rose from 40 to 1,920 during 1.6s poll pause; RSS climbed 180MB over 6h from seenKeys Set
`;

interface ConsultRootCause {
	causeId?: string;
	file?: string;
	symbol?: string;
	explanation?: string;
}

interface ConsultResponse {
	rootCauses?: ConsultRootCause[];
	recommendedDesign?: {
		claimMechanism?: string;
		retryScheduling?: string;
		idempotencyStrategy?: string;
		primaryTradeoff?: string;
	};
	nonCulpritFiles?: string[];
}

const ORACLE_SUMMARY = [
	"Read-only architectural consultation completed.",
	"```json",
	JSON.stringify(
		{
			rootCauses: [
				{
					causeId: "NON_ATOMIC_CLAIM",
					file: "src/job-dispatcher.mjs",
					symbol: "JobDispatcher.pollAndRun",
					explanation: "`listPending` followed separately by `markRunning` allows multiple workers (`worker-1`, `worker-2`) to select and execute the same jobs simultaneously.",
				},
				{
					causeId: "HOL_BACKOFF_BLOCKING",
					file: "src/job-dispatcher.mjs",
					symbol: "JobDispatcher.dispatchSingleJob",
					explanation: "`await sleep(decision.delayMs)` inside the batch loop blocks all subsequent jobs in the batch while waiting for exponential backoff.",
				},
				{
					causeId: "NON_IDEMPOTENT_LEDGER",
					file: "src/ledger-store.mjs",
					symbol: "LedgerStore.recordCompletion",
					explanation: "Checks `seenKeys.has(idempotencyKey)` only to log `duplicateObserved`, still appends duplicates to `entries`, and grows `seenKeys` unboundedly in RAM.",
				},
			],
			recommendedDesign: {
				claimMechanism: "Replace two-step select+mark with an atomic compare-and-swap or row-level lease claim (`UPDATE ... WHERE status='pending' AND next_run_at <= now() RETURNING` / lock token + lease expiry).",
				retryScheduling: "Remove inline `await sleep(...)` and reschedule via persisted `next_run_at = now() + backoff + jitter` column so the poll loop immediately moves to healthy jobs.",
				idempotencyStrategy: "Enforce unique constraint / persistent deduplication by `idempotencyKey` (short-circuit return before side effects/append) and TTL/bucket eviction instead of unbounded in-memory Set.",
				primaryTradeoff: "Lease-based claiming + delayed `next_run_at` adds DB write contention and small lease-expiry recovery latency during crashes, trading strict sub-second retry precision for high throughput and at-least-once safety with idempotent sinks.",
			},
			nonCulpritFiles: ["src/metrics-reporter.mjs"],
		},
		null,
		2,
	),
	"```",
].join("\n");

export const consultArchTradeoffTask: BenchmarkTaskDef = {
	id: "consult-01-arch-tradeoff",
	category: "consult-bench",
	title: "Production Incident Root-Cause & Architecture Tradeoff Consultation",
	description: "Measures consultative reasoning: multi-module diagnosis, real symbol grounding, non-edit restraint, and explicit architectural tradeoffs.",
	timeoutMs: 600_000,
	permissionMode: "read-only",
	fixtureFiles: {
		"package.json": JSON.stringify({ name: "outbox-dispatcher", type: "module", private: true }, null, 2) + "\n",
		"src/job-dispatcher.mjs": JOB_DISPATCHER_MJS,
		"src/ledger-store.mjs": LEDGER_STORE_MJS,
		"src/retry-policy.mjs": RETRY_POLICY_MJS,
		"src/metrics-reporter.mjs": METRICS_REPORTER_MJS,
		"docs/incident-trace.log": INCIDENT_TRACE_LOG,
	},
	oraclePatchFiles: {},
	oracleSummary: ORACLE_SUMMARY,
	prompt: [
		"Act as a Senior Principal Architect consulted by an orchestrator about a production incident.",
		"CRITICAL CONSTRAINT: STRICTLY READ-ONLY. Do NOT modify, create, or delete any files.",
		"Inspect `docs/incident-trace.log` and all source modules in `src/`.",
		"Identify every true root cause, exclude harmless subsystems, and propose an executable architectural fix with explicit tradeoffs.",
		"",
		"Return ONE ```json block using this exact schema:",
		"{",
		'  "rootCauses": [',
		'    { "causeId": "NON_ATOMIC_CLAIM | HOL_BACKOFF_BLOCKING | NON_IDEMPOTENT_LEDGER", "file": "src/...", "symbol": "...", "explanation": "..." }',
		"  ],",
		'  "recommendedDesign": {',
		'    "claimMechanism": "...",',
		'    "retryScheduling": "...",',
		'    "idempotencyStrategy": "...",',
		'    "primaryTradeoff": "..."',
		"  },",
		'  "nonCulpritFiles": ["src/metrics-reporter.mjs"]',
		"}",
	].join("\n"),
	async evaluate(sandboxDir: string, ctx?: EvalContext) {
		const checks: EvalCheckResult[] = [];
		const hygiene = evaluateReadOnlyHygiene(sandboxDir, ctx);
		checks.push(hygiene.check);

		const parsed = extractLastJsonValue<ConsultResponse>(ctx?.summary ?? "", ["rootCauses", "recommendedDesign"]);
		const causes = Array.isArray(parsed?.rootCauses) ? parsed.rootCauses : [];

		// PASS_TO_PASS: no blaming metrics-reporter decoy, no hallucinated files
		const decoyBlamed = causes.some((c) => normalizeRepoPath(String(c?.file ?? "")) === "src/metrics-reporter.mjs");
		const invalidFiles = [
			...causes.map((c) => String(c?.file ?? "")),
			...(Array.isArray(parsed?.nonCulpritFiles) ? parsed.nonCulpritFiles.map(String) : []),
		]
			.map(normalizeRepoPath)
			.filter((f) => f.length > 0 && !repoFileExists(sandboxDir, f));

		checks.push({
			name: "pass_to_pass:no_decoy_blame_or_hallucinations",
			kind: "pass_to_pass",
			passed: !decoyBlamed && invalidFiles.length === 0,
			detail: decoyBlamed
				? "Incorrectly blamed harmless decoy src/metrics-reporter.mjs"
				: invalidFiles.length > 0
					? `Hallucinated non-existent files: ${invalidFiles.join(", ")}`
					: undefined,
		});

		const hasClaimCause = causes.some(
			(c) =>
				normalizeRepoPath(String(c?.file ?? "")) === "src/job-dispatcher.mjs" &&
				includesAnyPattern(`${c?.symbol ?? ""} ${c?.causeId ?? ""} ${c?.explanation ?? ""}`, [/pollAndRun|listPending|markRunning|NON_ATOMIC_CLAIM/i]) &&
				includesAnyPattern(`${c?.causeId ?? ""} ${c?.explanation ?? ""}`, [/atomic|lease|race|duplicate|both|worker|claim/i]),
		);
		checks.push({
			name: "fail_to_pass:cause_non_atomic_claim",
			kind: "fail_to_pass",
			passed: hasClaimCause,
			detail: hasClaimCause ? undefined : "Did not diagnose non-atomic listPending+markRunning claim in src/job-dispatcher.mjs",
		});

		const hasHolCause = causes.some(
			(c) =>
				normalizeRepoPath(String(c?.file ?? "")) === "src/job-dispatcher.mjs" &&
				includesAnyPattern(`${c?.symbol ?? ""} ${c?.causeId ?? ""} ${c?.explanation ?? ""}`, [/dispatchSingleJob|pollAndRun|sleep|HOL_BACKOFF_BLOCKING/i]) &&
				includesAnyPattern(`${c?.causeId ?? ""} ${c?.explanation ?? ""}`, [/sleep|block|head.?of.?line|backoff|delay|stall/i]),
		);
		checks.push({
			name: "fail_to_pass:cause_hol_backoff_blocking",
			kind: "fail_to_pass",
			passed: hasHolCause,
			detail: hasHolCause ? undefined : "Did not diagnose head-of-line sleep/backoff blocking in src/job-dispatcher.mjs",
		});

		const hasLedgerCause = causes.some(
			(c) =>
				normalizeRepoPath(String(c?.file ?? "")) === "src/ledger-store.mjs" &&
				includesAnyPattern(`${c?.symbol ?? ""} ${c?.causeId ?? ""} ${c?.explanation ?? ""}`, [/recordCompletion|LedgerStore|seenKeys|NON_IDEMPOTENT/i]) &&
				includesAnyPattern(`${c?.causeId ?? ""} ${c?.explanation ?? ""}`, [/duplicate|idempoten|unbounded|memory|Set|append/i]),
		);
		checks.push({
			name: "fail_to_pass:cause_non_idempotent_ledger",
			kind: "fail_to_pass",
			passed: hasLedgerCause,
			detail: hasLedgerCause ? undefined : "Did not diagnose duplicate/unbounded ledger completion in src/ledger-store.mjs",
		});

		const d = parsed?.recommendedDesign ?? {};
		const designOk =
			Boolean(d.claimMechanism && /atomic|cas|compare|lease|lock|skip locked|returning/i.test(d.claimMechanism)) &&
			Boolean(
				d.retryScheduling &&
					/next.?run|available.?at|schedul|timestamp|delay|queue|defer(?:red)?|non.?block|does not block|without blocking/i.test(
						d.retryScheduling,
					),
			) &&
			Boolean(d.idempotencyStrategy && /unique|dedup|short.?circuit|persist|ttl|evict|bound/i.test(d.idempotencyStrategy)) &&
			Boolean(d.primaryTradeoff && /trade|latency|contention|throughput|memory|complex|cost/i.test(d.primaryTradeoff));
		checks.push({
			name: "fail_to_pass:actionable_architecture_tradeoffs",
			kind: "fail_to_pass",
			passed: designOk,
			detail: designOk ? undefined : "recommendedDesign lacked concrete atomic claim, non-blocking retry scheduling, bounded idempotency, or explicit tradeoff.",
		});

		return summarizeTaskChecks(checks, hygiene.forbiddenTouches);
	},
};
