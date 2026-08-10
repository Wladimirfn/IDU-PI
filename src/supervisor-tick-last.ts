/**
 * supervisor-tick-last.ts — read-only parser/formatter for the last
 * supervisor tick written to `supervisor-tick.log`.
 *
 * Issue #424. The tick's output is a flat wall of text where invariant
 * noise (DEP0190 Node warning, security notes, repeated identical
 * hygiene injections) dwarfs the result. This module renders a compact,
 * operator-first hierarchy from the LAST COMPLETE tick block in the log,
 * without touching the live tick output (zero risk to the tick).
 *
 * Log-resolution is deliberately NOT in this module: the caller decides
 * which log to read (CLI flag `--log` or `IDU_PI_TICK_LOG`). The module
 * only parses whatever text it is given. This keeps the "don't silently
 * read the frozen checkout log" decision close to the operator.
 *
 * Parser is LENIENT: it extracts known fields via regex and ignores any
 * unknown token/field. A future field added to a line (like the
 * `watermark_sha=`/`watermark_base=` added by #484) must not break the
 * parse. But it is FAIL-HARD on STRUCTURE: a missing/truncated block
 * (no `interval_minutes=` start, no `next_run=` end, or missing
 * `automaticov1_exit`/`cron_preflight_exit`) is an ERROR, never a
 * partial "all quiet" summary.
 *
 * The block is identified by its surrounding markers: the
 * `STEP Idu-pi supervisor tick` / `interval_minutes=` start and the
 * `next_run=` end of that tick.
 */

export type TickInjection = {
	/** e.g. hygiene_sensor, supervisor_categorize, objective_reminder */
	type: string;
	/** e.g. info, warning, critical, blocking */
	severity: string;
};

export type LastTick = {
	/** Absolute instant of the tick start — used only for age math. */
	startedAt: Date;
	/** Wall-clock rendering captured from the log line itself
	 *  ("YYYY-MM-DD HH:mm"). Display must NOT depend on the host timezone:
	 *  the log's own wall time is what the operator saw. */
	startedAtWall: string;
	automaticov1Exit: number;
	cronPreflightExit: number;
	changedFiles: number;
	sensorImpulses: number;
	escalationCritical: number;
	escalationTotal: number;
	shouldEscalate: boolean;
	injections: TickInjection[];
	/** Raw residual lines (cron_preflight_output / pending_injections_query /
	 *  user_escalation_output) shown only with --verbose. */
	residualLines: string[];
};

/** Structural failure — the caller must turn this into a hard error. */
export class TickParseError extends Error {}

const START_RE = /interval_minutes=\d+/;
const END_RE = /next_run=/;
const AUTOMATICOV1_RE = /automaticov1_exit=(\d+)/;
const CRON_EXIT_RE = /cron_preflight_exit=(\d+)/;
const CHANGED_FILES_RE = /changed_files=(\d+)/;
const SENSOR_IMPULSES_RE = /sensorImpulses=(\d+)/;
const ESCALATION_RE = /User escalation: shouldEscalate=(\w+) critical=(\d+) total=(\d+)/;
/** Matches `- <type> severity=<severity>` entries inside the
 *  pending_injections_query line. The `? BLOCKING: warning <type> ?`
 *  prefix is NOT matched (it has no `- type severity=` shape), so it is
 *  never double-counted as an extra injection. */
const INJECTION_RE = /-\s+([a-zA-Z0-9_]+)\s+severity=(\w+)/g;
const RESIDUAL_RE = /cron_preflight_output:|pending_injections_query:|user_escalation_output:/;
const TIMESTAMP_RE =
	/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})[:\d.]*([+\-]\d{2}:\d{2})/;

type ParsedTimestamp = { at: Date; wall: string };

