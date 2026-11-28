---
name: python-manim
description: >-
  Trigger: manim, python animation, math animation, algorithm visualization,
  hand-drawn diagram, rough-py, 3blue1brown, whiteboard python. Build deterministic
  2D vector/diagram and hand-drawn videos with Manim CE 0.22.1 + rough 1.6 in
  an isolated Python 3.12 venv, integrated with idu-pi's gates.
metadata:
  author: Wladimirfn / cross-cli skills-bundle
  tags: [manim, python, rough, whiteboard, diagrams, math]
  version: 1.0.0
---

# Python Manim + Rough (`manim 0.22.1` + `rough 1.6`)

Use this skill for algorithmic walkthroughs, progressive diagram drawing,
geometric proofs, and hand-drawn whiteboard aesthetics rendered natively in Python.

## Activation Contract

Load when `style-brief.md` declares `- Engine: manim` or `- Lane: manim-explainer`.
Do not load for modern web-UI mockups (`remotion-engine` / `video-production`)
or realistic 3D lighting (`blender-cinematic`).

## Hard Rules

- **Use the isolated Python 3.12 Manim venv.** `idu-pi` resolves
  `~/.idu/venvs/manim/Scripts/python.exe` (or project `.venv`) with
  `PYTHONNOUSERSITE=1`. Never install Manim into Python 3.13 or pollute the
  global Python environment used by `voz_validator.py`.
- **Probe LaTeX before using `MathTex`/`Tex`.** Run `idu-pi video probe --project <dir>`
  first. If `latex: no`, use `Text`, `MarkupText`, `Code`, SVGs, and Manim
  vector geometry (`VGroup`, `Arrow`, `Create`, `Write`) — never emit `MathTex`.
- **Hand-drawn aesthetic via `rough`.** For sketchy/hand-drawn strokes, generate
  SVG paths with `rough` (`1.6`) and import via `SVGMobject` instead of
  hand-jittering Bezier points inconsistently.
- **One `Scene` class per timeline entry.** Match `timeline.json` scene IDs
  (`e01`, `e02`, ...) or map them explicitly via `sceneClass` in `timeline.json`
  and `manim.scenes` in `video-engine.json`. Keep scene durations aligned with
  `timeline.json` (`self.wait(...)` pads to the exact scene span).
- **Audio gate parity.** Declare narration and music in `audio-manifest.json`
  so `idu-pi video validate-audio` validates Whisper STT and `partitura.json`
  before `idu-pi video render` concatenates and muxes scenes.

## Project Files

- `style-brief.md` (`- Engine: manim`, `- Lane: manim-explainer`)
- `art-direction.md`
- `timeline.json` (`total`, `fps`, `width`, `height`, `scenes[]`)
- `video-engine.json` (`{ "manim": { "file": "scene.py", "scenes": ["e01", "e02"] } }`)
- `scene.py` (defining `class e00(Scene)` or styleboard + `class e01(Scene)` ...)
- `audio-manifest.json` (when narrated or scored)

## Execution Steps

1. Run `idu-pi video probe --project <dir>` and record `manim`, `rough`, `latex`, and `ffmpeg` status.
2. Write `style-brief.md` (`Engine: manim`, `Lane: manim-explainer`) and `art-direction.md`.
3. Render `e00-styleboard.png` (`idu-pi video keyframes --project <dir> --scene e00`) and wait for approval.
4. Implement one `Scene` class per beat in `scene.py`, generate `keyframes/eNN.png` (`idu-pi video keyframes`), run `validate-audio` + `audit`.
5. Render and validate final MP4 with `idu-pi video render --project <dir>`.
