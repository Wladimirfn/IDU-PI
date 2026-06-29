import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDbFile } from "./evidence-gateways.js";
import { readIdPathWithMigration } from "./hygiene-migrate.js";
import { resolvePackageRoot } from "./package-root.js";
import {
	loadProjectCore,
	type ProjectCore,
	type ProjectCoreStatus,
} from "./project-core.js";
import type { ProjectPreflightRisk } from "./project-preflight.js";

export type ProjectConstitutionStatus = "draft" | "active" | "stale";
export type ConstitutionGateSeverity = "medium" | "high" | "blocker";

export type ConstitutionValidationGate = {
	id: string;
	severity: ConstitutionGateSeverity;
	description: string;
};

export type ProjectConstitution = {
	version: string;
	projectName: string;
	sourceCoreStatus: ProjectCoreStatus;
	principles: string[];
	forbiddenPractices: string[];
	requiredPractices: string[];
	technologyRules: {
		preferredStack: string[];
		// R3.1: widens from `string[]` to the union form. The legacy 6-string
		// array (current brain state) is still accepted — the validator
		// (`readRejectedStack`) emits strings as-is and only validates objects.
		rejectedStack: RejectedStackEntry[];
	};
	securityRules: string[];
	dataRules: string[];
	approvalRules: string[];
	validationGates: ConstitutionValidationGate[];
	specialistRoles: string[];
	createdAt: string;
	updatedAt: string;
	status: ProjectConstitutionStatus;
};

export type ConstitutionGateIssue = {
	gateId: string;
	severity: ConstitutionGateSeverity;
	message: string;
};

export type ConstitutionGateResult = {
	ok: boolean;
	risk: ProjectPreflightRisk;
	requiresHumanConfirmation: boolean;
	failures: ConstitutionGateIssue[];
	warnings: ConstitutionGateIssue[];
	affectedRules: string[];
};

// ============================================================================
// R3.1: Tier 3 pilot — rejectedStack schema (prose → predicate)
// ----------------------------------------------------------------------------
// Source: design obs-2688 (architecture/tier-3-rejectedstack-design) §2.1 and
// task obs-2689 (architecture/tier-3-rejectedstack-tasks) Phase A / Slice R3.1.
// Slicing principle: CODE slices land non-breaking. R3.1 widens the
// `technologyRules.rejectedStack` type from `string[]` to a union
// `RejectedStackEntry[]` that still accepts the legacy 6-string array
// (current brain state) AND the structured `RejectedRule[]` form.
// The gate consumption / predicate logic ships in R3.3 — NOT here.
// ============================================================================

export type BehaviorKind =
	| "long-running"
	| "periodic"
	| "network-bound"
	| "external-write";

export type RejectionDetection =
	| { filePattern: string }
	| { depPattern: string }
	| { importPattern: string }
	| { commandPattern: string }
	| { behaviorPattern: BehaviorKind };

export type RejectedRule = {
	id: string;
	summary: string;
	category: "stack" | "process" | "data" | "security";
	detection: RejectionDetection | null;
	severity: "blocker" | "high" | "medium" | "low";
	rationale: string;
	messages: { blocked: string; warning: string };
	advisoryOnly?: boolean;
};

export type RejectedStackEntry = string | RejectedRule;

export type ConstitutionGateInput = {
	request?: string;
	changedFiles?: string[];
	// R3.2: optional `deps` field — only populated by postflight (via
	// `readPackageJsonDeps` in project-postflight.ts). When absent, depPattern
	// rules in `hasRejection` are silently skipped (predicate inconclusive —
	// there is no package.json to inspect). Preflight callers do NOT pass
	// `deps`; this is non-breaking by design.
	deps?: {
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
	};
	constitution: ProjectConstitution;
};

// ============================================================================
// R3.3: Tier 3 pilot — predicate-driven `rejectedStack` gate (consumption)
// ----------------------------------------------------------------------------
// Source: design obs-2688 (architecture/tier-3-rejectedstack-design) §3 +
// task obs-2689 (architecture/tier-3-rejectedstack-tasks) Phase A / Slice R3.3.
// Slicing principle: this slice REPLACES the R3.1 shim (the inline string-or-
// summary coercion at the old line 346) with a predicate-driven gate. Two
// passes:
//   Pass 1: `hasRejection(input, rules)` evaluates the 5 detection branches
//           (filePattern / depPattern / importPattern / commandPattern /
//           behaviorPattern). Each hit emits `rejected_stack` with the rule's
//           severity. Missing inputs → predicate inconclusive (silently skipped).
//   Pass 2: prose-fallback for `advisoryOnly` rules (legacy strings + rules
//           marked `advisoryOnly: true`). Each prose hit emits
//           `rejected_stack_advisory` warning. This preserves the pre-R3.3
//           behavior for items 1/2/4 (LLM-discretion clauses) and item 6
//           (ADVISORY ONLY — never has a predicate) without ever prose-matching
//           against a non-advisory rule.
// ============================================================================

export type RejectionHit = {
	rule: RejectedRule;
	matchedFile?: string;
	matchedDep?: string;
};

export type HasRejectionOptions = {
	// DI hooks — tests inject deterministic content. Defaults use git CLI.
	readContent?: (file: string) => string | undefined;
	readDiff?: (file: string) => string | undefined;
};

export type ProjectConstitutionValidationResult =
	| { ok: true; constitution: ProjectConstitution; errors: [] }
	| { ok: false; errors: string[] };

const STATUSES = ["draft", "active", "stale"] as const;
const CORE_STATUSES = ["draft", "proposed", "confirmed", "stale"] as const;
const GATE_SEVERITIES = ["medium", "high", "blocker"] as const;

