import type { AgentProfile } from "./config.js";
import type { AgentRouter } from "./agent-router.js";
import type { LabDuration, LabRunRecorder } from "./lab.js";
import { runTestLab } from "./lab.js";
import {
	cleanAgentOutput,
	type LabReportStore,
	type LabRunRecord,
	summarizeOutput,
} from "./lab-reports.js";
import { oneLine } from "./session-summary.js";

export type LabRunSettledResult = PromiseSettledResult<LabRunRecord>;

export type RunLabForProfilesOptions = {
	router: AgentRouter;
	profileIndexes: number[];
	duration: LabDuration;
	projectId: string;
	projectPath: string;
	stateRoot: string;
	store: LabReportStore;
	labRunRecorder?: LabRunRecorder;
};

export type RunLabForProfilesResult = {
	profiles: AgentProfile[];
	results: LabRunSettledResult[];
};

export type LabReportServiceOptions = {
	router: AgentRouter;
	store: LabReportStore;
};

export function labProfilesForIndexes(
	profiles: AgentProfile[],
	indexes: number[],
): AgentProfile[] {
	const defaultProfileId = profiles[0]?.id;
	return indexes
		.map((index) => profiles[index - 1])
		.filter(
			(profile): profile is AgentProfile =>
				Boolean(profile) && profile.id !== defaultProfileId,
		);
}

export async function runLabForProfiles(
	options: RunLabForProfilesOptions,
): Promise<RunLabForProfilesResult> {
	const profiles = labProfilesForIndexes(
		options.router.profiles,
		options.profileIndexes,
	);
	const results = await Promise.allSettled(
		profiles.map((profile) =>
			runTestLab({
				router: options.router,
				profile,
				duration: options.duration,
				projectId: options.projectId,
				projectPath: options.projectPath,
				stateRoot: options.stateRoot,
				store: options.store,
				labRunRecorder: options.labRunRecorder,
			}),
		),
	);
	return { profiles, results };
}

export function formatLabRunResultLines(
	profiles: AgentProfile[],
	results: LabRunSettledResult[],
): string[] {
	return results.map((result, index) => {
		const profile = profiles[index];
		if (result.status === "rejected") {
			return `${profile.label}: failed - ${result.reason}`;
		}
		const output = cleanAgentOutput(
			result.value.rawOutput || result.value.error || result.value.summary,
		);
		return `${profile.label}: ${result.value.status} · ${result.value.id}\n\n${output}`;
	});
}

export async function triageLabReport(
	options: LabReportServiceOptions & { reportId: string },
): Promise<string> {
	const report = options.store.get(options.reportId);
	if (!report) return "not-found";
	if ((report.triageStatus ?? "pending") !== "pending") {
		return report.triageStatus ?? "pending";
	}
	const orchestrator = options.router.runtimeForProfile(
		options.router.profiles[0].id,
	);
	if (orchestrator.session.busy) return "pending";
	try {
		const result = await orchestrator.session.prompt(
			`Orquestación obligatoria con Engram como contexto, pero NO guardes este reporte raw en Engram todavía. Evaluá este reporte de laboratorio, descartá ruido, priorizá hallazgos graves, indicá confianza/impacto y proponé qué preguntarle al usuario. No tomes decisión final autónoma.\n\nFormato obligatorio: empezá con una línea "Resumen usuario:" y explicá qué pasó en lenguaje simple. No empieces hablando de Engram ni herramientas; si Engram falla, dejalo para una sección técnica al final.\n\nReporte lab:\n${JSON.stringify(report, null, 2)}`,
		);
		options.store.update(report.id, {
			triageStatus: result.ok ? "triaged" : "failed",
			triageSummary: result.ok
				? summarizeOutput(result.output, 180)
				: undefined,
			triageRaw: result.ok ? result.output : undefined,
			triagedAt: new Date().toISOString(),
			triageError: result.ok ? undefined : result.output,
		});
		return result.ok ? "triaged" : "failed";
	} catch (error) {
		options.store.update(report.id, {
			triageStatus: "failed",
			triagedAt: new Date().toISOString(),
			triageError: error instanceof Error ? error.message : String(error),
		});
		return "failed";
	}
}

export async function syncLabReportToEngram(
	options: LabReportServiceOptions & { reportId: string },
): Promise<string> {
	const report = options.store.get(options.reportId);
	if (!report) return "not-found";
	if (report.engramStatus !== "approved") {
		return report.engramStatus ?? "pending";
	}
	const orchestrator = options.router.runtimeForProfile(
		options.router.profiles[0].id,
	);
	if (orchestrator.session.busy) return "pending";
	try {
		const result = await orchestrator.session.prompt(
			`Orquestación obligatoria con Engram. El usuario/orquestador aprobó guardar o trabajar este hallazgo. Guardá en Engram solo la decisión durable, resumen útil, evidencia clave y próximos pasos.\n\nReporte lab triageado:\n${JSON.stringify(report, null, 2)}`,
		);
		options.store.update(report.id, {
			engramStatus: result.ok ? "saved" : "failed",
			engramSyncedAt: new Date().toISOString(),
			engramError: result.ok ? undefined : result.output,
		});
		return result.ok ? "saved" : "failed";
	} catch (error) {
		options.store.update(report.id, {
			engramStatus: "failed",
			engramSyncedAt: new Date().toISOString(),
			engramError: error instanceof Error ? error.message : String(error),
		});
		return "failed";
	}
}

export async function triagePendingReports(
	options: LabReportServiceOptions & { limit?: number },
): Promise<string[]> {
	const reports = options.store.pendingTriage(options.limit ?? 5);
	const lines: string[] = [];
	for (const report of reports) {
		const status = await triageLabReport({ ...options, reportId: report.id });
		const updated = options.store.get(report.id);
		lines.push(
			`${report.id} · ${report.agentLabel}: ${status}${updated?.triageSummary ? ` · ${oneLine(updated.triageSummary, 120)}` : ""}`,
		);
		if (status === "pending") break;
	}
	return lines;
}

export async function syncPendingReportsToEngram(
	options: LabReportServiceOptions & { limit?: number },
): Promise<string[]> {
	const reports = options.store.pendingEngram(options.limit ?? 5);
	const lines: string[] = [];
	for (const report of reports) {
		const status = await syncLabReportToEngram({
			...options,
			reportId: report.id,
		});
		lines.push(`${report.id} · ${report.agentLabel}: ${status}`);
		if (status === "pending") break;
	}
	return lines;
}
