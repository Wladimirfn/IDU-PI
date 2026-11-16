import {
	evaluateReadOnlyHygiene,
	extractLastJsonValue,
	includesAnyPattern,
	normalizeRepoPath,
	repoFileExists,
	summarizeTaskChecks,
} from "./eval-helpers.js";
import type { BenchmarkTaskDef, EvalCheckResult, EvalContext } from "../types.js";

const WEBHOOK_VERIFY_MJS = `import { createHmac } from "node:crypto";

/**
 * Verifies the incoming X-Webhook-Signature SHA-256 hex digest against the shared secret.
 */
export function verifyWebhookSignature(rawBody, providedHex, secret) {
  if (typeof providedHex !== "string" || typeof secret !== "string") {
    return false;
  }
  const normalized = providedHex.trim().toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return expected === normalized;
}
`;

const EXPORT_WORKER_MJS = `import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * Resolves a tenant-requested archive path under the root exports folder.
 */
export function resolveExportTarget(exportRoot, tenantId, requestedPath) {
  const rootResolved = path.resolve(exportRoot);
  const candidate = path.resolve(rootResolved, tenantId, requestedPath);
  if (!candidate.startsWith(rootResolved)) {
    throw new Error("Access outside export root is forbidden");
  }
  return candidate;
}

export async function readExportArtifact(exportRoot, tenantId, requestedPath) {
  const target = resolveExportTarget(exportRoot, tenantId, requestedPath);
  return readFile(target, "utf8");
}
`;

const RATE_LIMITER_MJS = `/**
 * Deducts API credits from the tenant balance if sufficient credits remain.
 */
export async function consumeApiCredits(store, tenantId, costUnits, auditLogger = null) {
  if (!Number.isFinite(costUnits) || costUnits <= 0) {
    throw new Error("Invalid costUnits");
  }
  const currentBalance = await store.getBalance(tenantId);
  if (currentBalance < costUnits) {
    return { allowed: false, remaining: currentBalance };
  }
  if (auditLogger) {
    await auditLogger.recordPendingCharge(tenantId, costUnits);
  }
  const updatedBalance = currentBalance - costUnits;
  await store.setBalance(tenantId, updatedBalance);
  return { allowed: true, remaining: updatedBalance };
}
`;

const CONFIG_LOADER_MJS = `function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-merges tenant JSON overrides onto a baseline configuration object.
 */
export function mergeTenantConfig(baseConfig, rawJsonOverride) {
  const parsed = typeof rawJsonOverride === "string" ? JSON.parse(rawJsonOverride) : rawJsonOverride;
  if (!isPlainRecord(parsed)) {
    return baseConfig;
  }
  const mergeInto = (target, patch) => {
    for (const key of Object.keys(patch)) {
      const nextVal = patch[key];
      if (isPlainRecord(nextVal) && isPlainRecord(target[key])) {
        mergeInto(target[key], nextVal);
      } else {
        target[key] = nextVal;
      }
    }
    return target;
  };
  return mergeInto(structuredClone(baseConfig), parsed);
}
`;

const AUTH_SESSION_MJS = `function decodeUnverifiedClaims(jwtToken) {
  const parts = String(jwtToken || "").split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Authorizes admin API callers using the session HMAC verifier.
 */
export function authorizeAdminSession(jwtToken, verifier, logger = console) {
  const unverifiedClaims = decodeUnverifiedClaims(jwtToken);
  try {
    const verified = verifier.verify(jwtToken);
    return Boolean(verified && verified.role === "admin");
  } catch (err) {
    logger.warn?.("Token verification error; checking parsed claims fallback", err?.message ?? err);
    return Boolean(unverifiedClaims && unverifiedClaims.role === "admin");
  }
}
`;