export function validateProjectConstitution(
	value: unknown,
): ProjectConstitutionValidationResult {
	const errors: string[] = [];
	const record = asRecord(value);
	if (!record) return { ok: false, errors: ["constitution must be an object"] };
	const version = readString(record, "version", errors);
	const projectName = readString(record, "projectName", errors);
	const sourceCoreStatus = readEnum(
		record,
		"sourceCoreStatus",
		CORE_STATUSES,
		errors,
	);
	const principles = readStringArray(record, "principles", errors);
	const forbiddenPractices = readStringArray(
		record,
		"forbiddenPractices",
		errors,
	);
	const requiredPractices = readStringArray(
		record,
		"requiredPractices",
		errors,
	);
	const securityRules = readStringArray(record, "securityRules", errors);
	const dataRules = readStringArray(record, "dataRules", errors);
	const approvalRules = readStringArray(record, "approvalRules", errors);
	const specialistRoles = readStringArray(record, "specialistRoles", errors);
	const createdAt = readString(record, "createdAt", errors);
	const updatedAt = readString(record, "updatedAt", errors);
	const status = readEnum(record, "status", STATUSES, errors);
	const technologyRules = readTechnologyRules(record.technologyRules, errors);
	const validationGates = readValidationGates(record.validationGates, errors);
	if (errors.length) return { ok: false, errors };
	return {
		ok: true,
		errors: [],
		constitution: {
			version: version!,
			projectName: projectName!,
			sourceCoreStatus: sourceCoreStatus!,
			principles: principles!,
			forbiddenPractices: forbiddenPractices!,
			requiredPractices: requiredPractices!,
			technologyRules: technologyRules!,
			securityRules: securityRules!,
			dataRules: dataRules!,
			approvalRules: approvalRules!,
			validationGates: validationGates!,
			specialistRoles: specialistRoles!,
			createdAt: createdAt!,
			updatedAt: updatedAt!,
			status: status!,
		},
	};
}

export function loadProjectConstitution(stateRoot: string): ProjectConstitution {
	// R1/5: align with blueprint/core/flows — use A-pref-B via
	// readIdPathWithMigration. Constitution was the outlier (Layout B direct
	// only); this aligns it with the other 3 loaders.
	// Closes the deferred hygiene-migrate bug: hygiene-migrate has
	// constitution in LEGACY_CONFIG_FILES (moves B→A), but the old B-only
	// loader could not read the migrated file. Now reads find A first.
	const migrated = readIdPathWithMigration(
		stateRoot,
		"project-constitution.json",
	);
	let path: string;
	let raw: string;
	if (migrated.content !== null) {
		raw = migrated.content;
		path = join(stateRoot, ".idu", "config", "project-constitution.json");
	} else if (existsSync(join(stateRoot, "config", "project-constitution.json"))) {
		// Edge case: file exists at Layout B but readIdPathWithMigration did not
		// migrate (e.g. partial state or permission issue). Read directly to
		// preserve the legacy fallback path.
		path = join(stateRoot, "config", "project-constitution.json");
		raw = readFileSync(path, "utf8");
	} else {
		path = defaultConstitutionPath();
		raw = readFileSync(path, "utf8");
	}
	const parsed = JSON.parse(raw) as unknown;
	const result = validateProjectConstitution(parsed);
	if (!result.ok) {
		throw new Error(
			`Invalid project constitution at ${path}: ${result.errors.join("; ")}`,
		);
	}
	return result.constitution;
}

export function deriveConstitutionFromProjectCore(
	core: ProjectCore,
): ProjectConstitution {
	const now = core.updatedAt || new Date().toISOString();
	return {
		version: "1.0.0",
		projectName: core.projectName,
		sourceCoreStatus: core.status,
		principles: [
			"La IA puede proponer, pero el humano confirma.",
			"Solo el Project Core confirmado es fuente de verdad.",
			`Project Core confirmado requerido para ${core.projectName}.`,
		],
		forbiddenPractices: [
			"Saltar tests o build requeridos",
			"Usar tecnología rechazada por Project Core",
			"Implementar alcance explícitamente excluido",
		],
		requiredPractices: [
			"Pedir confirmación humana para cambios high/blocker",
			"Mantener cambios dentro de includedScope",
			`Alcance incluido: ${core.includedScope.join(" | ")}`,
			`Alcance excluido: ${core.excludedScope.join(" | ")}`,
			"Revisar seguridad para auth, secrets y datos sensibles",
		],
		technologyRules: {
			preferredStack: core.preferredStack,
			rejectedStack: core.rejectedStack,
		},
		securityRules: [
			`Nivel de seguridad confirmado: ${core.securityLevel}`,
			"Auth/login/security requiere confirmación humana.",
		],
		dataRules: [
			`Sensibilidad de datos confirmada: ${core.dataSensitivity}`,
			"Cambios de datos high/critical requieren revisión de seguridad.",
		],
		approvalRules: [
			"Project Core debe estar confirmed.",
			"Cambios fuera de preferredStack con arquitectura requieren confirmación humana.",
		],
		validationGates: defaultValidationGates(),
		specialistRoles: ["security", "database", "architecture"],
		createdAt: now,
		updatedAt: now,
		status: core.status === "confirmed" ? "active" : "draft",
	};
}

export function formatConstitutionForPrompt(
	constitution: ProjectConstitution,
): string {
	return [
		"Project Constitution",
		`Proyecto: ${constitution.projectName}`,
		`Estado: ${constitution.status}`,
		`Source Core: ${constitution.sourceCoreStatus}`,
		`Principios: ${formatInline(constitution.principles)}`,
		`Prácticas prohibidas: ${formatInline(constitution.forbiddenPractices)}`,
		`Prácticas requeridas: ${formatInline(constitution.requiredPractices)}`,
		`Preferred stack: ${formatInline(constitution.technologyRules.preferredStack)}`,
		// R3.3 NOTE: rejectedStack accepts the union form (string | RejectedRule).
		// Audit-aware formatting:
		//   - Legacy strings pass through verbatim (byte-identical to pre-R3.3
		//     output, so existing prompt-format tests stay green).
		//   - Object entries render as "<summary> (<severity>, <detection-shape>)"
		//     so an orchestrator reading the prompt can see the predicate key
		//     driving each rule. `detection: null` (advisory-only) renders as
		//     "advisory". This replaces the R3.1 coercion shim that pre-rendered
		//     objects as "(advisory) summary" — the new format is honest about
		//     severity and detection shape.
		`Rejected stack: ${formatInline(
			constitution.technologyRules.rejectedStack.map((entry) => {
				if (!entry || typeof entry !== "object") return entry;
				const det =
					entry.detection === null
						? "advisory"
						: Object.keys(entry.detection).join("+");
				return `${entry.summary} (${entry.severity}, ${det})`;
			}),
		)}`,
		`Gates: ${formatInline(constitution.validationGates.map((gate) => gate.id))}`,
	].join("\n");
}

