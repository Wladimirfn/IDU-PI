import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PiProcess = {
	pid: number;
	parentPid: number;
	name: string;
	commandLine: string;
	kind: "bridge-rpc" | "external-pi";
};

type CimProcess = {
	ProcessId?: number;
	ParentProcessId?: number;
	Name?: string;
	CommandLine?: string;
};

export async function findPiProcesses(bridgePid: number): Promise<PiProcess[]> {
	const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pi-coding-agent|@earendil-works[\\/]+pi-coding-agent|dist[\\/]+cli.js' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 3`;
	const { stdout } = await execFileAsync(
		"powershell.exe",
		["-NoProfile", "-Command", script],
		{
			windowsHide: true,
			maxBuffer: 1024 * 1024,
		},
	);

	const trimmed = stdout.trim();
	if (!trimmed) return [];

	const parsed = JSON.parse(trimmed) as CimProcess | CimProcess[];
	const rows = Array.isArray(parsed) ? parsed : [parsed];

	return rows
		.filter(
			(row) =>
				typeof row.ProcessId === "number" &&
				typeof row.CommandLine === "string",
		)
		.filter((row) => row.ProcessId !== process.pid)
		.map((row) => {
			const commandLine = row.CommandLine ?? "";
			const parentPid = row.ParentProcessId ?? 0;
			const kind: PiProcess["kind"] =
				parentPid === bridgePid || commandLine.includes("--mode rpc")
					? "bridge-rpc"
					: "external-pi";
			return {
				pid: row.ProcessId ?? 0,
				parentPid,
				name: row.Name ?? "process",
				commandLine,
				kind,
			};
		})
		.filter((processInfo) => processInfo.pid > 0);
}
