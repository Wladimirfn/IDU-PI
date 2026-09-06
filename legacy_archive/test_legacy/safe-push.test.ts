import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildSafePushReport,
	type SafePushCheckRunner,
} from "../src/safe-push.js";

function runner(responses: Record<string, string>): SafePushCheckRunner {
	return (command, args) => responses[[command, ...args].join(" ")] ?? "";
}

const secretCommand =
	"git grep -n -I -E (TELEGRAM_BOT_TOKEN=[^r#[:space:]]|OPENAI_API_KEY=sk-[A-Za-z0-9]|ANTHROPIC_API_KEY=sk-ant-|password[[:space:]]*[:=][[:space:]]*[^[:space:]\"']|private[_-]?key[[:space:]]*[:=]) -- .";

const allIgnored =
	".gitignore:1:.env\t.env\n.gitignore:2:data/\tdata\n.gitignore:3:.pi/\t.pi\n.gitignore:4:.atl/\t.atl\n.gitignore:5:dist/\tdist\n.gitignore:6:node_modules/\tnode_modules\n.gitignore:7:openspec/\topenspec\n.gitignore:8:plan.md\tplan.md\n.gitignore:9:false\tfalse\n.gitignore:10:NUL\tNUL";

test("buildSafePushReport returns go when hygiene checks pass", () => {
	const report = buildSafePushReport({
		cwd: "C:/repo",
		run: runner({
			"git status --short --untracked-files=all": "",
			"git check-ignore .env data .pi .atl dist node_modules openspec plan.md false NUL":
				allIgnored,
			[secretCommand]: "",
			"git rev-parse --abbrev-ref HEAD": "main",
			"git remote -v": "origin\thttps://github.com/example/repo.git (fetch)",
		}),
	});

	assert.equal(report.ok, true);
	assert.match(report.text, /GO/);
	assert.match(report.text, /Sin cambios pendientes/);
});

test("buildSafePushReport blocks on uncommitted files and secret hits", () => {
	const report = buildSafePushReport({
		cwd: "C:/repo",
		run: runner({
			"git status --short --untracked-files=all": " M src/index.ts\n?? .env",
			"git check-ignore .env data .pi .atl dist node_modules openspec plan.md false NUL":
				"",
			[secretCommand]: "src/config.ts:1:TELEGRAM_BOT_TOKEN=123:abc",
			"git rev-parse --abbrev-ref HEAD": "main",
			"git remote -v": "",
		}),
	});

	assert.equal(report.ok, false);
	assert.match(report.text, /NO-GO/);
	assert.match(report.text, /Cambios pendientes/);
	assert.match(report.text, /Posibles secretos/);
});

test("buildSafePushReport ignores documented placeholders", () => {
	const report = buildSafePushReport({
		cwd: "C:/repo",
		run: runner({
			"git status --short --untracked-files=all": "",
			"git check-ignore .env data .pi .atl dist node_modules openspec plan.md false NUL":
				allIgnored,
			[secretCommand]:
				"README.md:48:TELEGRAM_BOT_TOKEN=token_de_botfather\nscripts/setup-env.mjs:150:TELEGRAM_BOT_TOKEN=${telegramBotToken}",
			"git rev-parse --abbrev-ref HEAD": "main",
			"git remote -v": "origin\thttps://github.com/example/repo.git (fetch)",
		}),
	});

	assert.equal(report.ok, true);
	assert.doesNotMatch(report.text, /Posibles secretos/);
});

test("buildSafePushReport blocks when any sensitive ignore is missing", () => {
	const report = buildSafePushReport({
		cwd: "C:/repo",
		run: runner({
			"git status --short --untracked-files=all": "",
			"git check-ignore .env data .pi .atl dist node_modules openspec plan.md false NUL":
				".gitignore:1:.env\t.env",
			[secretCommand]: "",
			"git rev-parse --abbrev-ref HEAD": "main",
			"git remote -v": "origin\thttps://github.com/example/repo.git (fetch)",
		}),
	});

	assert.equal(report.ok, false);
	assert.match(report.text, /Rutas sensibles sin ignore/);
});
