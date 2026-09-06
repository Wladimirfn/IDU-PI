/**
 * autonomy-gates.ts — D2.
 *
 * The supervisor context pack ships a fixed set of "autonomy gates": short
 * guidance strings the orchestrator must honor. Historically these were
 * recorded only as a COUNT (autonomyGatesCount in the context-quality
 * event) — there was no per-gate trace of verdict, honor, or override, and
 * no distinction between gates that guard reads vs. gates that guard
 * mutations.
 *
 * D2 adds two things:
 *   1. A per-gate verdict trace (gateId, verdict, honored, overridden,
 *      outcome) so every gate that fires leaves an inspectable record,
 *      not just an aggregate count.
 *   2. A read/write calibration: a gate that BLOCKS a legitimate read
 *      trains agents to ignore it (reads are what the operator asked for).
 *      Gates that fire on READ / investigation operations are therefore
 *      ADVISORY-ONLY (warn, never block). Gates that fire on MUTATIONS
 *      (writes, commits, deps, config) stay BLOCKING.
 */

export type GateOperation = "read" | "write";
export type GateVerdict = "allow" | "deny";

export type AutonomyGateDefinition = {
	gateId: string;
	text: string;
	operation: GateOperation;
};

export type AutonomyGateTrace = {
	gateId: string;
	verdict: GateVerdict;
	honored: boolean;
	overridden: boolean;
	operation: GateOperation;
	advisory: boolean;
	outcome: string;
};

/**
 * The fixed catalog of autonomy gates shipped in every supervisor context
 * pack. `text` is the existing guidance copy (kept verbatim — it is
 * established project content); `operation` is the D2 read/write
 * classification that drives the advisory-vs-blocking calibration.
 *
 * Classification rationale:
 *   - consult-master-plan, governance-review-before-worker,
 *     agentlabs-audit-only, report-gaps-not-approval → READ (consulting,
 *     reviewing, audit-only investigation, reporting). Advisory.
 *   - fix-within-objective, postflight-before-close,
 *     no-commit-without-instruction → WRITE (fixing code, gating a commit,
 *     committing/pushing). Blocking.
 */
export const AUTONOMY_GATES: readonly AutonomyGateDefinition[] = [
	{
		gateId: "consult-master-plan",
		text: "Consultar Plan Maestro antes de definir objetivo o declarar cierre.",
		operation: "read",
	},
	{
		gateId: "governance-review-before-worker",
		text: "Ejecutar governance-review del orquestador antes del worker.",
		operation: "read",
	},
	{
		gateId: "fix-within-objective",
		text: "Corregir bugs dentro del objetivo aprobado con tests y evidencia.",
		operation: "write",
	},
	{
		gateId: "postflight-before-close",
		text: "Ejecutar idu_postflight antes de cerrar o commitear.",
		operation: "write",
	},
	{
		gateId: "no-commit-without-instruction",
		text: "No commit/push/publicación sin instrucción explícita del humano u orquestador autorizado.",
		operation: "write",
	},
	{
		gateId: "agentlabs-audit-only",
		text: "AgentLabs son audit-only y sólo por llamada explícita; nunca implementan.",
		operation: "read",
	},
	{
		gateId: "report-gaps-not-approval",
		text: "Si falta evidencia o cobertura, reportar parcial/omisiones en vez de asumir aprobado.",
		operation: "read",
	},
];

/** The legacy string-only view, preserved for backward-compatible consumers. */
export const AUTONOMY_GATE_TEXTS: readonly string[] = AUTONOMY_GATES.map(
	(gate) => gate.text,
);

/**
 * Keywords that indicate an operation MUTATES the repo / stateRoot /
 * config. Everything else is treated as a read. The list is intentionally
 * lowercase; `classifyGateOperation` lowercases its input before matching.
 */
