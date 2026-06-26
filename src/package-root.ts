import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the idu-pi package root by walking up from this module's location
 * until a directory containing `package.json` is found. Works in BOTH source
 * (src/) and compiled (dist/src/) contexts without modification.
 *
 * This is the canonical package-root resolver. Future consolidation of
 * `resolveCliPackageRoot` (cli-home.ts:832) and `PACKAGE_ROOT` (config-wizard.ts:158)
 * should migrate to this helper.
 */
export function resolvePackageRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	while (!existsSync(join(dir, "package.json")) && dir !== dirname(dir)) {
		dir = dirname(dir);
	}
	return dir;
}
