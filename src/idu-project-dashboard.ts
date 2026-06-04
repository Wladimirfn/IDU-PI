import type {
	ProjectAlignmentStatus,
	ProjectConfigStatus,
	ProjectReadiness,
} from "./project-connection.js";

export type IduProjectDashboardReport = {
	projectId?: string;
	configStatus: ProjectConfigStatus;
	alignmentStatus: ProjectAlignmentStatus;
	readiness: ProjectReadiness;
	reason: string[];
	recommendedNext: string;
};

export function formatIduProjectDashboard(
	report: IduProjectDashboardReport,
): string {
	return [
		"Idu-pi activo",
		"",
		"Proyecto:",
		report.projectId ?? "—",
		"",
		"Modo supervisor:",
		"guardrails automáticos activos",
		"",
		"Límites seguros:",
		"- no ejecuta AgentLabs automáticamente",
		"- no aplica reglas ni modifica Project Core sin gates/aprobación",
		"",
		"Estado de configuración:",
		configStatusLabel(report.configStatus),
		"",
		"Estado de alineación:",
		report.alignmentStatus,
		"",
		"Motivo:",
		formatList(report.reason),
		"",
		"Estado operativo:",
		operationalStatus(report.readiness, report.alignmentStatus),
		"",
		"Acción principal:",
		report.recommendedNext,
	].join("\n");
}

export function configStatusLabel(status: ProjectConfigStatus): string {
	switch (status) {
		case "missing":
			return "faltante";
		case "default":
			return "default";
		case "project_local_valid":
			return "project-local válido";
		case "invalid":
			return "inválido";
	}
}

function operationalStatus(
	readiness: ProjectReadiness,
	alignmentStatus: ProjectAlignmentStatus,
): string {
	if (readiness === "config_ready" && alignmentStatus === "needs_review") {
		return "config_ready, pero requiere revisión de mapa antes de cambios grandes";
	}
	if (readiness === "config_ready" && alignmentStatus === "pending_scan") {
		return "config_ready, pero requiere scan/revisión de mapa antes de cambios grandes";
	}
	if (readiness === "config_ready" && alignmentStatus === "stale") {
		return "config_ready, pero el mapa puede estar stale por cambios locales";
	}
	return readiness;
}

function formatList(items: string[]): string {
	return items.length
		? items.map((item) => `- ${item}`).join("\n")
		: "- ninguno";
}
