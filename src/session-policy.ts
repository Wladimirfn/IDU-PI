import type { SessionTreeEntry } from "./types.js";

/**
 * The cap the runner actually enforces, resolved exactly the way the runner
 * resolves it when it builds a `RunnerSpec`.
 *
 * `getStatus` must not re-derive this as `hardCapMs ?? timeoutMs`, and an
 * earlier version of this file did. That re-derivation was a real bug and it
 * was found by adversarial review: the runner gives a profile with no
 * explicit `hardCapMs` a floor of four hours, while `?? timeoutMs` closed
 * the record at `timeoutMs`, which is thirty minutes on the default
 * profiles. So merely *reading* a healthy run past the thirty minute mark
 * would declare it failed and persist that, killing a worker the runner was
 * still perfectly happy to keep. A reader must never be more eager than the
 * thing it is reading about.
 *
 * Returns 0 for "no cap", which is the sentinel the runner already uses for
 * an explicitly disabled cap.
 */
export function resolveHardCapMs(input: {
	requestTimeoutMs?: number;
	profileHardCapMs?: number;
	profileTimeoutMs?: number;
}): number {
	if (input.requestTimeoutMs === 0 || input.profileHardCapMs === 0) return 0;
	if (input.profileHardCapMs !== undefined) return input.profileHardCapMs;
	// The runner substitutes config.defaultTimeoutMs here. Omitting it does not
	// change the result, because the floor below is larger than that default
	// and than any timeout a profile is shipped with.
	return Math.max(input.requestTimeoutMs ?? input.profileTimeoutMs ?? 0, 14_400_000);
}

/**
 * Decide which profile a delegate request must actually use.
 *
 * A session is owned by the profile that created it. When the caller resumes
 * a session WITHOUT naming a profile, the session's own profile wins over the
 * caller's global default, so a resume can never silently land on a different
 * CLI than the one holding the conversation.
 *
 * Pure: no I/O, so it is directly unit-testable.
 */
export function resolveSessionProfile(
	requestedProfile: string,
	owner: Pick<SessionTreeEntry, "profile"> | undefined,
	opts: { profileExplicit?: boolean; fork?: boolean },
): { profileName: string; inherited: boolean } {
	if (owner?.profile && !opts.profileExplicit && !opts.fork && owner.profile !== requestedProfile) {
		return { profileName: owner.profile, inherited: true };
	}
	return { profileName: requestedProfile, inherited: false };
}

/**
 * Harness-affinity guard for resuming a session.
 *
 * Returns null when the resume is legitimate, or a message explaining why it
 * was refused. Cross-harness resumes are refused because the incoming CLI
 * cannot read a transcript it never wrote: the native session id is silently
 * dropped and the run degrades to a fresh conversation while still being
 * billed against the original session.
 *
 * Pure: no I/O, so it is directly unit-testable.
 */
export function checkSessionHarnessAffinity(
	owner: Pick<SessionTreeEntry, "harness" | "profile"> | undefined,
	sessionId: string,
	target: { harness: string; profileName: string },
	force = false,
): string | null {
	if (!owner?.harness || !target.harness) return null;
	if (owner.harness === target.harness) return null;
	if (force) return null;
	return (
		`SESSION HARNESS MISMATCH: session "${sessionId}" was created by harness "${owner.harness}" ` +
		`(profile "${owner.profile}") but profile "${target.profileName}" uses harness "${target.harness}". ` +
		`Resuming across harnesses would discard native session continuity and corrupt the turn count. ` +
		`Re-run with the session's own profile ("${owner.profile}"), omit the profile to inherit it, ` +
		`or pass --force to override deliberately.`
	);
}

/**
 * Whether a finished run counts as a conversational turn.
 *
 * A run that failed or timed out is an audited attempt, not a turn: it must
 * not advance turnCount nor bind a native session id that the CLI never
 * accepted. Pure, so it is directly unit-testable.
 */
export function shouldCountTurn(exitCode: number | null, status: string): boolean {
	return exitCode === 0 && status !== "timeout";
}
