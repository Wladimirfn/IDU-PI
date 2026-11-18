import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildWorkerArgs } from "./cmdline.js";
import { IDU_HOME, loadIduConfig } from "./config.js";
import { inspectProfileEffort, type EffortInspection } from "./effort.js";
import {
	extractRoleRank,
	inferProfileRole,
	LEGACY_AGENT_ALIASES,
	listFleets,
	resolveEffectiveFleet,
} from "./fleets.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { canonicalHarnessName } from "./session-policy.js";
import {
	runCreateAgentAction,
	runDeleteAgentAction,
	runEditEffortAction,
	runEditModelAction,
	runManageFleetsAction,
	runManualTerminalAction,
	runMigrateLegacyAction,
	runTestTerminalsForCurrentAgent,
} from "./tui-editor.js";
import type { CapabilitiesResult, IduConfig, IduProfile, ReasoningEffort } from "./types.js";

export { extractRoleRank, inferProfileRole } from "./fleets.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_PURPLE = "\x1b[35m";
const ANSI_BRIGHT_PURPLE = "\x1b[95m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RED = "\x1b[31m";
const ANSI_REVERSE = "\x1b[7m";
const ANSI_ALT_SCREEN_ON = "\x1b[?1049h";
const ANSI_ALT_SCREEN_OFF = "\x1b[?1049l";
const ANSI_HOME_CLEAR = "\x1b[H\x1b[2J";
const ANSI_HIDE_CURSOR = "\x1b[?25l";
const ANSI_SHOW_CURSOR = "\x1b[?25h";

const ROLE_ORDER = [
	"Todos",
	"Trabajo",
	"Auditoría",
	"Diseño",
	"Arquitectura",
	"Consultas",
	"Exploración",
	"Iconografía",
	"Voz",
	"Música",
	"Otros",
] as const;

export interface AgentEntry {
	name: string;
	role: string;
	rank: number;
	harness: string;
	canonicalHarness: string;
	cliAvailable: boolean;
	cliCommand: string;
	provider?: string;
	modelDisplay: string;
	effort?: ReasoningEffort;
	effectiveEffort?: ReasoningEffort;
	effortSource: EffortInspection["source"];
	effortBadge: string;
	effortDetail: string;
	permissions: "read-only" | "workspace";
	streams: boolean;
	timeoutLabel: string;
	commandPreview: string;
	description: string;
	rawProfile?: IduProfile;
}

export interface AgentTuiSnapshot {
	version: string;
	iduHome: string;
	activeFleet: string;
	fleetSource: string;
	availableFleets: string[];
	hasLegacyNames: boolean;
	profilesPath: string;
	replaceDefaults: boolean;
	installedClis: Array<{ name: string; command: string; available: boolean }>;
	roles: Array<{ role: string; count: number }>;
	agents: AgentEntry[];
	rawProfiles?: Record<string, IduProfile>;
}

export interface AgentTuiState {
	roleIndex: number;
	selectedIndex: number;
	scrollOffset: number;
	lastReloadedAt?: string;
}

export interface TuiKeyEvent {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
	sequence?: string;
}

const ANSI_STRIP_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
	return text.replace(ANSI_STRIP_RE, "");
}

function visibleLength(text: string): number {
	return stripAnsi(text).length;
}

function truncateVisible(text: string, maxCols: number): string {
	if (maxCols <= 0) return "";
	const plain = stripAnsi(text);
	if (plain.length <= maxCols) return text;
	if (maxCols === 1) return "…";
	let vis = 0;
	let out = "";
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\x1b") {
			const match = text.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
			if (match) {
				out += match[0];
				i += match[0].length - 1;
				continue;
			}
		}
		if (vis >= maxCols - 1) break;
		out += text[i];
		vis++;
	}
	return `${out}…${text.includes("\x1b[") ? ANSI_RESET : ""}`;
}

function padRightVisible(text: string, width: number): string {
	const trimmed = truncateVisible(text, width);
	const len = visibleLength(trimmed);
	return len >= width ? trimmed : trimmed + " ".repeat(width - len);
}

