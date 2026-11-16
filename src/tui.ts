import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";
import { buildWorkerArgs } from "./cmdline.js";
import { getIduProfilesPath, IDU_HOME, loadIduConfig, loadProfilesConfig } from "./config.js";
import { CrossCliProcessManager } from "./process-manager.js";
import { canonicalHarnessName } from "./session-policy.js";
import type { CapabilitiesResult, IduConfig, IduProfile } from "./types.js";

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
	permissions: "read-only" | "workspace";
	streams: boolean;
	timeoutLabel: string;
	commandPreview: string;
	description: string;
}

export interface AgentTuiSnapshot {
	version: string;
	iduHome: string;
	profilesPath: string;
	replaceDefaults: boolean;
	installedClis: Array<{ name: string; command: string; available: boolean }>;
	roles: Array<{ role: string; count: number }>;
	agents: AgentEntry[];
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

function normalizeRoleLabel(raw: string): string {
	const key = raw
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
	if (key.startsWith("trabajo")) return "Trabajo";
	if (key.startsWith("auditoria")) return "Auditoría";
	if (key.startsWith("diseno")) return "Diseño";
	if (key.startsWith("arquitectura")) return "Arquitectura";
	if (key.startsWith("consult")) return "Consultas";
	if (key.startsWith("explor")) return "Exploración";
	if (key.startsWith("iconograf")) return "Iconografía";
	if (key.startsWith("voz")) return "Voz";
	if (key.startsWith("musica")) return "Música";
	return raw.trim() || "Otros";
}

/** Infers canonical role name from explicit `ROL ...` description header or profile naming convention. */
export function inferProfileRole(name: string, profile: Pick<IduProfile, "description">): string {
	const desc = profile.description ?? "";
	const match = desc.match(/^ROL\s+([^:(\r\n]+)/i);
	if (match?.[1]) {
		return normalizeRoleLabel(match[1]);
	}
	const lower = name.toLowerCase();
	if (lower.startsWith("work")) return "Trabajo";
	if (lower.startsWith("audit")) return "Auditoría";
	if (lower.startsWith("design")) return "Diseño";
	if (lower.startsWith("arch")) return "Arquitectura";
	if (lower.startsWith("consult")) return "Consultas";
	if (lower.startsWith("explore")) return "Exploración";
	if (lower.startsWith("icon")) return "Iconografía";
	if (lower.startsWith("voice")) return "Voz";
	if (lower.startsWith("music")) return "Música";
	return "Otros";
}

/** Extracts priority ordinal `(1)`, `(2º)`, etc. from role descriptions so primary slots appear first. */
export function extractRoleRank(description = ""): number {
	const match = description.match(/ROL\s+[^:(\r\n]+\(\s*(\d+)/i);
	if (match?.[1]) {
		const n = Number.parseInt(match[1], 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	if (/\(principal\)/i.test(description)) return 1;
	if (/^ROL\s+[^:(\r\n]+:/i.test(description)) return 1;
	return 999;
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
}): AgentTuiSnapshot {
	const {
		capabilities,
		config,
		replaceDefaults = false,
		profilesPath = getIduProfilesPath(),
		version = readPackageVersion(),
		iduHome = process.env.IDU_HOME || IDU_HOME,
	} = params;

	const cliByName = new Map(capabilities.installedClis.map((c) => [c.name.toLowerCase(), c]));
	const agents: AgentEntry[] = Object.entries(capabilities.profiles).map(([name, profile]) => {
		const canonical = canonicalHarnessName(profile.harness.trim().toLowerCase());
		const cliInfo = cliByName.get(canonical) ?? cliByName.get(profile.harness.trim().toLowerCase());
		const role = inferProfileRole(name, profile);
		const rank = extractRoleRank(profile.description);
		const modelDisplay = profile.provider && !profile.model?.startsWith(`${profile.provider}/`)
			? `${profile.provider}/${profile.model || "default"}`
			: profile.model || "default";
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
			permissions: profile.permissions === "workspace" ? "workspace" : "read-only",
			streams: Boolean(profile.streams),
			timeoutLabel: `${timeout} · idle ${idle} · cap ${cap}`,
			commandPreview: formatCommandPreview(profile, config),
			description: profile.description?.trim() || "(sin descripción)",
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

	return {
		version,
		iduHome,
		profilesPath,
		replaceDefaults,
		installedClis: capabilities.installedClis,
		roles,
		agents,
	};
}

export async function loadAgentTuiSnapshot(): Promise<AgentTuiSnapshot> {
	const [capabilities, config, profilesCfg] = await Promise.all([
		CrossCliProcessManager.getInstance().getCapabilities(),
		Promise.resolve(loadIduConfig()),
		Promise.resolve(loadProfilesConfig()),
	]);
	return buildAgentTuiSnapshot({
		capabilities,
		config,
		replaceDefaults: Boolean(profilesCfg.replaceDefaults),
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
	| { action: "quit"; state: AgentTuiState };

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
	const titleLine = `${c(ANSI_BOLD + ANSI_BRIGHT_PURPLE, "IDU-PI")} ${c(ANSI_DIM, `v${snapshot.version}`)}  ·  ${c(ANSI_CYAN, "Agentes configurados")} ${c(ANSI_BOLD, `(${snapshot.agents.length})`)}  ·  ${c(ANSI_DIM, `${homeShort} [${snapshot.replaceDefaults ? "replaceDefaults" : "merged"}]`)}`;
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
	const reloadTag = state.lastReloadedAt ? `  · recargado ${state.lastReloadedAt}` : "";
	out.push(
		truncateVisible(
			c(ANSI_DIM, `↑/↓ j/k Mover  ·  ←/→ Tab Rol (0-9)  ·  r Recargar  ·  q / Esc Salir${reloadTag}`),
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
	const raw = `${pointer} ${agent.name.padEnd(18)} ${agent.role.slice(0, 11).padEnd(11)} ${rankTag} ${cliTag} ${agent.harness.padEnd(11)} ${permTag} ${agent.modelDisplay}`;
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

	const lines = [
		`${c(ANSI_DIM, "Rol:")}        ${agent.role}${agent.rank < 999 ? ` (prioridad ${agent.rank})` : ""}`,
		`${c(ANSI_DIM, "CLI:")}        ${cliState}`,
		`${c(ANSI_DIM, "Modelo:")}     ${c(ANSI_BOLD, agent.modelDisplay)}`,
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
		`IDU-PI v${snapshot.version} — Agentes configurados (${snapshot.agents.length})`,
		`Profiles: ${snapshot.profilesPath} [${snapshot.replaceDefaults ? "replaceDefaults" : "merged"}]`,
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
		lines.push(
			`  ${rank} ${ag.name.padEnd(18)} ${ag.harness.padEnd(12)} [${cliMark}] ${ag.permissions.padEnd(9)} ${ag.modelDisplay}`,
		);
	}
	return lines.join("\n");
}

export async function runAgentsTui(options: { plain?: boolean; json?: boolean } = {}): Promise<void> {
	let snapshot = await loadAgentTuiSnapshot();

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

	const draw = () => {
		const width = stdout.columns || 100;
		const height = stdout.rows || 30;
		const frame = renderAgentTui(snapshot, state, { width, height, useColor: true });
		stdout.write(`${ANSI_HOME_CLEAR}${frame}`);
	};

	await new Promise<void>((resolve) => {
		const onKeypress = async (_str: string, key: TuiKeyEvent) => {
			const pageRows = Math.max(8, (stdout.rows || 30) - 14);
			const outcome = reduceTuiState(state, snapshot, key, pageRows);
			state = outcome.state;
			if (outcome.action === "quit") {
				finish();
				return;
			}
			if (outcome.action === "reload") {
				snapshot = await loadAgentTuiSnapshot();
				const now = new Date().toLocaleTimeString();
				state = {
					...state,
					roleIndex: Math.min(state.roleIndex, Math.max(0, snapshot.roles.length - 1)),
					selectedIndex: 0,
					scrollOffset: 0,
					lastReloadedAt: now,
				};
			}
			draw();
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
