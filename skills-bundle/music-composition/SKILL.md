---
name: music-composition
description: Compose and mix a soundtrack with the Lofi Live AI engine. The engine has TWO layers — an AI composer that writes a real score and a procedural synth that only makes loops. Use when a video, demo, or presentation needs music; write the music direction, render the score's full length, and mix it under the voice with ducking.
---

# Music composition (Lofi Live AI)

Generates a real WAV soundtrack from the Lofi Live AI engine: an **AI-composed
PlanCancion** rendered through the headless bridge.

## Music direction (before composing)

A cue that "sounds fine" but does not follow the piece is a failed cue. Write the
brief before calling the composer, in `style-brief.md` or `music-brief.md`:

| Field | Decision |
| --- | --- |
| Intent | What the music must make the viewer feel: the claim, the change, or the mood. |
| Arc | 3-5 acts and the energy of each: sparse -> build -> lift -> resolve. |
| Hit points | The scene or act boundaries where the music must change or land. Not every cut. |
| Instrumentation | The palette, and what stays out. Drums under a voiceover are out by default. |
| Voice space | Leave 1-4 kHz open: no bright cymbals, no dense plucks, no pad wash in that band. |
| Tempo/key | One tempo and key; modulate only when the arc earns it. |
| Reference | What to borrow (texture, energy) and what not to copy. |
| Duration | Film length plus tail; map the score's `vueltas` to the cut. |

The prompt carries the arc, the palette and the exclusions. After composing,
inspect the returned `PlanCancion`; direct `vueltas`, `desarrollo` and the voices
to the film. A generic prompt returns a generic cue.

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
(the folder with `src/main.ts` and the `__renderHeadless` bridge). Set it in your
environment; if it is unset, stop and ask for the path instead of guessing one:

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
  fs.readFileSync(require("os").homedir() + "/.commandcode/auth.json", "utf8"),
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
console.log("score:", partitura.titulo, "|", partitura.tempo, "BPM |", partitura.vueltas, "vueltas");

// 4. Render the score's declared length. A smaller `loops` is a fragment.
const base64 = await page.evaluate(
  async (p) => {
    const buf = await window.__renderHeadless({ partitura: p });
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

- `__generarYRenderizarIA(prompt, { loops })` — composes and renders in one call;
  only pass `loops` when it equals the score's `vueltas`.
- `__renderHeadless({ partitura })` — when you already have a score; it renders
  the declared length. Pass `loops` only for a larger sketch, never below
  `partitura.vueltas`.

## Verify it is NOT a procedural variation

Before delivering, run the gate:

```bash
python skills-bundle/voice-narration/validar_video_audio.py --proyecto "/path/to/video-project"
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

## Render the score, not a fragment

The composer returns a `PlanCancion` with a declared `vueltas` length. That is
the composition. `__renderHeadless({ partitura })` renders that length.

Passing a smaller `loops` — for example `loops: 4` on a 12-vuelta score — renders
the first four loops of the song, not the song: the development and the
resolution are missing, and the result sounds like a loop. That is a defect, not
a taste issue. If the film needs a shorter cue, edit `vueltas` and `desarrollo`
to the act structure you want, render the edited score, and trim with a fade.
Never let the render length be an accident.

## Duration and loops

Each loop is **~24.6 s** at 44.1 kHz stereo (16 bars at the default tempo).
Render time on CPU: ~20 s per loop. The table is for a procedural sketch; for an
AI score, the declared `vueltas` is the length and a smaller `loops` is a
fragment.

| loops | duration |
| ----- | -------- |
| 1     | ~24.6 s  |
| 2     | ~49 s    |
| 3     | ~74 s    |
| 5     | ~123 s   |
| 8     | ~197 s   |

For a procedural sketch, choose the loop count from the film length. For an AI
score, render `partitura.vueltas`; if the cue is longer than the cut, edit
`vueltas` and `desarrollo` to the acts you need and trim with a fade. If the
render is shorter than the video, the soundtrack cuts off; render extra and trim,
never stretch.

## Mixing with narration

The music is a bed, not a second narrator. Do not pick a fader by habit; measure.

- **Voice:** -16 LUFS integrated, true peak -1.5 dBTP.
- **Music in the gaps:** 16-20 dB below the voice (voice -16 -> music -32 to
  -36 LUFS). Start around 0.10-0.14 linear and measure; the final mix is the
  source of truth. The old fixed `0.22` is not a default.
- **Ducking:** sidechain compression under the voice, 3-6 dB, 20-30 ms attack,
  300-400 ms release. It must not pump.
- **EQ:** high-pass 90 Hz, low-pass 9 kHz, and a 2-3 dB cut at 2.5 kHz. The voice
  owns 1-4 kHz.
- **Loudness:** one `loudnorm` at the end: `I=-16`, `TP=-1.5`, `LRA=11`.
- **Fades:** 1-2 s in, 3-4 s out; end on a resolved chord, not a cut mid-loop.

Minimal recipe (music input 0, voice clips 1..N; adapt the delays):

```bash
ffmpeg -i soundtrack.wav -i voz/e01.wav ... \
  -filter_complex "\
  [0:a]aformat=sample_rates=48000:channel_layouts=stereo,\
highpass=f=90,lowpass=f=9000,equalizer=f=2500:width_type=o:width=1.2:g=-3,\
volume=0.10,afade=t=in:st=0:d=1.5,afade=t=out:st=72:d=3.56[music];\
  [1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=1000|1000[a1];...\
  [a1]...[aN]amix=inputs=N:duration=longest:normalize=0,\
apad=whole_dur=<film>,asplit=2[voice][sc];\
  [music][sc]sidechaincompress=threshold=0.04:ratio=3:attack=30:release=350:makeup=1[ducked];\
  [voice][ducked]amix=inputs=2:duration=longest:normalize=0,\
loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=<film>,atrim=0:<film>[a]" \
  -map "[a]" -t <film> -c:a pcm_s16le mix.wav
```

`sidechaincompress` stops when the sidechain (voice) ends. Pad the voice bus with
`apad=whole_dur=<film>` before the split, or the music tail is cut. Keep the
HTML `data-volume` in sync with the measured bed: the audio gate rejects values
above `0.20` and warns above `0.14`.

## Music audit (before delivery)

- Does the cue follow the brief's arc, with an audible change per act?
- Does it resolve, or is it a cut mid-loop?
- Are drums and percussion absent unless the brief asks for them?
- Is the music 16-20 dB below the voice in the gaps and ducked under speech?
- Is 1-4 kHz clear for the voice, with no cymbal, pluck or pad masking?
- Is the loop seam inaudible, and does the cue avoid constant 4-bar repetition?
- Does the music support the scene's intent, not just fill silence?

A failed check is a rebuild, not a fader tweak.

## Styles

`#mood-genero` options: `lofi`, `dub`, `classica`, `navidad`, `ambient`,
`chiptune`, `disco`, `calypso`, `hiphop`, `latin`, `jazz`, `soul`, `gospel`,
`blues`, `funk`, `house`, `deephouse`, `techno`, `dubstep`, `country`, `rock`,
`punk` (plus `familia:*` groupings that are not directly selectable).

Styles shape the procedural core. With the AI layer the score comes from the
prompt, so describe the music in words instead of relying on the style enum.

## Anti-patterns

- Do **not** render an AI score with fewer loops than its `vueltas`: that is a
  fragment without development or resolution, not an edit.
- Do **not** use a fixed `0.22` music fader. Measure the bed in the gaps; the
  measured default is 0.10-0.14 with ducking.
- Do **not** keep the composer's default drum layer under a voiceover. Remove it
  unless the music brief asks for percussion.
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
