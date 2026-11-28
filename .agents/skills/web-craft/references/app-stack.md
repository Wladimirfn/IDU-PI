# App Stack Integration Guide (`Delivery: app-stack`)

Use this reference when `web-brief.md` declares `Delivery: app-stack` and builds via Vite (`8.4.x`) + TypeScript. Run `idu-pi web probe --project .` first to check cached packages under `~/.idu/tools/web` and Playwright availability.

## 1. Project Hygiene & Build Contract

- Declare exact needed dependencies in `package.json` — never leave unused template packages installed.
- Include `"build": "vite build"` producing `dist/index.html` and hashed static assets.
- `idu-pi web capture` automatically serves `dist/` from an ephemeral HTTP server on `127.0.0.1` so ES modules, local audio files, and `fetch()` assets load cleanly without `file://` CORS failures.
- Keep third-party runtime CDN calls to zero unless explicitly required by the brief (self-host fonts, sounds, and shaders).

## 2. Three.js (`0.187.x`) & WebGL Safety

1. **Pixel Ratio Cap**:
   ```ts
   renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
   ```
2. **Non-Zero Responsive Canvas**:
   Observe the canvas container with `ResizeObserver` and update `camera.aspect`, `camera.updateProjectionMatrix()`, and `renderer.setSize(width, height, false)`. Ensure CSS gives the container explicit layout dimensions so `metrics.json` never reports `zeroSizeCanvases > 0`.
3. **Full Resource Disposal**:
   On unmount or HMR dispose, traverse meshes to call `geometry.dispose()`, `material.dispose()`, `texture.dispose()`, and `renderer.dispose()` plus `cancelAnimationFrame(rafId)`.
4. **WebGL & Reduced-Motion Graceful Fallback**:
   Wrap context setup so environments without WebGL (or `window.matchMedia("(prefers-reduced-motion: reduce)").matches`) render a crisp static hero pose, styled poster, or CSS/SVG composition cleanly with zero console/page errors.

## 3. GSAP (`3.15.1`) & Lenis (`1.3.x`) Motion Coupling

- Register plugins once at entry (`gsap.registerPlugin(ScrollTrigger)`).
- When pairing `Lenis` with `ScrollTrigger`:
  ```ts
  const lenis = new Lenis();
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  ```
- Respect motion preferences inside `gsap.matchMedia()`:
  ```ts
  const mm = gsap.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", () => {
    // ScrollTrigger & ambient motion here
  });
  ```
- Animate transform/opacity/clip-path properties rather than layout metrics (`width`, `height`, `top`, `left`).

## 4. Tactile Micro-Audio (`button-sounds` `1.0.x`)

`button-sounds` bundles 56 calibrated hardware click/press/release samples (`hi75-soft`, `asus-kbd-soft`, `mx-master-3`, etc.). Never load external MP3 URLs from random origins.

1. **Copy Sound Assets Locally**:
   Copy selected or full packs into static assets before building (`public/sounds/btn`), so Vite copies them into `dist/sounds/btn`:
   ```bash
   npx button-sounds copy ./public/sounds/btn
   ```
2. **Configure Path & Preload**:
   ```ts
   import { load, setPath, wireUp } from "button-sounds";

   setPath("/sounds/btn");
   load("hi75-soft");
   ```
3. **Wire Controls Conservatively** (vanilla DOM):
   ```ts
   const cleanup = wireUp(buttonEl, "hi75-soft", {
     volume: 0.25,
     pitchVariation: true,
     lofi: false,
   });
   ```
   Or in React (`button-sounds/react`):
   ```ts
   import { useButtonSounds, useImperativeButtonSounds } from "button-sounds/react";
   ```
   Always expose a mute control or honor user mute state (`WireUpOptions`: `{ volume?, lofi?, lofiOptions?, pitchVariation? }`), and keep default `volume <= 0.35`.

## 5. Vector Diagrams & Bespoke Icons

- Use `roughjs` (`4.6.x`) for intentional sketchy/architectural annotations — set deterministic `seed` per element so static captures never flicker between renders.
- Author domain-specific icons manually via `soul-icons` (consistent `viewBox`, uniform stroke weights) instead of emojis or mixed library pictograms.
- Validate custom UI/dataviz color contrast with `skills-bundle/kanagawa-html/validate_palette.js` when designing palettes.