function wrapText(text: string, width: number): string[] {
	const safeWidth = Math.max(16, width);
	const lines: string[] = [];
	for (const paragraph of text.split(/\r?\n/)) {
		const words = paragraph.trim().split(/\s+/).filter(Boolean);
		if (words.length === 0) {
			lines.push("");
			continue;
		}
		let current = words[0];
		for (let i = 1; i < words.length; i++) {
			const w = words[i];
			if (current.length + 1 + w.length <= safeWidth) {
				current += ` ${w}`;
			} else {
				lines.push(current);
				current = w;
			}
		}
		lines.push(current);
	}
	return lines;
}

function readPackageVersion(): string {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		for (const rel of [join("..", "..", "package.json"), join("..", "package.json")]) {
			const p = join(here, rel);
			if (existsSync(p)) {
				const parsed = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
				if (parsed.version) return parsed.version;
			}
		}
	} catch {
		// fall back cleanly
	}
	return "2.3.0";
}

function formatDurationMs(ms?: number): string {
	if (!ms || ms <= 0) return "-";
	if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
	if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
	return `${Math.round(ms / 1000)}s`;
}

function formatCommandPreview(profile: IduProfile, config: IduConfig): string {
	try {
		const built = buildWorkerArgs(profile, "<task>", [], config);
		const bin = basename(built.command);
		const args = built.args.map((a) => (a === "<task>" ? '"<task>"' : a));
		return `${bin} ${args.join(" ")}`.trim();
	} catch {
		return profile.harness;
	}
}

