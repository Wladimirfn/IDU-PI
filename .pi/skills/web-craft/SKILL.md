---
name: web-craft
description: >-
  Trigger: web, website, landing page, web app, portfolio, interactive UI,
  Three.js, GSAP, Lenis, button-sounds, roughjs, app-stack, single-file,
  web audit. Guides deliberate web delivery mode selection (single-file vs
  Vite app-stack), ecosystem library curation, art direction discipline, and
  multi-viewport Playwright + cross-harness audit verification (`idu-pi web`).
  Not for standalone video renders (use video-production).
---

# Web Craft — Deliberate Stack Selection & Visual Verification

Great web interfaces fail when every request collapses into the same raw monolithic HTML file—or when bloated abstractions ship with broken mobile layouts, console errors, and generic emoji cards.

Every web project starts with two explicit choices in `web-brief.md` (or `style-brief.md`) before coding:

1. **Declare `Intent:` and `Delivery:`** — decide what the site must make the visitor experience or do using a single hyphenated slug (`product-showcase`, `interactive-essay`, `editorial`, `web-app`, `portfolio`, `game`), and pick the right engineering surface (`single-file` vs `app-stack`).
2. **Declare `Author: <harness>/<model>`** and author **`art-direction.md`** across the six visual axes (**Shape, Depth, Texture, Color, Type, Motion**) before writing CSS, shaders, or components. Do not load `kanagawa-html` as the default visual answer unless the brief specifically calls for that preset.

## 1. Delivery Modes

| `Delivery:` | Build Shape | When to Choose | Required Files |
| --- | --- | --- | --- |
| `single-file` | Self-contained `index.html` (CSS + inline JS/canvas, zero build step) | Focused interactive explainers, compact tools, static essays, fast prototypes without heavy runtime graphs | `index.html` at project root |
| `app-stack` | Vite (`8.4.x`) + TypeScript (optional React) modular app with curated packages | 3D worlds (`three`), scroll choreography (`gsap`), smooth inertia (`lenis`), tactile UI audio (`button-sounds`), hand-drawn canvas diagrams (`roughjs`), or multi-route web apps | `package.json` + built `dist/index.html` (`npm run build`) |

Never mix these sloppily: if a project declares `Delivery: app-stack`, compile the real bundle (`npm run build` -> `dist/index.html`) rather than faking a dependency list in a raw HTML script tag.

## 2. Curated Ecosystem Stack

Run `idu-pi web probe --project <dir>` first to verify Playwright, browser binaries, and cached/local package availability (`~/.idu/tools/web` caches verified versions):

- **3D & WebGL scenes**: `three` (`0.187.x`; optional `@react-three/fiber` `9.8.x` in React apps). Clamp DPR (`<= 2`), handle resize observers cleanly, dispose GPU resources, and provide a CSS/SVG fallback if WebGL is unavailable.
- **Choreographed timeline & scroll motion**: `gsap` (`3.15.x`) + `ScrollTrigger`. Pair only deliberately with `lenis` (`1.3.x`), and wrap continuous/scroll animations inside `gsap.matchMedia()` so `(prefers-reduced-motion: reduce)` degrades gracefully.
- **Tactile micro-audio**: `button-sounds` (`1.0.x`). Self-host sound assets under `public/sounds/btn` via its CLI and call `setPath(...)` + `wireUp(...)` / `useButtonSounds(...)` cleanly at low conservative volume (`<= 0.35`).
- **Sketchy diagrams & bespoke icons**: `roughjs` (`4.6.x`) for architectural/whiteboard vector accents; load `soul-icons` for domain-specific SVGs (never use raw Unicode emojis as UI icons); pair with `shader-fx` for deterministic WebGL post/SDF layers.
- **Data palettes & Kanagawa opt-in**: Load `kanagawa-html` **only** when its dark warm aesthetic is declared or when reusing `kanagawa-html/validate_palette.js` for dataviz color validation.
- **Browser game builds**: Consider `phaser` / `babylonjs`, `rapier` / `matter-js`, `howler` / `jsfxr`, and `ldtk` / `blockbench` rather than hand-coding physics or audio codecs from scratch.

See `references/app-stack.md` for copy-ready integration rules and disposal patterns.

## 3. Verification & Audit Pipeline (`idu-pi web`)

Self-review is craft, not approval. Delivery requires runtime capture plus an independent cross-harness audit:

1. **Toolchain check**:
   ```bash
   idu-pi web probe --project .
   ```
2. **Multi-viewport capture + DOM telemetry**:
   ```bash
   idu-pi web capture --project .
   ```
   Captures `desktop-hero` (`1440x900`), `desktop-mid`, `desktop-low`, `desktop-full`, `mobile-hero` (`390x844`), and `mobile-mid` into `audit/web-captures/`, plus `metrics.json` (console errors, page errors, failed requests, broken images, horizontal overflow, zero-size `<canvas>` count, reduced-motion pass). For `app-stack`, automatically spins up an ephemeral static server over `dist/`.
3. **Independent cross-harness visual QA**:
   ```bash
   idu-pi web audit --project .
   ```
   Dispatches all 6 screenshots, `metrics.json`, `web-brief.md`, `art-direction.md`, and `references/web-visual-qa.md` to an auditor on a different harness (`audit/web-visual-qa.json`).
4. **Deterministic gate verification**:
   ```bash
   idu-pi web check --project .
   ```
   Verifies hashes are fresh, author != auditor harness, zero runtime errors/broken images/mobile overflow (`> 2px`), `piece.intent === "delivered"`, `piece.deliveryCompliant === true`, `piece.variety === "pass"`, and zero blocking view checks (`[4, 9, 10]`).

Read `references/web-visual-qa.md` for all 10 audit checks and blocking criteria.