const WRITE_KEYWORDS = [
	"commit",
	"push",
	"publicación",
	"publicacion",
	"corregir",
	"fix",
	"implementan",
	"implement",
	"postflight",
	"deps",
	"dependenc",
	"config",
	// Destructive verbs. Their absence was a hole: the default is READ, so a
	// gate phrased "borrar todas las filas" matched nothing and came back
	// advisory — the one classification where being wrong costs the most.
	"delete",
	"borrar",
	"drop",
	"remove",
	"eliminar",
	"reset",
	"overwrite",
	"sobrescribir",
	"migrate",
	"migrar",
	"truncate",
	"purge",
	"purgar",
];

/**
 * Classify an operation description (a gate text, a tool name, a request)
 * as READ or WRITE.
 *
 * READ  = does not mutate the repo / stateRoot / config: consulting the
 *         plan, running a review, audit-only investigation, reporting
 *         gaps. The operator asked for these; blocking them trains agents
 *         to ignore the gate.
 * WRITE = mutates: fixing code, running postflight before a commit,
 *         committing/pushing, changing deps/config, implementing.
 *
 * The default is READ, which means unmatched text FAILS OPEN — it warns
 * instead of blocking. That is the owner's deliberate calibration ("reads
 * are advisory, never block them"), not a safety property: do not call it
 * fail-safe. A control that defaults to not blocking fails open by
 * definition, and the keyword list is the only thing standing between a
 * destructive operation and an advisory.
 *
 * NOT WIRED TO PRODUCTION. The seven catalog gates carry a hand-set
 * `operation`, which is strictly safer than matching keywords against
 * prose — the same fragility that produced the docs-sensor regex gap and
 * the protocol-drift false positives. Before wiring this anywhere, decide
 * whether unmatched text should still default to READ, because at that
 * point the default stops being an editorial choice and starts deciding
 * whether mutations get gated.
 */
export function classifyGateOperation(text: string): GateOperation {
	const lower = text.toLowerCase();
	if (WRITE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
		return "write";
	}
	return "read";
}

/**
 * Build the per-gate verdict trace for a single gate.
 *
 * Calibration (D2 part 2):
 *   - READ gates  → advisory (warn, never block). verdict = "allow": the
 *                   agent may proceed, the warning is recorded.
 *   - WRITE gates → blocking. verdict = "deny": the gate withholds the
 *                   mutation until its condition is satisfied.
 *
 * `honored = true, overridden = false` is the default evaluated snapshot.
 * A consumer that later detects a bypass would flip honored to false and
 * overridden to true; recording the stance up front makes that drift
 * visible in the per-gate trace.
 */
export function buildAutonomyGateTrace(
	gate: AutonomyGateDefinition,
): AutonomyGateTrace {
	const isRead = gate.operation === "read";
	return {
		gateId: gate.gateId,
		operation: gate.operation,
		advisory: isRead,
		verdict: isRead ? "allow" : "deny",
		honored: true,
		overridden: false,
		outcome: isRead
			? "proceed (advisory: read/investigation gate warns but does not block)"
			: "blocked (requires its condition before the mutation proceeds)",
	};
}

/** Build the verdict trace for every gate in the catalog (or a subset). */
export function buildAutonomyGateTraces(
	gates: readonly AutonomyGateDefinition[] = AUTONOMY_GATES,
): AutonomyGateTrace[] {
	return gates.map(buildAutonomyGateTrace);
}

/**
 * Normalize an unknown value parsed from a pack's `autonomyGateTraces`
 * field into a trace, or return null when it is not a usable record.
 * Keeps the recording layer resilient to malformed/partial packs.
 */
export function parseAutonomyGateTrace(value: unknown): AutonomyGateTrace | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const gateId = typeof record.gateId === "string" ? record.gateId : "";
	const operation: GateOperation =
		record.operation === "write" ? "write" : "read";
	const isRead = operation === "read";
	if (!gateId) return null;
	return {
		gateId,
		operation,
		advisory:
			typeof record.advisory === "boolean" ? record.advisory : isRead,
		verdict: record.verdict === "deny" ? "deny" : "allow",
		honored: typeof record.honored === "boolean" ? record.honored : true,
		overridden:
			typeof record.overridden === "boolean" ? record.overridden : false,
		outcome:
			typeof record.outcome === "string"
				? record.outcome
				: isRead
					? "proceed (advisory)"
					: "blocked (requires condition)",
	};
}