function parseTimestamp(line: string): ParsedTimestamp | undefined {
	const m = line.match(TIMESTAMP_RE);
	if (!m) return undefined;
	const d = new Date(m[0]);
	if (Number.isNaN(d.getTime())) return undefined;
	// Wall clock comes from the log string, never from local getters:
	// a Date rendered with getHours()/etc. shifts with the host timezone
	// (CI rendered 18:46 for a 14:46 -04:00 tick and broke the test).
	return { at: d, wall: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` };
}

function numeric(text: string, re: RegExp): number | undefined {
	const m = text.match(re);
	return m ? Number(m[1]) : undefined;
}

export function parseLastTick(logText: string): LastTick {
	const lines = logText.split(/\r?\n/);

	const startIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (START_RE.test(lines[i])) startIdx.push(i);
	}
	if (startIdx.length === 0) {
		throw new TickParseError(
			"No pude leer el log: no hay ningún bloque de tick (falta el marcador de inicio `interval_minutes=`).",
		);
	}

	const lastStart = startIdx[startIdx.length - 1];
	let end = -1;
	for (let i = lastStart + 1; i < lines.length; i++) {
		if (END_RE.test(lines[i])) {
			end = i;
			break;
		}
	}
	if (end === -1) {
		throw new TickParseError(
			"El último tick está truncado: arrancó (interval_minutes=) pero no tiene cierre (next_run=). " +
				"No lo reporto como si estuviera completo.",
		);
	}

	const blockLines = lines.slice(lastStart, end + 1);
	const blockText = blockLines.join("\n");

	const startedAt = parseTimestamp(lines[lastStart]);
	const automaticov1 = numeric(blockText, AUTOMATICOV1_RE);
	const cronExit = numeric(blockText, CRON_EXIT_RE);
	const changed = numeric(blockText, CHANGED_FILES_RE);
	const sensor = numeric(blockText, SENSOR_IMPULSES_RE);
	const esc = blockText.match(ESCALATION_RE);

	if (!startedAt) {
		throw new TickParseError("El último tick no tiene timestamp legible en su inicio.");
	}
	if (automaticov1 === undefined) {
		throw new TickParseError("El último tick está incompleto: falta automaticov1_exit.");
	}
	if (cronExit === undefined) {
		throw new TickParseError("El último tick está incompleto: falta cron_preflight_exit.");
	}
	if (changed === undefined) {
		throw new TickParseError("El último tick está incompleto: falta changed_files.");
	}
	if (sensor === undefined) {
		throw new TickParseError("El último tick está incompleto: falta sensorImpulses.");
	}
	if (!esc) {
		throw new TickParseError(
			"El último tick está incompleto: falta la línea de user_escalation (critical/total).",
		);
	}

	const injections: TickInjection[] = [];
	for (const m of blockText.matchAll(INJECTION_RE)) {
		injections.push({ type: m[1], severity: m[2] });
	}

	const residualLines = blockLines
		.filter((l) => RESIDUAL_RE.test(l))
		.map((l) => l.replace(/^\S+\s/, "").trim());

	return {
		startedAt: startedAt.at,
		startedAtWall: startedAt.wall,
		automaticov1Exit: automaticov1,
		cronPreflightExit: cronExit,
		changedFiles: changed,
		sensorImpulses: sensor,
		escalationCritical: Number(esc[2]),
		escalationTotal: Number(esc[3]),
		shouldEscalate: esc[1] === "true",
		injections,
		residualLines,
	};
}

/** Only blocking/critical/warning injections are actionable. Repeated
 *  info hygiene entries and non-blocking objective_reminder are the
 *  invariant noise and must NOT count. */
const ACTIONABLE_SEVERITIES: ReadonlySet<string> = new Set([
	"blocking",
	"critical",
	"warning",
]);

const SEV_LABEL: Record<string, string> = {
	blocking: "bloqueante",
	critical: "crítica",
	warning: "advertencia",
};

function formatAge(ms: number): string {
	const min = Math.floor(ms / 60000);
	if (min < 1) return "hace <1 min";
	if (min < 60) return `hace ${min} min`;
	const hours = Math.floor(min / 60);
	if (hours < 24) return `hace ${hours} h`;
	return `hace ${Math.floor(hours / 24)} días`;
}

function formatActionable(tick: LastTick): string {
	const actionable = tick.injections.filter((i) =>
		ACTIONABLE_SEVERITIES.has(i.severity),
	);
	const escalationActionable = tick.shouldEscalate || tick.escalationCritical > 0;
	if (actionable.length === 0 && !escalationActionable) {
		return "acción: nada que hacer";
	}
	const types = [...new Set(actionable.map((i) => i.type))];
	if (escalationActionable) types.push("user_escalation");
	const count = actionable.length + (escalationActionable ? 1 : 0);
	if (count === 1 && actionable.length === 1) {
		const inj = actionable[0];
		return `acción: 1 ${SEV_LABEL[inj.severity] ?? inj.severity} (${inj.type})`;
	}
	return `acción: ${count} (${types.join(", ")})`;
}

export function formatLastTick(
	tick: LastTick,
	opts: { verbose?: boolean; now?: Date } = {},
): string {
	const now = opts.now ?? new Date();
	const lines: string[] = [];
	lines.push(
		`último tick: ${tick.startedAtWall} (${formatAge(now.getTime() - tick.startedAt.getTime())})`,
	);
	lines.push(
		`automaticov1_exit=${tick.automaticov1Exit} cron_preflight_exit=${tick.cronPreflightExit}`,
	);
	lines.push(
		`changed_files=${tick.changedFiles} · sensorImpulses=${tick.sensorImpulses} · escalación: ${tick.escalationCritical} críticas, ${tick.escalationTotal} total`,
	);
	lines.push(formatActionable(tick));
	if (opts.verbose) {
		lines.push("");
		lines.push("# residual (invariantes)");
		lines.push(...tick.residualLines);
	}
	return lines.join("\n") + "\n";
}