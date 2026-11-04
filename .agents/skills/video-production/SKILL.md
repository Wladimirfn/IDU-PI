---
name: video-production
description: >-
  Use when the user asks for a video of any kind: a YouTube explainer, a promo,
  a tutorial, a launch film, a reel, "créame un video que explique...". Runs the
  full production in ten stages (brief, research, script, storyboard, voice,
  keyframes, animation, draft, music and effects, delivery) with a review gate
  after each phase. The video is built in HTML, CSS and JS (HyperFrames or a
  seek(t) composition). It picks or mixes styles from its own library instead of
  improvising one, and it never delivers without the review report. It drives
  kanagawa-html (motion craft), soul-icons (icons), voice-narration (voice),
  music-composition (music) and, only for footage of people or physical places,
  higgsfield-scene.
---

# Video production: de un pedido a un video entregable

Un video no se "genera": se produce. Esta skill es el proceso de un estudio de
animación (guion → animatic → animación → postproducción) adaptado a un agente
que construye el video en HTML. Cada etapa deja un archivo en la carpeta del
proyecto, y la siguiente lo lee.

## La regla de oro

**La voz manda los tiempos.** El guion se escribe antes de diseñar, la voz se
genera antes de animar, y cada animación se engancha al inicio de una frase
medida en el audio real. Animar primero y narrar después produce desfases y
voces solapadas: es el defecto más común de un video hecho por un agente.

**Nada se entrega sin pasar las revisiones.** Hay cuatro (después del
storyboard, de los fotogramas clave, del borrador y del final). Una revisión
solo al final obliga a rehacer todo; en cada etapa corregir es barato. Los
criterios están en `revision.md` y el resultado va en `informe-revision.md`.

## Las diez etapas

| # | Etapa | Produce | Revisión |
| :--- | :--- | :--- | :--- |
| | **Preproducción** | | |
| 1 | Brief | `brief.md` | ¿falta un dato? → preguntar antes de seguir |
| 2 | Investigación | `investigacion.md` | cada dato con su fuente |
| 3 | Guion | `guion.md` | |
| 4 | Storyboard | `storyboard.md` | **Revisión 1**: ¿se entiende la historia? |
| | **Producción** | | |
| 5 | Voz | `voz/` + `timeline.json` | `validar_video_audio.py` |
| 6 | Fotogramas clave | `keyframes/` + hoja de contacto | **Revisión 2**: composición |
| 7 | Animación | `index.html` | |
| 8 | Borrador | `borrador.mp4` + hoja de contacto | **Revisión 3**: movimiento y sincronía |
| | **Postproducción** | | |
| 9 | Música y efectos | `musica/` (+ `partitura.json`), `sfx/`, mezcla | `validar_video_audio.py` |
| 10 | Entrega | `final.mp4`, `subtitulos.srt`, `miniatura.jpg`, `descripcion.md`, `informe-revision.md` | **Revisión 4**: final |

### 1. Brief

Antes de investigar, deja escrito en `brief.md`:

- **Para quién** es y qué sabe ya del tema.
- **Dónde** se publica: YouTube 16:9, Shorts/Reels 9:16, presentación.
- **Duración** objetivo.
- **El objetivo**, en una frase: qué tiene que entender o hacer el espectador al
  terminar. Si no se puede escribir esa frase, el video no tiene foco.
- **Idioma y voz**: idioma, voz (masculina/femenina) y tono.
- **Restricciones**: marca, colores, cosas que no se pueden decir o mostrar.

Si falta el objetivo, la plataforma o la duración, **pregunta**. El resto se
puede proponer con un valor por defecto, diciéndolo.

### 2. Investigación

Lee las fuentes reales (el repositorio, su README, sus docs, sus benchmarks) y
escribe en `investigacion.md` los hechos que el video va a usar, **cada uno con
su fuente** (archivo y línea, o URL). Ningún número aparece en pantalla sin
fuente. Si un dato no se puede verificar, no se dice o se dice como
aproximación ("unos 70 runs").

