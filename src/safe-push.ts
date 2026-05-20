import { execFileSync } from "node:child_process";

export type SafePushCheckRunner = (command: string, args: string[]) => string;

export type SafePushReport = {
	ok: boolean;
	text: string;
};

const sensitivePaths = [
	".env",
	"data",
	".pi",
	".atl",
	"dist",
	"node_modules",
	"openspec",
	"plan.md",
	"false",
	"NUL",
];

const secretPattern =
	"(TELEGRAM_BOT_TOKEN=[^r#[:space:]]|OPENAI_API_KEY=sk-[A-Za-z0-9]|ANTHROPIC_API_KEY=sk-ant-|password[[:space:]]*[:=][[:space:]]*[^[:space:]\"']|private[_-]?key[[:space:]]*[:=])";

export function defaultSafePushRunner(cwd: string): SafePushCheckRunner {
	return (command, args) =>
		execFileSync(command, args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
}

function runCheck(
	run: SafePushCheckRunner,
	command: string,
	args: string[],
): string {
	try {
		return run(command, args).trim();
	} catch (error) {
		return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function bullet(text: string): string {
	return `- ${text}`;
}

function isPlaceholderSecretHit(line: string): boolean {
	return /TELEGRAM_BOT_TOKEN=(?:token_de_botfather|replace_me|replace_with_botfather_token|\$\{[^}]+\})/u.test(
		line,
	);
}

function filterSecretHits(output: string): string {
	return output
		.split(/\r?\n/u)
		.filter((line) => line.trim() && !isPlaceholderSecretHit(line))
		.join("\n");
}

export function buildSafePushReport(options: {
	cwd: string;
	run?: SafePushCheckRunner;
}): SafePushReport {
	const run = options.run ?? defaultSafePushRunner(options.cwd);
	const findings: string[] = [];
	const passed: string[] = [];

	const branch = runCheck(run, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
	const remotes = runCheck(run, "git", ["remote", "-v"]);
	const status = runCheck(run, "git", [
		"status",
		"--short",
		"--untracked-files=all",
	]);
	const ignored = runCheck(run, "git", ["check-ignore", ...sensitivePaths]);
	const secretOutput = runCheck(run, "git", [
		"grep",
		"-n",
		"-I",
		"-E",
		secretPattern,
		"--",
		".",
	]);
	const secrets = secretOutput.startsWith("ERROR:")
		? secretOutput
		: filterSecretHits(secretOutput);

	if (status && !status.startsWith("ERROR:")) {
		findings.push(`Cambios pendientes:\n${status}`);
	} else if (status.startsWith("ERROR:")) {
		findings.push(`No pude leer git status: ${status}`);
	} else {
		passed.push("Sin cambios pendientes en git status.");
	}

	if (ignored.startsWith("ERROR:")) {
		findings.push(
			`No pude confirmar .gitignore para rutas sensibles: ${ignored}`,
		);
	} else {
		const ignoredSet = new Set(
			ignored
				.split(/\r?\n/u)
				.map((line) => line.split("\t").at(-1)?.trim())
				.filter(Boolean),
		);
		const missing = sensitivePaths.filter((path) => !ignoredSet.has(path));
		if (missing.length) {
			findings.push(
				`Rutas sensibles sin ignore confirmado: ${missing.join(", ")}`,
			);
		} else {
			passed.push("Rutas sensibles verificadas por git check-ignore.");
		}
	}

	if (secrets && !secrets.startsWith("ERROR:")) {
		findings.push(`Posibles secretos en archivos versionados:\n${secrets}`);
	} else if (secrets.startsWith("ERROR:")) {
		passed.push(
			"Búsqueda de secretos sin coincidencias o sin resultados versionados.",
		);
	} else {
		passed.push("Búsqueda de secretos sin coincidencias.");
	}

	if (!remotes || remotes.startsWith("ERROR:")) {
		findings.push("No encontré remoto git configurado.");
	} else {
		passed.push("Remoto git configurado.");
	}

	const ok = findings.length === 0;
	const text = `🛡️ Safe push ${ok ? "GO" : "NO-GO"}\n\nProyecto: ${options.cwd}\nRama: ${branch || "desconocida"}\n\nChecks OK:\n${passed.map(bullet).join("\n") || "- Ninguno"}\n\n${ok ? "Listo para que confirmes commit/push." : `Bloqueos:\n${findings.map(bullet).join("\n\n")}`}`;
	return { ok, text };
}
