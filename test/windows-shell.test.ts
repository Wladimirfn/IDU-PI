import test from "node:test";
import assert from "node:assert/strict";
import { escapeCmdArgument, resolveSpawnInvocation } from "../src/cmdline.js";

/*
 * These tests run on every platform, so they cannot ask a real cmd.exe. They
 * model the three parses a task goes through on its way into a CLI that sits
 * behind a batch shim instead:
 *
 *   1. cmd.exe parses the `/c` line: percent expansion, then carets and
 *      operators outside quotes.
 *   2. The shim forwards `%*`, and cmd parses that expansion again for carets
 *      and operators (percent expansion does not run twice).
 *   3. The program splits what is left by the MSVCRT rules.
 *
 * An operator (& | < >) that survives outside quotes in either cmd pass is an
 * injected command. An argv at the end that differs from what was sent is a
 * mangled task.
 */

function cmdPass(line: string): { out: string; operators: string[] } {
	let out = "";
	let inQuote = false;
	const operators: string[] = [];
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') {
			inQuote = !inQuote;
			out += c;
			continue;
		}
		if (inQuote) {
			out += c;
			continue;
		}
		if (c === "^") {
			i++;
			if (i < line.length) out += line[i];
			continue;
		}
		if ("&|<>".includes(c)) operators.push(c);
		out += c;
	}
	return { out, operators };
}

function msvcrtSplit(s: string): string[] {
	const args: string[] = [];
	let cur = "";
	let inQuote = false;
	let has = false;
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === "\\") {
			let n = 0;
			while (s[i] === "\\") {
				n++;
				i++;
			}
			if (s[i] === '"') {
				cur += "\\".repeat(Math.floor(n / 2));
				if (n % 2 === 1) {
					cur += '"';
					i++;
				}
			} else {
				cur += "\\".repeat(n);
			}
			has = true;
			continue;
		}
		if (c === '"') {
			inQuote = !inQuote;
			has = true;
			i++;
			continue;
		}
		if ((c === " " || c === "\t") && !inQuote) {
			if (has) {
				args.push(cur);
				cur = "";
				has = false;
			}
			i++;
			continue;
		}
		cur += c;
		has = true;
		i++;
	}
	if (has) args.push(cur);
	return args;
}

/** Runs the escaped arguments through both cmd passes and the final split. */
function deliver(args: string[]): { argv: string[]; operators: string[]; expandsPercent: boolean } {
	const escaped = args.map(escapeCmdArgument).join(" ");
	const expandsPercent = /%[A-Za-z0-9_]+%/.test(escaped);
	const first = cmdPass(escaped);
	const second = cmdPass(first.out);
	return {
		argv: msvcrtSplit(second.out),
		operators: [...first.operators, ...second.operators],
		expandsPercent,
	};
}

const HOSTILE_TASKS = [
	"Revisa el modulo & calc.exe",
	'x" & calc & "',
	'cierra la comilla" | del /q * & echo "',
	"a > C:\\Windows\\system.ini",
	"lee %PATH% y %USERPROFILE%",
	"100% listo",
	"termina en barra\\",
	'dice "hola" con \\"escapes\\"',
	"^caret (parentesis) [corchetes] !bang! `tick` ;coma, *glob?",
	"",
];

for (const task of HOSTILE_TASKS) {
	test(`cmd escaping delivers ${JSON.stringify(task)} intact and inert`, () => {
		const sent = ["-p", task, "--model", "some/model"];
		const { argv, operators, expandsPercent } = deliver(sent);
		assert.deepEqual(operators, [], "no cmd operator may survive outside quotes");
		assert.equal(expandsPercent, false, "no %VAR% may be left for cmd to expand");
		assert.deepEqual(argv, sent, "the CLI must receive exactly the arguments that were sent");
	});
}

test("resolveSpawnInvocation leaves a directly spawnable command alone", () => {
	const inv = resolveSpawnInvocation({ command: "C:\\bin\\tool.exe", args: ["-p", "a & b"], isShell: false }, "win32");
	assert.deepEqual(inv, { command: "C:\\bin\\tool.exe", args: ["-p", "a & b"], windowsVerbatimArguments: false });
});

test("resolveSpawnInvocation is a no-op off Windows", () => {
	const inv = resolveSpawnInvocation({ command: "tool", args: ["a & b"], isShell: true }, "linux");
	assert.equal(inv.windowsVerbatimArguments, false);
	assert.deepEqual(inv.args, ["a & b"]);
});

test("resolveSpawnInvocation turns a shell fallback into an escaped cmd.exe call", () => {
	const inv = resolveSpawnInvocation(
		{ command: "C:\\tools\\agent.cmd", args: ["-p", "x\" & calc & \""], isShell: true },
		"win32",
		"C:\\Windows\\System32\\cmd.exe",
	);
	assert.equal(inv.command, "C:\\Windows\\System32\\cmd.exe");
	assert.equal(inv.windowsVerbatimArguments, true);
	assert.deepEqual(inv.args.slice(0, 3), ["/d", "/s", "/c"]);
	const line = inv.args[3];
	assert.ok(line.startsWith('"') && line.endsWith('"'), "/s strips exactly one pair of outer quotes");

	// /s removes the outer pair; the first pass then must yield the shim path
	// followed by the arguments the shim forwards as %*.
	const first = cmdPass(line.slice(1, -1));
	assert.deepEqual(first.operators, []);
	assert.ok(first.out.startsWith("C:\\tools\\agent.cmd "));
	const second = cmdPass(first.out.slice("C:\\tools\\agent.cmd ".length));
	assert.deepEqual(second.operators, []);
	assert.deepEqual(msvcrtSplit(second.out), ["-p", "x\" & calc & \""]);
});

test("resolveSpawnInvocation refuses a task cmd.exe would cut at a line break", () => {
	assert.throws(
		() =>
			resolveSpawnInvocation(
				{ command: "C:\\tools\\agent.cmd", args: ["-p", "primera linea\nsegunda & calc"], isShell: true },
				"win32",
			),
		/line breaks/,
	);
});
