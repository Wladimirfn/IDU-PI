---
name: remotion-engine
description: >-
  Trigger: remotion, motion-graphics, react video, kinetic type, product promo,
  batch video, remotion studio, remotion render. Build deterministic React/TypeScript
  videos with Remotion 4.x integrated with idu-pi's e00, visual-qa, audio-qa,
  and motion gates.
metadata:
  author: Wladimirfn / cross-cli skills-bundle
  tags: [remotion, react, typescript, motion-graphics, video]
  version: 1.0.0
  sources: remotion-dev/skills
---

# Remotion Engine (`@remotion/cli` 4.x)

Use this skill for React/TypeScript motion graphics, UI product demos,
kinetic typography, data visualizations, and batch-rendered explainers under
`- Engine: remotion` (or `- Lane: motion-graphics` without legacy HyperFrames HTML).

## Activation Contract

Load when `style-brief.md` declares `- Engine: remotion` or `- Lane: motion-graphics`
for a new React/TS project. Do not mix HyperFrames `index.html` timelines and
Remotion compositions in the same project.

## Hard Rules (from Remotion + `idu-pi`)

- **Frame-pure math only.** Every animated property MUST derive deterministically
  from `useCurrentFrame()` and `useVideoConfig()` (`spring()`, `interpolate()`).
  Never use CSS `@keyframes`, `transition`, `setTimeout`, `setInterval`,
  `requestAnimationFrame`, or unseeded `Math.random()`.
- **Zero layout shift.** Pre-measure text/containers and lock layout boxes so
  static elements never jitter across frames (failing `validar_motion.py`).
- **Explicit asset loading.** Place images, fonts, and audio under `public/` and
  reference them via `staticFile(...)`.
- **Single source of timing.** `timeline.json` (`total`, `fps`, `width`, `height`,
  `scenes[]`) and Remotion's `<Composition durationInFrames fps width height>`
  must agree on duration and dimensions. Do not silently retime narration.
- **Audio gate parity.** When narrating or scoring externally, declare
  `audio-manifest.json` (`voices[]` + `bgm`) so `idu-pi video validate-audio`
  verifies Whisper STT, closing clicks, and `partitura.json` before delivery.
  If audio is muxed via `--audio` / `*-hq.mp4` by `idu-pi video render`, keep
  the Remotion composition mute so audio is never double-muxed.
- **Style agnostic.** Never impose `kanagawa-html` colors or fonts unless
  `art-direction.md` explicitly selects them.

## Project Files

- `style-brief.md` (`- Engine: remotion`, `- Lane: motion-graphics`)
- `art-direction.md`
- `timeline.json`
- `video-engine.json` (`{ "remotion": { "entry": "src/index.ts", "compositionId": "Main" } }`)
- `src/index.ts`, `src/Root.tsx`, scene components
- `audio-manifest.json` (when narrated or scored)

## Commands via `idu-pi`

- Probe toolchain: `idu-pi video probe --project <dir>`
- Live Studio preview: `idu-pi video studio --project <dir>` (launches `remotion studio`)
- Keyframes (`e00` / `eNN`): `idu-pi video keyframes --project <dir> [--scene e00]` (runs `remotion still` mapped from `timeline.json`)
- Audio gate: `idu-pi video validate-audio --project <dir>`
- Independent audit: `idu-pi video audit --project <dir>`
- Delivery MP4 + motion gate: `idu-pi video render --project <dir>`

## Execution Steps

1. Run `idu-pi video probe --project <dir>` and confirm `remotion` (`4.x`) and `ffmpeg`.
2. Scaffold project (`package.json` with `remotion`, `@remotion/cli`, `react`, `react-dom`, or reference `~/.idu/tools/remotion` toolchain) and write `style-brief.md` + `art-direction.md`.
3. Capture `e00-styleboard.png` at frame 0 (or hero frame) and wait for approval.
4. Build `<Sequence>` scenes matching `timeline.json`, verify `quietWindow`/`reviewAt` beats, capture `keyframes/eNN.png`, run `validate-audio` + `audit`.
5. Render delivery MP4 with `idu-pi video render --project <dir>`.