export function buildAgentTuiSnapshot(params: {
	capabilities: CapabilitiesResult;
	config: IduConfig;
	replaceDefaults?: boolean;
	profilesPath?: string;
	version?: string;
	iduHome?: string;
	cliHomeDir?: string;
	activeFleet?: string;
	fleetSource?: string;
	availableFleets?: string[];
}): AgentTuiSnapshot {
	const {
		capabilities,
		config,
		replaceDefaults = false,
		profilesPath = join(process.env.IDU_HOME || IDU_HOME, "profiles.json"),
		version = readPackageVersion(),
		iduHome = process.env.IDU_HOME || IDU_HOME,
		cliHomeDir,
		activeFleet = capabilities.activeFleet ?? "default",
		fleetSource = capabilities.fleetSource ?? "default",
		availableFleets = capabilities.availableFleets ?? ["default"],
	} = params;

	const cliByName = new Map(capabilities.installedClis.map((c) => [c.name.toLowerCase(), c]));
	const agents: AgentEntry[] = Object.entries(capabilities.profiles).map(([name, profile]) => {
		const canonical = canonicalHarnessName(profile.harness.trim().toLowerCase());
		const cliInfo = cliByName.get(canonical) ?? cliByName.get(profile.harness.trim().toLowerCase());
		const role = inferProfileRole(name, profile);
		const rank = extractRoleRank(profile.description, name);
		const modelDisplay = profile.provider && !profile.model?.startsWith(`${profile.provider}/`)
			? `${profile.provider}/${profile.model || "default"}`
			: profile.model || "default";
		const effortInfo = inspectProfileEffort(profile, cliHomeDir);
		const timeout = formatDurationMs(profile.timeoutMs ?? config.defaultTimeoutMs);
		const idle = formatDurationMs(profile.idleTimeoutMs);
		const cap = formatDurationMs(profile.hardCapMs);

		return {
			name,
			role,
			rank,
			harness: profile.harness,
			canonicalHarness: canonical,
			cliAvailable: cliInfo?.available ?? false,
			cliCommand: cliInfo?.command || canonical,
			provider: profile.provider,
			modelDisplay,
			...(effortInfo.explicit ? { effort: effortInfo.explicit } : {}),
			...(effortInfo.effective ? { effectiveEffort: effortInfo.effective } : {}),
			effortSource: effortInfo.source,
			effortBadge: effortInfo.badge,
			effortDetail: effortInfo.detail,
			permissions: profile.permissions === "workspace" ? "workspace" : "read-only",
			streams: Boolean(profile.streams),
			timeoutLabel: `${timeout} · idle ${idle} · cap ${cap}`,
			commandPreview: formatCommandPreview(profile, config),
			description: profile.description?.trim() || "(sin descripción)",
			rawProfile: profile,
		};
	});

	const roleIndexOrder = new Map<string, number>(ROLE_ORDER.map((r, i) => [r, i]));
	agents.sort((a, b) => {
		const ra = roleIndexOrder.get(a.role) ?? 999;
		const rb = roleIndexOrder.get(b.role) ?? 999;
		if (ra !== rb) return ra - rb;
		if (a.role !== b.role) return a.role.localeCompare(b.role);
		if (a.rank !== b.rank) return a.rank - b.rank;
		return a.name.localeCompare(b.name);
	});

	const counts = new Map<string, number>();
	for (const ag of agents) {
		counts.set(ag.role, (counts.get(ag.role) ?? 0) + 1);
	}
	const roles: Array<{ role: string; count: number }> = [{ role: "Todos", count: agents.length }];
	for (const canonicalRole of ROLE_ORDER.slice(1)) {
		const count = counts.get(canonicalRole) ?? 0;
		if (count > 0) roles.push({ role: canonicalRole, count });
	}
	for (const [role, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (!roleIndexOrder.has(role) && count > 0) {
			roles.push({ role, count });
		}
	}

	const hasLegacyNames = Object.keys(capabilities.profiles).some((name) => name in LEGACY_AGENT_ALIASES);

	return {
		version,
		iduHome,
		activeFleet,
		fleetSource,
		availableFleets,
		hasLegacyNames,
		profilesPath,
		replaceDefaults,
		installedClis: capabilities.installedClis,
		roles,
		agents,
		rawProfiles: capabilities.profiles,
	};
}

export async function loadAgentTuiSnapshot(options: { fleet?: string; workingDir?: string } = {}): Promise<AgentTuiSnapshot> {
	const workingDir = options.workingDir ?? process.cwd();
	const effective = resolveEffectiveFleet({ fleet: options.fleet, workingDir });
	const [capabilities, config] = await Promise.all([
		CrossCliProcessManager.getInstance().getCapabilities({
			fleet: options.fleet,
			projectPath: workingDir,
		}),
		Promise.resolve(loadIduConfig()),
	]);
	return buildAgentTuiSnapshot({
		capabilities,
		config,
		replaceDefaults: Boolean(effective.config.replaceDefaults),
		profilesPath: effective.filePath,
		cliHomeDir: homedir(),
		activeFleet: effective.fleetName,
		fleetSource: effective.source,
		availableFleets: listFleets().map((f) => f.name),
	});
}

export function getFilteredAgents(snapshot: AgentTuiSnapshot, state: AgentTuiState): AgentEntry[] {
	const activeRole = snapshot.roles[state.roleIndex]?.role ?? "Todos";
	if (activeRole === "Todos") return snapshot.agents;
	return snapshot.agents.filter((a) => a.role === activeRole);
}

export function createTuiState(): AgentTuiState {
	return { roleIndex: 0, selectedIndex: 0, scrollOffset: 0 };
}

export type TuiReducerOutcome =
	| { action: "stay"; state: AgentTuiState }
	| { action: "reload"; state: AgentTuiState }
	| { action: "quit"; state: AgentTuiState }
	| { action: "edit-model"; state: AgentTuiState }
	| { action: "edit-effort"; state: AgentTuiState }
	| { action: "edit-harness"; state: AgentTuiState }
	| { action: "test-terminals"; state: AgentTuiState }
	| { action: "manage-fleets"; state: AgentTuiState }
	| { action: "create-agent"; state: AgentTuiState }
	| { action: "delete-agent"; state: AgentTuiState }
	| { action: "migrate-slots"; state: AgentTuiState };

export function reduceTuiState(
	state: AgentTuiState,
	snapshot: AgentTuiSnapshot,
	key: TuiKeyEvent,
	visibleRows = 12,
): TuiReducerOutcome {
	if (key.ctrl && key.name === "c") {
		return { action: "quit", state };
	}
	const seq = key.sequence ?? "";
	if (key.name === "q" || key.name === "escape" || seq === "q" || seq === "Q") {
		return { action: "quit", state };
	}
	if (key.name === "r" || seq === "r" || seq === "R") {
		return { action: "reload", state };
	}
	if (key.name === "f" || seq === "f" || seq === "F") {
		return { action: "manage-fleets", state };
	}
	if (key.name === "n" || seq === "n" || seq === "N") {
		return { action: "create-agent", state };
	}
	if (key.name === "u" || seq === "u" || seq === "U") {
		return { action: "migrate-slots", state };
	}
	if (key.name === "return" || key.name === "enter" || key.name === "m" || seq === "m" || seq === "M") {
		return { action: "edit-model", state };
	}
	if (key.name === "e" || seq === "e" || seq === "E") {
		return { action: "edit-effort", state };
	}
	if (key.name === "t" || seq === "t" || seq === "T") {
		return { action: "test-terminals", state };
	}
	if (key.name === "c" || seq === "c" || seq === "C") {
		return { action: "edit-harness", state };
	}
	if (key.name === "x" || seq === "x" || seq === "X") {
		return { action: "delete-agent", state };
	}

	const roleCount = Math.max(1, snapshot.roles.length);
	const switchRole = (nextRoleIdx: number): TuiReducerOutcome => {
		const wrapped = ((nextRoleIdx % roleCount) + roleCount) % roleCount;
		return {
			action: "stay",
			state: { ...state, roleIndex: wrapped, selectedIndex: 0, scrollOffset: 0 },
		};
	};

	if (key.name === "tab") {
		return switchRole(state.roleIndex + (key.shift ? -1 : 1));
	}
	if (key.name === "left" || key.name === "h" || seq === "h") {
		return switchRole(state.roleIndex - 1);
	}
	if (key.name === "right" || key.name === "l" || seq === "l") {
		return switchRole(state.roleIndex + 1);
	}
	if (/^[0-9]$/.test(seq)) {
		const idx = Number.parseInt(seq, 10);
		if (idx < roleCount) return switchRole(idx);
	}

	const items = getFilteredAgents(snapshot, state);
	if (items.length === 0) return { action: "stay", state };

	let nextIdx = state.selectedIndex;
	if (key.name === "down" || key.name === "j" || seq === "j") {
		nextIdx = Math.min(items.length - 1, state.selectedIndex + 1);
	} else if (key.name === "up" || key.name === "k" || seq === "k") {
		nextIdx = Math.max(0, state.selectedIndex - 1);
	} else if (key.name === "pagedown") {
		nextIdx = Math.min(items.length - 1, state.selectedIndex + Math.max(1, visibleRows - 1));
	} else if (key.name === "pageup") {
		nextIdx = Math.max(0, state.selectedIndex - Math.max(1, visibleRows - 1));
	} else if (key.name === "home" || seq === "g") {
		nextIdx = 0;
	} else if (key.name === "end" || seq === "G") {
		nextIdx = items.length - 1;
	} else {
		return { action: "stay", state };
	}

	const pageSize = Math.max(1, visibleRows);
	let nextScroll = state.scrollOffset;
	if (nextIdx < nextScroll) nextScroll = nextIdx;
	else if (nextIdx >= nextScroll + pageSize) nextScroll = nextIdx - pageSize + 1;

	return {
		action: "stay",
		state: { ...state, selectedIndex: nextIdx, scrollOffset: nextScroll },
	};
}

function formatLogoLines(useColor: boolean): string[] {
	const raw = [
		"██╗██████╗ ██╗   ██╗      ██████╗  ██╗",
		"██║██╔══██╗██║   ██║      ██╔══██╗ ██║",
		"██║██║  ██║██║   ██║████╗██████╔╝ ██║",
		"██║██║  ██║██║   ██║╚═══╝██╔═══╝  ██║",
		"██║██████╔╝╚██████╔╝     ██║      ██║",
		"╚═╝╚═════╝  ╚═════╝      ╚═╝      ╚═╝",
	];
	if (!useColor) return raw;
	return raw.map((line, i) => `${i % 2 === 0 ? ANSI_BRIGHT_PURPLE : ANSI_PURPLE}${line}${ANSI_RESET}`);
}

export function renderAgentTui(
	snapshot: AgentTuiSnapshot,
	state: AgentTuiState,
	options: { width?: number; height?: number; useColor?: boolean } = {},
): string {
	const width = Math.max(72, options.width ?? 116);
	const height = Math.max(22, options.height ?? 32);
	const useColor = options.useColor ?? false;

	const c = (code: string, text: string) => (useColor ? `${code}${text}${ANSI_RESET}` : text);
	const homeShort = snapshot.profilesPath.replace(homedir(), "~");

	const out: string[] = [];
	if (height >= 28) {
		out.push(...formatLogoLines(useColor));
	}
	const fleetBadge = c(ANSI_BOLD + ANSI_CYAN, `Flota: ${snapshot.activeFleet}`) + c(ANSI_DIM, ` (${snapshot.fleetSource})`);
	const legacyBadge = snapshot.hasLegacyNames ? `  ·  ${c(ANSI_YELLOW, "[u] Migrar nombres viejos")}` : "";
	const titleLine = `${c(ANSI_BOLD + ANSI_BRIGHT_PURPLE, "IDU-PI")} ${c(ANSI_DIM, `v${snapshot.version}`)}  ·  ${fleetBadge}  ·  ${c(ANSI_CYAN, "Agentes")} ${c(ANSI_BOLD, `(${snapshot.agents.length})`)}  ·  ${c(ANSI_DIM, `${homeShort} [${snapshot.replaceDefaults ? "replaceDefaults" : "merged"}]`)}${legacyBadge}`;
	out.push(truncateVisible(titleLine, width));

	const okCount = snapshot.installedClis.filter((cli) => cli.available).length;
	const cliBadges = snapshot.installedClis
		.map((cli) =>
			cli.available
				? c(ANSI_GREEN, `● ${cli.name}`)
				: c(ANSI_RED, `○ ${cli.name}`),
		)
		.join("  ");
	out.push(truncateVisible(`${c(ANSI_DIM, `CLIs (${okCount}/${snapshot.installedClis.length}):`)} ${cliBadges}`, width));

	const tabLine = snapshot.roles
		.map((r, idx) => {
			const label = `[${idx}] ${r.role} (${r.count})`;
			return idx === state.roleIndex ? c(ANSI_REVERSE + ANSI_CYAN, ` ${label} `) : c(ANSI_DIM, label);
		})
		.join(" ");
	out.push(truncateVisible(tabLine, width));
	out.push(c(ANSI_DIM, "─".repeat(width)));

	const items = getFilteredAgents(snapshot, state);
	const clampedIdx = Math.min(state.selectedIndex, Math.max(0, items.length - 1));
	const selected = items[clampedIdx];

	const headerLinesUsed = out.length;
	const footerLines = 2;
	const bodyRows = Math.max(8, height - headerLinesUsed - footerLines);
	const showSideBySide = width >= 96;

	if (showSideBySide) {
		const leftW = Math.floor(width * 0.56);
		const rightW = width - leftW - 3;
		const listRows = bodyRows - 1;
		const scroll = Math.max(0, Math.min(state.scrollOffset, Math.max(0, items.length - listRows)));

		const leftHeader = c(ANSI_BOLD + ANSI_CYAN, padRightVisible(`Perfiles (${items.length})`, leftW));
		const rightHeader = c(ANSI_BOLD + ANSI_CYAN, padRightVisible(selected ? `Detalle · ${selected.name}` : "Detalle", rightW));
		out.push(`${leftHeader} ${c(ANSI_DIM, "│")} ${rightHeader}`);

		const detailLines = buildInspectorLines(selected, rightW, useColor);
		for (let row = 0; row < listRows; row++) {
			const ag = items[scroll + row];
			const leftCell = ag ? formatAgentListRow(ag, scroll + row === clampedIdx, leftW, useColor) : " ".repeat(leftW);
			const rightCell = padRightVisible(detailLines[row] ?? "", rightW);
			out.push(`${leftCell} ${c(ANSI_DIM, "│")} ${rightCell}`);
		}
	} else {
		const detailLines = buildInspectorLines(selected, width, useColor);
		const detailH = Math.min(detailLines.length + 1, Math.max(5, Math.floor(bodyRows * 0.45)));
		const listRows = Math.max(4, bodyRows - detailH - 1);
		const scroll = Math.max(0, Math.min(state.scrollOffset, Math.max(0, items.length - listRows)));

		for (let row = 0; row < listRows; row++) {
			const ag = items[scroll + row];
			out.push(ag ? formatAgentListRow(ag, scroll + row === clampedIdx, width, useColor) : "");
		}
		out.push(c(ANSI_DIM, "─".repeat(width)));
		for (let row = 0; row < detailH - 1; row++) {
			out.push(truncateVisible(detailLines[row] ?? "", width));
		}
	}

	out.push(c(ANSI_DIM, "─".repeat(width)));
	const reloadTag = state.lastReloadedAt ? `  · ${state.lastReloadedAt}` : "";
	const migrateHint = snapshot.hasLegacyNames ? "  · u Migrar" : "";
	out.push(
		truncateVisible(
			c(ANSI_DIM, `↑/↓ Mover · ←/→ Tab Rol · Enter/m Modelo · e Esfuerzo · t Test · c Terminal · f Perfiles · n Nuevo · x Borrar${migrateHint} · r Recargar · q Salir${reloadTag}`),
			width,
		),
	);

	return out.join("\n");
}

function formatAgentListRow(agent: AgentEntry, isSelected: boolean, width: number, useColor: boolean): string {
	const pointer = isSelected ? "►" : " ";
	const permTag = agent.permissions === "workspace" ? "W" : "R";
	const cliTag = agent.cliAvailable ? "✓" : "✗";
	const rankTag = agent.rank < 999 ? `#${agent.rank}` : "  ";
	const effTag = agent.effortBadge.padEnd(5).slice(0, 5);
	const raw = `${pointer} ${agent.name.padEnd(13)} ${agent.role.slice(0, 10).padEnd(10)} ${rankTag} ${cliTag} ${agent.harness.padEnd(10)} ${permTag} ${effTag} ${agent.modelDisplay}`;
	const padded = padRightVisible(raw, width);
	if (!useColor) return padded;
	if (isSelected) return `${ANSI_REVERSE}${ANSI_CYAN}${padded}${ANSI_RESET}`;
	if (!agent.cliAvailable) return `${ANSI_YELLOW}${padded}${ANSI_RESET}`;
	return padded;
}

function buildInspectorLines(agent: AgentEntry | undefined, width: number, useColor: boolean): string[] {
	if (!agent) return ["No hay perfiles configurados para este rol."];
	const c = (code: string, text: string) => (useColor ? `${code}${text}${ANSI_RESET}` : text);
	const cliState = agent.cliAvailable
		? c(ANSI_GREEN, `OK (${agent.cliCommand})`)
		: c(ANSI_RED, `NO ENCONTRADO (${agent.harness})`);
	const permState =
		agent.permissions === "workspace" ? c(ANSI_YELLOW, "workspace (escritura)") : c(ANSI_GREEN, "read-only");
	const effortValue =
		agent.effortSource === "explicit" || agent.effortSource === "model-suffix"
			? c(ANSI_BRIGHT_PURPLE, agent.effortDetail)
			: agent.effortDetail;

	const lines = [
		`${c(ANSI_DIM, "Rol:")}        ${agent.role}${agent.rank < 999 ? ` (prioridad ${agent.rank})` : ""}`,
		`${c(ANSI_DIM, "CLI:")}        ${cliState}`,
		`${c(ANSI_DIM, "Modelo:")}     ${c(ANSI_BOLD, agent.modelDisplay)}`,
		`${c(ANSI_DIM, "Esfuerzo:")}   ${effortValue}`,
		`${c(ANSI_DIM, "Permisos:")}   ${permState}  ·  streams: ${agent.streams ? "sí" : "no"}`,
		`${c(ANSI_DIM, "Timeouts:")}   ${agent.timeoutLabel}`,
		"",
		c(ANSI_DIM, "Comando real:"),
		...wrapText(agent.commandPreview, width - 2).map((l) => `  ${c(ANSI_CYAN, l)}`),
		"",
		c(ANSI_DIM, "Descripción:"),
		...wrapText(agent.description, width - 2).map((l) => `  ${l}`),
	];
	return lines;
}

/** Plain text non-TTY rendering showing every configured agent cleanly. */
export function renderAgentsPlain(snapshot: AgentTuiSnapshot): string {
	const lines: string[] = [
		`IDU-PI v${snapshot.version} — Flota: ${snapshot.activeFleet} (${snapshot.fleetSource}) — Agentes (${snapshot.agents.length})`,
		`Profiles: ${snapshot.profilesPath} [${snapshot.replaceDefaults ? "replaceDefaults" : "merged"}]`,
		`Flotas disponibles: ${snapshot.availableFleets.join(", ")}`,
		`CLIs OK: ${snapshot.installedClis.filter((c) => c.available).map((c) => c.name).join(", ") || "ninguno"}`,
		"",
	];
	let lastRole = "";
	for (const ag of snapshot.agents) {
		if (ag.role !== lastRole) {
			lines.push(`[${ag.role}]`);
			lastRole = ag.role;
		}
		const cliMark = ag.cliAvailable ? "OK" : "MISSING";
		const rank = ag.rank < 999 ? `#${ag.rank}` : "  ";
		const effTag = `[${ag.effortBadge}]`.padEnd(7);
		lines.push(
			`  ${rank} ${ag.name.padEnd(15)} ${ag.harness.padEnd(12)} [${cliMark}] ${effTag} ${ag.permissions.padEnd(9)} ${ag.modelDisplay}`,
		);
	}
	return lines.join("\n");
}

export async function runAgentsTui(options: { plain?: boolean; json?: boolean; fleet?: string; workingDir?: string } = {}): Promise<void> {
	let currentFleet = options.fleet;
	const workingDir = options.workingDir ?? process.cwd();
	let snapshot = await loadAgentTuiSnapshot({ fleet: currentFleet, workingDir });

	if (options.json) {
		console.log(JSON.stringify(snapshot, null, 2));
		return;
	}

	const interactive = !options.plain && Boolean(process.stdin.isTTY && process.stdout.isTTY);
	if (!interactive) {
		console.log(renderAgentsPlain(snapshot));
		return;
	}

	const stdin = process.stdin;
	const stdout = process.stdout;
	let state = createTuiState();
	let cleanupDone = false;
	let modalBusy = false;

	const draw = () => {
		const width = stdout.columns || 100;
		const height = stdout.rows || 30;
		const frame = renderAgentTui(snapshot, state, { width, height, useColor: true });
		stdout.write(`${ANSI_HOME_CLEAR}${frame}`);
	};

	const reloadSnapshot = async (resetSelection = false) => {
		snapshot = await loadAgentTuiSnapshot({ fleet: currentFleet, workingDir });
		const filtered = getFilteredAgents(snapshot, state);
		state = {
			...state,
			roleIndex: Math.min(state.roleIndex, Math.max(0, snapshot.roles.length - 1)),
			selectedIndex: resetSelection ? 0 : Math.min(state.selectedIndex, Math.max(0, filtered.length - 1)),
			scrollOffset: resetSelection ? 0 : state.scrollOffset,
			lastReloadedAt: new Date().toLocaleTimeString(),
		};
	};

	await new Promise<void>((resolve) => {
		const onKeypress = async (_str: string, key: TuiKeyEvent) => {
			if (modalBusy) return;
			const pageRows = Math.max(8, (stdout.rows || 30) - 14);
			const outcome = reduceTuiState(state, snapshot, key, pageRows);
			state = outcome.state;
			if (outcome.action === "quit") {
				finish();
				return;
			}
			if (outcome.action === "reload") {
				await reloadSnapshot(true);
				draw();
				return;
			}
			if (outcome.action === "stay") {
				draw();
				return;
			}

			// Interactive editor modals suspend the browse keypress listener cleanly.
			modalBusy = true;
			stdin.off("keypress", onKeypress);
			try {
				const items = getFilteredAgents(snapshot, state);
				const selected = items[Math.min(state.selectedIndex, Math.max(0, items.length - 1))];
				const ctx = {
					io: { stdin, stdout },
					activeFleet: snapshot.activeFleet,
					workingDir,
					installedClis: snapshot.installedClis,
					profiles: snapshot.rawProfiles ?? {},
				};

				if (outcome.action === "manage-fleets") {
					const res = await runManageFleetsAction(ctx);
					if (res.changed) {
						currentFleet = res.fleetName;
						await reloadSnapshot(true);
					}
				} else if (outcome.action === "create-agent") {
					const changed = await runCreateAgentAction(ctx);
					if (changed) await reloadSnapshot(false);
				} else if (outcome.action === "migrate-slots") {
					const changed = await runMigrateLegacyAction(ctx);
					if (changed) await reloadSnapshot(true);
				} else if (selected && selected.rawProfile) {
					const target = {
						name: selected.name,
						role: selected.role,
						rank: selected.rank,
						harness: selected.harness,
						provider: selected.provider,
						modelDisplay: selected.modelDisplay,
						...(selected.effort ? { effort: selected.effort } : {}),
						permissions: selected.permissions,
						description: selected.description,
						rawProfile: selected.rawProfile,
					};
					let changed = false;
					if (outcome.action === "edit-model") changed = await runEditModelAction(ctx, target);
					else if (outcome.action === "edit-effort") changed = await runEditEffortAction(ctx, target);
					else if (outcome.action === "test-terminals") changed = await runTestTerminalsForCurrentAgent(ctx, target);
					else if (outcome.action === "edit-harness") changed = await runManualTerminalAction(ctx, target);
					else if (outcome.action === "delete-agent") changed = await runDeleteAgentAction(ctx, target);
					if (changed) await reloadSnapshot(false);
				}
			} finally {
				modalBusy = false;
				if (!cleanupDone) {
					stdin.on("keypress", onKeypress);
					draw();
				}
			}
		};

		const onResize = () => draw();
		const onSignal = () => finish();

		const finish = () => {
			if (cleanupDone) return;
			cleanupDone = true;
			stdin.off("keypress", onKeypress);
			stdout.off("resize", onResize);
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
			try {
				if (stdin.isTTY) stdin.setRawMode(false);
			} catch {
				// best effort restore
			}
			stdin.pause();
			stdout.write(`${ANSI_SHOW_CURSOR}${ANSI_ALT_SCREEN_OFF}`);
			resolve();
		};

		emitKeypressEvents(stdin);
		if (stdin.isTTY) stdin.setRawMode(true);
		stdin.resume();
		stdout.write(`${ANSI_ALT_SCREEN_ON}${ANSI_HIDE_CURSOR}`);
		draw();

		stdin.on("keypress", onKeypress);
		stdout.on("resize", onResize);
		process.on("SIGINT", onSignal);
		process.on("SIGTERM", onSignal);
	});
}
