import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addSourceLibraryItem } from "../src/source-library.js";
import { createSourceResearchReport } from "../src/source-research.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "source-research-"));
}

function now(): Date {
	return new Date("2026-06-01T12:00:00.000Z");
}

test("research finds evidence only in registered readable sources", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const doc = join(temp, "manual.md");
		writeFileSync(
			doc,
			"# Manual\nProyecto robusto exige contratos, evidencia y revisión humana.",
			"utf8",
		);
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: doc,
			now,
		});
		const report = createSourceResearchReport({
			stateRoot,
			projectId: "Demo",
			query: "contratos evidencia",
			now,
		});
		assert.equal(report.contractPromotionAllowed, false);
		assert.deepEqual(report.searchedSourceIds, [added.addedSource!.id]);
		assert.ok(report.signals.length >= 1);
		assert.equal(report.signals[0]!.contractPromotionAllowed, false);
		assert.equal(report.signals[0]!.sourceId, added.addedSource!.id);
		assert.match(report.signals[0]!.evidence, /contratos|evidencia/iu);
		assert.match(report.signals[0]!.citationPath, /sources\/extracted/u);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("research reports limitations for PDFs without extracted text", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const pdf = join(temp, "manual.pdf");
		writeFileSync(pdf, "%PDF fake", "utf8");
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: pdf,
			now,
		});
		const report = createSourceResearchReport({
			stateRoot,
			projectId: "Demo",
			query: "manual",
			sourceIds: [added.addedSource!.id],
			now,
		});
		assert.equal(report.signals.length, 0);
		assert.match(
			report.limitations.join("\n"),
			/sin texto legible|PDF registrado/u,
		);
		assert.equal(report.contractPromotionAllowed, false);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
