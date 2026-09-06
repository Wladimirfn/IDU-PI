import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildObjectiveReminderText } from "../src/objective-reminder.js";
import { loadRoleProfile } from "../src/roles/profile-loader.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-objrem-"));
}

test("buildObjectiveReminderText includes the role label and routine from the orchestrator profile", () => {
	const stateRoot = makeStateRoot();
	try {
		const text = buildObjectiveReminderText({
			stateRoot,
			now: new Date("2026-06-15T00:00:00Z"),
		});
		assert.match(text, /Recordatorio de objetivo/);
		assert.match(text, /Eres: orquestador/i);
		assert.match(text, /Tipo: orquestador/);
		// Routine is present (look for any known section header).
		assert.match(
			text,
			/Rutina obligatoria|Al iniciar sesi|Entre tareas|Antes de implementar/i,
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("buildObjectiveReminderText reads objective from master-plan.json when present", () => {
	const stateRoot = makeStateRoot();
	try {
		writeFileSync(
			join(stateRoot, "master-plan.json"),
			`${JSON.stringify({ objective: "Build a deck for the team offsite" })}\n`,
			"utf8",
		);
		const text = buildObjectiveReminderText({
			stateRoot,
			now: new Date("2026-06-15T00:00:00Z"),
		});
		assert.match(text, /Build a deck for the team offsite/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("buildObjectiveReminderText falls back to a neutral default when master-plan is missing", () => {
	const stateRoot = makeStateRoot();
	try {
		const text = buildObjectiveReminderText({
			stateRoot,
			now: new Date("2026-06-15T00:00:00Z"),
		});
		assert.match(text, /revis[áa] el master-plan antes de seguir/i);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("cadence hint: weak model triggers shorter cadence", () => {
	const stateRoot = makeStateRoot();
	try {
		const text = buildObjectiveReminderText(
			{ stateRoot, now: new Date() },
			{ activeModelId: "opencode-go/minimax-m2.5" },
		);
		assert.match(text, /cada ~5 tareas/i);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("cadence hint: strong model uses default cadence", () => {
	const stateRoot = makeStateRoot();
	try {
		const text = buildObjectiveReminderText(
			{ stateRoot, now: new Date() },
			{ activeModelId: "opencode-go/deepseek-v4-pro" },
		);
		assert.match(text, /cada ~10 tareas/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("orchestrator profile's prohibitions include anti-drift guidance", () => {
	const profile = loadRoleProfile("orchestrator");
	const allProhibitions = profile.prohibitions.join("\n");
	assert.match(
		allProhibitions,
		/Trabaj[ao]r m[áa]s de ~1 hora|refrescar|contexto/i,
		"orchestrator must prohibit working >1h without refresh",
	);
});