const SAFE_QUERY_MJS = `const SORT_COLUMNS = new Map([
  ["created_at", "created_at DESC"],
  ["tenant_id", "tenant_id ASC"],
  ["status", "status ASC"],
]);

/**
 * Decoy (SAFE): Builds a parameterized PostgreSQL query using an explicit sort whitelist.
 */
export function buildAuditLookupQuery(tenantId, sortKey = "created_at", limit = 50) {
  const orderBy = SORT_COLUMNS.get(sortKey) ?? "created_at DESC";
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  return {
    sql: \`SELECT id, action, status, created_at FROM audit_events WHERE tenant_id = $1 ORDER BY \${orderBy} LIMIT $2\`,
    params: [String(tenantId), safeLimit],
  };
}
`;

const SAFE_CACHE_MJS = `/**
 * Decoy (SAFE): Bounded LRU-style Map cache keyed safely without Object prototype lookup.
 */
export class BoundedTokenCache {
  constructor(maxEntries = 512, defaultTtlMs = 60_000) {
    this.maxEntries = Math.max(1, maxEntries);
    this.defaultTtlMs = Math.max(100, defaultTtlMs);
    this.entries = new Map();
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const safeKey = String(key);
    if (this.entries.has(safeKey)) {
      this.entries.delete(safeKey);
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(safeKey, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
  }

  get(key) {
    const entry = this.entries.get(String(key));
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(String(key));
      return undefined;
    }
    return entry.value;
  }
}
`;

const DECOY_FILES = new Set(["src/safe-query.mjs", "src/safe-cache.mjs"]);

interface AuditFindingInput {
	bugClass?: string;
	file?: string;
	symbol?: string;
	line?: number;
	severity?: string;
	explanation?: string;
	remediation?: string;
}

interface AuditReportOutput {
	findings?: AuditFindingInput[];
	safeReviewedFiles?: string[];
}

interface VulnerabilitySpec {
	checkName: string;
	file: string;
	symbols: string[];
	lineRange: [number, number];
	classPatterns: RegExp[];
	signalPatterns: RegExp[];
}

const EXPECTED_VULNS: VulnerabilitySpec[] = [
	{
		checkName: "fail_to_pass:vuln_timing_hmac",
		file: "src/webhook-verify.mjs",
		symbols: ["verifyWebhookSignature"],
		lineRange: [6, 13],
		classPatterns: [/timing/i, /side.?channel/i, /constant/i, /hmac/i],
		signalPatterns: [/timingSafeEqual/i, /===|non.?constant|timing/i],
	},
	{
		checkName: "fail_to_pass:vuln_path_traversal_prefix",
		file: "src/export-worker.mjs",
		symbols: ["resolveExportTarget", "readExportArtifact"],
		lineRange: [6, 18],
		classPatterns: [/path/i, /travers/i, /prefix/i, /tenant/i],
		signalPatterns: [/startsWith/i, /path\.sep|separator|sibling|prefix|relative|tenant/i],
	},
	{
		checkName: "fail_to_pass:vuln_toctou_race",
		file: "src/rate-limiter.mjs",
		symbols: ["consumeApiCredits"],
		lineRange: [4, 17],
		classPatterns: [/toctou|race|concurren|atomic|double/i],
		signalPatterns: [/race|toctou|atomic|lock|cas|concurrent|getBalance|setBalance/i],
	},
	{
		checkName: "fail_to_pass:vuln_prototype_pollution",
		file: "src/config-loader.mjs",
		symbols: ["mergeTenantConfig", "mergeInto"],
		lineRange: [8, 24],
		classPatterns: [/proto/i, /pollut/i, /merge/i],
		signalPatterns: [/__proto__|constructor|prototype/i],
	},
	{
		checkName: "fail_to_pass:vuln_fail_open_auth",
		file: "src/auth-session.mjs",
		symbols: ["authorizeAdminSession", "decodeUnverifiedClaims"],
		lineRange: [12, 23],
		classPatterns: [/fail.?open|auth|bypass|signature|catch|fallback/i],
		signalPatterns: [/catch|unverified|fallback|bypass|fail.?open|throws?/i],
	},
];

