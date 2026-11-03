---
name: music-composition
description: Compose a soundtrack with the Lofi Live AI engine. The engine has TWO layers — an AI composer that writes a real score and a procedural synth that only makes loops. Use when a video, demo, or presentation needs music; always compose with the AI layer before rendering.
---

# Music composition (Lofi Live AI)

Generates a real WAV soundtrack from the Lofi Live AI engine: an **AI-composed
PlanCancion** rendered through the headless bridge.

## The two layers (do not confuse them)

The engine has two separate things. Rendering without composing produces
garbage that sounds plausible:

| Layer | API | Result |
| ----- | --- | ------ |
| **AI composer** | `__configurarIA` + `__componerCancionIA` | A real `PlanCancion`: own title, tempo, scale, chord progression, riff |
| **Procedural core** | `__renderHeadless({ loops })` alone | The SAME base loop with another style/seed. **Not a song** |

HARD RULE: `__renderHeadless({ loops })` without `partitura` is valid only for
a technical sketch, **never for a deliverable**. For video music, always compose
with the AI layer first and render the returned score.

Why this matters: a fresh Playwright context starts with empty `localStorage`,
so the AI provider config is absent and the engine silently falls back to the
procedural core. Four "candidates" generated that way measured **0.04** spectral
distance from each other — the same song in four disguises. The user caught it
by ear before any metric did.

## Prerequisites

The engine's dev server must be up. `$LOFI_ENGINE` is the engine checkout
(the folder with `src/main.ts` and the `__renderHeadless` bridge):

```bash
cd "$LOFI_ENGINE"
npx vite --port 5180 --strictPort
```

Check: `GET http://127.0.0.1:5180` → 200.

## Workflow (mandatory, AI path)

```js
const { chromium } = require("playwright");
const fs = require("fs");

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto("http://127.0.0.1:5180", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(4000);

// 1. Configure the AI. The key is read at runtime, never written into the script.
const auth = JSON.parse(
  fs.readFileSync(process.env.USERPROFILE + "/.commandcode/auth.json", "utf8"),
);
const apiKey = auth?.nan?.key;
if (!apiKey) throw new Error("No NAN key in ~/.commandcode/auth.json");

await page.evaluate(
  ({ providerId, model, apiKey }) => window.__configurarIA({ providerId, model, apiKey }),
  { providerId: "nan", model: "glm5.3-flash", apiKey },
);

// 2. MANDATORY check before composing.
const estado = await page.evaluate(() => window.__estadoIA());
if (!estado || estado.configurado !== true) {
  throw new Error(`AI not configured: ${JSON.stringify(estado)}. Abort.`);
}

// 3. Compose and validate the score.
const prompt =
  "Cinematic soundtrack for an industrial tech company video. Warm ambient with a " +
  "subtle pulse, wide pads, no aggressive drums, 80 BPM, D minor, optimistic and " +
  "modern, leaving space for a voiceover.";

const partitura = await page.evaluate((p) => window.__componerCancionIA(p), prompt);
for (const campo of ["titulo", "tempo", "progresion"]) {
  if (!partitura?.[campo]) throw new Error(`Invalid score: missing ${campo}`);
}

// 4. Render WITH the score.
const base64 = await page.evaluate(
  async (p) => {
    const buf = await window.__renderHeadless({ partitura: p, loops: 8 });
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  },
  partitura,
);

fs.writeFileSync("soundtrack.wav", Buffer.from(base64, "base64"));
await browser.close();
```

Valid shortcuts, in order of preference:

- `__generarYRenderizarIA(prompt, { loops })` — composes and renders in one call.
- `__renderHeadless({ partitura, loops })` — when you already have a score.

## Verify it is NOT a procedural variation

Before delivering, run the gate:

```bash
python "$IDU_VOICE/validar_video_audio.py" --proyecto "/path/to/video-project"
```

Exit code 1 means **do not render**. It fails when the music track is shorter
than the film, and warns when there is no `partitura.json` beside the WAV —
without a score there is no proof the AI composed it.

Then compare renders with these metrics:

| Metric | Procedural (REJECT) | Real AI (ACCEPT) |
| ------ | ------------------- | ---------------- |
| Spectral distance between variants | ~0.04 | ~0.40 (10×) |
| Envelope correlation | ~0.74 | low |
| RMS | baseline | ~2× baseline |
| Score | same structure, different tempo | own title, tempo, progression (e.g. 80 BPM) |

If two renders sit below **0.1** spectral distance or above **0.7** envelope
correlation, they are the same procedural base: abort and go back to the
`__estadoIA()` check. "They all sound the same" by ear is confirmation of this
failure, not a style opinion.

**Always save the score.** Write the returned `PlanCancion` to
`partitura.json` next to the WAV. It is the only durable proof that the music
was composed rather than synthesised, and the gate reads it.

## Duration and loops

Each loop is **~24.6 s** at 44.1 kHz stereo (16 bars at the default tempo).
Render time on CPU: ~20 s per loop.

| loops | duration |
| ----- | -------- |
| 1     | ~24.6 s  |
| 2     | ~49 s    |
| 3     | ~74 s    |
| 5     | ~123 s   |
| 8     | ~197 s   |

Plan the loop count from the film length. If the render is shorter than the
video, the soundtrack cuts off; render extra loops and trim, never stretch.

## Mixing with narration

In the HyperFrames composition, put the soundtrack on its own track, well under
the voice:

```html
<audio class="clip" src="soundtrack.wav"
       data-start="0" data-duration="138.1" data-track-index="1"
       data-volume="0.22" data-fade-in="2" data-fade-out="4"></audio>
```

`0.22` (−13 dB) sits under speech without masking it. Fades prevent a hard cut.

## Styles

`#mood-genero` options: `lofi`, `dub`, `classica`, `navidad`, `ambient`,
`chiptune`, `disco`, `calypso`, `hiphop`, `latin`, `jazz`, `soul`, `gospel`,
`blues`, `funk`, `house`, `deephouse`, `techno`, `dubstep`, `country`, `rock`,
`punk` (plus `familia:*` groupings that are not directly selectable).

Styles shape the procedural core. With the AI layer the score comes from the
prompt, so describe the music in words instead of relying on the style enum.

## Anti-patterns

- Do **not** call `__renderHeadless({ loops })` in a fresh Playwright context as
  the final step. `localStorage` is empty, AI config is missing, and the engine
  silently falls back to the procedural core.
- Do **not** write the provider API key in any script. Read it at runtime from
  `~/.commandcode/auth.json` → `.nan.key`, or an env var.
- Do **not** treat distinct styles/seeds as distinct songs. Style + seed changes
  on the procedural core are one song in disguise (spectral distance ~0.04).
- Do **not** click `#export-wav` under headless Playwright: the download relies
  on a live AudioContext and hangs.
- Do **not** reuse one short render stretched by `ffmpeg -stream_loop` when the
  film is long: the loop point becomes audible. Render the loops you need.
- Do **not** trust `acestep.cpp` (port 8000) as the composer. It is an optional
  texture layer; the composer is the LLM provider in "Cerebro de IA".