export function evaluateConstitutionGates(
	input: ConstitutionGateInput,
): ConstitutionGateResult {
	const text = normalize(
		`${input.request ?? ""} ${(input.changedFiles ?? []).join(" ")}`,
	);
	const failures: ConstitutionGateIssue[] = [];
	const warnings: ConstitutionGateIssue[] = [];
	if (input.constitution.sourceCoreStatus !== "confirmed") {
		failures.push(
			issue(
				"project_core_not_confirmed",
				"blocker",
				"Project Core no está confirmed.",
			),
		);
	}
	// Tema B (skip_tests_blocker gate — ADVISORY (B)):
	//   idu-pi does NOT execute build/test automatically.
	//   `src/physical-gates.ts:148-168` explicitly records `buildNotRunGate` /
	//   `testNotRunGate` with `status: "not_run"`. There is no record in
	//   stateRoot of "build ran at timestamp X with exit code 0" or
	//   "tests passed".
	//
	//   To become deterministic: idu-pi must actually run `pnpm build` /
	//   `pnpm test` and record evidence in stateRoot (positive evidence) —
	//   OR a negative-evidence check ("code changed AND no build/test
	//   evidence exists") must be added.
	//   Tracked in Tier 3 contract restructuring + infrastructure work.
	if (hasSkipValidation(text)) {
		failures.push(
			issue(
				"skip_tests_blocker",
				"blocker",
				"No se permite saltar tests/build.",
			),
		);
	}
	// Tema B / R3.3 (rejected_stack gate — predicate-driven):
	//   This block REPLACES the R3.1 shim. The pre-R3.3 implementation prose-matched
	//   `entry.summary` against the union text, which was bypassable by rewording.
	//   R3.3 closes that bypass: structured rules fire only when their detection
	//   predicate matches an artifact (changed file content, diff, or dep). Legacy
	//   prose entries (and rules marked `advisoryOnly: true`) still prose-match,
	//   but as WARNINGS (`rejected_stack_advisory`) — never as failures. See
	//   design obs-2688 §3 and §4 for the full phase-separation contract.
	//
	// R3.5 (post-R3.4 — per-item verdict breakdown, refs #195):
	//   After R3.4 data migration (commits 81a1813 + 4462171 + 980c401),
	//   `technologyRules.rejectedStack` is no longer 6 prose strings. Items 1-5
	//   are now `RejectedRule[]` (structured predicates); item 6 remains a
	//   prose string (advisory-only). The per-item verdict the original Tema B
	//   JSDoc labelled "ADVISORY (B) for all 5" no longer applies uniformly.
	//
	//   Per-item post-R3.4 classification (R3.5 closure in content; R5.3 will
	//   re-verify at runtime after R5.1 loader fix + build + restart):
	//
	//     item 1 (unbounded-daemon-*): PARTIAL — `behaviorPattern` is
	//       text-fragile; LLM-discretion clause embedded in `rationale`
	//       ("orchestrator may flag additional patterns as 'unbounded'").
	//       Stays a warning-grade gate in practice.
	//     item 2 (mcp-write-*): PARTIAL — `filePattern`/`importPattern` cover
	//       the MCP write surface; LLM-discretion clause handles whitelists
	//       (lab artifact paths, migration runners) and entrypoint changes
	//       beyond `src/mcp-server.ts` / `src/cli.ts`.
	//     item 3 (agentlabs-edit-*): DETERMINISTIC (blocker) — `filePattern:
	//       "src/agentlab-*.ts"` matches 6 real files; `importPattern` and
	//       `commandPattern` are mechanical. No LLM clause needed.
	//     item 4 (uncontrolled-search-*): PARTIAL — `commandPattern` and
	//       `importPattern` cover the common shape; LLM-discretion clause
	//       whitelists consented tests / agentlab sandboxes and flags
	//       additional fetch patterns (axios, undici).
	//     item 5 (implicit-deps-postinstall): DETERMINISTIC (blocker) —
	//       `commandPattern: "\bpostinstall\b|\bpreinstall\b"` matches
	//       artifact text deterministically. No LLM clause needed.
	//     item 6 ("Repo writes outside explicit worker/orchestrator flows"):
	//       ADVISORY-ONLY — runtime intent, not static artifact. Stays as a
	//       prose string in the array; `normalizeRejectedRules` wraps it as
	//       an `advisoryOnly` rule with `detection: null`. The prose
	//       fallback (Pass 2) is its only emission path.
	//
	//   NOTE: R3.5 is DOCS-ONLY. The seed wording above describes the rules
	//   and their classification, NOT the gate's runtime failure/warning
	//   behavior. Fail-loud semantics on a deterministic `rejected_stack`
	//   hit are deferred to R5.2 (separate gated slice). R5.1 owns the
	//   loader fix; R5.3 owns the runtime acceptance run.
	const rejectedRules = normalizeRejectedRules(
		input.constitution.technologyRules.rejectedStack,
	);
	// Pass 1 — predicate failures. Empty when `changedFiles` / `deps` are absent
	// (preflight) or when no rule's detection matches.
	for (const hit of hasRejection(input, rejectedRules)) {
		const sev = normalizeRuleSeverity(hit.rule.severity);
		failures.push(
			issue(
				"rejected_stack",
				sev,
				hit.rule.messages.blocked,
			),
		);
	}
	// Pass 2 — prose fallback for `advisoryOnly` rules (legacy strings + rules
	// explicitly marked). advisoryOnly rules have NO predicate (`detection: null`)
	// so the prose match is the only signal they ever emit.
	for (const rule of rejectedRules) {
		if (!rule.advisoryOnly) continue;
		if (includesTerm(text, rule.summary)) {
			const sev = normalizeRuleSeverity(rule.severity);
			warnings.push(
				issue(
					"rejected_stack_advisory",
					sev,
					rule.messages.warning,
				),
			);
		}
	}
	// Tema B (forbidden_practice + auth_security_review gates — ADVISORY (B)):
	//   these are content-policy checks against free-text user requests.
	//   The "security" intent and the "forbidden practice" intent are
	//   themselves expressed as text — there is no structured field that
	//   captures them.
	//
	//   These gates are LLM-discretion advisory: they hint to the
	//   orchestrator that the request looks security-sensitive or matches
	//   a forbidden pattern. The orchestrator decides whether to follow
	//   the hint.
	//
	//   To become deterministic: forbidden practices must be restructured
	//   as machine-checkable predicates (e.g. "no shell exec of external
	//   commands" = detect `child_process.exec` calls; "auth changes
	//   require review" = require `auth_review_required: true` flag in
	//   the request payload).
	//   Tracked in Tier 3 contract restructuring.
	for (const forbidden of input.constitution.forbiddenPractices) {
		if (matchesForbiddenPractice(text, forbidden)) {
			failures.push(
				issue(
					"forbidden_practice",
					"blocker",
					`Práctica prohibida: ${forbidden}`,
				),
			);
		}
	}
	for (const excluded of input.constitution.approvalRules.length
		? extractScope(input.constitution, "excluded")
		: []) {
		if (includesTerm(text, excluded)) {
			failures.push(
				issue(
					"scope_excluded",
					"blocker",
					`Solicitud toca excludedScope: ${excluded}`,
				),
			);
		}
	}
	if (hasAuthSecurity(text)) {
		failures.push(
			issue(
				"auth_security_review",
				"high",
				"Auth/login/security requiere confirmación humana.",
			),
		);
	}
	// Tema B: db_schema_plan is path-based on changedFiles (was regex on text).
	// Reword-only mentions of "database" no longer trigger — only actual DB
	// file paths (prisma|supabase|sqlite|lab-db|migration|migrations|schema).
	const dbChangedFiles = (input.changedFiles ?? []).filter(isDbFile);
	if (dbChangedFiles.length > 0) {
		failures.push(
			issue(
				"db_schema_plan",
				"high",
				`DB/schema detectado en: ${dbChangedFiles.join(", ")}. Requiere regla, plan o migración explícita.`,
			),
		);
		if (
			/high|critical/u.test(
				input.constitution.dataRules.join(" ").toLowerCase(),
			)
		) {
			failures.push(
				issue(
					"data_security_review",
					"high",
					"Datos high/critical requieren revisión de seguridad.",
				),
			);
		}
	}
	const included = extractScope(input.constitution, "included");
	if (
		hasNewModule(text) &&
		included.length > 0 &&
		!included.some((scope) => includesTerm(text, scope))
	) {
		warnings.push(
			issue(
				"scope_included",
				"medium",
				"Solicitud parece fuera de includedScope confirmado.",
			),
		);
	}
	// Tema B (non_preferred_stack gate — ADVISORY (B)):
	//   the regex checks for LIBRARY names (react, vue, supabase, postgres)
	//   but `preferredStack` in `project-constitution.json` declares
	//   ARCHITECTURAL PATTERNS (TypeScript, Node.js ESM, pnpm). These are
	//   orthogonal — a project using Supabase would trigger a false warning.
	//
	//   Additionally, `package.json` is NOT in
	//   `ConstitutionGateInput.changedFiles` — the gate input has no way to
	//   know actual dependencies.
	//
	//   To become deterministic: (1) pass `package.json` deps into the gate
	//   input, (2) restructure `preferredStack` to list approved LIBRARY
	//   names (not architectural descriptors), (3) compare actual deps
	//   against approved list.
	//   Tracked in Tier 3 contract restructuring.
	if (hasArchitectureChange(text)) {
		const preferredHit = input.constitution.technologyRules.preferredStack.some(
			(tech) => includesTerm(text, tech),
		);
		const mentionsTech =
			/react|vue|svelte|firebase|supabase|postgres|mysql|mongodb|next|nestjs|express/u.test(
				text,
			);
		if (mentionsTech && !preferredHit) {
			warnings.push(
				issue(
					"non_preferred_stack",
					"high",
					"Tecnología fuera de preferredStack requiere confirmación humana.",
				),
			);
		}
	}
	const risk = [...failures, ...warnings].reduce<ProjectPreflightRisk>(
		(current, item) =>
			maxRisk(current, item.severity === "medium" ? "medium" : item.severity),
		"low",
	);
	return {
		ok: failures.length === 0,
		risk,
		requiresHumanConfirmation: risk === "high" || risk === "blocker",
		failures,
		warnings,
		affectedRules: dedupe(
			[...failures, ...warnings].map((item) => item.gateId),
		),
	};
}

