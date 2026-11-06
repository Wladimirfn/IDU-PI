/**
 * Helpers for values caught by `catch`.
 *
 * A `catch` clause binds `unknown` under strict TypeScript, which is correct:
 * anything can be thrown. Reading `.code` or `.message` off it needs a guard,
 * and this is that guard, in one place instead of an `any` cast per catch.
 */

/** Node system errors carry a string `code` (EPERM, ESRCH, EEXIST, ...). */
export function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

/** Message of an Error, or a stringified value for anything else thrown. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
