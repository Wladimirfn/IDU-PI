import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const cliSource = readFileSync("src/cli.ts", "utf8");
const mcpSource = readFileSync("src/mcp-server.ts", "utf8");
const catalogSource = readFileSync("src/command-catalog.ts", "utf8");

const cases = [
	"idu-birth-status",
	"idu-birth-existing-scan",
	"idu-birth-bibliotecario-discovery",
	"idu-birth-validate",
	"idu-birth-repo-plan",
];

for (const c of cases) {
	test(`cli.ts handles ${c}`, () => {
		assert.match(
			cliSource,
			new RegExp(`case\\s+"${c}":`),
			`missing case "${c}:" in cli.ts`,
		);
	});
	test(`mcp-server.ts handles ${c.replace(/-/g, "_")}`, () => {
		assert.match(
			mcpSource,
			new RegExp(`case\\s+"${c.replace(/-/g, "_")}":`),
			`missing case "${c.replace(/-/g, "_")}:" in mcp-server.ts`,
		);
	});
}

for (const c of cases) {
	test(`command-catalog registers ${c}`, () => {
		assert.match(
			catalogSource,
			new RegExp(`cli -- ${c}\\b`),
			`missing entry for ${c} in command-catalog.ts`,
		);
	});
}

for (const t of [
	"idu_birth_status",
	"idu_birth_existing_scan",
	"idu_birth_bibliotecario_discovery",
	"idu_birth_validate",
	"idu_birth_repo_plan",
]) {
	test(`mcp-server.ts registers tool ${t}`, () => {
		assert.match(
			mcpSource,
			new RegExp(`tool\\(\\s*"${t}",`),
			`missing tool("${t}"`,
		);
	});
}
