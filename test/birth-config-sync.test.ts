import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncProjectConfigToStateRoot } from "../src/birth-config-sync.js";

function makeFixture(): { repoRoot: string; stateRoot: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "idu-bcs-"));
	const repoRoot = join(dir, "repo");
	const stateRoot = join(dir, "state");
	mkdirSync(join(repoRoot, ".idu", "config"), { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	return { repoRoot, stateRoot, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("syncProjectConfigToStateRoot copia project-core.json y project-constitution.json", () => {
	const { repoRoot, stateRoot, cleanup } = makeFixture();
	try {
		writeFileSync(join(repoRoot, ".idu", "config", "project-core.json"), JSON.stringify({ status: "confirmed" }));
		writeFileSync(
			join(repoRoot, ".idu", "config", "project-constitution.json"),
			JSON.stringify({ status: "active" }),
		);
		const r = syncProjectConfigToStateRoot({ repoRoot, stateRoot });
		assert.equal(r.copied, 2);
		assert.equal(r.skipped, 0);
		assert.equal(
			readFileSync(join(stateRoot, "config", "project-core.json"), "utf8"),
			JSON.stringify({ status: "confirmed" }),
		);
		assert.equal(
			readFileSync(join(stateRoot, "config", "project-constitution.json"), "utf8"),
			JSON.stringify({ status: "active" }),
		);
	} finally {
		cleanup();
	}
});

test("syncProjectConfigToStateRoot es idempotente (mismo contenido no copia de nuevo)", () => {
	const { repoRoot, stateRoot, cleanup } = makeFixture();
	try {
		writeFileSync(join(repoRoot, ".idu", "config", "project-core.json"), JSON.stringify({ status: "confirmed" }));
		const r1 = syncProjectConfigToStateRoot({ repoRoot, stateRoot });
		const r2 = syncProjectConfigToStateRoot({ repoRoot, stateRoot });
		assert.equal(r1.copied, 1);
		assert.equal(r1.skipped, 0);
		assert.equal(r2.copied, 0);
		assert.equal(r2.skipped, 1);
	} finally {
		cleanup();
	}
});

test("syncProjectConfigToStateRoot no falla si config/ no existe", () => {
	const { repoRoot, stateRoot, cleanup } = makeFixture();
	try {
		// No files in repoRoot/config
		const r = syncProjectConfigToStateRoot({ repoRoot, stateRoot });
		assert.equal(r.copied, 0);
	} finally {
		cleanup();
	}
});

test("syncProjectConfigToStateRoot rechaza path traversal en stateRoot", () => {
	const { repoRoot, stateRoot, cleanup } = makeFixture();
	try {
		assert.throws(
			() => syncProjectConfigToStateRoot({ repoRoot, stateRoot: stateRoot + "/../../../etc" }),
			/stateRoot inválido/,
		);
	} finally {
		cleanup();
	}
});
