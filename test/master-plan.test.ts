import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
	approveMasterPlan,
	classifyProjectPath,
	ensureMasterPlanForIdu,
	handleMasterPlanNaturalDecision,
	isMasterPlanCompatible,
	formatIduSupervisorPlanReport,
	formatMasterPlanReview,
	formatMasterPlanSummaryForIdu,
	generateMasterPlanDraft,
	getMasterPlanStatus,
	loadExternalProjectMemory,
	readMasterPlanPendingAction,
	redraftMasterPlan,
	rejectMasterPlan,
	reviewMasterPlan,
} from "../src/master-plan.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-master-plan-"));
}

function writeSmallProject(projectPath: string): void {
	mkdirSync(join(projectPath, "src"), { recursive: true });
	writeFileSync(
		join(projectPath, "README.md"),
		"# Demo\n\nSmall project.\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "index.ts"),
		"export const ok = true;\n",
		"utf8",
	);
}

function writeStandardProject(projectPath: string): void {
	mkdirSync(join(projectPath, "src", "ui"), { recursive: true });
	mkdirSync(join(projectPath, "db"), { recursive: true });
	writeFileSync(
		join(projectPath, "package.json"),
		JSON.stringify({
			dependencies: { express: "1.0.0", sqlite3: "1.0.0", react: "1.0.0" },
		}),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "ui", "login.html"),
		"<form id='login'></form>",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "db", "schema.sql"),
		"create table users(id int);",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "auth.ts"),
		"export const login = () => true;",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "app.ts"),
		"export const app = () => true;",
		"utf8",
	);
}

