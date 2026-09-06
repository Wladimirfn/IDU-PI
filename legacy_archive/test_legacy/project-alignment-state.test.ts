import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	projectAlignmentStatePath,
	readProjectAlignmentState,
	recordProjectAlignmentState,
} from "../src/project-alignment-state.js";

test("alignment state writes under stateRoot reports and reads matching project", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alignment-state-"));
	try {
		const stateRoot = join(root, "state");
		const recorded = recordProjectAlignmentState(stateRoot, {
			projectId: "idu-pi",
			projectPath: join(root, "project"),
			alignmentStatus: "aligned",
			readiness: "aligned_ready",
			alignmentReason: ["último prepare: Proyecto preparado"],
			differencesDetected: {
				screens: 0,
				uiElements: 0,
				dataStores: 0,
				flows: 0,
			},
			recordedAt: "2026-06-05T00:00:00.000Z",
		});

		assert.equal(
			existsSync(projectAlignmentStatePath(stateRoot)),
			true,
		);
		assert.equal(recorded.version, 1);
		const read = readProjectAlignmentState(stateRoot, {
			projectId: "idu-pi",
			projectPath: join(root, "project"),
		});
		assert.equal(read?.alignmentStatus, "aligned");
		assert.equal(read?.readiness, "aligned_ready");
		assert.deepEqual(read?.alignmentReason, ["último prepare: Proyecto preparado"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("alignment state ignores mismatched project", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-alignment-state-"));
	try {
		const stateRoot = join(root, "state");
		recordProjectAlignmentState(stateRoot, {
			projectId: "idu-pi",
			projectPath: join(root, "project"),
			alignmentStatus: "aligned",
			readiness: "aligned_ready",
			alignmentReason: ["último prepare"],
		});

		assert.equal(
			readProjectAlignmentState(stateRoot, {
				projectId: "other",
				projectPath: join(root, "project"),
			}),
			undefined,
		);
		assert.equal(
			readProjectAlignmentState(stateRoot, {
				projectId: "idu-pi",
				projectPath: join(root, "other-project"),
			}),
			undefined,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
