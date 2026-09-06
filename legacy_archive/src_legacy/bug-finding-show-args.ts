/**
 * bug-finding-show-args.ts — pure parser for the
 * `/idu_bug_finding_show <id>` Telegram command.
 *
 * The bot handler in src/index.ts uses this instead of inlining
 * the parsing so the parsing is testable directly. Source-grep
 * tests (regex against `src/index.ts`) pass when broken and fail
 * when working — see #468 for the case and the audit.
 *
 * The function is a thin layer over the regex shape that
 * `commandArg` (src/index.ts:733) uses. Telegram appends `@BotName`
 * to the command when the message comes from a group, so the
 * parser must accept the optional `@BotName` suffix; otherwise
 * the handler falls through to "Uso: ..." in groups. The owner
 * verified this hole is reachable: `isAllowedUser` filters by
 * user, not by chat, so writing to the bot from a group is
 * allowed.
 *
 * Returns the id (first whitespace-separated token after the
 * command) or null when the message has no id. Extra tokens are
 * silently dropped — the bot handler will surface a "no existe
 * la fila" error if the id doesn't match, which is the right
 * signal for typos and partial pastes from the alert.
 *
 *   parseBugFindingShowArgs("/idu_bug_finding_show bf-idu-pi-v2:abc")          === "bf-idu-pi-v2:abc"
 *   parseBugFindingShowArgs("/idu_bug_finding_show@IduPiBot bf-idu-pi-v2:abc") === "bf-idu-pi-v2:abc"
 *   parseBugFindingShowArgs("/idu_bug_finding_show")                            === null
 *   parseBugFindingShowArgs("/idu_bug_finding_show bf-...abc extra junk")       === "bf-...abc"
 *   parseBugFindingShowArgs("")                                                  === null
 */
export function parseBugFindingShowArgs(text: string): string | null {
	const stripped = text.replace(/^\/\w+(?:@\w+)?\s*/u, "").trim();
	const id = stripped.split(/\s+/u, 1)[0] ?? "";
	return id.length > 0 ? id : null;
}
