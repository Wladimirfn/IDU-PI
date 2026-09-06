import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SAFE_ARTIFACT_NAME = /^[a-z0-9_-]+$/u;

export type BirthArtifactName =
	| "status"
	| "intake"
	| "existing-scan"
	| "detected-specs"
	| "bibliotecario-discovery"
	| "blueprint"
	| "mission-draft"
	| "prototype-master"
	| "general-spec"
	| "repo-plan"
	| "validation-report";

export function resolveBirthArtifactPath(
	stateRoot: string,
	artifactName: string,
): string {
	assertSafeArtifactName(artifactName);
	return join(stateRoot, "birth", `${artifactName}.json`);
}

export function writeBirthArtifact(
	stateRoot: string,
	artifactName: string,
	value: unknown,
): string {
	const path = resolveBirthArtifactPath(stateRoot, artifactName);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	return path;
}

export function readBirthArtifact<T = unknown>(
	stateRoot: string,
	artifactName: string,
): T | undefined {
	const path = resolveBirthArtifactPath(stateRoot, artifactName);
	if (!existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf8");
		if (!raw.trim()) return undefined;
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

export function assertSafeArtifactName(name: string): void {
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(`invalid artifact name: ${JSON.stringify(name)}`);
	}
	if (name.includes("..") || name.includes("/") || name.includes("\\")) {
		throw new Error(`invalid artifact name: ${JSON.stringify(name)}`);
	}
	if (!SAFE_ARTIFACT_NAME.test(name)) {
		throw new Error(`invalid artifact name: ${JSON.stringify(name)}`);
	}
}
