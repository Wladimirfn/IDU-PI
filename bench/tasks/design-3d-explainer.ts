import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runIsolatedNodeCommand } from "./eval-subprocess.js";
import { evaluateProtectedPaths, summarizeTaskChecks } from "./eval-helpers.js";
import type { BenchmarkTaskDef, EvalCheckResult } from "../types.js";

const BENCHMARK_FINDINGS = {
	datasetId: "nan-controlled-v1",
	totalControlledRuns: 576,
	legacyTimeoutMs: 180000,
	keyInsights: [
		{ id: "hy4-timeout-masking", label: "DeepSeek V4.1 / hy4 <180s pass rate", underTimeoutResolved: 13, underTimeoutTotal: 13, timedOutRuns: 51, totalRuns: 64 },
		{ id: "kimi-k3-1-pro", label: "Kimi K3.1 Pro (excl. codex) <180s pass rate", underTimeoutResolved: 19, underTimeoutTotal: 19, timedOutRuns: 38, totalRuns: 64 },
		{ id: "qwen3-8-max", label: "Qwen 3.8 Max <180s pass rate", underTimeoutResolved: 20, underTimeoutTotal: 24, timedOutRuns: 40, totalRuns: 64 },
		{ id: "harness-interaction", label: "Harness effect on identical model", exampleModel: "qwen3.8-max", gentleShellResolved: 6, opencodeResolved: 3 },
	],
	roles: [
		{ role: "Audit (Read-Only)", recommendation: "Needs deep invariant checking + decoy restraint without timeout clipping" },
		{ role: "Architecture Consult", recommendation: "Needs multi-file root-cause synthesis + explicit tradeoff reasoning" },
		{ role: "Fast Explore", recommendation: "Needs fast low-latency call-flow mapping + dead-code exclusion" },
		{ role: "3D / Visual Design", recommendation: "Needs deterministic multi-minute temporal choreography & visual polish" },
	],
};

const DATA_JSON = JSON.stringify(BENCHMARK_FINDINGS, null, 2) + "\n";

const README_MD = `# Design Task: 5-Minute (300s) 3D Benchmark Explainer

Create an interactive **300-second (5-minute)** 3D explanatory presentation visualizing the dataset in \`data/benchmark-findings.json\` without modifying \`data/benchmark-findings.json\` or breaking \`test/data-integrity.test.mjs\`.

## Required Deliverables
1. \`style-brief.md\` — must declare \`Intent: presentation\`, duration \`300\`, color palette tokens, typography, and camera rules.
2. \`art-direction.md\` — scene breakdown across \`0..300s\`, shot pacing, and character continuity/rig rules for \`CHAR-ARCHITECT\` and \`CHAR-EXECUTOR\`.
3. \`timeline.json\` — array of at least 5 ordered scenes spanning \`0\` to \`300\` seconds, each with \`id\`, \`title\`, \`startSec\`, \`endSec\`, \`character\`, \`pose\`, and \`cameraPreset\`.
4. \`index.html\` — **100% offline self-contained** page (ZERO external \`http://\` or \`https://\` CDN scripts/stylesheets):
   - Root stage element with \`data-duration="300"\`
   - Visible \`<canvas>\` (>= 640x360) rendering genuine 3D camera projection, 3D data visuals, and two articulated 3D/rigged characters (\`CHAR-ARCHITECT\` & \`CHAR-EXECUTOR\`) that animate smoothly across timestamps
   - Deterministic synchronous global \`window.seek(t)\` function (\`0 <= t <= 300\`) updating both the 3D canvas frame and synchronized captions/HUD
   - Interactive Play/Pause and timeline scrubber controls for human viewing
`;

const DATA_TEST_MJS = `import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("benchmark findings JSON remains intact and valid", () => {
  const raw = readFileSync(new URL("../data/benchmark-findings.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.datasetId, "nan-controlled-v1");
  assert.equal(parsed.totalControlledRuns, 576);
  assert.ok(Array.isArray(parsed.keyInsights) && parsed.keyInsights.length >= 4);
  assert.ok(Array.isArray(parsed.roles) && parsed.roles.length >= 4);
});
`;

const ORACLE_STYLE_BRIEF = `# Style Brief — Harness vs Model 3D Explainer

- Intent: presentation
- Duration: 300s (5 minutes deterministic timeline)
- Renderer: Self-contained offline 3D perspective engine on HTML5 Canvas + HUD overlay (zero external CDN requests)
- Palette (Kanagawa Sumi Editorial):
  - Ink Canvas: #16161D / #1F1F28
  - Bone Primary Ink: #DCD7BA
  - Crystal Blue Accent: #7E9CD8
  - Carp Gold Emphasis: #E6C384
  - Spring Green Verified: #98BB6C
  - Lotus Alert: #E46876
- Typography: Clean geometric system sans + monospace tabular metrics
- Camera Grammar: Smooth damped orbital yaw/pitch/zoom transitions anchored per beat via \`window.seek(t)\`
- Character Continuity: \`CHAR-ARCHITECT\` (indigo visor + gold drafting arm) & \`CHAR-EXECUTOR\` (jade crest + dual wrench/scanner arms)
`;

