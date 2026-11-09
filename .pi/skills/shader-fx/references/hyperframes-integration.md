# HyperFrames integration

How a shader effect lives inside a HyperFrames composition: a deterministic
frame renderer where every frame is a pure function of composition time. The
composition exposes `window.seek(t)`; the delivery renderer (`render_frames.mjs`)
captures one PNG per frame through it. Anything that breaks that purity —
wall-clock time, `Math.random()`, un-seeded noise, `requestAnimationFrame`
loops — renders correctly in preview and wrong in the MP4.

## Mounting the canvas

The effect is one fullscreen `<canvas>` (WebGL or 2D) inside the scene layer:

```html
<canvas id="fx" style="position:absolute; inset:0; width:100%; height:100%;
                      pointer-events:none;"></canvas>
```

- Size the backing store once at setup (or on resize), from
  `canvas.clientWidth/Height * devicePixelRatio`; pass it as `u_resolution`.
  Do not re-allocate per frame.
- Order layers so the effect sits behind text/data; keep the text layer
  independent so contrast can be verified without re-rendering the effect.

## Driving time: `renderAt(t)` / `window.seek(t)`

The composition owns a global timeline function; the renderer calls it, not
your effect:

```js
window.seek = function (t) {
  // 1) move every scene element to composition time t (CSS/DOM/attributes)
  // 2) drive every effect from the same t:
  fxCanvas.renderAt(t);           // sets u_time = t, draws one frame
  // 3) return (or resolve) only when the DOM and canvases are ready to capture
};
```

Inside the effect, the only clock is the `t` handed in:

```js
function renderAt(t) {
  gl.uniform1f(uTimeLoc, t);          // u_time = composition time
  gl.uniform2f(uResLoc, w, h);
  gl.uniform1f(uSeedLoc, SEED);       // fixed constant, per scene
  gl.drawArrays(gl.TRIANGLES, 0, 6);  // one fullscreen quad
}
```

- `u_time` is seconds of composition time. Quantize it inside the shader when
  the effect should tick at a fixed rate (grain, scanline jitter): pass
  `floor(t * fps)` to the hash.
- `u_seed` is a fixed float constant chosen per scene; changing it re-rolls the
  effect deterministically. Never seed from the clock.
- No `requestAnimationFrame` in render mode. The Studio preview may use a RAF
  loop, but it must call the same `renderAt(previewT)` with composition time,
  not wall time.

## WebGL fallback

Detect once at setup; on failure, mount the CSS/SVG fallback:

```js
const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
if (!gl) {
  canvas.replaceWith(fallbackLayer());   // CSS gradient / SVG filter layer
}
```

The fallback approximates the effect's average look (gradient position, hue,
opacity), never the motion. State this in the delivery notes.

## Verifying determinism and performance

Before delivery:

1. **Same-t diff.** Render `seek(t)` twice and diff the captures — must be 0
   changed pixels. A nonzero diff means clock or RNG leaked in.
2. **Seek stability.** Jump to `t`, then to `t - 1`, back to `t`; re-diff.
   Effects that accumulate state per draw (instead of computing from `t`)
   fail this.
3. **fps budget.** At 1080p on integrated GPU, target 60 fps for the full
   composition: measure the effect's draw cost alone first, then composed.
   If over budget: fewer octaves/steps, half-resolution render target upscaled,
   or drop to the 2D fallback pattern.

## Testing with `render_frames.mjs`

The delivery renderer captures frames through `window.seek(t)` — see
`../video-production/SKILL.md` for the full pipeline. To smoke-test
the effect:

- Load the composition as `file://.../index.html` (not the Studio URL: the
  Studio-served page does not expose `window.seek` on the top window).
- Render a short range covering the effect's most active beats
  (`--end <s>` for a partial render) and inspect the PNGs: the effect must be
  present, artifact-free, and identical across two renders of the same range.
- Remember the renderer is video-only unless `--audio` is passed; the effect
  change should be verified on the visual diff, not the codec noise.

## Checklist before hand-off

- [ ] `u_time` fed only from composition `t`; no clock APIs in render code.
- [ ] No `Math.random()`, no unseeded hash, no per-frame allocation.
- [ ] One fullscreen quad (or one `ImageData` pass); no RAF loop in render mode.
- [ ] Determinism diff: two renders of the same `t` produce identical pixels.
- [ ] Contrast verified where the effect touches text or data.
- [ ] Fallback mounted and visually acceptable on no-WebGL.
- [ ] Budget stated: resolution, steps/octaves, fps class, downscale knob.