function defaultValidationGates(): ConstitutionValidationGate[] {
	return [
		{
			id: "project_core_not_confirmed",
			severity: "blocker",
			description: "Project Core debe estar confirmed.",
		},
		{
			id: "db_schema_plan",
			severity: "high",
			description: "DB/schema requiere plan o migración.",
		},
		{
			id: "auth_security_review",
			severity: "high",
			description: "Auth/login/security requiere confirmación humana.",
		},
		{
			id: "scope_included",
			severity: "medium",
			description: "Cambios deben respetar includedScope.",
		},
		{
			id: "scope_excluded",
			severity: "blocker",
			description: "No tocar excludedScope.",
		},
		{
			id: "rejected_stack",
			severity: "blocker",
			description: "No usar rejectedStack.",
		},
		{
			id: "non_preferred_stack",
			severity: "high",
			description: "Stack no preferido requiere confirmación.",
		},
		{
			id: "data_security_review",
			severity: "high",
			description: "Datos high/critical requieren revisión.",
		},
		{
			id: "skip_tests_blocker",
			severity: "blocker",
			description: "No saltar tests/build.",
		},
		{
			id: "forbidden_practice",
			severity: "blocker",
			description: "No usar prácticas prohibidas.",
		},
	];
}

// Tema B (scope_excluded / scope_included gates — ADVISORY (B)):
//   scope values in `project-constitution.json` are stored as text fragments
//   (e.g. `"src"` from "Alcance excluido: src | config"), not path globs.
//   `changedFiles` is a list of paths available in the gate input, but
//   matching it against text fragments produces false positives
//   ("src" matches "script", "source", "oscar/src", etc.).
//
//   To become deterministic: excludedScope/includedScope must be
//   restructured as path globs (e.g. `["src/**", "config/**"]`) and matched
//   against `changedFiles` paths via a real glob matcher.
//   Tracked in Tier 3 contract restructuring.
function extractScope(
	constitution: ProjectConstitution,
	kind: "included" | "excluded",
): string[] {
	const marker =
		kind === "included" ? "Alcance incluido:" : "Alcance excluido:";
	const rule = constitution.requiredPractices.find((item) =>
		item.startsWith(marker),
	);
	return rule
		? rule
				.slice(marker.length)
				.split("|")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

function readTechnologyRules(
	value: unknown,
	errors: string[],
): ProjectConstitution["technologyRules"] | undefined {
	const record = asRecord(value);
	if (!record) {
		errors.push("technologyRules must be an object");
		return undefined;
	}
	return {
		preferredStack: readStringArray(record, "preferredStack", errors) ?? [],
		rejectedStack:
			readRejectedStack(record, "rejectedStack", errors) ?? [],
	};
}

function readValidationGates(
	value: unknown,
	errors: string[],
): ConstitutionValidationGate[] | undefined {
	if (!Array.isArray(value)) {
		errors.push("validationGates must be an array");
		return undefined;
	}
	const gates: ConstitutionValidationGate[] = [];
	for (const item of value) {
		const record = asRecord(item);
		if (!record) {
			errors.push("validationGates entries must be objects");
			return undefined;
		}
		const id = readString(record, "id", errors);
		const severity = readEnum(record, "severity", GATE_SEVERITIES, errors);
		const description = readString(record, "description", errors);
		if (id && severity && description)
			gates.push({ id, severity, description });
	}
	return gates;
}

function readString(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): string | undefined {
	const value = record[field];
	if (typeof value === "string" && value.trim()) return value.trim();
	errors.push(`${field} must be a non-empty string`);
	return undefined;
}

function readStringArray(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): string[] | undefined {
	const value = record[field];
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || !item.trim())
	) {
		errors.push(`${field} must be an array of non-empty strings`);
		return undefined;
	}
	return value.map((item) => item.trim());
}

