import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { assertSafeArtifactName } from "./birth-artifacts.js";

export type InjectionSeverity = "info" | "warning" | "critical";

export type DecisionEnvelope = {
	severity: InjectionSeverity;
	summary: string;
	options: string[];
	evidenceRefs: string[];
	orchestratorDecisionRequired: boolean;
};

export type Injection = {
	ts: string;
	triggerId: string;
	decisionEnvelope: DecisionEnvelope;
	injectionId: string;
	acked: boolean;
};

export type ReadPendingInjectionsOptions = {
	since?: string;
};

export function resolveInjectionsPath(stateRoot: string): string {
	return join(stateRoot, "injections.jsonl");
}

export function appendInjection(stateRoot: string, envelope: Injection): void {
	// Path-safety guard: triggerId flows into the envelope and may be consumed
	// downstream as a reference; reject `..`, `/` or `\` characters to keep
	// the trigger engine injection namespace controlled.
	assertSafeArtifactName(envelope.triggerId);
	const filePath = resolveInjectionsPath(stateRoot);
	if (!existsSync(filePath)) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, "", "utf8");
	}
	appendFileSync(filePath, `${JSON.stringify(envelope)}\n`, "utf8");
}

export function readPendingInjections(
	stateRoot: string,
	options: ReadPendingInjectionsOptions = {},
): Injection[] {
	const filePath = resolveInjectionsPath(stateRoot);
	if (!existsSync(filePath)) return [];
	let raw: string;
	try {
		raw = readFileSync(filePath, "utf8");
	} catch {
		return [];
	}
	if (!raw.trim()) return [];
	const sinceMs = options.since ? Date.parse(options.since) : undefined;
	const out: Injection[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let parsed: Injection;
		try {
			parsed = JSON.parse(line) as Injection;
		} catch {
			continue;
		}
		if (parsed.acked) continue;
		if (
			typeof sinceMs === "number" &&
			Number.isFinite(sinceMs) &&
			Date.parse(parsed.ts) < sinceMs
		)
			continue;
		out.push(parsed);
	}
	return out;
}

export function markInjectionAcked(
	stateRoot: string,
	injectionId: string,
): void {
	const filePath = resolveInjectionsPath(stateRoot);
	if (!existsSync(filePath)) return;
	const raw = readFileSync(filePath, "utf8");
	if (!raw.trim()) return;
	const lines = raw.split("\n").filter((line) => line.length > 0);
	let touched = false;
	const updated: string[] = lines.map((line) => {
		try {
			const parsed = JSON.parse(line) as Injection;
			if (parsed.injectionId === injectionId && !parsed.acked) {
				touched = true;
				return JSON.stringify({ ...parsed, acked: true });
			}
			return line;
		} catch {
			return line;
		}
	});
	if (!touched) return;
	writeFileSync(filePath, `${updated.join("\n")}\n`, "utf8");
}
