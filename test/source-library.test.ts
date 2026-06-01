import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import {
	addSourceLibraryItem,
	getSourceLibraryStatus,
	refreshSourceLibrary,
	sourceLibraryPaths,
} from "../src/source-library.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "source-library-"));
}

function now(): Date {
	return new Date("2026-06-01T12:00:00.000Z");
}

test("status reports missing then add copies manual markdown only into stateRoot", () => {
	const temp = root();
	try {
		const repo = join(temp, "repo");
		const stateRoot = join(temp, "state", "projects", "demo");
		mkdirSync(repo, { recursive: true });
		const source = join(repo, "manual.md");
		writeFileSync(source, "# Manual\nReglas humanas", "utf8");

		const missing = getSourceLibraryStatus({ stateRoot, projectId: "Demo" });
		assert.equal(missing.state, "missing");

		const result = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: source,
			now,
		});
		assert.equal(result.state, "ready");
		assert.deepEqual(result.unindexedLocalFiles, []);
		assert.equal(result.addedSource?.contractPromotionAllowed, false);
		assert.equal(result.addedSource?.kind, "markdown");
		assert.ok(result.addedSource?.extractedTextPath);
		assert.ok(existsSync(result.paths.indexPath));
		assert.ok(
			existsSync(join(result.paths.root, result.addedSource!.storedPath)),
		);
		assert.ok(
			existsSync(
				join(result.paths.root, result.addedSource!.extractedTextPath!),
			),
		);
		assert.equal(existsSync(join(repo, "source-index.json")), false);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("pdf is copied and registered without text snapshot", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const pdf = join(temp, "manual.pdf");
		writeFileSync(pdf, "%PDF-1.4 fake", "utf8");
		const result = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: pdf,
			now,
		});
		assert.equal(result.addedSource?.kind, "pdf");
		assert.equal(result.addedSource?.extractedTextPath, undefined);
		assert.ok(
			existsSync(join(result.paths.root, result.addedSource!.storedPath)),
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("add rejects missing files, directories, and unsupported extensions", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		assert.throws(
			() =>
				addSourceLibraryItem({
					stateRoot,
					projectId: "Demo",
					inputPath: join(temp, "missing.md"),
				}),
			/Fuente no encontrada/u,
		);
		assert.throws(
			() =>
				addSourceLibraryItem({ stateRoot, projectId: "Demo", inputPath: temp }),
			/debe ser un archivo/u,
		);
		const exe = join(temp, "tool.exe");
		writeFileSync(exe, "bin", "utf8");
		assert.throws(
			() =>
				addSourceLibraryItem({ stateRoot, projectId: "Demo", inputPath: exe }),
			/no soportado/u,
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("status detects stale and refresh persists recalculated status", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const text = join(temp, "notes.txt");
		writeFileSync(text, "v1", "utf8");
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: text,
			now,
		});
		const stored = join(added.paths.root, added.addedSource!.storedPath);
		writeFileSync(stored, "v2", "utf8");

		const stale = getSourceLibraryStatus({ stateRoot, projectId: "Demo" });
		assert.deepEqual(stale.unindexedLocalFiles, []);
		assert.equal(stale.state, "stale");
		assert.deepEqual(stale.staleSources, [added.addedSource!.id]);

		const refreshed = refreshSourceLibrary({
			stateRoot,
			projectId: "Demo",
			now,
		});
		assert.equal(refreshed.state, "stale");
		assert.equal(refreshed.sources[0]?.status, "stale");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("legacy source-index is normalized and preserved when adding sources", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const paths = sourceLibraryPaths(stateRoot, "Demo");
		mkdirSync(paths.root, { recursive: true });
		writeFileSync(
			paths.indexPath,
			`${JSON.stringify(
				{
					version: 1,
					projectId: "Demo",
					updatedAt: "2026-06-01T00:00:00.000Z",
					purpose: "legacy normative source index",
					localSources: [{ id: "manual", status: "active" }],
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		assert.equal(
			getSourceLibraryStatus({ stateRoot, projectId: "Demo" }).state,
			"empty",
		);

		const source = join(temp, "manual.txt");
		writeFileSync(source, "manual", "utf8");
		const added = addSourceLibraryItem({
			stateRoot,
			projectId: "Demo",
			inputPath: source,
			now,
		});
		assert.equal(added.state, "ready");
		const saved = JSON.parse(readFileSync(paths.indexPath, "utf8")) as {
			purpose?: string;
			localSources?: unknown[];
			contractPromotionAllowed?: boolean;
			sources?: unknown[];
		};
		assert.equal(saved.purpose, "legacy normative source index");
		assert.equal(saved.localSources?.length, 1);
		assert.equal(saved.contractPromotionAllowed, false);
		assert.equal(saved.sources?.length, 1);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("invalid and empty index states are explicit", () => {
	const temp = root();
	try {
		const stateRoot = join(temp, "state", "projects", "demo");
		const paths = sourceLibraryPaths(stateRoot, "Demo");
		mkdirSync(paths.root, { recursive: true });
		writeFileSync(paths.indexPath, "{}\n", "utf8");
		assert.equal(
			getSourceLibraryStatus({ stateRoot, projectId: "Demo" }).state,
			"invalid",
		);

		writeFileSync(
			paths.indexPath,
			`${JSON.stringify({ version: 1, projectId: "Demo", updatedAt: "2026-06-01T00:00:00.000Z", contractPromotionAllowed: false, sources: [] }, null, 2)}\n`,
			"utf8",
		);
		assert.equal(
			getSourceLibraryStatus({ stateRoot, projectId: "Demo" }).state,
			"empty",
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
