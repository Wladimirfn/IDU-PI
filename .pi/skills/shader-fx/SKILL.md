---
name: shader-fx
description: "Trigger: shader, GLSL, WebGL, procedural background, CRT, VHS, grain, dither, pixelate, SDF, raymarching, noise, water, clouds. Deterministic GLSL/post-process effects for HTML/Three.js scenes via renderAt(t)/seek(t). Not game pixel-art."
license: MIT
metadata:
  author: Wladimirfn / cross-cli skills-bundle
  version: 1.0.0
  updated: 2026-11-09
  sources: gokayfem/shader-skills (MIT), patch-gg/pixelfx (MIT, post-process ideas only)
---

# Shader FX

GLSL and post-process effects as deterministic, budgeted snippets for HTML
canvas / Three.js compositions rendered through a fixed timeline. Every frame
is a pure function of composition time: same `t` in, same pixels out, in Studio
preview and MP4 alike. Lane-agnostic — any scene composition can consume it —
and neither a narrative engine nor a game pixel-art skill.

## Activation Contract

Load when the request involves a procedural background or generative visual;
CRT scanlines, VHS, film grain, dither, pixelation, vignette, chromatic
aberration, distortion; or SDF, raymarching, noise, water, clouds, terrain in a
canvas. Do not load for scenes whose core is readable text, data, dashboards or
charts; simple gradients, blurs or fades a CSS gradient or SVG filter resolves;
or targets without WebGL, where the fallback is the deliverable.

## Hard Rules

- **Determinism.** `u_time` derives from composition time (`t` in
  `renderAt(t)` / `window.seek(t)`), never `Date.now()`, `performance.now()`,
  or wall clock. Seeded hash only (PCG-style on integer cells); no
  `Math.random()` in render code; no per-frame allocation.
- **One fullscreen quad.** A single fragment-shader pass (or one `ImageData`
  pass on canvas 2D). No `requestAnimationFrame` in render mode.
- **Fallback first.** No WebGL → the CSS gradient/SVG fallback is the
  deliverable, mounted by the snippet, not an afterthought.
- **Legibility.** Never place an effect behind text or data without verifying
  contrast; "text unreadable" is a blocker, not a tuning nit.
- **Budget.** 1080p 60 fps on integrated GPU: bound raymarching steps (≤ 64),
  fade octaves with distance, downscale-and-upscale soft effects. Report the
  budget in the notes.
- **No shader for what CSS/SVG solves.** A shader earns its cost only when the
  effect moves procedurally or needs per-pixel math.

## Decision Gates

| Question | Use |
| --- | --- |
| Simple gradient / static vignette / blur? | CSS or SVG — not this skill |
| Animated noise, warp, SDF, water, clouds, retro post? | WebGL fragment shader |
| Soft, low-frequency texture (fog, grain haze)? | Canvas 2D `ImageData` pass acceptable |
| Studio preview vs delivery render? | Same snippet; verify determinism under `window.seek(t)` before delivery |
| Subtle backdrop vs generative centerpiece? | Backdrop: downscale + few octaves; centerpiece: full budget, still ≤ 60 fps |

## Execution Steps

1. **Detect the lane and the effect.** Host composition (HTML scene /
   Three.js); classify: backdrop, post-process, or centerpiece.
2. **Pick the recipe.** Adapt the closest pattern in
   `references/glsl-patterns.md` rather than writing from scratch.
3. **Adapt the uniforms.** `u_time` from composition `t`, `u_resolution` from
   the canvas, `u_seed` fixed per scene. Name art controls as constants.
4. **Integrate into the timeline.** Mount and drive exactly as
   `references/hyperframes-integration.md` specifies; no own animation loop.
5. **Verify determinism and performance.** Same-`t` render diff must be 0
   changed pixels; seek stability check; fps at target resolution.
6. **Deliver snippet + notes.** Snippet, fallback, integration notes, budget,
   and which pattern was adapted.

## Output Contract

Return a self-contained GLSL or canvas-2D snippet (one fullscreen pass,
uniforms wired, constants named) ready to paste into the host composition, with
integration notes (mount point, `renderAt(t)`/`window.seek(t)` wiring, fallback
engagement), the CSS/SVG fallback, a performance budget (resolution,
steps/octaves, fps class, downscale knob), and a one-line pattern attribution
per `references/attribution.md`.

## References

- `references/glsl-patterns.md` — recipe catalog: SDF, fBm/noise, water,
  clouds, CRT, VHS, grain, dither, pixelate, vignette.
- `references/hyperframes-integration.md` — mounting, `renderAt(t)` /
  `window.seek(t)`, uniforms, fallback, testing with `render_frames.mjs`.
- `references/attribution.md` — sources, licenses, what was rewritten vs
  inspired.
