/**
 * G4 — Spec propagation (living document).
 *
 * Pure predicate `isDesignSkillStale` decides whether a design skill needs
 * re-derivation based on specVersion vs derivedFromSpecVersion.
 * `ensureDesignSkillForVersion` calls rederive exactly once per specVersion
 * (idempotent within the same in-process cache), and never modifies specVersion.
 */

export type VersionedSpec = {
	specVersion?: number;
};

export type DerivedDesignSkill = {
	derivedFromSpecVersion: number;
};

const servedVersions = new Set<number>();

export function isDesignSkillStale(input: {
	spec: VersionedSpec;
	skill: DerivedDesignSkill;
}): boolean {
	const specVersion = input.spec.specVersion ?? 1;
	const derived = input.skill.derivedFromSpecVersion;
	// Stale only when derived < spec. derived >= spec is treated as fresh
	// (prevents false re-derivation on rollback).
	return derived < specVersion;
}

export async function ensureDesignSkillForVersion(input: {
	spec: VersionedSpec;
	skill: DerivedDesignSkill;
	rederive: () => Promise<void>;
}): Promise<void> {
	const specVersion = input.spec.specVersion ?? 1;
	if (!isDesignSkillStale(input)) return;
	if (servedVersions.has(specVersion)) return;
	await input.rederive();
	servedVersions.add(specVersion);
}

export function _resetServedVersionsForTests(): void {
	servedVersions.clear();
}