const ORACLE_ART_DIRECTION = `# Art Direction — 5-Minute Benchmark Storyboard

## Character Rigs & Continuity
- \`CHAR-ARCHITECT\`: Stationary-anchor strategist on left-center dais; articulated torso prism, beveled head, glowing visor, animated pointing arm toward 3D monoliths.
- \`CHAR-EXECUTOR\`: Agile harness-runner figure in slate-jade chassis; articulates arm sweep & step bounce synchronized to timeline progress.

## Six-Act Choreography (0s – 300s)
1. **0–50s (` + "`act-01-hook`" + `)**: Establishing orbit framing the 576-run monument and why 180s timeouts confuse speed with model capability.
2. **50–105s (` + "`act-02-timeout-trap`" + `)**: Rising 3D monoliths isolate ` + "`hy4`" + ` (13/13 under 180s vs 51 timeouts) and ` + "`kimi-k3.1-pro`" + ` (19/19 non-codex under 180s).
3. **105–165s (` + "`act-03-harness-effect`" + `)**: Camera swings to side-by-side harness pedestals comparing ` + "`gentle-shell`" + ` vs ` + "`opencode`" + ` on identical ` + "`qwen3.8-max`" + `.
4. **165–220s (` + "`act-04-role-specialization`" + `)**: ` + "`CHAR-ARCHITECT`" + ` and ` + "`CHAR-EXECUTOR`" + ` inspect the four agent specialization towers (Audit, Consult, Explore, Design).
5. **220–265s (` + "`act-05-cost-accuracy`" + `)**: Telemetry ribbon contrasts token consumption vs reliability across ` + "`pi`" + `, ` + "`opencode`" + `, and ` + "`mcode`" + `.
6. **265–300s (` + "`act-06-verdict`" + `)**: Hero elevation pulls back for the final IDU-PI role-matrix synthesis and closing slate.
`;

const ORACLE_TIMELINE = [
	{
		id: "act-01-hook",
		title: "Why Speed Benchmarks Mislead Role Selection",
		startSec: 0,
		endSec: 50,
		character: "CHAR-ARCHITECT",
		pose: "present_stage",
		cameraPreset: "establishing_orbit",
		caption: "576 controlled Nan runs exposed a hidden confound: 180s timeouts penalize deep reasoners like hy4 before they finish verifying.",
	},
	{
		id: "act-02-timeout-trap",
		title: "Separating Capability from Latency",
		startSec: 50,
		endSec: 105,
		character: "CHAR-ARCHITECT",
		pose: "highlight_monoliths",
		cameraPreset: "low_hero_sweep",
		caption: "When finishing within 180s, hy4 passed 13/13 runs and Kimi K3.1 Pro passed 19/19 non-codex runs; Qwen 3.8 Max hit 20/24.",
	},
	{
		id: "act-03-harness-effect",
		title: "Harness Effect on the Same Model",
		startSec: 105,
		endSec: 165,
		character: "CHAR-EXECUTOR",
		pose: "compare_harnesses",
		cameraPreset: "split_dolly_left",
		caption: "Keeping Qwen 3.8 Max fixed: gentle-shell delivered 6/8 passes while opencode hit 6 timeouts out of 8 due to harness overhead.",
	},
	{
		id: "act-04-role-specialization",
		title: "Four Distinct Agent Roles in IDU-PI",
		startSec: 165,
		endSec: 220,
		character: "CHAR-ARCHITECT",
		pose: "conduct_roles",
		cameraPreset: "isometric_overview",
		caption: "Auditors need decoy precision without edits; Consultants need tradeoff clarity; Explorers need fast maps; Designers need visual polish.",
	},
	{
		id: "act-05-efficiency-frontier",
		title: "Telemetry Fidelity & Token Discipline",
		startSec: 220,
		endSec: 265,
		character: "CHAR-EXECUTOR",
		pose: "scan_telemetry",
		cameraPreset: "close_tracking",
		caption: "Pi and OpenCode emit reliable usage telemetry; kimi streams 0% token metadata and mcode averages 3x–6x higher token spend.",
	},
	{
		id: "act-06-verdict",
		title: "Matched Role-Based Evaluation Suite",
		startSec: 265,
		endSec: 300,
		character: "CHAR-ARCHITECT",
		pose: "salute_verdict",
		cameraPreset: "pullback_finale",
		caption: "With role-specific harnesses (read-only flags + 600–1200s budgets), IDU-PI now picks the best CLI+Model pair per job category.",
	},
];

