---
name: blender-cinematic
description: >-
  Trigger: blender, cycles, eevee, 3d render, camera choreography, PBR lighting,
  product 3D, blender-mcp, mcp-for-blender, bpy. Build and render cinematic 3D
  scenes in Blender 5.3.0 with GPU Cycles (OptiX/CUDA) and mcp-for-blender,
  passing idu-pi's e00, visual-qa, audio-qa, and motion gates.
metadata:
  author: Wladimirfn / cross-cli skills-bundle
  tags: [blender, 3d, cycles, eevee, mcp-for-blender, bpy, cinematic]
  version: 1.0.0
---

# Blender Cinematic (`blender-mcp` + headless `bpy`)

Use this skill when a piece requires real 3D geometry, physical lighting,
shadows, PBR materials, or cinematic camera moves that HTML/CSS cannot carry.

## Activation Contract

Load when `style-brief.md` declares `- Engine: blender` or `- Lane: blender-3d`,
or when `art-direction.md` selects true 3D lighting/shadows/camera work. Do not
load for 2D UI explainers or simple data charts (`video-production` / `remotion-engine`).

## Hard Rules

- **Verify the toolchain first.** Run `idu-pi video probe --project <dir>` and
  record Blender `5.3.0`, Cycles GPU (`OPTIX`/`CUDA` on RTX 3060), and
  `blender_mcp.py` addon status in `art-direction.md`.
- **Two-stage workflow: interactive MCP, deterministic headless render.**
  Use `blender` MCP (`mcp-for-blender`) while Blender GUI is open (viewport
  feedback, lookdev, camera framing), then commit reproducible scene logic to
  `scene.blend` + `render_blender.py` so `idu-pi video render` executes
  deterministically in `-b` background mode.
- **No silent CPU fallback on `--gpu`.** If `--gpu` is passed and no
  OPTIX/CUDA device exists, `idu-pi video render` fails explicitly.
- **One timeline truth.** `timeline.json` (`total`, `fps`, `scenes[]` with
  `start`, `end`, `reviewAt`, `quietWindow`) must match the frame range
  rendered by `render_blender.py`.
- **Blender 5.x compatibility.**
  - Install/sync the addon into `Blender Foundation/Blender/5.3/scripts/addons/`
    with `PYTHONUTF8=1 uvx mcp-for-blender install-addon` (never assume 4.x
    addons carry over automatically).
  - Use `Principled BSDF` socket names from Blender 4.x/5.x (`Subsurface Weight`,
    `Specular IOR Level`, `Transmission Weight`, `Coat Weight`, `Emission Color`).
- **Audio contract.** Never rely on `<audio>` tags alone; declare voice/music
  clips in `audio-manifest.json` so `idu-pi video validate-audio` validates
  Whisper STT, clicks, and `partitura.json` before muxing.

## Project Files

- `style-brief.md` (`- Engine: blender`, `- Lane: blender-3d`)
- `art-direction.md`
- `timeline.json` (`total`, `fps`, `width`, `height`, `scenes[]`)
- `video-engine.json` (optional `{ "blender": { "blendFile": "scene.blend", "script": "render_blender.py" } }`)
- `scene.blend` and/or `render_blender.py`
- `audio-manifest.json` (when narrated or scored)

## `render_blender.py` CLI Contract

`idu-pi video keyframes` and `idu-pi video render` invoke your script as:

```bash
blender -b scene.blend --python render_blender.py -- --still e01 --frame 142 --out keyframes/e01.png
blender -b scene.blend --python render_blender.py -- --frames-dir <tmp> --end-frame 450 --fps 30 [--width 1920 --height 1080 --gpu]
```

Write `frame_0001.png` ... `frame_NNNN.png` (4-digit padded PNG) inside `--frames-dir`
when rendering full sequences, or write the exact `--out` path on `--still`.
Configure Cycles OPTIX/CUDA + OpenImageDenoise when `--gpu` is set, and save
clean `e00-styleboard.png` + `keyframes/eNN.png` for `idu-pi video audit`.

## Execution Steps

1. Run `idu-pi video probe --project <dir>` and confirm `blender`, `ffmpeg`, and `blenderMCP`.
2. Write `style-brief.md` (`Engine: blender`, `Lane: blender-3d`) and `art-direction.md`.
3. Build/test lookdev in Blender (interactively via `blender` MCP or via `render_blender.py`).
4. Capture `e00-styleboard.png` (`idu-pi video keyframes --project <dir> --scene e00`) and get user approval.
5. Capture `keyframes/eNN.png` (`idu-pi video keyframes --project <dir>`), validate audio (`idu-pi video validate-audio`), and run `idu-pi video audit`.
6. Deliver MP4 via `idu-pi video render --project <dir> [--gpu]`.
