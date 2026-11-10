# GLSL patterns

Compact recipe catalog. Each pattern is a minimal, rewritten starting point:
adapt it, do not paste it blindly. Conventions shared by all patterns:

- `uv` covers the canvas: `vec2 uv = gl_FragCoord.xy / u_resolution;`
- Time is `u_time` (composition `t`), resolution `u_resolution`, seed `u_seed`
  (a fixed float; vary it per scene by authoring, never at runtime).
- Float literals always (`2.0`, not `2`). Guard NaN sources: `atan(0,0)`,
  `sqrt(neg)`, `normalize(vec3(0))`.
- Hash: PCG-style integer hash on cell ids — never
  `fract(sin(dot(p,k))*43758.5453)`, whose pattern differs per GPU.
- `sceneColor(uv)` is the host scene sample: procedural in a single-pass canvas
  shader, or `texture(u_tex, uv)` only when the host explicitly uploads a texture.
- Integer PCG requires WebGL2 / GLSL ES 3.00 (`#version 300 es`). On WebGL1,
  use a seeded float hash and document the precision caveat.

## Value / fBm noise

```glsl
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p))) + uint(u_seed * 1000.0);
  return float(pcg(q.x + pcg(q.y)) >> 8u) * (1.0 / 16777216.0);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
```

`u_seed` is an integer-valued float. On WebGL1, replace `pcg` with a seeded
float mixer and keep the same `hash(vec2)` signature.

Variants: ridged (`v = a * (1.0 - abs(2.0 * noise(p) - 1.0))`) for mountains;
domain warp (`fbm(p + fbm(p))`) for marble/smoke. Fade octaves with distance.

## SDF shapes (2D)

```glsl
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float smin(float a, float b, float k) {   // organic blend
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
```

Compose with `smin`/`smax`; color by nearest distance band. For posters and
logos this replaces whole texture pipelines.

## Raymarching (3D SDF)

Bound it: ≤ 64 steps, early exit on distance < epsilon or `t > tMax`. Scene
function returns `vec2(distance, materialId)`. Cheap AO: compare a few
off-surface samples. If displacement or twist bends distances, scale the step
down (Lipschitz > 1). Prefer 2D SDFs or fBm when a raymarcher would be invisible
at backdrop scale.

## Water

Sum of sines with sharpened crests for the surface, plus fBm normal jitter:

```glsl
float wave(vec2 p, float t) {
  float h = 0.0, a = 1.0, ph = t * 1.2;
  for (int i = 0; i < 4; i++) {
    vec2 d = normalize(vec2(cos(ph), sin(ph)));
    h += a * sin(dot(p, d) * (3.0 + float(i)) + ph * 2.0);
    a *= 0.5; ph += 1.7;
  }
  return h;
}
```

Cheap depth: mix shallow/deep color by fBm; add a specular glint from the
normal's dot with the light direction. Foam: threshold crests.

## Clouds

Two-layer fBm, scrolled at different speeds, alpha-thresholded:

```glsl
float clouds(vec2 uv, float t) {
  float c = fbm(uv * 3.0 + vec2(t * 0.05, 0.0));
  c += 0.5 * fbm(uv * 7.0 - vec2(t * 0.11, 0.0));
  return smoothstep(0.45, 0.85, c * 0.5);
}
```

For volumetric looks at backdrop scale, sample 2–4 fbm slices along a fixed
view direction instead of true raymarched volume integration.

## CRT scanlines

```glsl
vec3 crt(vec3 col, vec2 uv) {
  float sl = 0.85 + 0.15 * sin(uv.y * u_resolution.y * 3.14159);
  // slow bright band rolling down
  float band = smoothstep(0.0, 0.15, fract(uv.y - u_time * 0.1));
  return col * mix(sl, 1.05, band);
}
```

Pair with a slight barrel distortion of `uv` before sampling and a soft corner
vignette after.

## VHS artifacts

Chromatic aberration: sample the color three times with a per-channel x-offset
that jitters by a low-frequency noise of `u_time`:

```glsl
float j = 0.002 * (noise(vec2(u_time * 8.0, uv.y * 40.0)) - 0.5);
col.r = sceneColor(uv + vec2(j, 0.0)).r;
col.b = sceneColor(uv - vec2(j, 0.0)).b;
```

`sceneColor(uv)` is the host sample. If the host uploads a texture, define
`vec3 sceneColor(vec2 uv) { return texture(u_tex, uv).rgb; }`; otherwise
evaluate the scene procedurally.

Add: horizontal tear bands (displace `uv.x` where a noise row crosses a
threshold), tape noise (sparse bright specks from the hash), and slight
bottom-edge tracking wobble.

## Film grain

Animated but deterministic: hash the pixel cell with frame-quantized time.

```glsl
float grain(vec2 uv, float t) {
  return hash(floor(uv * u_resolution) + floor(t * 24.0) * 13.7);
}
col += (grain(uv, u_time) - 0.5) * 0.06;   // amount to taste
```

Quantize time to the target fps so rendered frames and live preview agree.

## Ordered (Bayer 4×4) dither

```glsl
const float bayer[16] = float[16](
  0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float bayerDither(vec2 px) {
  ivec2 c = ivec2(mod(floor(px), 4.0));
  return bayer[c.y * 4 + c.x] / 16.0;
}
// use: quantize col to N levels with threshold = bayerDither(gl_FragCoord.xy)
```

Use for pixel-art-style fades and limited palettes; it preserves hard pixels
where blur would smear them.

## Pixelate

```glsl
vec2 px = u_resolution / u_pixelSize;
vec2 uvPix = (floor(uv * px) + 0.5) / px;
col = sceneColor(uvPix).rgb;
```

Prefer a low-resolution render target upscaled with
`image-rendering: pixelated` when the whole scene is pixelated; use the shader
version for partial effects.

## Vignette

```glsl
float vig = smoothstep(1.0, 0.4, length(uv - 0.5) * 1.4);
col *= mix(0.7, 1.0, vig);
```

If the vignette is static and uniform, a CSS radial-gradient overlay is cheaper
— use the shader only when it must animate or interact with the effect.