### 3. Guion

`guion.md` es la narración, **frase por frase**, agrupada por escenas. Sigue una
de las estructuras de `estructuras.md`.

- Una idea por frase y una idea por escena.
- Frases de hasta ~20 palabras. En español, la voz va a ~2,5–3 palabras por
  segundo: 3 minutos son unas 450–500 palabras.
- Cada frase lleva un id (`e03-f2` = escena 3, frase 2). La animación se
  engancha a esos ids.
- **Léxico de pronunciación**: los términos que la voz va a leer mal (nombres
  en inglés, siglas) se reescriben solo para la voz, nunca en los subtítulos.
  Por ejemplo: `Claude Code → Clod Cod`, `MCP → eme ce pe`, `worker → uórker`.

### 4. Storyboard

`storyboard.md` decide **cómo se ve cada escena antes de construir nada**. Por
escena, una tabla:

| Campo | Contenido |
| :--- | :--- |
| Escena y frases | `e05` · `e05-f1` a `e05-f4` |
| Idea | lo que el espectador debe entender |
| Metáfora visual | la imagen que lo explica sin texto (ver abajo) |
| Estilo | uno de `estilos/`, con el porqué |
| Personajes | ninguno, mascota, o cuáles; con qué expresión |
| Beats | qué aparece en cada frase: `e05-f2 → entra el cilindro de engram` |
| Sonido | efectos (whoosh, pop, tic) y ambiente musical |
| Transición | cómo pasa a la siguiente escena |

**Metáfora antes que texto.** Un concepto abstracto se explica con un objeto o
una acción: "entrenar" son unas manos girando perillas conectadas a una red; la
ONE ORCHESTRATOR RULE es un director que frena a un worker que intenta delegar.
Si una escena es solo texto, pregunta qué objeto o acción la contaría mejor.

**Elegir el estilo.** Usa la tabla de abajo. Se puede mezclar estilos entre
escenas siguiendo la regla de mezcla.

→ **Revisión 1** (`revision.md` §1). Es la más barata: se corrige texto, no
código.

### 5. Voz

Genera la voz con `voice-narration`, **un clip por frase**. Con las duraciones
reales escribe `timeline.json`: el inicio de cada escena y de cada frase, en
segundos. Deja aire entre frases (~0,3 s) y entre escenas (~0,7–0,9 s). Pasa
`validar_video_audio.py` (sin solapes, sin clicks, duraciones declaradas ≤
reales).

Si voicebox no está disponible, se puede usar una voz provisional para avanzar,
pero el `informe-revision.md` debe decirlo y la voz final se regenera antes de la
etapa 9.

### 6. Fotogramas clave

Construye cada escena **en su estado final y quieto** (todo ya entró), con el
estilo final, sin animación todavía. Renderiza un fotograma por escena y arma la
hoja de contacto:

```bash
node skills-bundle/video-production/hoja-de-contacto.mjs keyframes/ --salida keyframes/hoja.png
```

→ **Revisión 2** (`revision.md` §2): desbordes, solapes, contraste, punto focal,
uso del cuadro, legibilidad en teléfono. Mira la hoja tú mismo; no la des por
buena sin abrirla.

### 7. Animación

Anima sobre los fotogramas clave aprobados, con las reglas de movimiento de
`kanagawa-html` §3 y §5 y las del estilo elegido.

- **Cada entrada se engancha a una frase**: `inicio = timeline[frase] + desfase`.
  Nunca a un segundo escrito a mano.
- Un movimiento por elemento; entra lento y sale limpio; la opacidad no rebota.
- Cada escena debe quedar **quieta y legible al menos 1,5 s** antes de cambiar.
- Si va a renderizarse cuadro a cuadro: nada de `Math.random()` sin semilla ni
  `requestAnimationFrame` como reloj (`kanagawa-html` §6).

### 8. Borrador

