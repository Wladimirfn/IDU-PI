import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	invalidateMasterPlanObjectiveCache,
	resolveMasterPlanObjectiveCachePath,
} from "../src/master-plan-objective-cache.js";

function makeStateRoot(): { stateRoot: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "idu-mpoc-"));
	return {
		stateRoot: root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("invalidateMasterPlanObjectiveCache borra el cache si existe", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const path = resolveMasterPlanObjectiveCachePath(stateRoot);
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		writeFileSync(path, '{"version":1}', "utf8");
		assert.ok(existsSync(path));
		const r = invalidateMasterPlanObjectiveCache(stateRoot);
		assert.equal(r.invalidated, true);
		assert.equal(existsSync(path), false);
	} finally {
		cleanup();
	}
});

test("invalidateMasterPlanObjectiveCache es no-op si el cache no existe", () => {
	const { stateRoot, cleanup } = makeStateRoot();
	try {
		const r = invalidateMasterPlanObjectiveCache(stateRoot);
		assert.equal(r.invalidated, false);
	} finally {
		cleanup();
	}
});

test("invalidateMasterPlanObjectiveCache rechaza stateRoot inválido", () => {
	assert.throws(
		() => invalidateMasterPlanObjectiveCache(""),
		/stateRoot inválido/,
	);
	assert.throws(
		() => invalidateMasterPlanObjectiveCache("foo/../../etc"),
		/stateRoot inválido/,
	);
});
