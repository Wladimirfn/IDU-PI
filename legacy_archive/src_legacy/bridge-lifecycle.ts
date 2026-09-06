import { spawn } from "node:child_process";
import { join } from "node:path";
import { buildBridgeControlCommand } from "./bridge-control.js";

export type BridgeLifecycleAction = "run" | "restart" | "off";

export type BridgeLifecycleCommand = {
  file: string;
  args: string[];
  cwd: string;
};

const powershellArgs = [
  "powershell",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
];

function cmdStartTitle(title: string): string {
  return `"${title}"`;
}

export function buildBridgeLifecycleCommand(
  action: BridgeLifecycleAction,
  root: string,
): BridgeLifecycleCommand {
  if (action === "restart") return buildBridgeControlCommand("restart", root);

  const script = join(
    root,
    "scripts",
    action === "off" ? "stop-bridge.ps1" : "start-bridge.ps1",
  );

  return {
    file: "cmd.exe",
    args: [
      "/c",
      "start",
      cmdStartTitle(
        action === "off" ? "pi-telegram-bridge-stop" : "pi-telegram-bridge",
      ),
      "cmd.exe",
      action === "off" ? "/c" : "/k",
      ...powershellArgs,
      "-File",
      script,
    ],
    cwd: root,
  };
}

export function bridgeLifecycleReply(action: BridgeLifecycleAction): string {
  if (action === "off") {
    return "Apagando bridge en una ventana CMD. El bot va a quedar offline hasta que vuelvas a iniciarlo.";
  }
  if (action === "restart") {
    return "Reiniciando bridge en una nueva ventana CMD. Esta sesión puede cerrarse unos segundos.";
  }
  return "Abriendo bridge en una nueva ventana CMD.";
}

export function launchBridgeLifecycle(
  action: BridgeLifecycleAction,
  root: string,
): void {
  const command = buildBridgeLifecycleCommand(action, root);
  const child = spawn(command.file, command.args, {
    cwd: command.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}
