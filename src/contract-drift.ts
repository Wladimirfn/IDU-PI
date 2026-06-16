/**
 * contract-drift.ts — drift detection between the Plan Maestro's
 * approved contracts and the actual state of the project.
 *
 * The Plan Maestro is a durable contract: once `status === "approved"`,
 * it stays approved until the user explicitly revises it via
 * `/idu revise` or `/idu redraft`. Code changes do not auto-mark the
 * plan as stale. What code changes CAN do is violate an approved
 * contract; that is the signal this module produces.
 *
 * For now, the function is a placeholder: it reads
 * `plan.approvedContracts` (currently empty in every project) and
 * returns zero violations. As the user approves contracts through
 * `/idu revise`, the claim-based checks will be added. The wire
 * (postflight + cron) is in place so that when contracts are
 * approved, the next tick catches drift.
 */

export type ContractSeverity = "info" | "warning" | "critical";

export type ContractClaim = {
	contractId: string;
	claim: string;
	severity: ContractSeverity;
};

export type ContractViolation = {
	contractId: string;
	claim: string;
	severity: ContractSeverity;
	evidence: string;
	observedAt: string;
};

export type DetectContractDriftInput = {
	stateRoot: string;
	plan: unknown;
};

export type DetectContractDriftResult = {
	violations: ContractViolation[];
	scannedContracts: number;
};

function readApprovedContracts(plan: unknown): ContractClaim[] {
	if (!plan || typeof plan !== "object") return [];
	const candidate = (plan as { approvedContracts?: unknown }).approvedContracts;
	if (!Array.isArray(candidate)) return [];
	const out: ContractClaim[] = [];
	for (const entry of candidate) {
		if (!entry || typeof entry !== "object") continue;
		const c = entry as {
			contractId?: unknown;
			claim?: unknown;
			severity?: unknown;
		};
		if (
			typeof c.contractId === "string" &&
			typeof c.claim === "string" &&
			(c.severity === "info" || c.severity === "warning" || c.severity === "critical")
		) {
			out.push({
				contractId: c.contractId,
				claim: c.claim,
				severity: c.severity,
			});
		}
	}
	return out;
}

export function detectContractDrift(
	input: DetectContractDriftInput,
): DetectContractDriftResult {
	const approved = readApprovedContracts(input.plan);
	if (approved.length === 0) {
		return { violations: [], scannedContracts: 0 };
	}
	// Future: for each approved contract, run the matching claim
	// checker against the real code/state under stateRoot and emit
	// a violation when the claim is no longer satisfied. For now
	// the function is a no-op (zero violations) but the wire is
	// present so callers can already integrate the result.
	return { violations: [], scannedContracts: approved.length };
}
