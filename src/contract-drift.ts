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
 * Architecture:
 *
 *   1. The user adds approved contracts to master-plan.json under
 *      `approvedContracts: [{ contractId, claim, severity }]`.
 *   2. On every postflight and on every cron auto-refresh tick,
 *      `detectContractDrift` is called.
 *   3. For each approved contract, the matching `claim checker` in
 *      `claim-checkers.ts` is run against the real state under
 *      stateRoot. If the claim is no longer satisfied, a violation
 *      is appended to `events.jsonl` with kind
 *      `contract_drift_violation`.
 *   4. The orchestrator (Pi) reads the violation events and decides
 *      whether to fix, override, or escalate.
 *
 * The available claim checkers today:
 *
 *   - `data-retention` (severity: critical) — the stateRoot must
 *     declare a retention policy via `retention.json` so SQLite /
 *     JSON / JSONL stores have an explicit lifecycle. Matches the
 *     "Datos/DB" contract from the canonical plan.
 *
 * To add a new checker, register it in CLAIM_CHECKERS. Each checker
 * returns `null` when the claim is satisfied and a non-empty
 * `evidence` string when it is violated.
 */

import { claimCheckers, type ClaimCheckInput } from "./claim-checkers.js";

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
			(c.severity === "info" ||
				c.severity === "warning" ||
				c.severity === "critical")
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
	const violations: ContractViolation[] = [];
	const observedAt = new Date().toISOString();
	for (const claim of approved) {
		const checker = claimCheckers[claim.contractId];
		if (!checker) continue;
		const checkInput: ClaimCheckInput = {
			stateRoot: input.stateRoot,
			claim,
		};
		const evidence = checker(checkInput);
		if (evidence) {
			violations.push({
				contractId: claim.contractId,
				claim: claim.claim,
				severity: claim.severity,
				evidence,
				observedAt,
			});
		}
	}
	return { violations, scannedContracts: approved.length };
}
