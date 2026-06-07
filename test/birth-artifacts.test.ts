import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	readBirthArtifact,
	resolveBirthArtifactPath,
	writeBirthArtifact,
} from "../src/birth-artifacts.js";

function makeTmpStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-birth-"));
}

test("resolveBirthArtifactPath joins stateRoot and birth/<name>.json", () => {
	const root = makeTmpStateRoot();
	try {
		const p = resolveBirthArtifactPath(root, "status");
		assert.equal(p, join(root, "birth", "status.json"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("writeBirthArtifact creates the birth/ directory and writes JSON", () => {
	const root = makeTmpStateRoot();
	try {
		writeBirthArtifact(root, "status", {
			version: 1,
			projectId: "idu-pi",
			state: "not_started",
		});
		const stat = statSync(join(root, "birth", "status.json"));
		assert.ok(stat.isFile());
		const back = readBirthArtifact<{ projectId: string }>(root, "status");
		assert.equal(back?.projectId, "idu-pi");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readBirthArtifact returns undefined when missing", () => {
	const root = makeTmpStateRoot();
	try {
		assert.equal(readBirthArtifact(root, "status"), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readBirthArtifact returns undefined for malformed JSON", () => {
	const root = makeTmpStateRoot();
	try {
		mkdirSync(join(root, "birth"), { recursive: true });
		writeFileSync(
			join(root, "birth", "status.json"),
			"{ not valid json",
			"utf8",
		);
		assert.equal(readBirthArtifact(root, "status"), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("writeBirthArtifact rejects path traversal in artifact name", () => {
	const root = makeTmpStateRoot();
	try {
		assert.throws(
			() => writeBirthArtifact(root, "../../../etc/passwd", { ok: true }),
			/invalid artifact name/i,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readBirthArtifact rejects path traversal in artifact name", () => {
	const root = makeTmpStateRoot();
	try {
		assert.throws(
			() => readBirthArtifact(root, "../outside"),
			/invalid artifact name/i,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
