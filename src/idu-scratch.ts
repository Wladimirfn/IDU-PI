/**
 * idu-scratch.ts — territory primitives for the self-hygiene feature.
 *
 * idu-pi only writes to two roots:
 *   1. stateRoot/**  — runtime state, scratch, and a synced copy of governance
 *   2. <repoRoot>/.idu/**  — governance and project skills (versioned)
 *
 * This module exposes the assertion helpers that enforce the territory model
 * by construction. Every writer that needs to leave stateRoot calls
 * `assertAllowedWrite` before `writeFileSync`. The test in
 * `test/writer-migration.test.ts` (the "writer territory" and
 * "NEGATIVE (auditor-required)" tests) is the regression guard.
 *
 * The active-rejection behavior (NEGATIVE test, auditor-required): a write
 * outside both roots is REJECTED — `assertAllowedWrite` throws
 * `ScratchPathError`, never silently allows.
 */

import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export class ScratchPathError extends Error {
	constructor(
		public readonly path: string,
		public readonly allowedRoot: string,
		public readonly actualLocation: string,
	) {
		super(
			`ScratchPathError: path "${path}" is not under allowed root "${allowedRoot}". ` +
				`Actual location: "${actualLocation}". ` +
				`idu-pi only writes under stateRoot/** or <repo>/.idu/**. ` +
				`Use the scratch helper or restructure the write.`,
		);
		this.name = "ScratchPathError";
	}
}

/** Resolve a scratch path under <stateRoot>/tmp/<name>. */
export function scratchPath(stateRoot: string, name: string): string {
	if (
		!name ||
		name.includes("..") ||
		name.includes("/") ||
		name.includes("\\")
	) {
		throw new Error(`scratchPath: invalid name "${name}"`);
	}
	return join(stateRoot, "tmp", name);
}

/** Ensure <stateRoot>/tmp exists; return the absolute path. */
export function ensureScratchDir(stateRoot: string): string {
	const dir = join(stateRoot, "tmp");
	mkdirSync(dir, { recursive: true });
	return resolve(dir);
}

/** Throws if the given absolute path is not under stateRoot. */
export function assertUnderStateRoot(
	absolutePath: string,
	stateRoot: string,
): void {
	if (!isAbsolute(absolutePath)) {
		throw new Error(
			`assertUnderStateRoot: path must be absolute, got "${absolutePath}"`,
		);
	}
	const normPath = normalizePath(absolutePath);
	const normRoot = normalizePath(resolve(stateRoot));
	if (!isUnder(normPath, normRoot)) {
		throw new ScratchPathError(absolutePath, normRoot, normPath);
	}
}

/**
 * Throws if the given absolute path is not under stateRoot OR under
 * <repoRoot>/<allowRepoDir>. Default allowRepoDir is ".idu".
 *
 * Auditor-required active rejection: this helper does not silently allow a
 * write that lands outside the allowed roots. It throws `ScratchPathError`.
 */
export function assertAllowedWrite(
	absolutePath: string,
	options: { stateRoot: string; repoRoot: string; allowRepoDir?: string },
): void {
	if (!isAbsolute(absolutePath)) {
		throw new Error(
			`assertAllowedWrite: path must be absolute, got "${absolutePath}"`,
		);
	}
	const allowDir = options.allowRepoDir ?? ".idu";
	const stateRootNorm = normalizePath(resolve(options.stateRoot));
	const iduDirNorm = normalizePath(resolve(options.repoRoot, allowDir));
	const normPath = normalizePath(absolutePath);
	if (!isUnder(normPath, stateRootNorm) && !isUnder(normPath, iduDirNorm)) {
		throw new ScratchPathError(
			absolutePath,
			`${stateRootNorm} or ${iduDirNorm}`,
			normPath,
		);
	}
}

function normalizePath(p: string): string {
	// Resolve to absolute, normalize separators, strip trailing slashes.
	// We do NOT call realpathSync because that resolves symlinks and we
	// want to assert the literal path the writer passed in.
	return resolve(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

function isUnder(child: string, parent: string): boolean {
	return child === parent || child.startsWith(parent + "/");
}