const ORACLE_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>IDU-PI 3D Benchmark Explainer (300s)</title>
<style>
  :root {
    --bg: #16161d;
    --panel: rgba(31, 31, 40, 0.88);
    --border: rgba(126, 156, 216, 0.3);
    --fg: #dcd7ba;
    --muted: #9cabca;
    --blue: #7e9cd8;
    --gold: #e6c384;
    --green: #98bb6c;
    --rose: #e46876;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    display: flex; flex-direction: column; align-items: center; min-height: 100vh;
  }
  #stage {
    position: relative; width: min(1280px, 100vw); aspect-ratio: 16 / 9;
    background: radial-gradient(circle at 50% 30%, #24273a, #13131a 78%);
    overflow: hidden; border: 1px solid var(--border);
  }
  canvas { display: block; width: 100%; height: 100%; }
  .hud-top {
    position: absolute; top: 18px; left: 22px; right: 22px;
    display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; pointer-events: none;
  }
  .badge {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 14px; backdrop-filter: blur(6px);
  }
  .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--gold); }
  .title { font-size: 20px; font-weight: 700; margin-top: 2px; color: #f2efe4; }
  .hud-bottom {
    position: absolute; bottom: 18px; left: 22px; right: 22px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .caption-box {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 18px;
  }
  .caption-text { font-size: 15px; line-height: 1.4; }
  .char-pill { font-size: 12px; font-family: ui-monospace, monospace; color: var(--green); white-space: nowrap; }
  .controls {
    display: flex; align-items: center; gap: 12px; background: rgba(18, 18, 26, 0.9);
    border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px;
  }
  button {
    background: var(--blue); color: #16161d; border: 0; border-radius: 6px;
    font-weight: 700; padding: 6px 12px; cursor: pointer;
  }
  input[type="range"] { flex: 1; accent-color: var(--gold); }
  .clock { font-family: ui-monospace, monospace; font-size: 13px; color: var(--gold); min-width: 90px; text-align: right; }
</style>
</head>
<body>
<div id="stage" data-duration="300">
  <canvas id="scene3d" width="1280" height="720"></canvas>
  <div class="hud-top">
    <div class="badge">
      <div class="eyebrow" id="scene-id">ACT-01-HOOK · 0s–50s</div>
      <div class="title" id="scene-title">Why Speed Benchmarks Mislead Role Selection</div>
    </div>
    <div class="badge">
      <div class="eyebrow">Dataset</div>
      <div class="title" style="font-size:15px;color:#7e9cd8;">nan-controlled-v1 · 576 runs</div>
    </div>
  </div>
  <div class="hud-bottom">
    <div class="caption-box">
      <div class="caption-text" id="scene-caption">Loading benchmark timeline...</div>
      <div class="char-pill" id="char-pose">CHAR-ARCHITECT · present_stage</div>
    </div>
    <div class="controls">
      <button id="play-btn" type="button">Play</button>
      <input id="scrubber" type="range" min="0" max="300" step="0.1" value="0" />
      <div class="clock" id="clock-readout">0.0s / 300s</div>
    </div>
  </div>
</div>
<script>
(() => {
  const DURATION = 300;
  const SCENES = ${JSON.stringify(ORACLE_TIMELINE)};
  const BARS = [
    { label: "hy4 (<180s)", val: 1.0, timeouts: 0.797, color: "#98bb6c" },
    { label: "kimi-k3.1-pro", val: 1.0, timeouts: 0.594, color: "#7e9cd8" },
    { label: "qwen3.8-max", val: 0.833, timeouts: 0.625, color: "#e6c384" },
    { label: "gentle-shell", val: 0.75, timeouts: 0.25, color: "#7fb4ca" },
    { label: "opencode", val: 0.375, timeouts: 0.75, color: "#e46876" }
  ];

  const canvas = document.getElementById("scene3d");
  const ctx = canvas.getContext("2d");
  const titleEl = document.getElementById("scene-title");
  const idEl = document.getElementById("scene-id");
  const capEl = document.getElementById("scene-caption");
  const poseEl = document.getElementById("char-pose");
  const clockEl = document.getElementById("clock-readout");
  const scrubber = document.getElementById("scrubber");
  const playBtn = document.getElementById("play-btn");

  let currentTime = 0;
  let playing = false;
  let lastRaf = 0;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, u) { return a + (b - a) * u; }

  function project(pt, cam) {
    const dx = pt[0] - cam.target[0];
    const dy = pt[1] - cam.target[1];
    const dz = pt[2] - cam.target[2];
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const rx = cy * dx - sy * dz;
    const rz0 = sy * dx + cy * dz;
    const ry = cp * dy - sp * rz0;
    const rz = sp * dy + cp * rz0 + cam.dist;
    const f = 780 / Math.max(1.2, rz);
    return { x: canvas.width * 0.5 + rx * f, y: canvas.height * 0.48 - ry * f, z: rz, scale: f };
  }

  function addBox(faces, cx, cy, cz, sx, sy, sz, color, cam) {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const verts = [
      [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
      [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz]
    ].map((v) => project(v, cam));
    const quads = [
      [0, 1, 2, 3, 0.78], [4, 5, 6, 7, 1.0], [0, 4, 7, 3, 0.85],
      [1, 5, 6, 2, 0.9], [3, 2, 6, 7, 1.08], [0, 1, 5, 4, 0.65]
    ];
    for (const [a, b, c, d, shade] of quads) {
      const z = (verts[a].z + verts[b].z + verts[c].z + verts[d].z) * 0.25;
      faces.push({ pts: [verts[a], verts[b], verts[c], verts[d]], z, color, shade });
    }
  }

  function shadeHex(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * factor), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * factor), 0, 255);
    const b = clamp(Math.round((n & 255) * factor), 0, 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function drawCharacter(faces, baseX, baseZ, primary, accent, t, phaseOffset, cam) {
    const bob = Math.sin(t * 1.4 + phaseOffset) * 0.14;
    const armLift = Math.sin(t * 0.9 + phaseOffset) * 0.45 + 0.3;
    const stride = Math.cos(t * 1.1 + phaseOffset) * 0.25;
    // Left & right legs + boots
    addBox(faces, baseX - 0.3, 0.55 + Math.max(0, stride * 0.2), baseZ + stride * 0.3, 0.32, 1.1, 0.36, "#363646", cam);
    addBox(faces, baseX + 0.3, 0.55 + Math.max(0, -stride * 0.2), baseZ - stride * 0.3, 0.32, 1.1, 0.36, "#363646", cam);
    // Torso chassis
    addBox(faces, baseX, 1.75 + bob, baseZ, 0.95, 1.35, 0.58, primary, cam);
    // Chest core emblem
    addBox(faces, baseX, 1.82 + bob, baseZ + 0.32, 0.42, 0.42, 0.12, accent, cam);
    // Articulated arms
    addBox(faces, baseX - 0.72, 1.82 + bob + armLift * 0.35, baseZ + 0.15, 0.26, 0.98, 0.26, primary, cam);
    addBox(faces, baseX + 0.72, 1.88 + bob - armLift * 0.2, baseZ + 0.25, 0.26, 0.98, 0.26, accent, cam);
    // Head + Glowing visor
    addBox(faces, baseX, 2.82 + bob, baseZ, 0.72, 0.68, 0.68, "#dcd7ba", cam);
    addBox(faces, baseX, 2.86 + bob, baseZ + 0.35, 0.56, 0.24, 0.12, accent, cam);
  }

  function findScene(t) {
    return SCENES.find((s) => t >= s.startSec && t < s.endSec) || SCENES[SCENES.length - 1];
  }

  function renderFrame(t) {
    const progress = clamp(t / DURATION, 0, 1);
    const scene = findScene(t);
    const sceneIdx = SCENES.indexOf(scene);

    titleEl.textContent = scene.title;
    idEl.textContent = scene.id.toUpperCase() + " · " + scene.startSec + "s–" + scene.endSec + "s";
    capEl.textContent = scene.caption;
    poseEl.textContent = scene.character + " · " + scene.pose;
    clockEl.textContent = t.toFixed(1) + "s / 300s";
    scrubber.value = String(t);

    const cam = {
      yaw: -0.55 + Math.sin(progress * Math.PI * 2.4) * 0.72 + sceneIdx * 0.14,
      pitch: 0.34 + Math.cos(progress * Math.PI * 1.5) * 0.12,
      dist: 15.5 - Math.sin(progress * Math.PI) * 3.0,
      target: [Math.sin(progress * Math.PI * 2) * 1.1, 1.8, 0]
    };

    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, sceneIdx % 2 === 0 ? "#181824" : "#1b2030");
    g.addColorStop(1, "#0f1017");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 3D Floor grid projection
    ctx.strokeStyle = "rgba(126, 156, 216, 0.22)";
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i += 2) {
      const a = project([i, 0, -8], cam), b = project([i, 0, 8], cam);
      const c = project([-8, 0, i], cam), d = project([8, 0, i], cam);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }

    const faces = [];
    // Role-weighted 3D bar monoliths
    BARS.forEach((bar, i) => {
      const x = -4.2 + i * 2.1;
      const focusBoost = sceneIdx === 1 && i < 3 ? 1.25 : sceneIdx === 2 && i >= 3 ? 1.3 : 1.0;
      const h = (0.8 + bar.val * 3.8 * focusBoost) * (0.88 + 0.12 * Math.sin(t * 0.8 + i));
      addBox(faces, x, h * 0.5, -2.2, 1.05, h, 1.05, bar.color, cam);
      const tH = Math.max(0.25, bar.timeouts * 2.2);
      addBox(faces, x, tH * 0.5, -0.4, 0.65, tH, 0.65, "#957fb8", cam);
    });

    // Two articulated 3D characters
    const archX = -4.4 + Math.sin(progress * Math.PI * 1.5) * 1.1;
    const execX = 4.4 - Math.cos(progress * Math.PI * 1.5) * 1.1;
    drawCharacter(faces, archX, 2.8, "#54546d", "#e6c384", t, 0, cam);
    drawCharacter(faces, execX, 2.6, "#2d4f67", "#98bb6c", t, 1.7, cam);

    // Floating role beacons
    for (let r = 0; r < 4; r++) {
      const angle = t * 0.35 + r * (Math.PI * 0.5);
      addBox(faces, Math.cos(angle) * 5.8, 4.4 + Math.sin(t + r) * 0.35, Math.sin(angle) * 4.2, 0.55, 0.55, 0.55, "#7e9cd8", cam);
    }

    faces.sort((a, b) => b.z - a.z);
    for (const face of faces) {
      ctx.fillStyle = shadeHex(face.color, face.shade);
      ctx.strokeStyle = "rgba(15, 16, 23, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(face.pts[0].x, face.pts[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(face.pts[k].x, face.pts[k].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Floating 3D labels projected above monoliths
    ctx.font = "600 13px ui-monospace, monospace";
    ctx.textAlign = "center";
    BARS.forEach((bar, i) => {
      const p = project([-4.2 + i * 2.1, 4.9, -2.2], cam);
      ctx.fillStyle = "#dcd7ba";
      ctx.fillText(bar.label, p.x, p.y);
    });
    const pArch = project([archX, 3.6, 2.8], cam);
    const pExec = project([execX, 3.6, 2.6], cam);
    ctx.fillStyle = "#e6c384";
    ctx.fillText("CHAR-ARCHITECT", pArch.x, pArch.y);
    ctx.fillStyle = "#98bb6c";
    ctx.fillText("CHAR-EXECUTOR", pExec.x, pExec.y);
  }

  window.seek = (t) => {
    const numeric = Number(t);
    currentTime = clamp(Number.isFinite(numeric) ? numeric : 0, 0, DURATION);
    renderFrame(currentTime);
    return currentTime;
  };

  scrubber.addEventListener("input", () => {
    playing = false;
    playBtn.textContent = "Play";
    window.seek(Number(scrubber.value));
  });

  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "Pause" : "Play";
    if (playing) {
      lastRaf = performance.now();
      const tick = (now) => {
        if (!playing) return;
        const dt = Math.min(0.1, (now - lastRaf) / 1000);
        lastRaf = now;
        currentTime = currentTime + dt >= DURATION ? 0 : currentTime + dt;
        renderFrame(currentTime);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  });

  renderFrame(0);
})();
</script>
</body>
</html>
`;

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
};

function startStaticSandboxServer(sandboxDir: string): Promise<{ url: string; close: () => Promise<void> }> {
	const root = resolve(sandboxDir);
	return new Promise((resolvePromise, rejectPromise) => {
		const server = createServer((req, res) => {
			const cleanUrl = (req.url ?? "/").split("?")[0];
			const rel = cleanUrl === "/" ? "index.html" : decodeURIComponent(cleanUrl).replace(/^\/+/, "");
			const abs = resolve(root, rel);
			if (!abs.startsWith(root) || !existsSync(abs) || statSync(abs).isDirectory()) {
				if (rel === "favicon.ico") {
					res.writeHead(204);
					res.end();
					return;
				}
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			const ext = extname(abs).toLowerCase();
			res.writeHead(200, { "content-type": MIME_TYPES[ext] ?? "application/octet-stream" });
			res.end(readFileSync(abs));
		});
		server.once("error", rejectPromise);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				rejectPromise(new Error("Failed to bind static sandbox server"));
				return;
			}
			resolvePromise({
				url: `http://127.0.0.1:${addr.port}/index.html`,
				close: () => new Promise<void>((done) => server.close(() => done())),
			});
		});
	});
}

