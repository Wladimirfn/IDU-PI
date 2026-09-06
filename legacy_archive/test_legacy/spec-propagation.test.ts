import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
	_resetServedVersionsForTests,
	ensureDesignSkillForVersion,
	isDesignSkillStale,
	type DerivedDesignSkill,
	type VersionedSpec,
} from "../src/spec-propagation.js";

beforeEach(() => {
	_resetServedVersionsForTests();
});

test("isDesignSkillStale returns true when skill derivedFromSpecVersion < spec specVersion", () => {
	const spec: VersionedSpec = { specVersion: 3 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 2 };
	assert.equal(isDesignSkillStale({ spec, skill }), true);
});

test("isDesignSkillStale returns false when skill derivedFromSpecVersion === spec specVersion", () => {
	const spec: VersionedSpec = { specVersion: 3 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 3 };
	assert.equal(isDesignSkillStale({ spec, skill }), false);
});

test("isDesignSkillStale treats D > V as fresh to prevent false re-derivation on rollback", () => {
	const spec: VersionedSpec = { specVersion: 3 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 4 };
	assert.equal(isDesignSkillStale({ spec, skill }), false);
});

test("isDesignSkillStale treats absent specVersion as N=1", () => {
	const spec: VersionedSpec = {};
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 1 };
	assert.equal(isDesignSkillStale({ spec, skill }), false);
});

test("ensureDesignSkillForVersion calls rederive exactly once when stale", async () => {
	const spec: VersionedSpec = { specVersion: 2 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 1 };
	let rederiveCalls = 0;
	let writtenVersion: number | undefined;

	await ensureDesignSkillForVersion({
		spec,
		skill,
		rederive: async () => {
			rederiveCalls++;
			writtenVersion = spec.specVersion;
		},
	});

	assert.equal(rederiveCalls, 1);
	assert.equal(writtenVersion, 2);
});

test("ensureDesignSkillForVersion does not call rederive when fresh", async () => {
	const spec: VersionedSpec = { specVersion: 2 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 2 };
	let rederiveCalls = 0;

	await ensureDesignSkillForVersion({
		spec,
		skill,
		rederive: async () => {
			rederiveCalls++;
		},
	});

	assert.equal(rederiveCalls, 0);
});

test("ensureDesignSkillForVersion is idempotent for the same version within the same in-process cache", async () => {
	const spec: VersionedSpec = { specVersion: 2 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 1 };
	let rederiveCalls = 0;

	await ensureDesignSkillForVersion({
		spec,
		skill,
		rederive: async () => {
			rederiveCalls++;
		},
	});
	await ensureDesignSkillForVersion({
		spec,
		skill,
		rederive: async () => {
			rederiveCalls++;
		},
	});

	assert.equal(rederiveCalls, 1);
});

test("ensureDesignSkillForVersion does not modify specVersion in the spec", async () => {
	const spec: VersionedSpec = { specVersion: 2 };
	const skill: DerivedDesignSkill = { derivedFromSpecVersion: 1 };

	await ensureDesignSkillForVersion({
		spec,
		skill,
		rederive: async () => {},
	});

	assert.equal(spec.specVersion, 2);
});
