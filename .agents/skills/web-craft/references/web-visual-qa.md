# Web Visual QA Contract (`idu-pi web audit`)

Two verification layers work together, never in isolation:

- **Deterministic Runtime Telemetry** (`audit/web-captures/metrics.json`): checks console errors, uncaught page errors, failed network requests, broken `<img>` tags, zero-size `<canvas>` elements, and horizontal overflow at desktop (`1440x900`) and mobile (`390x844`).
- **Independent Cross-Harness Artistic & Craft Audit** (`audit/web-visual-qa.json`): an auditor on a different harness inspects every captured PNG pixel-by-pixel alongside `web-brief.md`, `art-direction.md`, `metrics.json`, and the entry file (`package.json` or `index.html`). The authoring harness never approves its own UI.

## Required Captures

`idu-pi web capture` produces six screenshots inside `audit/web-captures/`:

| View ID | Viewport | Target |
| --- | --- | --- |
| `desktop-hero` | `1440x900` | Initial above-the-fold load (`scroll = 0`) |
| `desktop-mid` | `1440x900` | ~45% scroll depth |
| `desktop-low` | `1440x900` | ~85% scroll depth / footer band |
| `desktop-full` | `1440x900` | Full-page vertical composite (`fullPage: true`) |
| `mobile-hero` | `390x844` | Initial mobile fold (`scroll = 0`) |
| `mobile-mid` | `390x844` | ~45% mobile scroll depth |

## Checks (1-10)

| # | Check | Question | Fails when |
| --- | --- | --- | --- |
| 1 | Intent & Hero Read | Does `desktop-hero` / `mobile-hero` immediately communicate the brief's declared `Intent`? | Hero shows generic fluff, vague slogan, or hides the core experience below empty hero chrome |
| 2 | Focal Hierarchy | Does the eye land cleanly on primary -> secondary -> tertiary elements? | Equal-weight boxes compete everywhere, or CTA/focal canvas is buried |
| 3 | Style & 6-Axis Fidelity | Do **Shape, Depth, Texture, Color, Type, Motion** hold consistently per `art-direction.md`? | Any axis drifts, or unrequested generic dark-gold (`kanagawa`) styling leaks in |
| 4 | **Responsive Integrity** *(blocking)* | Do both `1440x900` and `390x844` compose cleanly without clipping, overlaps, or overflow? | Horizontal scroll overflow (`> 2px` mobile), overlapping labels, squished grids, unusable touch targets |
| 5 | Section Variety & Rhythm | Does scroll pacing vary structure meaningfully (the "same-card test")? | 3+ consecutive sections repeat the identical card/grid skeleton without declared motif |
| 6 | Icon & Visual Asset Craft | Are icons and visuals bespoke (`soul-icons`, SVGs, rendered WebGL/canvas)? | Unicode emojis used as UI icons, stock placeholders, low-contrast muddy renders |
| 7 | Typography & Legibility | Are scale, contrast, line measure, and tabular numerals sharp across viewports? | Low contrast over gradients/canvas, body lines too wide, missing hierarchy |
| 8 | Motion & Accessibility Discipline | Does motion serve comprehension and remain safe under `prefers-reduced-motion`? | Clipped transitions, motionless stuck hero states, illegible mid-scroll fades, `zeroSizeCanvases` |
| 9 | **Delivery Mode & Reference Compliance** *(blocking)* | Does the artifact genuinely fulfill `Delivery: single-file` or `app-stack`? | `app-stack` declared without real dependencies/build, or raw copy-pasted template branding |
| 10 | **Runtime Proof & Honesty** *(blocking)* | Does `metrics.json` + DOM evidence match visual claims cleanly? | Console/page errors, `brokenImages > 0`, failed local assets, faked metrics, or non-functional UI stubs |

Blocking checks `[4, 9, 10]` automatically reject the gate even on a `revise` verdict.

## Verdict Rules

- `pass`: all checks hold (`failed` MUST be `[]`).
- `revise`: localized defects fixed without re-architecting (still fails the gate if `failed` includes `4`, `9`, or `10`, or if `piece.variety === "revise"`).
- `block`: broken readability, mobile collapse, wrong `Intent`, delivery-mode violation, console/runtime failure, or copied layout skeleton.

## JSON Output Contract

The auditor MUST end its response with up to 10 lines of reasoning followed by **one** fenced JSON block:

```json
{
  "piece": {
    "intent": "delivered | fell-back",
    "became": "what it became if fell-back, otherwise empty string",
    "variety": "pass | revise",
    "rhythm": "one paragraph describing visual cadence and section variety",
    "deliveryCompliant": true
  },
  "views": [
    {
      "id": "desktop-hero",
      "verdict": "pass | revise | block",
      "failed": [],
      "evidence": "concrete pixel and metrics evidence",
      "fix": ""
    }
  ]
}
```

Every captured view ID (`desktop-hero`, `desktop-mid`, `desktop-low`, `desktop-full`, `mobile-hero`, `mobile-mid`) must appear once in `views`.

## Deterministic Gate Behavior (`idu-pi web check`)

| Condition | Gate Result |
| --- | --- |
| Missing or invalid `audit/web-visual-qa.json` | Fail (`exit 1`) |
| Captures, `metrics.json`, `art-direction.md`, or entry (`package.json`/`index.html`) hash changed since audit | Fail (stale) |
| Author harness equals auditor harness (`Author:` missing or matches auditor) | Fail (not independent) |
| Runtime `consoleErrors`, `pageErrors`, `brokenImages > 0`, or `mobileOverflowPx > 2` | Fail |
| `desktopOverflowPx > 2` or `zeroSizeCanvases > 0` | Warning |
| `piece.intent !== "delivered"`, `piece.deliveryCompliant === false`, or `piece.variety === "revise"` | Fail |
| Any view `block`, or `revise` containing checks `4`, `9`, or `10` | Fail |
| Any non-blocking view `revise` | Warning |
