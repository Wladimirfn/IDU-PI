import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeBirthGeneralSpec } from "../src/birth-general-spec.js";

const legacySpec = {
	version: 1,
	projectId: "idu-pi",
	status: "approved",
	derivedFrom: ["project-core", "master-plan", "prototype-master"],
	navigation: ["header"],
	baseComponents: ["Button"],
	pageStructureRules: ["every page declares a layout"],
	dataRules: ["no secrets in client state"],
	interactionRules: ["confirm before destructive actions"],
	motionRules: ["respect prefers-reduced-motion"],
	accessibilityCriteria: ["keyboard reachable"],
	performanceCriteria: ["TTI under 3s"],
	approvedBy: "reviewer-1",
	approvedAt: "2026-06-12T00:00:00.000Z",
};

test("normalizeBirthGeneralSpec defaults absent specVersion to 1", () => {
	const spec = normalizeBirthGeneralSpec(legacySpec);

	assert.equal(spec.specVersion, 1);
	assert.deepEqual(spec.provenance, {});
	assert.deepEqual(spec.evidence, {});
});

test("normalizeBirthGeneralSpec preserves explicit specVersion", () => {
	const spec = normalizeBirthGeneralSpec({ ...legacySpec, specVersion: 3 });

	assert.equal(spec.specVersion, 3);
});

test("normalizeBirthGeneralSpec rejects invalid specVersion values to default 1", () => {
	assert.equal(
		normalizeBirthGeneralSpec({ ...legacySpec, specVersion: NaN }).specVersion,
		1,
	);
	assert.equal(
		normalizeBirthGeneralSpec({ ...legacySpec, specVersion: null }).specVersion,
		1,
	);
	assert.equal(normalizeBirthGeneralSpec({ ...legacySpec }).specVersion, 1);
});

test("normalizeBirthGeneralSpec preserves numeric specVersion zero", () => {
	const spec = normalizeBirthGeneralSpec({ ...legacySpec, specVersion: 0 });

	assert.equal(spec.specVersion, 0);
});

test("normalizeBirthGeneralSpec works for enrolled-project general-spec artifact", async () => {
	const stateRoot = await mkdtempForTest("birth-general-spec-");
	const birthDir = join(stateRoot, "birth");
	await mkdir(birthDir, { recursive: true });
	const specPath = join(birthDir, "general-spec.json");
	await writeFile(specPath, JSON.stringify(legacySpec), "utf8");

	const raw = JSON.parse(await readFile(specPath, "utf8"));
	const spec = normalizeBirthGeneralSpec(raw);

	assert.equal(spec.specVersion, 1);
	assert.deepEqual(spec.provenance, {});
	assert.deepEqual(spec.evidence, {});
});

async function mkdtempForTest(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}