interface PlaywrightConsoleMessage {
	type(): string;
	text(): string;
}

interface PlaywrightRequest {
	url(): string;
	failure(): { errorText?: string } | null;
}

interface PlaywrightPage {
	on(event: "pageerror", cb: (err: Error) => void): void;
	on(event: "console", cb: (msg: PlaywrightConsoleMessage) => void): void;
	on(event: "request", cb: (req: PlaywrightRequest) => void): void;
	on(event: "requestfailed", cb: (req: PlaywrightRequest) => void): void;
	goto(url: string, opts: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
	waitForTimeout(ms: number): Promise<void>;
	evaluate<R, A = unknown>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
	screenshot(opts: { type: "png" }): Promise<Buffer>;
}

interface PlaywrightBrowser {
	newPage(opts: { viewport: { width: number; height: number } }): Promise<PlaywrightPage>;
	close(): Promise<void>;
}

export interface PlaywrightChromiumModule {
	chromium: {
		launch(opts: { headless: boolean; args: string[]; executablePath?: string }): Promise<PlaywrightBrowser>;
	};
}

function findPlaywrightEntry(): string | null {
	const explicit = process.env.PLAYWRIGHT_PATH?.trim();
	if (explicit && existsSync(explicit)) return explicit;
	const local = join(process.cwd(), "node_modules", "playwright", "index.mjs");
	if (existsSync(local)) return local;
	const home = homedir();
	const homeDirect = join(home, "node_modules", "playwright", "index.mjs");
	if (existsSync(homeDirect)) return homeDirect;
	const homePnpm = join(home, "node_modules", ".pnpm");
	if (existsSync(homePnpm)) {
		for (const entry of readdirSync(homePnpm)) {
			if (!entry.startsWith("playwright@")) continue;
			const candidate = join(homePnpm, entry, "node_modules", "playwright", "index.mjs");
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

/** Loads optional Playwright runtime without requiring compile-time type declarations. */
export async function tryLoadPlaywright(): Promise<PlaywrightChromiumModule | null> {
	const entry = findPlaywrightEntry();
	try {
		const spec = entry ? pathToFileURL(entry).href : "playwright";
		return (await import(spec)) as PlaywrightChromiumModule;
	} catch {
		return null;
	}
}

async function launchHeadlessChromium(): Promise<PlaywrightBrowser> {
	const pw = await tryLoadPlaywright();
	if (!pw?.chromium) {
		throw new Error("Playwright Chromium is required to evaluate design-01 rendered compositions");
	}
	const { chromium } = pw;
	const args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"];
	try {
		return await chromium.launch({ headless: true, args });
	} catch (primaryErr) {
		const candidatePaths = [
			"C:/Program Files/Google/Chrome/Application/chrome.exe",
			"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
			"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
			"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
			"/usr/bin/google-chrome",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		];
		for (const exe of candidatePaths) {
			if (!existsSync(exe)) continue;
			try {
				return await chromium.launch({ executablePath: exe, headless: true, args });
			} catch {
				// Try next installed Chromium/Edge binary.
			}
		}
		throw primaryErr;
	}
}

async function evaluateRenderedComposition(sandboxDir: string): Promise<{
	passed: boolean;
	detail?: string;
}> {
	const indexPath = join(sandboxDir, "index.html");
	if (!existsSync(indexPath)) {
		return { passed: false, detail: "Missing index.html" };
	}

	const staticHtml = readFileSync(indexPath, "utf8");
	if (/https?:\/\//i.test(staticHtml)) {
		const externalMatches = staticHtml.match(/<(?:script|link|img)[^>]*(?:src|href)=["']https?:\/\/[^"']+["']/gi);
		if (externalMatches && externalMatches.length > 0) {
			return { passed: false, detail: `External CDN/network asset detected in offline task: ${externalMatches[0]}` };
		}
	}

	let srv: { url: string; close: () => Promise<void> } | null = null;
	let browser: PlaywrightBrowser | null = null;
	try {
		srv = await startStaticSandboxServer(sandboxDir);
		browser = await launchHeadlessChromium();
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

		const runtimeErrors: string[] = [];
		const externalRequests: string[] = [];
		page.on("pageerror", (err) => runtimeErrors.push(`pageerror: ${err.message}`));
		page.on("console", (msg) => {
			if (msg.type() === "error") runtimeErrors.push(`console.error: ${msg.text()}`);
		});
		page.on("request", (req) => {
			const url = req.url();
			if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("data:") && !url.startsWith("blob:")) {
				externalRequests.push(url);
			}
		});
		page.on("requestfailed", (req) => {
			runtimeErrors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? "unknown"})`);
		});

		await page.goto(srv.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
		await page.waitForTimeout(250);

		const domInfo = await page.evaluate(() => {
			const canvas = document.querySelector("canvas");
			const durEl = document.querySelector("[data-duration]");
			return {
				hasSeek: typeof (window as unknown as { seek?: unknown }).seek === "function",
				durationAttr: durEl?.getAttribute("data-duration") ?? null,
				canvasW: canvas ? canvas.getBoundingClientRect().width : 0,
				canvasH: canvas ? canvas.getBoundingClientRect().height : 0,
			};
		});
		if (!domInfo.hasSeek) {
			return { passed: false, detail: "window.seek(t) function is missing" };
		}
		if (domInfo.durationAttr !== "300") {
			return { passed: false, detail: `Expected [data-duration="300"], got ${String(domInfo.durationAttr)}` };
		}
		if (domInfo.canvasW < 640 || domInfo.canvasH < 360) {
			return { passed: false, detail: `Canvas too small or invisible: ${domInfo.canvasW}x${domInfo.canvasH}` };
		}

		const sampleTimes = [5, 12, 70, 145, 215, 280];
		const pngDataUrls: string[] = [];
		const bodyTexts: string[] = [];

		for (const t of sampleTimes) {
			const text = await page.evaluate((sec: number) => {
				const w = window as unknown as { seek: (s: number) => void };
				w.seek(sec);
				return new Promise<string>((done) => {
					requestAnimationFrame(() =>
						requestAnimationFrame(() => done((document.body.innerText || "").trim())),
					);
				});
			}, t);
			bodyTexts.push(text);
			const png = await page.screenshot({ type: "png" });
			pngDataUrls.push(`data:image/png;base64,${png.toString("base64")}`);
		}

		if (externalRequests.length > 0) {
			return { passed: false, detail: `External network requests made during offline render: ${externalRequests.join(", ")}` };
		}
		if (runtimeErrors.length > 0) {
			return { passed: false, detail: `Runtime JS/resource errors: ${runtimeErrors.slice(0, 3).join("; ")}` };
		}

		const visualMetrics = await page.evaluate(async (urls: string[]) => {
			const loadPixels = async (src: string) => {
				const img = new Image();
				img.src = src;
				await new Promise<void>((res, rej) => {
					img.onload = () => res();
					img.onerror = () => rej(new Error("Failed to decode frame PNG"));
				});
				const c = document.createElement("canvas");
				c.width = 160;
				c.height = 90;
				const g = c.getContext("2d")!;
				g.drawImage(img, 0, 0, 160, 90);
				return g.getImageData(0, 0, 160, 90).data;
			};

			const frames = await Promise.all(urls.map(loadPixels));
			const stdDevs = frames.map((buf) => {
				let sum = 0;
				let sumSq = 0;
				const n = buf.length / 4;
				for (let i = 0; i < buf.length; i += 4) {
					const luma = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
					sum += luma;
					sumSq += luma * luma;
				}
				const mean = sum / n;
				return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
			});

			const diffBetween = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
				let changed = 0;
				const n = a.length / 4;
				for (let i = 0; i < a.length; i += 4) {
					const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
					if (d > 18) changed++;
				}
				return changed / n;
			};

			return {
				minStdDev: Math.min(...stdDevs),
				intraSceneDiff: diffBetween(frames[0], frames[1]),
				beatDiffs: [
					diffBetween(frames[0], frames[2]),
					diffBetween(frames[2], frames[3]),
					diffBetween(frames[3], frames[4]),
					diffBetween(frames[4], frames[5]),
				],
			};
		}, pngDataUrls);

		if (visualMetrics.minStdDev < 6) {
			return { passed: false, detail: `Rendered frame appears nearly blank/flat (min stddev=${visualMetrics.minStdDev.toFixed(2)})` };
		}
		if (visualMetrics.intraSceneDiff < 0.002) {
			return { passed: false, detail: `No intra-scene animation detected between t=5s and t=12s (delta=${visualMetrics.intraSceneDiff.toFixed(4)})` };
		}
		const minBeatDiff = Math.min(...visualMetrics.beatDiffs);
		if (minBeatDiff < 0.015) {
			return { passed: false, detail: `Insufficient scene/camera motion across 300s beats (min beat delta=${minBeatDiff.toFixed(4)})` };
		}

		const distinctTexts = new Set(bodyTexts);
		if (distinctTexts.size < 4) {
			return { passed: false, detail: `Expected distinct synchronized HUD/caption states across beats (saw ${distinctTexts.size})` };
		}
		const mergedCorpus = bodyTexts.join("\n");
		if (!/(576|hy4|kimi|qwen|opencode|gentle-shell|architect|executor)/i.test(mergedCorpus)) {
			return { passed: false, detail: "Rendered captions do not reference real dataset/character concepts" };
		}

		return { passed: true };
	} catch (err) {
		return { passed: false, detail: err instanceof Error ? err.message : String(err) };
	} finally {
		if (browser) await browser.close().catch(() => {});
		if (srv) await srv.close().catch(() => {});
	}
}

export const design3dExplainerTask: BenchmarkTaskDef = {
	id: "design-01-3d-benchmark-explainer",
	category: "design-bench",
	title: "5-Minute Interactive 3D Character Benchmark Explainer (Playwright Visual Gate)",
	description: "Evaluates 3D scene/rig choreography, editorial clarity, deterministic seek(t) timeline over 300s, and headless Chromium pixel motion.",
	timeoutMs: 1_200_000,
	permissionMode: "workspace",
	protectedPaths: ["data/benchmark-findings.json", "test/data-integrity.test.mjs"],
	fixtureFiles: {
		"package.json": JSON.stringify({ name: "benchmark-3d-explainer", type: "module", private: true }, null, 2) + "\n",
		"README.md": README_MD,
		"data/benchmark-findings.json": DATA_JSON,
		"test/data-integrity.test.mjs": DATA_TEST_MJS,
	},
	oraclePatchFiles: {
		"style-brief.md": ORACLE_STYLE_BRIEF,
		"art-direction.md": ORACLE_ART_DIRECTION,
		"timeline.json": JSON.stringify(ORACLE_TIMELINE, null, 2) + "\n",
		"index.html": ORACLE_INDEX_HTML,
	},
	prompt: [
		"Read `README.md` and `data/benchmark-findings.json` completely.",
		"Build the 300-second (5-minute) interactive 3D explainer video composition described in `README.md`.",
		"Deliverables: `style-brief.md`, `art-direction.md`, `timeline.json`, and self-contained offline `index.html` (zero external CDN URLs).",
		"CRITICAL: Do NOT modify `data/benchmark-findings.json` or `test/data-integrity.test.mjs`.",
		"Ensure `index.html` renders genuine animated 3D perspective geometry on a `<canvas>`, articulates both `CHAR-ARCHITECT` and `CHAR-EXECUTOR` characters, updates DOM captions/HUD deterministically via `window.seek(t)` across 0..300s, and runs with zero browser console errors.",
	].join("\n"),
	async evaluate(sandboxDir: string) {
		const checks: EvalCheckResult[] = [];
		const prot = evaluateProtectedPaths(sandboxDir, design3dExplainerTask);
		checks.push(...prot.checks);

		// 1. PASS_TO_PASS: data/benchmark-findings.json integrity check
		const dataRes = await runIsolatedNodeCommand({
			cwd: sandboxDir,
			args: ["--test", "test/data-integrity.test.mjs"],
			timeoutMs: 10_000,
		});
		checks.push({
			name: "pass_to_pass:dataset_integrity",
			kind: "pass_to_pass",
			passed: dataRes.passed,
			detail: dataRes.detail,
		});

		// 2. FAIL_TO_PASS (1): style-brief.md, art-direction.md & timeline.json design contracts
		let docsOk = false;
		let docsDetail: string | undefined;
		try {
			const briefPath = join(sandboxDir, "style-brief.md");
			const artPath = join(sandboxDir, "art-direction.md");
			const tlPath = join(sandboxDir, "timeline.json");
			if (!existsSync(briefPath) || !existsSync(artPath) || !existsSync(tlPath)) {
				throw new Error("Missing one or more design docs: style-brief.md, art-direction.md, timeline.json");
			}
			const brief = readFileSync(briefPath, "utf8");
			const art = readFileSync(artPath, "utf8");
			const rawTl = JSON.parse(readFileSync(tlPath, "utf8")) as unknown;
			const tl = (
				Array.isArray(rawTl)
					? rawTl
					: rawTl && typeof rawTl === "object" && Array.isArray((rawTl as { scenes?: unknown[] }).scenes)
						? (rawTl as { scenes: unknown[] }).scenes
						: []
			) as Array<{ startSec?: number; endSec?: number }>;
			if (!/Intent\s*:/i.test(brief) || !/300/.test(brief)) {
				throw new Error("style-brief.md must declare Intent: presentation and 300s duration");
			}
			if (!/CHAR-ARCHITECT/i.test(art) || !/CHAR-EXECUTOR/i.test(art)) {
				throw new Error("art-direction.md must define continuity for both CHAR-ARCHITECT and CHAR-EXECUTOR");
			}
			if (!Array.isArray(tl) || tl.length < 5) {
				throw new Error("timeline.json must define at least 5 scenes across 0..300s");
			}
			const maxEnd = Math.max(...tl.map((s) => Number(s?.endSec ?? 0)));
			const minStart = Math.min(...tl.map((s) => Number(s?.startSec ?? 999)));
			if (minStart > 1 || maxEnd < 290) {
				throw new Error(`timeline.json coverage insufficient (${minStart}s..${maxEnd}s)`);
			}
			docsOk = true;
		} catch (err) {
			docsDetail = err instanceof Error ? err.message : String(err);
		}
		checks.push({
			name: "fail_to_pass:design_contract_docs_and_timeline",
			kind: "fail_to_pass",
			passed: docsOk,
			detail: docsDetail,
		});

		// 3. FAIL_TO_PASS (2): Headless Chromium Playwright offline render, seek(t), 3D character motion & narrative telemetry
		const renderRes = await evaluateRenderedComposition(sandboxDir);
		checks.push({
			name: "fail_to_pass:playwright_3d_render_seek_and_motion",
			kind: "fail_to_pass",
			passed: renderRes.passed,
			detail: renderRes.detail,
		});

		return summarizeTaskChecks(checks, prot.forbiddenTouches);
	},
};
