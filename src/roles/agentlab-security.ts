/**
 * `agentlab-security` role — T2.3.
 *
 * Monitors security-sensitive file changes and dependency bumps.
 * Produces security findings with severity and recommended fixes.
 *
 * REQ-LRV2-13: Priority 95, Cooldown 5 minutes, subscribes to
 * file_changed (auth/login/secrets), dependency_bumped.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleInput, RoleContext, RoleAdvisory } from "./index.js";

const AGENTLAB_SECURITY_PRIORITY = 95;
const AGENTLAB_SECURITY_COOLDOWN_MS = 300_000; // 5 minutes
const AGENTLAB_SECURITY_SUBSCRIBES: readonly EventKind[] = [
	"file_changed",
	"dependency_bumped",
];

// Security-sensitive file patterns
const SECURITY_SENSITIVE_PATH_RE =
	/(auth|login|secret|session|token|credential|\.env|id_rsa|\.pem)/i;

const MAX_FINDINGS = 8;

type SecurityFinding = {
	severity: "low" | "medium" | "high" | "critical";
	title: string;
	description: string;
	recommendedFix: string;
	file?: string;
	line?: number;
};

type SecurityMeta = {
	findings: SecurityFinding[];
	summary: string;
};

type LLMResponse = {
	findings?: Array<{
		severity?: string;
		title?: string;
		description?: string;
		recommendedFix?: string;
		recommended_fix?: string;
		file?: string;
		line?: number;
	}>;
	summary?: string;
};

function parseLLMResponse(raw: string): {
	parsed: LLMResponse | null;
	error?: string;
} {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return { parsed: parsed as LLMResponse };
		}
		return { parsed: null, error: "Response is not an object" };
	} catch (e) {
		return { parsed: null, error: `JSON parse error: ${e}` };
	}
}

function normalizeSeverity(
	severity: string | undefined,
): "low" | "medium" | "high" | "critical" {
	if (!severity) return "low";
	const lower = severity.toLowerCase();
	if (lower === "critical") return "critical";
	if (lower === "high") return "high";
	if (lower === "medium" || lower === "med") return "medium";
	return "low";
}

function capArray<T>(items: T[] | undefined, max: number): T[] {
	if (!Array.isArray(items)) return [];
	return items.slice(0, max);
}

function buildAgentLabSecurityPrompt(
	input: RoleInput,
	_ctx: RoleContext,
): string {
	const lines: string[] = [
		"You are the security analyst for the IDU orchestrator.",
		"Your role is to review security-sensitive changes and identify vulnerabilities.",
		"",
	];

	const event = input.event;

	if (event.kind === "file_changed") {
		const path = event.payload.path as string;
		lines.push("Security-sensitive file changed:");
		lines.push(`  Path: ${path}`);
		lines.push("");
		lines.push("Analyze the file change for security issues:");
		lines.push("  - Hardcoded credentials or secrets");
		lines.push("  - SQL injection vulnerabilities");
		lines.push("  - Insecure authentication/authorization");
		lines.push("  - Missing input validation");
		lines.push("  - Sensitive data exposure");
	} else if (event.kind === "dependency_bumped") {
		const packageName = event.payload.packageName as string;
		const oldVersion = event.payload.oldVersion as string;
		const newVersion = event.payload.newVersion as string;
		lines.push("Dependency updated:");
		lines.push(`  Package: ${packageName}`);
		lines.push(`  Old version: ${oldVersion}`);
		lines.push(`  New version: ${newVersion}`);
		lines.push("");
		lines.push("Analyze the dependency change for security issues:");
		lines.push("  - Known vulnerabilities in old version");
		lines.push("  - Security improvements in new version");
		lines.push("  - Breaking changes affecting security");
	}

	lines.push("");
	lines.push("Respond with a JSON object:");
	lines.push("{");
	lines.push('  "findings": [');
	lines.push("    {");
	lines.push('      "severity": "low|medium|high|critical",');
	lines.push('      "title": "<short title>",');
	lines.push('      "description": "<detailed description>",');
	lines.push('      "recommendedFix": "<actionable fix>",');
	lines.push('      "file": "<file path (optional)>",');
	lines.push('      "line": <line number (optional)>');
	lines.push("    }");
	lines.push("  ],");
	lines.push('  "summary": "<one-line summary>"');
	lines.push("}");
	lines.push("");
	lines.push("Cap findings at 8 items. Respond with a single JSON object.");

	return lines.join("\n");
}

export function createAgentLabSecurityRole(): Role {
	return {
		name: "AgentLab de seguridad",
		priority: AGENTLAB_SECURITY_PRIORITY,
		cooldownMs: AGENTLAB_SECURITY_COOLDOWN_MS,
		subscribesTo: () => AGENTLAB_SECURITY_SUBSCRIBES,
		shouldFire(
			input: RoleInput,
			lastFireAt: Date | undefined,
			now: Date,
		): boolean {
			// Check cooldown first
			if (lastFireAt) {
				const elapsed = now.getTime() - lastFireAt.getTime();
				if (elapsed < AGENTLAB_SECURITY_COOLDOWN_MS) {
					return false;
				}
			}

			// For file_changed events, check if path matches security patterns
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				return SECURITY_SENSITIVE_PATH_RE.test(path);
			}

			// For dependency_bumped events, always fire (after cooldown check)
			if (input.event.kind === "dependency_bumped") {
				return true;
			}

			return false;
		},
		async invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory> {
			const prompt = buildAgentLabSecurityPrompt(input, ctx);

			const result = await ctx.router.promptForRole(
				"agentlab-security",
				prompt,
				{
					projectId: ctx.projectId,
					stateRoot: ctx.stateRoot,
					invocationSink: (record) => {
						ctx.repository.appendInvocation(record);
					},
				},
			);

			const { parsed, error: parseError } = parseLLMResponse(result.output);

			// Build evidence refs
			const evidenceRefs: string[] = [`events.jsonl:${input.event.ts}`];
			if (input.event.kind === "file_changed") {
				const path = input.event.payload.path as string;
				evidenceRefs.push(path);
			} else if (input.event.kind === "dependency_bumped") {
				const packageName = input.event.payload.packageName as string;
				evidenceRefs.push(`package.json:${packageName}`);
			}

			if (!parsed) {
				// Malformed response — fallback to empty findings
				const meta: SecurityMeta = {
					findings: [],
					summary: parseError || "Unknown parse error",
				};

				return {
					roleId: "agentlab-security",
					priority: AGENTLAB_SECURITY_PRIORITY,
					ts: ctx.now.toISOString(),
					advisory: `Failed to parse LLM response: ${parseError || "Unknown error"}`,
					evidenceRefs,
					meta,
				};
			}

			// Parse and normalize findings
			const rawFindings = parsed.findings || [];
			const findings: SecurityFinding[] = capArray(rawFindings, MAX_FINDINGS)
				.filter(
					(f) =>
						(f &&
							typeof f === "object" &&
							typeof f.recommendedFix === "string") ||
						typeof f.recommended_fix === "string",
				)
				.map((f) => ({
					severity: normalizeSeverity(f.severity),
					title: f.title || "Security finding",
					description: f.description || "",
					recommendedFix: f.recommendedFix || f.recommended_fix || "",
					file: f.file,
					line: f.line,
				}));

			const summary = parsed.summary || "Security review completed";

			const meta: SecurityMeta = {
				findings,
				summary,
			};

			const findingCount = findings.length;
			const criticalCount = findings.filter(
				(f) => f.severity === "critical",
			).length;
			const highCount = findings.filter((f) => f.severity === "high").length;

			let advisoryText = summary;
			if (findingCount > 0) {
				const severityParts: string[] = [];
				if (criticalCount > 0) severityParts.push(`${criticalCount} critical`);
				if (highCount > 0) severityParts.push(`${highCount} high`);
				advisoryText = `${findingCount} findings (${severityParts.join(", ") || "low/medium"}): ${summary}`;
			} else {
				advisoryText = `No security findings: ${summary}`;
			}

			return {
				roleId: "agentlab-security",
				priority: AGENTLAB_SECURITY_PRIORITY,
				ts: ctx.now.toISOString(),
				advisory: advisoryText,
				evidenceRefs,
				meta,
			};
		},
	};
}
