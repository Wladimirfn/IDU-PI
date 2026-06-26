import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the idu-pi package root from the location of this module.
 *
 * Works in the COMPILED context (`dist/src/package-root.js`): the regex
 * strips the trailing `/dist/src` segment and returns the package root.
 *
 * SOURCE-CONTEXT LIMITATION: when loaded from `src/package-root.ts` (e.g.
 * via `tsx`, Vitest against source, or any non-compiled loader), `dirname`
 * yields `<pkg>/src/` and the regex does NOT match, so the result is
 * `<pkg>/src/` instead of `<pkg>/`. Callers must ensure they run against
 * the compiled `dist/` output. `npm test` does this by invoking
 * `node --test dist/test/*.test.js`, so the R2.2 hermetic tests are
 * compatible with this helper as long as the test suite keeps running
 * against `dist/`.
 *
 * This limitation matches the pre-existing `resolvePackageRootForTelegram`
 * (src/index.ts:582) and `PACKAGE_ROOT` (src/config-wizard.ts:158) which
 * also rely on compiled-context geometry.
 */
export function resolvePackageRoot(): string {
	return dirname(fileURLToPath(import.meta.url)).replace(
		/[\\/]dist[\\/]src$/u,
		"",
	);
}
