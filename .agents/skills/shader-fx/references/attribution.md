# Attribution

This skill is a distilled, rewritten work. It copies no source file wholesale;
every recipe and rule was re-authored for this repository's conventions
(deterministic timeline-driven rendering, paste-ready snippets, budget-first
delivery).

## Sources

| Source | License | What was used |
| --- | --- | --- |
| [gokayfem/shader-skills](https://github.com/gokayfem/shader-skills) (`skills/shader-art-coding/SKILL.md`, `adapters/universal-system-prompt.md`, `prompts/video-to-shader-prompt.md`, `CREDITS.md`, gallery templates) | MIT | GLSL conventions and hard rules (PCG/integer hashing instead of sine hashes, float literals, NaN guards, bounded raymarching, Lipschitz scaling), the subject→technique routing idea (SDF, fBm, terrain, water, clouds, tonemapping), and the verify-each-stage workflow discipline. |
| [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) (`skills/pixelfx/SKILL.md`, `docs/AUTHORING.md`, `src/core/painter.js`, `src/fx/transitions/crt-off.js`) | MIT | Post-process ideas only: ordered (Bayer) dithering as the alpha/fade mechanism, scanline/CRT treatment patterns, and the determinism discipline (seeded randomness, never `Math.random()`, quantized time). |

## What was rewritten

- All GLSL snippets in `glsl-patterns.md` were written for this skill against
  this repo's uniform contract (`u_time` / `u_resolution` / `u_seed`,
  fullscreen-quad pass, composition-time `t`). They are not copies of either
  source's code.
- The CRT/VHS/grain/dither/pixelate sections restate techniques whose ideas
  appear in pixelfx's painter and transitions in a fragment-shader form; the
  pixel-art sprite/effect pipeline (acts, sprite sheets, the 244-effect
  library) is deliberately out of scope.
- The HyperFrames integration layer (`hyperframes-integration.md`) is original
  to this repository, based on `../video-production/SKILL.md`'s
  renderer contract; no external source describes it.

## What was inspired (ideas only)

- shader-skills' "smallest mathematical model first" and debug-view discipline.
- pixelfx's "render, look, refine" loop, adapted here as the
  determinism/performance verification step.

Downstream users of this skill should preserve this attribution when
redistributing. Both sources are MIT; their licenses require keeping the
copyright and permission notice — see each repository's `LICENSE` for the
canonical text.
