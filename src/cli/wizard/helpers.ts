/**
 * helpers.ts — setup wizard activation helpers.
 *
 * Internal-only. Re-exported by `index.ts`. Used by `src/cli.ts` for
 * the `runWizardActivateSupervisor` flow (called by the setup command).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalDirectory, isAllowedCwd } from "../../config.js";
import {
	applyPackageEnvDefaults,
	resolveIduRegistryPath,
} from "../../cli-home.js";
import {
	activateIduSession,
	configureIduSessionStore,
} from "../../idu-session.js";
import {
	loadRegistry,
	type ProjectEntry,
	type ProjectRegistry,
} from "../../projects.js";

export function runWizardActivateSupervisor(): string {
	try {
		applyPackageEnvDefaults();
		const defaultCwd = canonicalDirectory(requiredEnvForWizard("DEFAULT_CWD"));
		const allowedRoots = parseAllowedRootsForWizard(
			process.env.ALLOWED_ROOTS,
			defaultCwd,
		);
		const registry = loadRegistry(defaultCwd, allowedRoots, {
			registryPath: resolveIduRegistryPath(),
			createIfMissing: false,
		});
		const projectPath = canonicalDirectory(process.cwd());
		if (!isAllowedCwd(projectPath, allowedRoots)) {
			return wizardActivationDiagnostic(
				`cwd fuera de ALLOWED_ROOTS: ${projectPath}`,
			);
		}
		const project = registeredProjectForPath(registry, projectPath);
		if (!project) {
			return wizardActivationDiagnostic(
				"Proyecto no registrado; el wizard no enrola automáticamente.",
			);
		}
		if (!project.stateRoot || !existsSync(project.stateRoot)) {
			return wizardActivationDiagnostic(
				"Proyecto registrado sin stateRoot aislado existente; re-enrolalo antes de activar.",
			);
		}
		configureIduSessionStore({
			workspaceRoot: project.stateRoot,
			filePath: join(project.stateRoot, "idu-session-state.json"),
		});
		activateIduSession(project.id);
		return [
			"Guardrails automáticas activados para el proyecto activo.",
			"No ejecuté bootstrap, scans, prepare ni AgentLabs desde el wizard.",
			`projectId: ${project.id}`,
			`projectPath: ${project.path}`,
			`stateRoot: ${project.stateRoot}`,
		].join("\n");
	} catch (error) {
		return wizardActivationDiagnostic(
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function registeredProjectForPath(
	registry: ProjectRegistry,
	projectPath: string,
): ProjectEntry | undefined {
	const normalize = (value: string) =>
		process.platform === "win32" ? value.toLowerCase() : value;
	return registry.projects.find(
		(project) => normalize(project.path) === normalize(projectPath),
	);
}

export function requiredEnvForWizard(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing required env var: ${name}`);
	return value;
}

export function parseAllowedRootsForWizard(
	raw: string | undefined,
	defaultCwd: string,
): string[] {
	return (raw?.trim() ? raw.split(";") : [defaultCwd])
		.map((entry) => canonicalDirectory(entry.trim()))
		.filter(Boolean);
}

export function wizardActivationDiagnostic(reason: string): string {
	return [
		"No pude activar guardrails desde el wizard.",
		`Qué pasó: ${reason}`,
		"Acción recomendada: primero enrolá o bootstrappeá el proyecto de forma explícita.",
		"Comando sugerido: idu-pi project enroll .",
	].join("\n");
}
