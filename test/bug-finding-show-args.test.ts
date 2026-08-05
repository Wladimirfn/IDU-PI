// test/bug-finding-show-args.test.ts
//
// Real-behavior tests for the pure parser behind the
// `/idu_bug_finding_show <id>` Telegram command. The previous
// round (#467) verified this command by reading `src/index.ts`
// as text and applying regexes against the source. That shape
// passes when broken (a discarded `commandArg(...)` call still
// matches the regex) and fails when working (a rename or
// formatter line-break can break the regex without breaking
// the behavior). This file replaces those source-grep tests
// with direct calls to the parser, the same pattern used by
// `parseHygieneMigrateArgs`, `parseAgentLabRunSelector`, etc.
//
// Issue #468.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseBugFindingShowArgs } from "../src/bug-finding-show-args.js";

describe("parseBugFindingShowArgs", () => {
	test("bare command: private chat, single id", () => {
		// The form the operator uses when typing the command
		// from the phone in a private chat.
		assert.equal(
			parseBugFindingShowArgs("/idu_bug_finding_show bf-idu-pi-v2:abc123"),
			"bf-idu-pi-v2:abc123",
		);
	});

	test("@BotName suffix: group chat form", () => {
		// Telegram appends `@BotName` to the command when the
		// message comes from a group. Without the optional
		// suffix in the parser, the group form falls through to
		// "Uso: ..." in the bot. The owner verified this hole
		// is reachable before merging #467 (isAllowedUser
		// filters by user, not by chat).
		assert.equal(
			parseBugFindingShowArgs(
				"/idu_bug_finding_show@IduPiBot bf-idu-pi-v2:abc123",
			),
			"bf-idu-pi-v2:abc123",
		);
	});

	test("no id: returns null (handler replies with Uso)", () => {
		assert.equal(parseBugFindingShowArgs("/idu_bug_finding_show"), null);
	});

	test("only whitespace after the command: returns null", () => {
		assert.equal(
			parseBugFindingShowArgs("/idu_bug_finding_show    "),
			null,
		);
	});

	test("empty text: returns null", () => {
		assert.equal(parseBugFindingShowArgs(""), null);
	});

	test("trailing whitespace and tabs: id is trimmed", () => {
		assert.equal(
			parseBugFindingShowArgs(
				"/idu_bug_finding_show bf-idu-pi-v2:abc123   \t  ",
			),
			"bf-idu-pi-v2:abc123",
		);
	});

	test("extra tokens after the id: only the first is taken", () => {
		// Operator pastes the alert line with extra whitespace
		// or trailing text. The id is the first token; the rest
		// is silently dropped because the handler will surface
		// "no existe la fila" if the id doesn't match.
		assert.equal(
			parseBugFindingShowArgs(
				"/idu_bug_finding_show bf-idu-pi-v2:abc123 extra junk",
			),
			"bf-idu-pi-v2:abc123",
		);
	});

	test("@BotName suffix combined with extra tokens", () => {
		assert.equal(
			parseBugFindingShowArgs(
				"/idu_bug_finding_show@IduPiBot bf-idu-pi-v2:abc123 trailing",
			),
			"bf-idu-pi-v2:abc123",
		);
	});

	test("id with colons is preserved (bug_findings ids look like bf-<project>:<hash>)", () => {
		assert.equal(
			parseBugFindingShowArgs(
				"/idu_bug_finding_show bf-idu-pi-v2:3b41b73cdde81b0b",
			),
			"bf-idu-pi-v2:3b41b73cdde81b0b",
		);
	});
});