// R3.1: accept either legacy string entries or structured RejectedRule objects
// during the Tier 3 transition. Strings pass through verbatim (backward-compat
// with the current brain's 6-string array). Objects are validated against the
// 7 required fields per design §5.3 plus the closed BehaviorKind enum.
// On validation failure this reader pushes stable, test-matchable error
// prefixes of the form "rejectedStack[N]: missing field 'X'" /
// "rejectedStack[N]: invalid category 'X'" etc. (see test/project-constitution.test.ts).
// This reader NEVER throws — it pushes to `errors` and returns whatever entries
// parsed successfully (matching the `readStringArray` convention).
function readRejectedStack(
	record: Record<string, unknown>,
	field: string,
	errors: string[],
): RejectedStackEntry[] | undefined {
	const value = record[field];
	if (!Array.isArray(value)) {
		errors.push(`${field} must be an array`);
		return undefined;
	}
	const out: RejectedStackEntry[] = [];
	const allowedSeverities = ["blocker", "high", "medium", "low"] as const;
	const allowedCategories = ["stack", "process", "data", "security"] as const;
	const allowedBehaviors = [
		"long-running",
		"periodic",
		"network-bound",
		"external-write",
	] as const;
	const detectionKeys = [
		"filePattern",
		"depPattern",
		"importPattern",
		"commandPattern",
		"behaviorPattern",
	] as const;
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		const prefix = `${field}[${i}]`;
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (!trimmed) {
				errors.push(`${prefix}: must be a non-empty string`);
				continue;
			}
			out.push(trimmed);
			continue;
		}
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			errors.push(`${prefix}: must be a string or an object`);
			continue;
		}
		const rec = item as Record<string, unknown>;
		const id = rec.id;
		if (typeof id !== "string" || !id.trim()) {
			errors.push(`${prefix}: missing field 'id'`);
			continue;
		}
		const summary = rec.summary;
		if (typeof summary !== "string" || !summary.trim()) {
			errors.push(`${prefix}: missing field 'summary'`);
			continue;
		}
		const category = rec.category;
		if (
			typeof category !== "string" ||
			!(allowedCategories as readonly string[]).includes(category)
		) {
			errors.push(
				`${prefix}: invalid category '${String(category)}' (must be one of: ${allowedCategories.join(", ")})`,
			);
			continue;
		}
		const detection = rec.detection;
		// detection may be null (advisory-only legacy object form) OR an object
		// with EXACTLY ONE detection key. Capture the validated detection shape
		// in `validatedDetection` so it is visible at the rule-construction site
		// below (TS narrowing does not survive across block boundaries inside
		// the for-loop body).
		let validatedDetection: RejectionDetection | null = null;
		if (detection === null) {
			// allowed: null = advisory-only
			validatedDetection = null;
		} else if (
			detection === undefined ||
			typeof detection !== "object" ||
			Array.isArray(detection)
		) {
			errors.push(`${prefix}: missing field 'detection' (or null)`);
			continue;
		} else {
			const dRec = detection as Record<string, unknown>;
			const presentKeys = detectionKeys.filter((k) => k in dRec);
			if (presentKeys.length === 0) {
				errors.push(
					`${prefix}: detection must have exactly one of: ${detectionKeys.join(", ")}`,
				);
				continue;
			}
			if (presentKeys.length > 1) {
				errors.push(
					`${prefix}: detection must have exactly one key, got ${presentKeys.length} (${presentKeys.join(", ")})`,
				);
				continue;
			}
			const key = presentKeys[0];
			const inner = dRec[key];
			if (key === "behaviorPattern") {
				if (
					typeof inner !== "string" ||
					!(allowedBehaviors as readonly string[]).includes(inner)
				) {
					errors.push(
						`${prefix}: invalid behaviorPattern '${String(inner)}' (must be one of: ${allowedBehaviors.join(", ")})`,
					);
					continue;
				}
				validatedDetection = { behaviorPattern: inner as BehaviorKind };
			} else {
				if (typeof inner !== "string" || !inner.trim()) {
					errors.push(
						`${prefix}: detection.${key} must be a non-empty string`,
					);
					continue;
				}
				if (key === "filePattern") validatedDetection = { filePattern: inner };
				else if (key === "depPattern") validatedDetection = { depPattern: inner };
				else if (key === "importPattern") validatedDetection = { importPattern: inner };
				else if (key === "commandPattern") validatedDetection = { commandPattern: inner };
			}
		}
		const severity = rec.severity;
		if (
			typeof severity !== "string" ||
			!(allowedSeverities as readonly string[]).includes(severity)
		) {
			errors.push(
				`${prefix}: invalid severity '${String(severity)}' (must be one of: ${allowedSeverities.join(", ")})`,
			);
			continue;
		}
		const rationale = rec.rationale;
		if (typeof rationale !== "string" || !rationale.trim()) {
			errors.push(`${prefix}: missing field 'rationale'`);
			continue;
		}
		const messages = rec.messages;
		if (!messages || typeof messages !== "object" || Array.isArray(messages)) {
			errors.push(`${prefix}: missing field 'messages'`);
			continue;
		}
		const mRec = messages as Record<string, unknown>;
		const blocked = mRec.blocked;
		if (typeof blocked !== "string" || !blocked.trim()) {
			errors.push(`${prefix}: missing field 'messages.blocked'`);
			continue;
		}
		const warning = mRec.warning;
		if (typeof warning !== "string" || !warning.trim()) {
			errors.push(`${prefix}: missing field 'messages.warning'`);
			continue;
		}
		const rule: RejectedRule = {
			id: id.trim(),
			summary: summary.trim(),
			category: category as RejectedRule["category"],
			detection: validatedDetection,
			severity: severity as RejectedRule["severity"],
			rationale: rationale.trim(),
			messages: { blocked: blocked.trim(), warning: warning.trim() },
		};
		if (rec.advisoryOnly === true) rule.advisoryOnly = true;
		out.push(rule);
	}
	return out;
}

