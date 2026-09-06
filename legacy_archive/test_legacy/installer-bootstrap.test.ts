import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const installScript = join(repoRoot, "scripts", "install.mjs");
const installPs1 = join(repoRoot, "scripts", "install.ps1");
const quickstartDoc = join(repoRoot, "docs", "quickstart-install.md");

function tempDir(): string {
	return mkdtempCompat("idu-install-bootstrap-");
}

function mkdtempCompat(prefix: string): string {
	const path = join(
		tmpdir(),
		`${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(path, { recursive: true });
	return path;
}

function runInstall(
	args: string[],
	env: Record<string, string | undefined> = {},
): string {
	return execFileSync(process.execPath, [installScript, ...args], {
		cwd: repoRoot,
		env: {
			...process.env,
			...env,
			NO_COLOR: "1",
		},
		encoding: "utf8",
	});
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("install.mjs --dry-run no escribe archivos", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		const agentDir = join(root, "agent");
		const output = runInstall(["--dry-run"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			PI_CODING_AGENT_DIR: agentDir,
		});
		assert.match(output, /Instalador seguro/u);
		assert.match(output, /Dry-run/u);
		assert.match(
			output,
			/corepack pnpm install --frozen-lockfile --ignore-scripts/u,
		);
		assert.match(output, /node dist[\\/]src[\\/]cli\.js -- setup mcp-init/u);
		assert.equal(existsSync(shimDir), false);
		assert.equal(existsSync(agentDir), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("detecta falta de Node y Corepack con mensaje claro mediante mocks", () => {
	const output = runInstall(["--dry-run"], {
		IDU_PI_INSTALL_MOCK_TOOLS: JSON.stringify({ node: false, corepack: false }),
	});
	assert.match(output, /Node: missing/u);
	assert.match(output, /Corepack: missing/u);
	assert.match(output, /Instalá Node\.js LTS/u);
});

test("plan incluye install build mcp shim y wizard", () => {
	const output = runInstall(["--dry-run"]);
	assert.match(output, /1\. Instalar dependencias/u);
	assert.match(output, /2\. Compilar/u);
	assert.match(output, /3\. Configurar MCP Pi/u);
	assert.match(output, /4\. Instalar comandos slash globales Pi/u);
	assert.match(output, /5\. Crear shim idu-pi local/u);
	assert.match(output, /6\. Abrir wizard/u);
});

test("omite corepack enable si pnpm ya está disponible", () => {
	const output = runInstall(["--dry-run"], {
		IDU_PI_INSTALL_MOCK_TOOLS: JSON.stringify({ pnpm: "11.1.3" }),
	});
	assert.doesNotMatch(output, /corepack enable/u);
	assert.match(
		output,
		/corepack pnpm install --frozen-lockfile --ignore-scripts/u,
	);
});

test("incluye corepack enable sólo si pnpm falta", () => {
	const output = runInstall(["--dry-run"], {
		IDU_PI_INSTALL_MOCK_TOOLS: JSON.stringify({ pnpm: false }),
	});
	assert.match(output, /corepack enable/u);
});

test("crea shim .cmd y .ps1 en temp dir", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		const output = runInstall(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
			PATH: [shimDir, process.env.PATH ?? ""].join(delimiter),
		});
		const cmdPath = join(shimDir, "idu-pi.cmd");
		const ps1Path = join(shimDir, "idu-pi.ps1");
		assert.equal(existsSync(cmdPath), true);
		assert.equal(existsSync(ps1Path), true);
		assert.match(
			readFileSync(cmdPath, "utf8"),
			/node ".*dist[\\/]src[\\/]cli\.js" %\*/u,
		);
		assert.match(
			readFileSync(ps1Path, "utf8"),
			/node .*dist[\\/]src[\\/]cli\.js/u,
		);
		assert.match(output, /PATH no modificado porque ya estaba configurado/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("si shim existe distinto crea backup", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		mkdirSync(shimDir, { recursive: true });
		writeFileSync(join(shimDir, "idu-pi.cmd"), "old cmd", "utf8");
		writeFileSync(join(shimDir, "idu-pi.ps1"), "old ps1", "utf8");
		runInstall(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
		});
		const files = readdirSync(shimDir);
		assert.ok(
			files.some((file) => /^idu-pi\.backup-\d{8}-\d{6}\.cmd$/u.test(file)),
		);
		assert.ok(
			files.some((file) => /^idu-pi\.backup-\d{8}-\d{6}\.ps1$/u.test(file)),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("si shim existe igual no crea backup", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		runInstall(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
		});
		runInstall(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
		});
		const files = readdirSync(shimDir);
		assert.equal(
			files.some((file) => file.includes("backup")),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("--no-mcp omite setup mcp-init", () => {
	const output = runInstall(["--dry-run", "--no-mcp"]);
	assert.doesNotMatch(output, /setup mcp-init/u);
	assert.match(output, /MCP Pi: omitido por --no-mcp/u);
});

test("--no-shim omite shim", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		const output = runInstall(["--dry-run", "--no-shim"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
		});
		assert.match(output, /Shim idu-pi: omitido por --no-shim/u);
		assert.equal(existsSync(shimDir), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("--yes sin --add-path no modifica PATH", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		const userPathFile = join(root, "user-path.txt");
		const originalPath = process.env.PATH ?? "";
		const output = runInstall(["--yes", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
			IDU_PI_INSTALL_TEST_USER_PATH_FILE: userPathFile,
		});
		assert.equal(process.env.PATH ?? "", originalPath);
		assert.equal(existsSync(userPathFile), false);
		assert.match(output, /No modifiqué PATH automáticamente/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("--yes --add-path agrega shim al PATH de usuario simulado", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		const userPathFile = join(root, "user-path.txt");
		const output = runInstall(["--yes", "--add-path", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
			IDU_PI_INSTALL_TEST_USER_PATH: join(root, "existing"),
			IDU_PI_INSTALL_TEST_USER_PATH_FILE: userPathFile,
		});
		assert.match(output, /PATH de usuario actualizado/u);
		assert.match(
			readFileSync(userPathFile, "utf8"),
			new RegExp(escapeRegex(shimDir), "u"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("si shim ya está en PATH no modifica PATH", () => {
	const root = tempDir();
	try {
		const shimDir = join(root, "bin");
		const userPathFile = join(root, "user-path.txt");
		const output = runInstall(["--yes", "--add-path", "--no-mcp"], {
			IDU_PI_INSTALL_SHIM_DIR: shimDir,
			IDU_PI_INSTALL_TEST_SKIP_COMMANDS: "1",
			IDU_PI_INSTALL_TEST_USER_PATH_FILE: userPathFile,
			PATH: [shimDir, process.env.PATH ?? ""].join(delimiter),
		});
		assert.match(output, /PATH ya contiene/u);
		assert.equal(existsSync(userPathFile), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scripts no contienen bootstrap remoto opaco ni irm iex", () => {
	const combined = `${readFileSync(installScript, "utf8")}\n${readFileSync(installPs1, "utf8")}`;
	assert.doesNotMatch(combined, /irm\s*\|\s*iex/iu);
	assert.doesNotMatch(combined, /Invoke-RestMethod\s*\|\s*Invoke-Expression/iu);
	assert.doesNotMatch(combined, /curl\s+https?:\/\//iu);
	assert.match(combined, /--frozen-lockfile/u);
	assert.match(combined, /--ignore-scripts/u);
});

test("docs mencionan que PATH requiere confirmación o --add-path", () => {
	const docs = [
		readFileSync(quickstartDoc, "utf8"),
		readFileSync(join(repoRoot, "docs", "installer.md"), "utf8"),
		readFileSync(join(repoRoot, "README.md"), "utf8"),
	].join("\n");
	assert.match(docs, /--add-path|-AddPath/u);
	assert.match(docs, /PATH.*confirm/u);
});

test("scripts y quickstart están versionables según gitignore", () => {
	for (const path of [installScript, installPs1, quickstartDoc]) {
		let ignored = false;
		try {
			execFileSync("git", ["check-ignore", "-q", resolve(path)], {
				cwd: repoRoot,
			});
			ignored = true;
		} catch {
			ignored = false;
		}
		assert.equal(ignored, false, `${path} should not be ignored`);
	}
});