function findingMatchesSpec(finding: AuditFindingInput, spec: VulnerabilitySpec): boolean {
	if (!finding.file || normalizeRepoPath(finding.file) !== spec.file) {
		return false;
	}
	const symbolText = String(finding.symbol ?? "");
	const symbolMatched = spec.symbols.some((sym) => symbolText.includes(sym));
	const lineMatched =
		typeof finding.line === "number" &&
		finding.line >= spec.lineRange[0] - 2 &&
		finding.line <= spec.lineRange[1] + 2;
	if (!symbolMatched && !lineMatched) {
		return false;
	}
	const combined = `${finding.bugClass ?? ""} ${finding.explanation ?? ""} ${finding.remediation ?? ""}`;
	const classMatched = includesAnyPattern(combined, spec.classPatterns);
	const signalMatched = includesAnyPattern(combined, spec.signalPatterns);
	return classMatched && signalMatched;
}

const ORACLE_SUMMARY = [
	"Read-only security and concurrency audit completed across all files in `src/`.",
	"```json",
	JSON.stringify(
		{
			findings: [
				{
					bugClass: "TIMING_ATTACK",
					file: "src/webhook-verify.mjs",
					symbol: "verifyWebhookSignature",
					line: 12,
					severity: "medium",
					explanation: "Uses non-constant-time `expected === normalized` hex comparison on HMAC-SHA256 digests, exposing a timing side-channel.",
					remediation: "Decode buffers and use `crypto.timingSafeEqual` after verifying equal byte lengths.",
				},
				{
					bugClass: "PATH_TRAVERSAL",
					file: "src/export-worker.mjs",
					symbol: "resolveExportTarget",
					line: 10,
					severity: "critical",
					explanation: "`candidate.startsWith(rootResolved)` lacks a trailing path separator check and fails to enforce containment within the specific `tenantId` directory, enabling sibling-prefix and cross-tenant traversal (`..`).",
					remediation: "Resolve `tenantRoot = path.resolve(rootResolved, tenantId)` safely and check `path.relative(tenantRoot, candidate)` stays inside `tenantRoot` without `..` or absolute targets.",
				},
				{
					bugClass: "TOCTOU_RACE",
					file: "src/rate-limiter.mjs",
					symbol: "consumeApiCredits",
					line: 8,
					severity: "high",
					explanation: "Classic async read-modify-write TOCTOU race between `getBalance`, `recordAuditProbe`, and `setBalance` allows concurrent callers to double-spend credits.",
					remediation: "Use an atomic store decrement/CAS operation or per-tenant mutex/transaction.",
				},
				{
					bugClass: "PROTOTYPE_POLLUTION",
					file: "src/config-loader.mjs",
					symbol: "mergeTenantConfig",
					line: 14,
					severity: "high",
					explanation: "`mergeInto` copies keys from JSON input without blocking `__proto__`, `constructor`, or `prototype`, allowing prototype pollution.",
					remediation: "Skip or reject `__proto__`, `constructor`, and `prototype` keys before assignment and prefer `Object.hasOwn`.",
				},
				{
					bugClass: "FAIL_OPEN_AUTH",
					file: "src/auth-session.mjs",
					symbol: "authorizeAdminSession",
					line: 20,
					severity: "critical",
					explanation: "In the `catch` block when `verifier.verify(jwtToken)` throws, authorization falls back to `unverifiedClaims.role === 'admin'`, letting forged tokens bypass signature validation.",
					remediation: "Always return `false` inside `catch` on signature verification failures; never trust `decodeUnverifiedClaims`.",
				},
			],
			safeReviewedFiles: ["src/safe-query.mjs", "src/safe-cache.mjs"],
		},
		null,
		2,
	),
	"```",
].join("\n");