Renderiza un MP4 rápido (calidad baja). Arma la hoja de contacto desde el video:

```bash
node skills-bundle/video-production/hoja-de-contacto.mjs borrador.mp4 --cada 4 --salida hoja-borrador.png
```

Y revisa a mano los momentos de cada beat del storyboard con `--tiempos`.

→ **Revisión 3** (`revision.md` §3): ritmo, sincronía con la voz, transiciones.

### 9. Música y efectos

- **Música** con `music-composition` (capa de IA, con `partitura.json`), compuesta
  para la **duración real** del video y con el ambiente del storyboard.
- **Efectos**: uno por entrada importante, nunca en cada elemento. Deben tener
  licencia libre o ser sintetizados, y se documentan en `sfx/LICENCIAS.md`.
- **Mezcla**: la música va bajo la voz con *ducking* (compresión por la voz) y el
  total se normaliza a **−14 LUFS** con picos ≤ −1,5 dBTP (el nivel de YouTube).
- Pasa `validar_video_audio.py` otra vez: la música cubre el video y tiene su
  partitura.

### 10. Entrega

- `final.mp4`: 1920×1080 (o 1080×1920), 30 fps, H.264 `yuv420p`, AAC 192 kbps,
  `+faststart`.
- `subtitulos.srt`: el texto **original** del guion (sin el léxico de
  pronunciación), con los tiempos de `timeline.json`.
- `miniatura.jpg`: 1280×720, una idea y pocas palabras grandes. Debe leerse a
  tamaño pequeño.
- `descripcion.md`: título, descripción, capítulos y etiquetas. En YouTube **cada
  capítulo debe durar al menos 10 s**, y el primero empieza en `0:00`: fusiona
  las escenas cortas.
- `informe-revision.md`: qué se revisó en cada etapa, qué se corrigió y qué queda
  pendiente.

→ **Revisión 4** (`revision.md` §4).

## Elegir el estilo

| Si la escena trata de… | Estilo | Por qué |
| :--- | :--- | :--- |
| Un concepto abstracto, un "cómo funciona" | `explainer-ilustrado` | metáforas y personajes lo vuelven concreto |
| Una frase de impacto, el gancho, el cierre | `bold-kinetic` | tipografía gigante y ritmo |
| Números, comparaciones, resultados | `editorial-datos` | el dato es el protagonista y se cita |
| Código, comandos, terminales, instalación | `terminal-tech` | se ve como lo usa quien programa |
| Un razonamiento paso a paso, una clase | `pizarra` | se dibuja mientras se explica |

Footage de personas, productos filmados o lugares reales: eso no se hace con
código, es `higgsfield-scene`.

### Regla de mezcla

Un video puede usar varios estilos (por ejemplo: gancho `bold-kinetic`,
explicación `explainer-ilustrado`, prueba `editorial-datos`, cierre
`bold-kinetic`). Para que se vea variado pero de una sola pieza:

1. **Una paleta base para todo el video.** Cada estilo usa la suya *derivada*:
   mismo fondo, o el mismo color de acento.
2. **Una fuente de cuerpo para todo el video.** Cambia solo la display.
3. **El mismo grosor de trazo y el mismo personaje** en todas las escenas que lo
   usen.
4. **Una transición puente** cuando cambia el estilo (barrido, corte en el
   golpe de un efecto), nunca un salto seco.
5. Como máximo **3 estilos** por video.

## Archivos de esta skill

| Archivo | Para qué |
| :--- | :--- |
| `estructuras.md` | estructuras narrativas: explainer, promo, tutorial, anuncio |
| `estilos/*.md` | la biblioteca: un archivo por estilo, con lienzo, paleta, tipografía, trazo, movimiento, sonido y errores prohibidos |
| `revision.md` | los criterios de las cuatro revisiones |
| `hoja-de-contacto.mjs` | fotogramas de un video o de una carpeta de imágenes, en una sola hoja |