function writeLargeProject(projectPath: string): void {
	writeStandardProject(projectPath);
	for (let index = 0; index < 130; index += 1) {
		const dir = join(projectPath, "src", `module-${index}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `file-${index}.ts`),
			"export const value = 'auth db security';\n",
			"utf8",
		);
	}
}

function writeToolingHeavyProductProject(projectPath: string): void {
	mkdirSync(join(projectPath, ".agents", "skills", "agent"), {
		recursive: true,
	});
	mkdirSync(join(projectPath, ".adal", "skills"), { recursive: true });
	mkdirSync(join(projectPath, ".augment", "cache"), { recursive: true });
	mkdirSync(join(projectPath, ".vscode"), { recursive: true });
	mkdirSync(join(projectPath, "src", "components"), { recursive: true });
	mkdirSync(join(projectPath, "src", "services"), { recursive: true });
	mkdirSync(join(projectPath, "routes"), { recursive: true });
	mkdirSync(join(projectPath, "supabase", "migrations"), { recursive: true });
	writeFileSync(
		join(projectPath, "README.md"),
		"# Maintenance Portal\n\nIndustrial operations maintenance system.\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "package.json"),
		JSON.stringify({
			dependencies: {
				"@supabase/supabase-js": "1.0.0",
				express: "1.0.0",
				vite: "1.0.0",
			},
			devDependencies: { typescript: "1.0.0" },
		}),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "pnpm-lock.yaml"),
		"lockfileVersion: '9'\n",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "login.html"),
		"<form id='login-form'><button id='login'>Login</button></form>",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "login.js"),
		"fetch('/api/auth/login'); localStorage.setItem('session', token);",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "routes", "auth.ts"),
		"import jwt from 'jsonwebtoken'; export const login = () => jwt.sign({ id: 1 }, 'secret');",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "components", "dashboard.tsx"),
		"export function Dashboard(){ return null; }",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "services", "upload.ts"),
		"import { createClient } from '@supabase/supabase-js'; export const upload = () => createClient('', '').storage.from('files');",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "supabase", "migrations", "001.sql"),
		"create table reports(id uuid primary key);",
		"utf8",
	);
	writeFileSync(
		join(projectPath, ".agents", "skills", "README.md"),
		"# agent skills\n",
		"utf8",
	);
	writeFileSync(join(projectPath, ".adal", "config.json"), "{}", "utf8");
}

function listRelativeFiles(root: string): string[] {
	const files: string[] = [];
	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else files.push(relative(root, path).replace(/\\/gu, "/"));
		}
	}
	walk(root);
	return files.sort();
}

function writeBrokenDirectoryLink(linkPath: string, targetPath: string): void {
	try {
		symlinkSync(targetPath, linkPath, "dir");
	} catch (error) {
		if (process.platform !== "win32") throw error;
		mkdirSync(targetPath, { recursive: true });
		execFileSync("cmd.exe", ["/c", "mklink", "/J", linkPath, targetPath]);
		rmSync(targetPath, { recursive: true, force: true });
	}
}

test("classifyProjectPath separa señales de producto de tooling genérico", () => {
	assert.equal(
		classifyProjectPath(".agents/skills/react/SKILL.md"),
		"agent_metadata",
	);
	assert.equal(
		classifyProjectPath(".augment/cache/state.json"),
		"agent_metadata",
	);
	assert.equal(classifyProjectPath(".vscode/settings.json"), "tooling");
	assert.equal(classifyProjectPath("src/components/Login.tsx"), "component");
	assert.equal(classifyProjectPath("routes/auth.ts"), "auth");
	assert.equal(
		classifyProjectPath("supabase/migrations/001.sql"),
		"data_store",
	);
	assert.equal(classifyProjectPath("dist/index.js"), "generated");
});

test("Plan Maestro separa tooling y detecta arquitectura datos auth y flujos funcionales", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeToolingHeavyProductProject(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.deepEqual(
			[".adal", ".agents", ".augment"].filter((tool) =>
				result.plan.detectedModules.includes(tool),
			),
			[],
		);
		assert.ok(result.plan.toolingDetected.includes(".agents"));
		assert.ok(result.plan.toolingDetected.includes(".adal"));
		assert.ok(result.plan.toolingDetected.includes(".augment"));
		assert.ok(result.plan.detectedModules.includes("src"));
		assert.ok(result.plan.detectedModules.includes("routes"));
		assert.equal(result.plan.architecture.packageManager, "pnpm");
		assert.ok(result.plan.architecture.languages.includes("TypeScript"));
		assert.ok(result.plan.architecture.languages.includes("JavaScript"));
		assert.ok(result.plan.architecture.frameworks.includes("Express"));
		assert.equal(result.plan.architecture.database, "Supabase/Postgres");
		assert.equal(result.plan.securityModel.authDetected, true);
		assert.equal(result.plan.securityModel.sessionDetected, true);
		assert.ok(
			result.plan.dataStores.some((store) => store.type === "supabase"),
		);
		assert.ok(
			result.plan.dataStores.some((store) => store.type === "postgres"),
		);
		assert.ok(
			result.plan.detectedFlows.every((flow) => typeof flow !== "string"),
		);
		assert.ok(
			result.plan.detectedFlows.some(
				(flow) => flow.type === "auth" && flow.modules.includes("routes"),
			),
		);
		assert.ok(
			result.plan.detectedFlows.some((flow) =>
				flow.dataStores.includes("supabase"),
			),
		);
		const summary = formatMasterPlanSummaryForIdu(result);
		assert.match(summary, /Objetivo:/u);
		assert.match(summary, /Arquitectura:/u);
		assert.match(summary, /Datos:/u);
		assert.match(summary, /Auth:/u);
		assert.match(summary, /Flujos principales:/u);
		assert.doesNotMatch(summary, /\.agents|\.adal|\.augment/u);
		const review = reviewMasterPlan({ stateRoot, pathOrLatest: "latest" });
		assert.ok(review.revisionAntesDeZarpar.projectUnderstanding.length > 0);
		assert.ok(
			review.revisionAntesDeZarpar.requiredContracts.some(
				(contract) => contract.category === "objective",
			),
		);
		assert.ok(
			review.revisionAntesDeZarpar.requiredContracts.some(
				(contract) => contract.category === "information_sources",
			),
		);
		assert.ok(
			review.revisionAntesDeZarpar.beforeSailingChecklist.some((item) =>
				/aprobar plan maestro/iu.test(item),
			),
		);
		const markdown = formatMasterPlanReview(review);
		assert.match(markdown, /## Revisión antes de zarpar/u);
		assert.match(markdown, /Contratos necesarios/u);
		assert.match(markdown, /Fuentes de información/u);
		assert.match(markdown, /## Arquitectura detectada/u);
		assert.match(markdown, /## Stack\/lenguajes/u);
		assert.match(markdown, /## Persistencia \/ datos/u);
		assert.match(markdown, /## Seguridad \/ auth/u);
		assert.match(markdown, /## Flujos funcionales/u);
		assert.match(markdown, /## Tooling detectado/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Plan Maestro renderiza documento normativo y separa flujos permanentes", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "idu-pi");
		const stateRoot = join(root, "state", "projects", "idu-pi");
		mkdirSync(join(projectPath, "docs"), { recursive: true });
		mkdirSync(join(projectPath, "src"), { recursive: true });
		writeFileSync(
			join(projectPath, "docs", "architecture.md"),
			[
				"# Arquitectura de Idu-pi",
				"",
				"Idu-pi está organizado como core de supervisión más adaptadores.",
				"CLI adapter, Telegram adapter, MCP adapter y Pi slash commands llaman al Core Idu-pi.",
				"El core mantiene reports JSON/JSONL, lab.db SQLite local, Project Core, Constitution, Flows, Plan Maestro, Doc y AgentLabs audit-only.",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(projectPath, "README.md"),
			"# Idu-pi\n\nSupervisor MCP/CLI/Telegram para guiar proyectos.",
			"utf8",
		);
		writeFileSync(
			join(projectPath, "src", "session.ts"),
			"export const sessionName = 'pi-session'; // not product login/auth",
			"utf8",
		);

		const result = generateMasterPlanDraft({
			projectId: "idu-pi",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const markdown = readFileSync(result.markdownPath, "utf8");
		const review = reviewMasterPlan({ stateRoot, pathOrLatest: "latest" });
		const flowArtifact = join(stateRoot, "master-plan.flows.json");

		assert.notEqual(result.plan.inferredObjective, "Idu-pi");
		assert.match(
			result.plan.inferredObjective,
			/supervisor\/auditor normativo/iu,
		);
		assert.match(result.plan.inferredObjective, /orquestador Pi/iu);
		assert.match(result.plan.inferredObjective, /Plan Maestro/iu);
		assert.match(result.plan.inferredObjective, /AgentLabs/iu);
		assert.ok(
			review.revisionAntesDeZarpar.questionsForUser.some((question) =>
				/supervisor\/auditor normativo/iu.test(question),
			),
		);
		assert.equal(
			review.revisionAntesDeZarpar.questionsForUser.some((question) =>
				/^¿Confirmás que el objetivo del proyecto es: Idu-pi\?$/u.test(
					question,
				),
			),
			false,
		);
		assert.ok(
			review.revisionAntesDeZarpar.recommendedExternalSources.some((source) =>
				/(posts? oficiales.*x|x\/twitter|twitter)/iu.test(source),
			),
		);
		assert.ok(
			review.revisionAntesDeZarpar.recommendedExternalSources.some((source) =>
				/(reddit|comunidades? t[eé]cnicas?)/iu.test(source),
			),
		);
		const librarianLab = review.revisionAntesDeZarpar.recommendedAgentLabs.find(
			(lab) => /bibliotecario/iu.test(lab.name),
		);
		assert.ok(librarianLab);
		assert.match(
			librarianLab.purpose,
			/documentaci[oó]n|noticias|advisories/iu,
		);
		assert.match(librarianLab.purpose, /orquestador/iu);
		assert.match(librarianLab.purpose, /audit-only|auditor/iu);
		assert.ok(markdown.includes("## Identidad del proyecto"));
		assert.ok(
			markdown.includes("## Documentación declarada vs realidad construida"),
		);
		assert.ok(markdown.includes("## Flujos funcionales permanentes"));
		assert.ok(markdown.includes("master-plan.flows.json"));
		assert.equal(markdown.includes("Idu-pi generó un Plan Maestro"), false);
		assert.equal(markdown.includes("## Preguntas abiertas"), false);
		assert.equal(markdown.includes("## Próximos pasos"), false);
		assert.equal(markdown.includes("## Plan por hitos"), false);
		assert.equal(markdown.includes("Login/acceso"), false);
		assert.equal(existsSync(flowArtifact), true);
		const flows = JSON.parse(readFileSync(flowArtifact, "utf8")) as {
			projectId: string;
			flows: Array<{ name: string; source: string }>;
		};
		assert.equal(flows.projectId, "idu-pi");
		assert.ok(flows.flows.some((flow) => flow.name.includes("MCP")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("revisionAntesDeZarpar usa Doc root sanitizado y distingue falta de herramientas", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, "src"), { recursive: true });
		writeFileSync(join(projectPath, "README.md"), "# Demo", "utf8");
		writeFileSync(
			join(projectPath, "src", "index.ts"),
			"export const ok = true;",
			"utf8",
		);
		const result = generateMasterPlanDraft({
			projectId: "Proyecto Ácido/Uno",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const approvedPlan = {
			...result.plan,
			status: "approved",
			criticalRisks: [],
			canonicalClaims: [
				...result.plan.canonicalClaims,
				{
					title: "Contrato usuario aprobado legado",
					statement: "El usuario aprobó objetivo y contratos mínimos.",
					source: "human_approved",
					status: "confirmed",
					confidence: 0.9,
					evidence: ["conversación humana"],
				},
			],
		};
		writeFileSync(
			result.jsonPath,
			`${JSON.stringify(approvedPlan, null, 2)}\n`,
			"utf8",
		);

		const missingSourceReview = reviewMasterPlan({
			stateRoot,
			pathOrLatest: "latest",
		});
		assert.equal(
			missingSourceReview.plan.canonicalClaims.some(
				(claim) => claim.source === "user_approved",
			),
			true,
		);
		assert.equal(
			missingSourceReview.plan.canonicalClaims.some(
				(claim) => claim.source === "human_approved",
			),
			false,
		);
		assert.equal(
			missingSourceReview.revisionAntesDeZarpar.status,
			"needs_tools",
		);
		assert.equal(
			missingSourceReview.revisionAntesDeZarpar.missingDefinitions.some(
				(item) => /biblioteca de fuentes/iu.test(item),
			),
			false,
		);

		mkdirSync(join(stateRoot, "Doc", "proyecto_cido_uno"), {
			recursive: true,
		});
		writeFileSync(
			join(stateRoot, "Doc", "proyecto_cido_uno", "source-index.json"),
			"{}\n",
			"utf8",
		);
		const readyReview = reviewMasterPlan({ stateRoot, pathOrLatest: "latest" });
		assert.equal(readyReview.revisionAntesDeZarpar.status, "ready");
		assert.equal(
			readyReview.revisionAntesDeZarpar.currentProblems.some((item) =>
				/source-index/iu.test(item),
			),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Plan Maestro prioriza documentación técnica canónica sobre menciones ruidosas", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, "docs"), { recursive: true });
		mkdirSync(join(projectPath, "tests"), { recursive: true });
		mkdirSync(join(projectPath, "prisma"), { recursive: true });
		writeFileSync(
			join(projectPath, "DOCUMENTACION_TECNICA_SISTEMA_DE_MANTENCION_RCM.md"),
			[
				"# Documentación técnica — Sistema_de_mantencion-RCM",
				"",
				"Sistema_de_mantencion-RCM es una plataforma web orientada a la gestión integral del área técnica y mantenimiento industrial.",
				"",
				"En términos arquitectónicos, el sistema está compuesto por:",
				"- un backend en Node.js + Express;",
				"- un frontend estático servido por el mismo servidor;",
				"- una base de datos PostgreSQL operada mediante Prisma ORM;",
				"- Supabase Storage para archivos;",
				"- autenticación basada en JWT;",
				"- notificaciones en tiempo real mediante Server-Sent Events (SSE).",
				"",
				"Módulos principales: Activos, Mantenimiento, Bitácoras, Inventario, Compras, SGC, Capacitaciones, Turnos, Usuarios y Auditoría.",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(projectPath, "package.json"),
			JSON.stringify({ dependencies: { express: "1.0.0", prisma: "1.0.0" } }),
			"utf8",
		);
		writeFileSync(
			join(projectPath, "server.js"),
			"const express = require('express'); app.get('/api/health', () => {});",
			"utf8",
		);
		writeFileSync(
			join(projectPath, "prisma", "schema.prisma"),
			'datasource db { provider = "postgresql" url = env("DATABASE_URL") }',
			"utf8",
		);
		writeFileSync(
			join(projectPath, "docs", "alternativas.md"),
			"No usar mysql, mongodb ni indexedDB; son menciones comparativas.",
			"utf8",
		);
		writeFileSync(
			join(projectPath, "tests", "storage.test.js"),
			"const text = 'localStorage mysql mongodb indexedDB supabase';",
			"utf8",
		);

		const result = generateMasterPlanDraft({
			projectId: "sistema_de_mantencion",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.inferredObjective, "Sistema_de_mantencion-RCM");
		assert.equal(result.plan.architecture.frontend, "HTML/CSS/JS vanilla");
		assert.equal(result.plan.architecture.backend, "Node/Express");
		assert.equal(result.plan.architecture.database, "PostgreSQL + Prisma");
		assert.equal(result.plan.architecture.auth, "JWT");
		assert.ok(result.plan.architecture.frameworks.includes("SSE"));
		assert.equal(result.plan.architecture.frameworks.includes("React"), false);
		assert.ok(
			result.plan.dataStores.some((store) => store.type === "postgres"),
		);
		assert.ok(result.plan.dataStores.some((store) => store.type === "prisma"));
		assert.ok(
			result.plan.dataStores.some((store) => store.type === "supabase"),
		);
		assert.equal(
			result.plan.dataStores.some((store) => store.type === "mysql"),
			false,
		);
		assert.equal(
			result.plan.dataStores.some((store) => store.type === "mongodb"),
			false,
		);
		assert.equal(
			result.plan.dataStores.some((store) => store.type === "indexedDB"),
			false,
		);
		assert.equal(
			result.plan.dataStores.some((store) => store.type === "localStorage"),
			false,
		);
		assert.ok(
			result.plan.sourceFiles.includes(
				"DOCUMENTACION_TECNICA_SISTEMA_DE_MANTENCION_RCM.md",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Plan Maestro legacy se considera incompatible y /idu regenera", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		writeSmallProject(projectPath);
		writeFileSync(
			join(stateRoot, "reports", "master-plan-legacy.json"),
			JSON.stringify({
				version: "1.0.0",
				projectId: "demo",
				projectPath,
				generatedAt: new Date().toISOString(),
				status: "draft",
				autoDepth: {
					mode: "quick",
					reason: "legacy",
					signals: [],
					agentLabsSelected: [],
					skippedAgentLabs: [],
					tokenCostHint: "low",
				},
				source: {
					projectCoreStatus: "missing",
					constitutionStatus: "missing",
					blueprintStatus: "missing",
					flowsStatus: "missing",
					scanStatus: "legacy",
				},
				executiveSummary: "legacy",
				inferredObjective: "legacy objective",
				problemStatement: "legacy problem",
				scope: [],
				outOfScope: [],
				detectedModules: ["src"],
				detectedFlows: ["src/login.ts"],
				dataStores: ["db/schema.sql"],
				userRoles: [],
				criticalRisks: [],
				qualityRisks: [],
				securityRisks: [],
				architectureRisks: [],
				openQuestions: [],
				assumptions: [],
				recommendedNext: [],
				sourceFiles: [],
				agentLabReviews: [],
			}),
			"utf8",
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "reports/master-plan-legacy.json",
				currentPlanMd: "reports/master-plan-legacy.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const status = getMasterPlanStatus({ stateRoot });
		assert.equal(status.status, "incompatible");
		const raw = JSON.parse(
			readFileSync(
				join(stateRoot, "reports", "master-plan-legacy.json"),
				"utf8",
			),
		);
		assert.equal(isMasterPlanCompatible(raw), false);
		const result = ensureMasterPlanForIdu({
			projectId: "demo",
			projectPath,
			stateRoot,
		});
		assert.equal("current" in result, true);
		if (!("current" in result)) throw new Error("expected regenerated draft");
		const text = formatMasterPlanSummaryForIdu(result);
		assert.equal(result.plan.schemaVersion, 2);
		assert.notEqual(
			result.current.currentPlanJson,
			"reports/master-plan-legacy.json",
		);
		assert.equal(
			existsSync(join(stateRoot, "reports", "master-plan-legacy.json")),
			true,
		);
		assert.match(
			text,
			/Plan Maestro anterior incompatible con esquema actual/u,
		);
		assert.doesNotMatch(text, /Arquitectura:\n—/u);
		assert.doesNotMatch(text, /AutoDepth:\n—/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("schema v2 malformado se invalida y /idu regenera", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		writeSmallProject(projectPath);
		writeFileSync(
			join(stateRoot, "reports", "bad-v2.json"),
			JSON.stringify({
				schemaVersion: 2,
				executiveSummary: "bad but superficially v2",
				inferredObjective: "bad objective",
				autoDepth: { mode: "standard" },
				architecture: { projectKind: "web", languages: ["TypeScript"] },
				dataStores: [],
				securityModel: {},
				detectedFlows: [],
				toolingDetected: [],
			}),
			"utf8",
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "reports/bad-v2.json",
				currentPlanMd: "reports/bad-v2.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const raw = JSON.parse(
			readFileSync(join(stateRoot, "reports", "bad-v2.json"), "utf8"),
		);
		assert.equal(isMasterPlanCompatible(raw), false);
		const status = getMasterPlanStatus({ stateRoot });
		assert.equal(status.status, "incompatible");
		const result = ensureMasterPlanForIdu({
			projectId: "demo",
			projectPath,
			stateRoot,
		});
		assert.equal("current" in result, true);
		if (!("current" in result)) throw new Error("expected regenerated draft");
		assert.equal(result.plan.schemaVersion, 2);
		assert.notEqual(result.current.currentPlanJson, "reports/bad-v2.json");
		assert.equal(existsSync(join(stateRoot, "reports", "bad-v2.json")), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("current ausente o inválido fuerza nuevo draft compatible", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		writeSmallProject(projectPath);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "reports/missing.json",
				currentPlanMd: "reports/missing.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		const missingStatus = getMasterPlanStatus({ stateRoot });
		assert.equal(missingStatus.status, "incompatible");
		const result = ensureMasterPlanForIdu({
			projectId: "demo",
			projectPath,
			stateRoot,
		});
		assert.equal("current" in result, true);
		if (!("current" in result)) throw new Error("expected regenerated draft");
		assert.equal(result.plan.schemaVersion, 2);
		assert.equal(
			existsSync(join(stateRoot, result.current.currentPlanJson)),
			true,
		);

		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../escape.json",
				currentPlanMd: "../escape.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		const unsafeStatus = getMasterPlanStatus({ stateRoot });
		assert.equal(unsafeStatus.status, "incompatible");
		assert.equal("incompatibleReason" in unsafeStatus, true);
		if (!("incompatibleReason" in unsafeStatus))
			throw new Error("expected incompatible status");
		assert.match(unsafeStatus.incompatibleReason, /fuera de stateRoot/u);
		const regenerated = ensureMasterPlanForIdu({
			projectId: "demo",
			projectPath,
			stateRoot,
		});
		assert.equal("current" in regenerated, true);
		if (!("current" in regenerated))
			throw new Error("expected regenerated draft");
		assert.equal(regenerated.plan.schemaVersion, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("master-plan-review latest diagnostica plan incompatible sin regenerar", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(stateRoot, "reports"), { recursive: true });
		writeSmallProject(projectPath);
		writeFileSync(
			join(stateRoot, "reports", "old.json"),
			JSON.stringify({
				version: "1.0.0",
				status: "draft",
				detectedFlows: ["src/login.ts"],
			}),
			"utf8",
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "reports/old.json",
				currentPlanMd: "reports/old.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const review = reviewMasterPlan({ stateRoot, pathOrLatest: "latest" });
		assert.match(formatMasterPlanReview(review), /Plan Maestro incompatible/u);
		assert.match(formatMasterPlanReview(review), /master-plan-redraft latest/u);
		assert.equal(
			readdirSync(join(stateRoot, "reports")).filter((entry) =>
				/^master-plan-/u.test(entry),
			).length,
			0,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Supabase storage sin señales auth no marca login/session", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, "src", "services"), { recursive: true });
		writeFileSync(
			join(projectPath, "package.json"),
			JSON.stringify({ dependencies: { "@supabase/supabase-js": "1.0.0" } }),
			"utf8",
		);
		writeFileSync(
			join(projectPath, "src", "services", "storage.ts"),
			"import { createClient } from '@supabase/supabase-js'; export const storage = createClient('', '').storage.from('files');",
			"utf8",
		);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
		});
		assert.equal(result.plan.architecture.database, "Supabase/Postgres");
		assert.equal(result.plan.securityModel.authDetected, false);
		assert.equal(result.plan.securityModel.sessionDetected, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("genera Plan Maestro canónico en stateRoot sin modificar repo del usuario", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		const before = listRelativeFiles(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "abc123",
		});

		assert.equal(result.plan.status, "draft");
		assert.equal(result.plan.schemaVersion, 2);
		assert.equal(result.plan.autoDepth.mode, "quick");
		assert.equal(
			existsSync(join(stateRoot, result.current.currentPlanJson)),
			true,
		);
		assert.equal(
			existsSync(join(stateRoot, result.current.currentPlanMd)),
			true,
		);
		assert.equal(existsSync(join(stateRoot, "master-plan.current.json")), true);
		assert.equal(existsSync(join(stateRoot, "master-plan.memory.json")), true);
		assert.equal(result.current.currentPlanJson, "master-plan.json");
		assert.equal(result.current.currentPlanMd, "master-plan.md");
		assert.equal(existsSync(join(stateRoot, "project-index.json")), true);
		assert.equal(existsSync(join(stateRoot, "agentlabs", "requests")), true);
		assert.equal(existsSync(join(stateRoot, "agentlabs", "runs")), true);
		assert.match(
			readFileSync(join(stateRoot, result.current.currentPlanMd), "utf8"),
			/# Plan Maestro Idu-pi/u,
		);
		assert.deepEqual(listRelativeFiles(projectPath), before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Plan Maestro ignora links rotos durante escaneo del proyecto", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, ".adal", "skills"), { recursive: true });
		writeSmallProject(projectPath);
		writeBrokenDirectoryLink(
			join(projectPath, ".adal", "skills", "supabase"),
			join(projectPath, ".agents", "skills", "supabase"),
		);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.status, "draft");
		assert.equal(
			result.plan.detectedFlows.every((flow) => typeof flow !== "string"),
			true,
		);
		assert.equal(existsSync(join(stateRoot, "master-plan.current.json")), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("AutoDepth elige standard para proyecto mediano con DB UI y auth", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeStandardProject(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.autoDepth.mode, "standard");
		assert.ok(result.plan.autoDepth.agentLabsSelected.includes("security"));
		assert.ok(result.plan.autoDepth.agentLabsSelected.includes("database"));
		assert.ok(result.plan.autoDepth.agentLabsSelected.length <= 3);
		assert.ok(
			result.plan.agentLabReviews.every(
				(review) => review.status === "not_run" || review.status === "skipped",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("/idu no bloquea por llamadas API internas locales", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, "src"), { recursive: true });
		writeFileSync(
			join(projectPath, "src", "index.html"),
			"<main></main>",
			"utf8",
		);
		writeFileSync(
			join(projectPath, "src", "app.js"),
			"fetch('/api/work-orders').then((response) => response.json());",
			"utf8",
		);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const text = formatIduSupervisorPlanReport({
			bootstrap: { project: { id: "demo" }, criticalDecisions: [] },
			masterPlan: result,
			reviewHandled: false,
		});

		assert.doesNotMatch(text, /No puedo cerrar el Plan Maestro todavía/u);
		assert.doesNotMatch(text, /falta conexión MCP\/credenciales/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("/idu bloquea plan final si falta contexto externo obligatorio", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, "src"), { recursive: true });
		writeFileSync(
			join(projectPath, "package.json"),
			JSON.stringify({ dependencies: { "@supabase/supabase-js": "1.0.0" } }),
			"utf8",
		);
		writeFileSync(
			join(projectPath, "src", "login.js"),
			"import { createClient } from '@supabase/supabase-js';\nexport const supabase = createClient('url', 'anon');\nlocalStorage.getItem('token');\n",
			"utf8",
		);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const text = formatIduSupervisorPlanReport({
			bootstrap: { project: { id: "demo" }, criticalDecisions: [] },
			masterPlan: result,
			reviewHandled: false,
		});

		assert.match(text, /No puedo cerrar el Plan Maestro todavía/u);
		assert.match(text, /Supabase\/Postgres/u);
		assert.match(text, /Repo local revisado:/u);
		assert.equal(
			existsSync(
				join(stateRoot, "Doc", "demo", "01-contratos-operativos.generado.md"),
			),
			true,
		);
		assert.doesNotMatch(text, /PLAN MAESTRO DE INGENIERÍA/u);
		assert.doesNotMatch(text, /Supervisor escaló|Project Core|project-local/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("/idu muestra arquitectura y riesgos sin ruido interno del supervisor", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(join(projectPath, "src"), { recursive: true });
		mkdirSync(join(projectPath, "db"), { recursive: true });
		writeFileSync(
			join(projectPath, "package.json"),
			JSON.stringify({ dependencies: { express: "1.0.0", sqlite3: "1.0.0" } }),
			"utf8",
		);
		writeFileSync(
			join(projectPath, "src", "login.html"),
			"<form onclick='login()'></form><script>function login(){}</script>",
			"utf8",
		);
		writeFileSync(
			join(projectPath, "src", "auth.js"),
			"localStorage.getItem('jwt');",
			"utf8",
		);
		writeFileSync(
			join(projectPath, "db", "schema.sql"),
			"create table users(id int);",
			"utf8",
		);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const text = formatIduSupervisorPlanReport({
			bootstrap: { project: { id: "demo" }, criticalDecisions: [] },
			masterPlan: result,
			reviewHandled: false,
		});

		assert.match(text, /PLAN MAESTRO DE INGENIERÍA/u);
		assert.match(text, /Lenguajes: .*HTML/u);
		assert.match(text, /Backend: Node\/Express/u);
		assert.match(text, /Auth\/login\/session detectado/u);
		assert.match(text, /8\. CONTRATOS OPERATIVOS DEL PROYECTO/u);
		assert.match(text, /JS inline, onclick\/onchange inline/u);
		assert.match(text, /9\. VIOLACIONES ACTUALES CONTRA CONTRATOS/u);
		assert.match(text, /HTML mezcla estructura con lógica JS/u);
		assert.match(text, /10\. PLAN DE TRABAJO POR HITOS/u);
		assert.equal(
			existsSync(
				join(stateRoot, "Doc", "demo", "02-violaciones-detectadas.generado.md"),
			),
			true,
		);
		assert.doesNotMatch(
			text,
			/Supervisor:|Supervisor escaló|Project Core|project-local|Plan Maestro no materializada/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("AutoDepth elige deep_required para proyecto grande y no ejecuta AgentLabs", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeLargeProject(projectPath);

		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		assert.equal(result.plan.autoDepth.mode, "deep_required");
		assert.equal(result.plan.deepStage, "lab_requests_prepared");
		assert.equal(result.plan.deepReviewRecommended, true);
		assert.equal(result.plan.deepReviewRequiresApproval, true);
		assert.ok(
			result.plan.safeActionsPerformed.includes(
				"Analicé estructura y señales principales.",
			),
		);
		assert.match(
			formatMasterPlanSummaryForIdu(result),
			/análisis seguro etapa 1 completado; deep review requiere aprobación/i,
		);
		assert.match(
			formatMasterPlanSummaryForIdu(result),
			/Preparé recomendaciones para revisión profunda/u,
		);
		assert.match(
			formatMasterPlanSummaryForIdu(result),
			/usar \/idu para continuar el flujo supervisor/u,
		);
		assert.doesNotMatch(
			formatMasterPlanSummaryForIdu(result),
			/agentlab-request-create postflight latest/u,
		);
		assert.ok(result.plan.autoDepth.skippedAgentLabs.length >= 1);
		assert.ok(
			result.plan.agentLabReviews.every(
				(review) => review.status === "not_run" || review.status === "skipped",
			),
		);
		assert.match(result.plan.recommendedNext.join("\n"), /deep review/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("pending action aprueba o rehace sólo con respuesta natural exacta", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		const draft = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const pending = readMasterPlanPendingAction(stateRoot);
		assert.equal(pending?.type, "approve_master_plan");
		assert.equal(pending?.planPath, draft.current.currentPlanJson);

		assert.equal(
			handleMasterPlanNaturalDecision({
				text: "broken",
				projectId: "demo",
				projectPath,
				stateRoot,
				source: "cli",
			}).handled,
			false,
		);
		assert.equal(
			handleMasterPlanNaturalDecision({
				text: "token",
				projectId: "demo",
				projectPath,
				stateRoot,
				source: "cli",
			}).handled,
			false,
		);
		const approved = handleMasterPlanNaturalDecision({
			text: "ok dale",
			projectId: "demo",
			projectPath,
			stateRoot,
			source: "cli",
		});
		assert.equal(approved.handled, true);
		assert.equal(approved.action, "approved");
		assert.equal(readMasterPlanPendingAction(stateRoot), undefined);

		const ignored = handleMasterPlanNaturalDecision({
			text: "dale",
			projectId: "demo",
			projectPath,
			stateRoot,
			source: "cli",
		});
		assert.equal(ignored.handled, false);

		generateMasterPlanDraft({ projectId: "demo", projectPath, stateRoot });
		const redrafted = handleMasterPlanNaturalDecision({
			text: "rehacer",
			projectId: "demo",
			projectPath,
			stateRoot,
			source: "cli",
		});
		assert.equal(redrafted.handled, true);
		assert.equal(redrafted.action, "redrafted");
		assert.equal(
			readMasterPlanPendingAction(stateRoot)?.type,
			"approve_master_plan",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("memory provider local fake y fallido se integra sin bloquear", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		const fake = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			memoryProvider: {
				provider: "engram",
				load: () => ({
					provider: "engram",
					status: "available",
					summary: "Arquitectura aceptada: CLI como adapter fino.",
					evidence: Array.from({ length: 20 }, (_, index) => `memory-${index}`),
				}),
			},
		});
		assert.equal(fake.plan.memoryContext.provider, "engram");
		assert.equal(fake.plan.memoryContext.status, "available");
		assert.ok(fake.plan.memoryContext.evidence.length <= 8);
		assert.match(
			formatMasterPlanSummaryForIdu(fake),
			/Memoria:\nengram\/available/u,
		);

		const local = loadExternalProjectMemory({ projectId: "demo", stateRoot });
		assert.equal(local.provider, "local");
		assert.equal(local.status, "available");

		const fallback = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			memoryProvider: {
				provider: "engram",
				load: () => {
					throw new Error("engram unavailable");
				},
			},
		});
		assert.equal(fallback.plan.memoryContext.provider, "local");
		assert.equal(fallback.plan.memoryContext.status, "available");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("approve reject y redraft actualizan current sin borrar drafts anteriores", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		const first = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});

		const approved = approveMasterPlan({
			stateRoot,
			pathOrLatest: "latest",
			source: "cli",
			reason: "usuario confirmó contratos",
		});
		assert.equal(approved.plan.status, "approved");
		assert.equal(approved.current.status, "approved");
		assert.equal(approved.plan.approval?.source, "cli");
		assert.equal(approved.plan.approval?.reason, "usuario confirmó contratos");
		assert.equal(
			(
				JSON.parse(
					readFileSync(join(stateRoot, "master-plan.flows.json"), "utf8"),
				) as { status: string }
			).status,
			"approved",
		);

		const rejected = rejectMasterPlan({
			stateRoot,
			pathOrLatest: "latest",
			reason: "objetivo incompleto",
		});
		assert.equal(rejected.plan.status, "rejected");
		assert.equal(rejected.plan.approval?.reason, "objetivo incompleto");

		const second = redraftMasterPlan({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head2",
			reason: "rehacer",
		});
		assert.equal(second.current.currentPlanJson, first.current.currentPlanJson);
		assert.equal(second.current.currentPlanJson, "master-plan.json");
		assert.equal(
			existsSync(join(stateRoot, first.current.currentPlanJson)),
			true,
		);
		assert.equal(second.plan.status, "draft");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("status detecta approved vigente y marca stale si gitHead cambia", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeSmallProject(projectPath);
		generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "same",
		});
		approveMasterPlan({ stateRoot, pathOrLatest: "latest", source: "cli" });

		const current = getMasterPlanStatus({ stateRoot, currentGitHead: "same" });
		assert.equal(current.status, "approved");
		assert.match(
			formatMasterPlanSummaryForIdu({
				status: current,
				plan: reviewMasterPlan({ stateRoot, pathOrLatest: "latest" }).plan,
			}),
			/Continuar con prepare\/flows según corresponda/u,
		);
		const stale = getMasterPlanStatus({ stateRoot, currentGitHead: "changed" });
		assert.equal(stale.status, "stale");
		assert.match(
			formatMasterPlanSummaryForIdu({
				status: stale,
				plan: reviewMasterPlan({ stateRoot, pathOrLatest: "latest" }).plan,
			}),
			/master-plan-redraft latest/u,
		);
		assert.equal(
			JSON.parse(
				readFileSync(join(stateRoot, "master-plan.current.json"), "utf8"),
			).status,
			"stale",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review rechaza rutas fuera de stateRoot", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		const sibling = join(root, "state", "projects", "demo-evil");
		mkdirSync(projectPath, { recursive: true });
		mkdirSync(sibling, { recursive: true });
		writeSmallProject(projectPath);
		generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		writeFileSync(join(sibling, "escape.json"), "{}", "utf8");

		assert.throws(
			() =>
				reviewMasterPlan({
					stateRoot,
					pathOrLatest: join(sibling, "escape.json"),
				}),
			/Master Plan fuera de stateRoot/u,
		);

		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../demo-evil/escape.json",
				currentPlanMd: "../demo-evil/escape.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		assert.match(
			formatMasterPlanReview(
				reviewMasterPlan({ stateRoot, pathOrLatest: "latest" }),
			),
			/Plan Maestro incompatible/u,
		);
		assert.throws(
			() =>
				approveMasterPlan({ stateRoot, pathOrLatest: "latest", source: "cli" }),
			/Master Plan fuera de stateRoot/u,
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../demo-evil/escape.json",
				currentPlanMd: "reports/master-plan.md",
				status: "approved",
				projectId: "demo",
				projectPath,
				gitHead: "old-head",
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		assert.equal(
			getMasterPlanStatus({ stateRoot, currentGitHead: "new-head" }).status,
			"incompatible",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("memory es liviano y review/summary son humanos", () => {
	const root = tempRoot();
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state", "projects", "demo");
		mkdirSync(projectPath, { recursive: true });
		writeStandardProject(projectPath);
		const result = generateMasterPlanDraft({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		const memory = JSON.parse(
			readFileSync(join(stateRoot, "master-plan.memory.json"), "utf8"),
		) as Record<string, unknown>;
		assert.equal(memory.currentPlanJson, result.current.currentPlanJson);
		assert.equal("detectedModules" in memory, false);
		assert.equal("detectedFlows" in memory, false);
		assert.ok(
			JSON.stringify(memory).length < JSON.stringify(result.plan).length / 2,
		);

		const review = reviewMasterPlan({ stateRoot, pathOrLatest: "latest" });
		assert.match(formatMasterPlanReview(review), /Plan Maestro Idu-pi/u);
		assert.match(formatMasterPlanSummaryForIdu(result), /AutoDepth:/u);
		assert.match(
			formatMasterPlanSummaryForIdu(result),
			/Responder "ok" para aprobar, "rehacer" para regenerar/u,
		);
		assert.doesNotMatch(
			formatMasterPlanSummaryForIdu(result),
			/Acción principal:[\s\S]*idu-pi idu-prepare/u,
		);
		writeFileSync(
			join(stateRoot, "master-plan.current.json"),
			JSON.stringify({
				currentPlanJson: "../demo-evil/escape.json",
				currentPlanMd: "reports/master-plan.md",
				status: "draft",
				projectId: "demo",
				projectPath,
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		const regenerated = ensureMasterPlanForIdu({
			projectId: "demo",
			projectPath,
			stateRoot,
			gitHead: "head1",
		});
		assert.equal("current" in regenerated, true);
		if (!("current" in regenerated))
			throw new Error("expected regenerated draft");
		assert.equal(regenerated.plan.schemaVersion, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
