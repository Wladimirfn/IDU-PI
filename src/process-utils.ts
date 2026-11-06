import { execFileSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorCode } from "./errors.js";
import { KILL_ESCALATION_MS } from "./timeouts.js";

export function isProcessAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if (errorCode(err) === "EPERM") return true;
		if (errorCode(err) === "ESRCH") return false;
		return false;
	}
}

export function getRunnerScriptPath(): string {
	const jsPath = fileURLToPath(new URL("./runner.js", import.meta.url));
	if (existsSync(jsPath)) return jsPath;
	const distJsPath = resolve(process.cwd(), "dist/src/runner.js");
	if (existsSync(distJsPath)) return distJsPath;
	return jsPath;
}

export function killProcessTree(child: ChildProcess | number, reason = "termination"): void {
	const pid = typeof child === "number" ? child : child.pid;
	if (!pid) return;

	if (process.platform === "win32") {
		// Reliable process tree termination on Windows (cmd.exe wrapper + child processes)
		try {
			execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
		} catch {
			if (typeof child !== "number") {
				try {
					child.kill("SIGKILL");
				} catch {
					// best effort
				}
			}
		}
		return;
	}

	// POSIX: process group kill with escalation
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// best effort
		}
	}

	const escalationTimer = setTimeout(() => {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// best effort
			}
		}
	}, KILL_ESCALATION_MS);
	escalationTimer.unref();
}