// R3.1: convert the union form (RejectedStackEntry[]) into a uniform
// RejectedRule[] so the gate in R3.3 can iterate one shape. Legacy string
// entries are normalized into advisory-only rules with `detection: null` and
// `advisoryOnly: true` — preserving the gate's current prose-fallback
// behavior exactly. Object entries pass through unchanged (their optional
// `advisoryOnly` field is preserved if set, and left absent otherwise).
// This function is PURE: no I/O, no state.
export function normalizeRejectedRules(
	entries: RejectedStackEntry[],
): RejectedRule[] {
	return entries.map((entry, i) => {
		if (!entry || typeof entry !== "object") {
			return {
				id: `legacy-string-${i}`,
				summary: entry,
				category: "stack",
				detection: null,
				severity: "high",
				rationale: "Legacy prose entry — no predicate available.",
				messages: {
					blocked: entry,
					warning: `Posible rechazo (advisory): ${entry}`,
				},
				advisoryOnly: true,
			};
		}
		// Object entry — pass through unchanged.
		return entry;
	});
}

// R3.3: predicate-driven evaluation of `rejectedStack`. Each rule's
// `detection` field drives one of five branches. Missing inputs
// (`changedFiles` empty, `deps` absent, no git history) cause the predicate
// to skip silently — we DO NOT synthesize signals from prose. This function
// is pure (given deterministic read hooks); the DI options let tests inject
// fixture content/diff without touching the filesystem.
//
// Important: this function NEVER matches `advisoryOnly` rules against their
// `summary` prose. The prose fallback path lives in `evaluateConstitutionGates`
// (Pass 2). Splitting the two passes keeps the predicate bypass-closed.
export function hasRejection(
	input: ConstitutionGateInput,
	rules: RejectedRule[],
	options: HasRejectionOptions = {},
): RejectionHit[] {
	const hits: RejectionHit[] = [];
	const readContent = options.readContent ?? defaultReadChangedFileContent;
	const readDiff = options.readDiff ?? defaultReadChangedFileDiff;
	const files = input.changedFiles ?? [];
	const deps = input.deps;

	for (const rule of rules) {
		// Predicate rules MUST have a detection object; advisoryOnly rules
		// have `detection: null` and are handled by Pass 2 in the gate.
		const det = rule.detection;
		if (!det) continue;

		if ("filePattern" in det) {
			if (files.length === 0) continue;
			const matched = files.filter((f) => matchesGlob(f, det.filePattern));
			for (const m of matched) hits.push({ rule, matchedFile: m });
			continue;
		}

		if ("depPattern" in det) {
			if (!deps) continue;
			const depName = det.depPattern;
			const inDeps = Object.prototype.hasOwnProperty.call(
				deps.dependencies,
				depName,
			);
			const inDevDeps = Object.prototype.hasOwnProperty.call(
				deps.devDependencies,
				depName,
			);
			if (inDeps || inDevDeps) {
				hits.push({ rule, matchedDep: depName });
			}
			continue;
		}

		if ("importPattern" in det) {
			if (files.length === 0) continue;
			const regex = safeRegExp(det.importPattern);
			if (!regex) continue;
			for (const f of files) {
				const content = readContent(f);
				if (content && regex.test(content)) hits.push({ rule, matchedFile: f });
			}
			continue;
		}

		if ("commandPattern" in det) {
			if (files.length === 0) continue;
			const regex = safeRegExp(det.commandPattern);
			if (!regex) continue;
			for (const f of files) {
				const diff = readDiff(f);
				if (diff && regex.test(diff)) hits.push({ rule, matchedFile: f });
			}
			continue;
		}

		if ("behaviorPattern" in det) {
			if (files.length === 0) continue;
			for (const f of files) {
				const content = readContent(f);
				if (content && detectBehavior(content, det.behaviorPattern)) {
					hits.push({ rule, matchedFile: f });
				}
			}
			continue;
		}
	}
	return hits;
}