export const auditSecurityRaceTask: BenchmarkTaskDef = {
	id: "audit-01-security-race",
	category: "audit-bench",
	title: "Security & Concurrency Read-Only Audit (5 Real Flaws + 2 Safe Decoys)",
	description: "Evaluates deep code auditing recall, decoy precision, symbol grounding, and strict read-only restraint.",
	timeoutMs: 600_000,
	permissionMode: "read-only",
	fixtureFiles: {
		"package.json": JSON.stringify({ name: "tenant-service", type: "module", private: true }, null, 2) + "\n",
		"src/webhook-verify.mjs": WEBHOOK_VERIFY_MJS,
		"src/export-worker.mjs": EXPORT_WORKER_MJS,
		"src/rate-limiter.mjs": RATE_LIMITER_MJS,
		"src/config-loader.mjs": CONFIG_LOADER_MJS,
		"src/auth-session.mjs": AUTH_SESSION_MJS,
		"src/safe-query.mjs": SAFE_QUERY_MJS,
		"src/safe-cache.mjs": SAFE_CACHE_MJS,
	},
	oraclePatchFiles: {},
	oracleSummary: ORACLE_SUMMARY,
	prompt: [
		"Perform a STRICTLY READ-ONLY security and concurrency audit of every `.mjs` file under `src/`.",
		"CRITICAL CONSTRAINT: Do NOT edit, create, or delete any files in the repository.",
		"Note: Some files under `src/` are already hardened and should NOT be reported as vulnerable.",
		"",
		"Return ONE ```json block with this exact schema in your final answer:",
		"{",
		'  "findings": [',
		"    {",
		'      "bugClass": "TIMING_ATTACK | PATH_TRAVERSAL | TOCTOU_RACE | PROTOTYPE_POLLUTION | FAIL_OPEN_AUTH",',
		'      "file": "src/...",',
		'      "symbol": "functionOrClassName",',
		'      "line": 12,',
		'      "severity": "critical | high | medium",',
		'      "explanation": "Precise technical root cause",',
		'      "remediation": "Concrete fix without editing files"',
		"    }",
		"  ],",
		'  "safeReviewedFiles": ["src/..."]',
		"}",
	].join("\n"),
	async evaluate(sandboxDir: string, ctx?: EvalContext) {
		const checks: EvalCheckResult[] = [];
		const hygiene = evaluateReadOnlyHygiene(sandboxDir, ctx);
		checks.push(hygiene.check);

		const responseText = ctx?.summary ?? "";
		const parsed = extractLastJsonValue<AuditReportOutput>(responseText, ["findings"]);
		const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];

		// Precision / Grounding PASS_TO_PASS checks: baseline (empty) passes cleanly because zero false positives/hallucinations exist.
		const decoyHits = findings
			.map((f) => normalizeRepoPath(String(f?.file ?? "")))
			.filter((f) => DECOY_FILES.has(f));
		checks.push({
			name: "pass_to_pass:no_decoy_false_positives",
			kind: "pass_to_pass",
			passed: decoyHits.length === 0,
			detail: decoyHits.length === 0 ? undefined : `Misflagged safe decoy file(s): ${decoyHits.join(", ")}`,
		});

		const missingFiles = [
			...findings.map((f) => String(f?.file ?? "")),
			...(Array.isArray(parsed?.safeReviewedFiles) ? parsed.safeReviewedFiles.map(String) : []),
		]
			.map((p) => normalizeRepoPath(p))
			.filter((p) => p.length > 0 && !repoFileExists(sandboxDir, p));
		checks.push({
			name: "pass_to_pass:all_cited_files_exist",
			kind: "pass_to_pass",
			passed: missingFiles.length === 0,
			detail: missingFiles.length === 0 ? undefined : `Cited non-existent file(s): ${missingFiles.join(", ")}`,
		});

		for (const spec of EXPECTED_VULNS) {
			const matched = findings.some((f) => f && findingMatchesSpec(f, spec));
			checks.push({
				name: spec.checkName,
				kind: "fail_to_pass",
				passed: matched,
				detail: matched ? undefined : `Missing or inaccurately grounded finding for ${spec.file} (${spec.symbols.join("/")})`,
			});
		}

		return summarizeTaskChecks(checks, hygiene.forbiddenTouches);
	},
};
