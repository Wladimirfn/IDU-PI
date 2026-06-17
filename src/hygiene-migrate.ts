/**
 * hygiene-migrate.ts — one-time migration from legacy <repo>/config/ to
 * <repo>/.idu/config/ (and <repo>/skills/ to <repo>/.idu/skills/).
 *
 * The migration is governed by the territory model: idu-pi only moves what
 * its own manifest says it owns. For config files, that's a fixed list of
 * 4 governance files. For skills, the migration is by manifest — read
 * skills.json, enumerate only the skills it lists, move each one
 * recursively. Anything else in <repo>/skills/ is the user's and is
 * left alone.
 *
 * Atomic on the same filesystem (renameSync). Cross-device fallback uses
 * cpSync recursive + rmSync recursive (NOT copyFileSync, which is
 * file-only and would break for dirs).
 *
 * The migration is idempotent. Running it twice does not double-move.
 * If <repo>/.idu/ already exists, the legacy is left untouched and the
 * user is told to reconcile manually.
 */

import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Exact 4 governance files (auditor-approved, no more, no less). */
const LEGACY_CONFIG_FILES = [
	"project-core.json",
	"project-constitution.json",
	"project-blueprint.json",
	"project-flows.json",
] as const;

export type MovedEntry = { from: string; to: string };
export type SkippedEntry = { from: string; reason: string };
export type ErrorEntry = { from: string; message: string };

export type MigrationResult = {
	moved: MovedEntry[];
	skipped: SkippedEntry[];
	errors: ErrorEntry[];
};

export function migrateHygieneLayout(input: {
	repoRoot: string;
	stateRoot: string;
	now?: Date;
}): MigrationResult {
	const iduConfigDir = join(input.repoRoot, ".idu", "config");
	const iduSkillsDir = join(input.repoRoot, ".idu", "skills");
	const legacyConfigDir = join(input.repoRoot, "config");
	const legacySkillsDir = join(input.repoRoot, "skills");

	const result: MigrationResult = { moved: [], skipped: [], errors: [] };

	// 1. Config: fixed list (exact 4 governance files, no more, no less).
	if (existsSync(iduConfigDir)) {
		result.skipped.push({
			from: legacyConfigDir,
			reason: ".idu/config/ already exists; manual reconciliation required",
		});
	} else {
		for (const file of LEGACY_CONFIG_FILES) {
			const from = join(legacyConfigDir, file);
			const to = join(iduConfigDir, file);
			if (!existsSync(from)) continue;
			try {
				safeMove(from, to);
				result.moved.push({ from, to });
			} catch (err) {
				result.errors.push({ from, message: (err as Error).message });
			}
		}
		// If the legacy config dir is now empty, remove it. If the user has
		// other files in there, we leave it alone (those are the user's).
		tryRmdirIfEmpty(legacyConfigDir);
	}

	// 2. Skills: by manifest. Read skills.json, enumerate only the skills
	// it lists, move each one recursively. Leave non-listed dirs intact.
	if (existsSync(iduSkillsDir)) {
		result.skipped.push({
			from: legacySkillsDir,
			reason: ".idu/skills/ already exists; manual reconciliation required",
		});
	} else {
		const manifestPath = join(legacySkillsDir, "skills.json");
		if (existsSync(manifestPath)) {
			try {
				const manifestRaw = readFileSync(manifestPath, "utf8");
				const manifest = JSON.parse(manifestRaw) as { skills?: unknown };
				const skillNames = extractSkillNames(manifest);
				// Move each skill dir recursively
				for (const name of skillNames) {
					if (!name) continue;
					const from = join(legacySkillsDir, name);
					const to = join(iduSkillsDir, name);
					if (!existsSync(from)) continue;
					try {
						const stat = statSync(from);
						if (!stat.isDirectory()) continue;
						safeMove(from, to);
						result.moved.push({ from, to });
					} catch (err) {
						result.errors.push({ from, message: (err as Error).message });
					}
				}
				// Then move the manifest itself
				const manifestTo = join(iduSkillsDir, "skills.json");
				try {
					safeMove(manifestPath, manifestTo);
					result.moved.push({ from: manifestPath, to: manifestTo });
				} catch (err) {
					result.errors.push({ from: manifestPath, message: (err as Error).message });
				}
				// .gitkeep is created by initProjectAssets, so it is idu-pi-owned.
				const gitkeep = join(legacySkillsDir, ".gitkeep");
				if (existsSync(gitkeep)) {
					try {
						const gitkeepTo = join(iduSkillsDir, ".gitkeep");
						safeMove(gitkeep, gitkeepTo);
						result.moved.push({ from: gitkeep, to: gitkeepTo });
					} catch (err) {
						result.errors.push({ from: gitkeep, message: (err as Error).message });
					}
				}
			} catch (err) {
				result.errors.push({
					from: manifestPath,
					message: `manifest parse failed: ${(err as Error).message}`,
				});
			}
		}
		// If the legacy skills dir is now empty, remove it. If the user has
		// other files/dirs in there (non-listed, non-manifest), we leave them.
		tryRmdirIfEmpty(legacySkillsDir);
	}

	// 3. Log to events
	appendToEventsLog(input.stateRoot, {
		kind: "hygiene_migration",
		ts: (input.now ?? new Date()).toISOString(),
		moved: result.moved,
		skipped: result.skipped,
		errors: result.errors,
	});

	return result;
}

/**
 * Extract skill names from a skills.json manifest. Supports both shapes:
 * - { skills: [{ name: "foo" }, ...] } (array of objects)
 * - { skills: { foo: {...}, bar: {...} } } (object map)
 */
function extractSkillNames(manifest: { skills?: unknown }): string[] {
	if (!manifest.skills) return [];
	if (Array.isArray(manifest.skills)) {
		return manifest.skills
			.map((s) => {
				if (typeof s === "object" && s !== null && "name" in s) {
					return String((s as { name: unknown }).name);
				}
				return "";
			})
			.filter((n) => n.length > 0);
	}
	if (typeof manifest.skills === "object" && manifest.skills !== null) {
		return Object.keys(manifest.skills as Record<string, unknown>);
	}
	return [];
}

/**
 * Safe move that handles both files and dirs. Atomic rename on the same
 * filesystem; cpSync recursive + rmSync recursive on cross-device (EXDEV).
 * NOT copyFileSync — that is file-only and breaks for dirs.
 */
function safeMove(from: string, to: string): void {
	mkdirSync(dirname(to), { recursive: true });
	try {
		renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EXDEV") {
			// Cross-device. cpSync handles both files and dirs (recursive).
			cpSync(from, to, { recursive: true });
			rmSync(from, { recursive: true, force: true });
			return;
		}
		throw err;
	}
}

function appendToEventsLog(stateRoot: string, event: Record<string, unknown>): void {
	const eventsPath = join(stateRoot, "events.jsonl");
	mkdirSync(stateRoot, { recursive: true });
	appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

/** Remove a directory if it is empty. If it has other content, leave it. */
function tryRmdirIfEmpty(dir: string): void {
	if (!existsSync(dir)) return;
	try {
		rmdirSync(dir);
	} catch {
		// Not empty, or not a dir, or no permission. Leave it.
	}
}
