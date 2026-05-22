import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatIduProjectDashboard,
	type IduProjectDashboardReport,
} from "../src/idu-project-dashboard.js";

function dashboard(
	overrides: Partial<IduProjectDashboardReport> = {},
): IduProjectDashboardReport {
	return {
		projectId: "pi-telegram-bridge",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		reason: ["no existe scan reciente"],
		recommendedNext: "/idu_prepare",
		...overrides,
	};
}

test("/idu dashboard with valid local config but no recent scan shows config_ready and pending_scan", () => {
	const text = formatIduProjectDashboard(dashboard());

	assert.match(text, /Idu-pi activo/u);
	assert.match(text, /Proyecto:\npi-telegram-bridge/u);
	assert.match(text, /Estado de configuración:\nproject-local válido/u);
	assert.match(text, /Estado de alineación:\npending_scan/u);
	assert.match(text, /Estado operativo:\nconfig_ready/u);
	assert.match(text, /Acción principal:\n\/idu_prepare/u);
});

test("/idu dashboard can report needs_review from last prepare differences", () => {
	const text = formatIduProjectDashboard(
		dashboard({
			alignmentStatus: "needs_review",
			reason: ["último prepare detectó 39 dataStores sugeridos"],
		}),
	);

	assert.match(text, /Estado de alineación:\nneeds_review/u);
	assert.match(text, /último prepare detectó 39 dataStores sugeridos/u);
	assert.match(
		text,
		/Estado operativo:\nconfig_ready, pero requiere revisión de mapa antes de cambios grandes/u,
	);
	assert.doesNotMatch(text, /listo total/i);
});

test("/idu dashboard with missing configs is not_ready", () => {
	const text = formatIduProjectDashboard(
		dashboard({
			configStatus: "missing",
			alignmentStatus: "unknown",
			readiness: "not_ready",
			reason: ["faltan blueprint/flows project-local"],
		}),
	);

	assert.match(text, /Estado de configuración:\nfaltante/u);
	assert.match(text, /Estado de alineación:\nunknown/u);
	assert.match(text, /Estado operativo:\nnot_ready/u);
});