// R3.3: read a changed file's CURRENT CONTENT as-of HEAD. Postflight-only:
// when `changedFiles` is absent (preflight path), or git is not available
// (e.g. tests), returns `undefined`. Wrapped in try/catch so a broken repo
// never crashes the gate.
function defaultReadChangedFileContent(file: string): string | undefined {
	try {
		const out = execFileSync("git", ["show", `HEAD:${file}`], {
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return out;
	} catch {
		return undefined;
	}
}

// R3.3: read a changed file's DIFF against HEAD. Postflight-only; same
// fallback contract as `defaultReadChangedFileContent`.
function defaultReadChangedFileDiff(file: string): string | undefined {
	try {
		const out = execFileSync("git", ["diff", "HEAD", "--", file], {
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return out;
	} catch {
		return undefined;
	}
}

// R3.3: glob matcher supporting `*` and `**` segments and `?` single-char.
// Converted to a regex per-call (rules are evaluated at most once per gate
// run; no hot path). Patterns are anchored at start and end so `src/**/*.ts`
// does NOT accidentally match `prefix-src/foo.ts`.
//
// `**` semantics follow micromatch: a `**` segment matches zero or more
// path segments INCLUDING the surrounding slashes — i.e. `a/**/b` matches
// both `a/b` and `a/x/y/b`, and `src/**/*.ts` matches both
// `src/foo.ts` and `src/dir/foo.ts`. We model this by collapsing
// `<seg>/**/<rest>` (and the boundary forms `**/<rest>` and `<seg>/**`)
// into a single regex group `(?:.*/)?` before segment-by-segment expansion.
function matchesGlob(file: string, pattern: string): boolean {
	const normalized = file.replace(/\\/gu, "/");
	// Use a placeholder for `**` so the downstream regex-escape step doesn't
	// rewrite its dots. The placeholder is a token that has no regex meaning
	// (alphanumeric, not in the escape set) and survives escaping unchanged.
	const STAR_STAR = "\u0000DSTAR\u0000";
	const STAR = "\u0000SSTAR\u0000";
	const QMARK = "\u0000QMARK\u0000";
	const collapsed = pattern
		.replace(/\*\*\//gu, STAR_STAR)
		.replace(/\/\*\*/gu, STAR_STAR)
		.replace(/\*\*/gu, STAR_STAR);
	const escaped = collapsed
		.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
		.replace(/\*/gu, STAR)
		.replace(/\?/gu, QMARK);
	const regexStr = escaped
		.replace(new RegExp(STAR_STAR, "gu"), ".*")
		.replace(new RegExp(STAR, "gu"), "[^/]*")
		.replace(new RegExp(QMARK, "gu"), "[^/]");
	const regex = new RegExp(`^${regexStr}$`, "u");
	return regex.test(normalized);
}

// R3.3: compile a user-supplied detection regex safely. Invalid patterns
// are SKIPPED silently (predicate inconclusive) rather than throwing — the
// gate must never crash on a malformed rule.
function safeRegExp(pattern: string): RegExp | undefined {
	try {
		return new RegExp(pattern, "u");
	} catch {
		return undefined;
	}
}

// R3.3: behavior detector. Each `BehaviorKind` maps to a regex shape:
//   - `long-running`: timer / loop tokens AND NOT a shutdown handler
//                     (rough heuristic; see design §2.2 item 1).
//   - `periodic`: `setInterval(`.
//   - `network-bound`: outbound HTTP(S) / fetch primitives.
//   - `external-write`: filesystem write primitives.
// `long-running` is intentionally narrow: "unbounded" is a runtime property
// that cannot be proven statically; the predicate catches the common shape
// (timers + no SIGTERM handler) and the orchestrator/LLM fills the rest.
function detectBehavior(content: string, kind: BehaviorKind): boolean {
	switch (kind) {
		case "long-running": {
			const hasTimer =
				/(setInterval|setTimeout|cron|while\s*\(\s*true\s*\))/u.test(content);
			if (!hasTimer) return false;
			const hasShutdown =
				/(SIGTERM|SIGINT|process\.exit|clearInterval)/u.test(content);
			return !hasShutdown;
		}
		case "periodic":
			return /setInterval\s*\(/u.test(content);
		case "network-bound":
			return /(http\.get|https\.get|fetch\s*\()/u.test(content);
		case "external-write":
			return /(writeFileSync|appendFileSync|fs\.writeFile)/u.test(content);
	}
}

// R3.3: rule severity → gate severity. Rules may declare any of the 4
// fine-grained levels; the gate's `ConstitutionGateSeverity` accepts 3
// (`medium`/`high`/`blocker`) plus the implicit `low`. We map `low` to
// `medium` so a low-severity rule still surfaces in the report — a `low`
// severity that disappears entirely would defeat the audit trail.
function normalizeRuleSeverity(
	sev: RejectedRule["severity"],
): ConstitutionGateSeverity {
	if (sev === "low") return "medium";
	if (sev === "medium" || sev === "high" || sev === "blocker") return sev;
	return "high";
}

function readEnum<T extends readonly string[]>(
	record: Record<string, unknown>,
	field: string,
	allowed: T,
	errors: string[],
): T[number] | undefined {
	const value = record[field];
	if (typeof value === "string" && allowed.includes(value)) return value;
	errors.push(`${field} must be one of: ${allowed.join(", ")}`);
	return undefined;
}

function issue(
	gateId: string,
	severity: ConstitutionGateSeverity,
	message: string,
): ConstitutionGateIssue {
	return { gateId, severity, message };
}

function hasAuthSecurity(text: string): boolean {
	return /(auth|login|security|seguridad|token|secret|permiso|permission)/u.test(
		text,
	);
}

function hasNewModule(text: string): boolean {
	return /(?:crear|crea|agrega|agregar|nuevo|nueva)\s+(?:un\s+|una\s+)?m[oó]dulo/u.test(
		text,
	);
}

function hasArchitectureChange(text: string): boolean {
	return /(arquitectura|architecture|stack|framework|migrar|usar|cambiar)/u.test(
		text,
	);
}

function hasSkipValidation(text: string): boolean {
	return /(sin|skip|saltar|omite|omitir|no correr|no ejecutes).{0,24}(test|tests|build)/u.test(
		text,
	);
}

function matchesForbiddenPractice(text: string, forbidden: string): boolean {
	const normalized = normalize(forbidden);
	if (/saltar.*(test|build)|tests?.*build/u.test(normalized)) {
		return hasSkipValidation(text);
	}
	if (/tecnolog.+rechazada|rejected/u.test(normalized)) return false;
	if (/alcance.*excluido/u.test(normalized)) return false;
	return includesTerm(text, normalized);
}

function includesTerm(value: string, term: string): boolean {
	const normalizedTerm = normalize(term);
	if (!normalizedTerm) return false;
	return value.includes(normalizedTerm);
}

function normalize(value: string): string {
	return value.toLocaleLowerCase("es");
}

function maxRisk(
	current: ProjectPreflightRisk,
	candidate: ProjectPreflightRisk,
): ProjectPreflightRisk {
	const order: ProjectPreflightRisk[] = ["low", "medium", "high", "blocker"];
	return order.indexOf(candidate) > order.indexOf(current)
		? candidate
		: current;
}

function formatInline(items: string[]): string {
	return items.length ? items.join(" | ") : "—";
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

// R2.2: resolve from packageRoot (template is bundled with idu-pi package,
// not with project state). Replaces the cwd-fragile implementation that
// broke when called from non-project dirs.
function defaultConstitutionPath(): string {
	return join(resolvePackageRoot(), "config", "default-constitution.json");
}

/**
 * R5.1: discriminated-union return. NEVER returns `undefined` — every exit is
 * typed so callers can pattern-match on `kind`. Callers MUST handle the
 * discriminated union directly (R5.2 fail-loud): a "skipped" return must
 * surface as a blocker severity in any downstream gate execution.
 */
export type LoadConfirmedConstitutionSkipReason =
	| "no-stateRoot"
	| "core-not-confirmed"
	| "core-loaded-default"
	| "read-failed";

export type LoadConfirmedConstitutionResult =
	| { kind: "ok"; constitution: ProjectConstitution }
	| {
			kind: "skipped";
			reason: LoadConfirmedConstitutionSkipReason;
			detail?: string;
	  };

/**
 * Detects whether the project core was loaded from a real file at the
 * project's Layout A/B paths, or fell through to the package-bundled
 * default. This matters because the cwd-fallback trap (R5.1 fix in
 * `defaultCorePath`) used to silently succeed with the package default
 * — a confirmed core that does NOT actually belong to the project.
 *
 * Returns:
 *   - `"layout-a"` — found at `<stateRoot>/.idu/config/project-core.json`
 *   - `"layout-b"` — found at `<stateRoot>/config/project-core.json` (would
 *     be migrated to A on next readIdPathWithMigration call)
 *   - `"default"`  — neither path has the file; loadProjectCore fell through
 *     to `defaultCorePath()` (the package-bundled default)
 */
function detectCoreSource(
	stateRoot: string,
): "layout-a" | "layout-b" | "default" {
	const layoutA = join(stateRoot, ".idu", "config", "project-core.json");
	if (existsSync(layoutA)) return "layout-a";
	const layoutB = join(stateRoot, "config", "project-core.json");
	if (existsSync(layoutB)) return "layout-b";
	return "default";
}

/**
 * Load the project constitution only when its Project Core is `confirmed`.
 *
 * R5.1 changes vs prior shape:
 *  - Returns a discriminated union `{ kind: "ok" | "skipped", ... }` instead
 *    of `ProjectConstitution | undefined`. This makes "skipped" explicit at
 *    the type level so callers can no longer accidentally treat it as a
 *    legitimate constitution.
 *  - Adds `"core-loaded-default"` skip reason: the loader previously could
 *    silently return a derived constitution built from the package-bundled
 *    default core, masking the cwd-fallback trap.
 *  - Reads the constitution via A-pref-B (`readIdPathWithMigration`) like
 *    `loadProjectConstitution` does at L220, instead of Layout B only. This
 *    closes the deferred hygiene-migrate bug for this code path: previously
 *    a confirmed core + Layout A constitution would skip the read because
 *    the helper checked Layout B first.
 *  - Read failures now surface `detail` (the underlying error message) so
 *    triage is possible without re-running the loader.
 *
 * R5.2 (fail-loud, blocker-on-skip) deploys AFTER acceptance — callers now
 * handle the discriminated union directly via `constitutionStatus` in
 * `analyzeProjectPostflight` / `analyzeProjectPreflight`. The R5.1 caller
 * shim `getActiveConstitution` is GONE — it silently absorbed `skipped` to
 * `null`, which masked the original R5 bug at the type level.
 */
export function loadConfirmedProjectConstitution(
	stateRoot: string,
): LoadConfirmedConstitutionResult {
	if (!stateRoot) return { kind: "skipped", reason: "no-stateRoot" };

	let core: ProjectCore;
	try {
		core = loadProjectCore(stateRoot);
	} catch (err) {
		return {
			kind: "skipped",
			reason: "read-failed",
			detail: err instanceof Error ? err.message : String(err),
		};
	}

	// R5.1: detect if the core was actually loaded from the project, or fell
	// through to the package default. Order matters: the package default has
	// status="draft", so checking status first would mask the cwd-fallback
	// trap as a generic "core-not-confirmed". Source detection must come
	// first so the root cause is visible in the typed skip reason.
	const coreSource = detectCoreSource(stateRoot);
	if (coreSource === "default") {
		return { kind: "skipped", reason: "core-loaded-default" };
	}
	if (core.status !== "confirmed") {
		return { kind: "skipped", reason: "core-not-confirmed" };
	}

	// R5.1: A-pref-B (mirror loadProjectConstitution at L220). Previously this
	// helper checked Layout B only, which caused silent skips for projects
	// that had migrated to Layout A.
	try {
		const migrated = readIdPathWithMigration(
			stateRoot,
			"project-constitution.json",
		);
		if (migrated.content !== null) {
			const raw = migrated.content;
			const parsed = JSON.parse(raw) as unknown;
			const result = validateProjectConstitution(parsed);
			if (!result.ok) {
				return {
					kind: "skipped",
					reason: "read-failed",
					detail: `Invalid constitution: ${result.errors.join("; ")}`,
				};
			}
			return { kind: "ok", constitution: result.constitution };
		}
		// Neither Layout A nor B exists — derive from the confirmed core.
		return {
			kind: "ok",
			constitution: deriveConstitutionFromProjectCore(core),
		};
	} catch (err) {
		return {
			kind: "skipped",
			reason: "read-failed",
			detail: err instanceof Error ? err.message : String(err),
		};
	}
}
