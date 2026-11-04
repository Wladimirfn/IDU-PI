---
name: higgsfield-scene
description: >-
  Use when the user asks for a video explanation, launch film, animated scene,
  "explicación en video", cinematic scene, AI-generated footage, or any shot
  that needs AI video generation (Higgsfield / Seedance / Kling / Veo /
  Hailuo). Architects production-grade prompts with exact timing, camera
  movement, lighting and sound design — paste-ready for the video model.
  NOT for videos of UI, dashboards, charts, data or any on-screen text — the
  models render text badly; those scenes are built WITH CODE by kanagawa-html
  (which also exports to PDF/MP4). Use this skill only when the shot needs
  footage an AI model must generate: actors, filmed products, environments,
  facial emotion. When unsure: text/data legible → kanagawa-html; human or
  physical world → this. Hybrid projects use both.
metadata:
  tags: [higgsfield, seedance, video-prompt, cinematic, camera, motion]
  version: 1.1.0
  updated: 2026-10-31
  sources: OSideMedia/higgsfield-ai-prompt-skill v3.42.0, rediumvex/ai-video-generator-claude
---

# Higgsfield Scene — dirección de escenas IA condensada

Un prompt de video IA es un guión de producción, no una descripción. Una idea
entra; sale un prompt de 15-25 líneas con timestamps por segundo, cámara con
nombres exactos, iluminación y capas de sonido — listo para pegar en el
generador.

## 0. Decidir: ¿escena web o escena IA?

| Señal | Usar |
|---|---|
| UI, datos, dashboard, gráfico, reporte, texto legible | **kanagawa-html** (código: exacto, gratis, determinista) |
| Persona actuando, producto físico filmado, ambiente real, emoción facial | **esta skill** (el modelo de video genera el footage) |
| Producto digital + presencia humana | Híbrido: kanagawa para las tomas de UI, esta para las de gente/ambiente |

Los modelos de video SON malos renderizando texto e UI — nunca le pidas que
muestre una pantalla con datos legibles. Captura la UI real y pásala como
`@material` (referencia de imagen), o genera el entorno alrededor del producto.

## 1. Antes de gastar créditos: ¿la escena merece existir?

Cinco elementos estructurales (scene engine). Si fallan, reescribe la escena
ANTES de generar:

1. **Goal** — qué quiere el que actúa (visible, no explicado).
2. **Obstacle** — qué se lo impide.
3. **Tactic** — qué hace al respecto.
4. **Reversal** — el giro: algo no sale como esperaba.
5. **Value Shift** — el valor cambia de un polo a otro (tensión→alivio,
   duda→claridad, caos→orden).

Una escena sin Reversal es un demo aburrido. Un prompt sin Goal genera video
bonito que no cuenta nada.

## 2. La fórmula MCSLA

Cada shot se construye en 5 capas, en este orden:

| Capa | Qué define | Ejemplo |
|---|---|---|
| **M**odel | el generador y su variante | Seedance 2.0, 720p, 8s |
| **C**amera | movimiento con SU NOMBRE EXACTO (los presets se citan textual) | `Slow Dolly In` + `Rack Focus` |
| **S**ubject | quién/qué actúa, con apariencia concreta | "ingeniera de 30 años, camisa gris, luz lateral" |
| **L**ook | iluminación + paleta + textura | "luz práctica fría, contraste neon, superficie mate" |
| **A**ction | UNA acción primaria con timestamp | "0-3s teclea sin levantar la vista; 3-5s el cursor cruza y la luz cambia" |

Reglas duras:
- **Límites por modelo** (elige el régimen ANTES de escribir):
  - **Cine Studio: 512 caracteres duro.** Prompt corto MCSLA, una sola idea.
  - **Multi-shot (15-25 líneas con varios [SHOT]): solo modelos que declaran
    soportarlo** (Seedance 2.0+). Si el modelo genera un clip por prompt:
    **un prompt por clip** y ensambla en edición — no fuerces multi-shot.
  - Formato corto general: ≤ 200 palabras.
- **I2V (imagen→video): describe SOLO lo que se mueve.** Jamás re-describas lo
  que ya está en la imagen — lo re-renderiza peor. Texto→video vs imagen→video:
  usa I2V cuando el sujeto/producto ya existe como imagen (consistencia de marca);
  T2V cuando el shot es puro ambiente o emoción.
- **Nada de emociones genéricas** ("triste", "feliz"): descomponer en músculo,
  respiración, mirada, piel. "el ceño baja un milímetro, exhala por la nariz,
  la mandíbula se suelta".
- **Cámara máx 2 movimientos compatibles** por shot; combos secuenciados llevan
  timing explícito. **Nunca** Dolly In + Dolly Out en el mismo shot. Presets
  citados por SU NOMBRE EXACTO — la lista por modelo vive en
  `references/camera-presets.md` de la skill fuente higgsfield-ai-prompt-skill;
  si no la tienes a mano, usa SOLO presets universales (Dolly In/Out, Orbit,
  Rack Focus, Snap Zoom, Crane Up/Down, Static Pan) — nunca inventes un nombre.
- **Qué va en el prompt y qué en la UI del generador**: prompt = cámara,
  sujeto, look, acción, sonido. Configuración del generador (UI, nunca texto):
  aspect ratio, resolución, duración, seed, modelo/variante.
- **Fast Motion Trick**: lo que debe verse veloz, genéralo en slow motion y
  aceléralo en post — el interpolador deforma menos.

## 3. El hook de 2 segundos (scroll-stop)

Los primeros 2s deciden si el video se ve. Patrones probados:

- **Pattern interrupt** — algo aparece donde no debe (un objeto rompiendo la gravedad, una escala imposible).
- **Curiosity gap** — se ve el resultado sin el proceso; el cerebro exige saber cómo.
- **Dopamine trigger** — un click, un snap, un settle perfecto en el primer beat.
- **The Problem Flash** — montaje rápido del dolor que el producto resuelve (spinners de carga, pantallas de error), cortado al beat.

El hook se edita ÚLTIMO pero se diseña PRIMERO: si el material del video no
tiene un beat en los primeros 2s, el guión está mal, no el corte.

## 4. Estructura del prompt de producción (multi-shot, solo si el modelo lo soporta)

```
[SHOT 01 · 0:00-0:02 · HOOK]
Cámara: Snap Zoom Out desde macro
Sujeto: el producto sobre superficie oscura, polvo en el aire
Look: luz práctica fría, contraste alto, macro f/1.8
Acción: el polvo se aparta en onda cuando el producto despierta
Sonido: sub-bass hit + air (sin música aún)

[SHOT 02 · 0:02-0:06 · DESARROLLO]
Cámara: Orbit 180 lento + Rack Focus al logotipo
Sujeto: manos reales operando la interfaz (UI via @material01 — la captura
        de pantalla real del producto; los modelos de video no renderizan UI legible)
Look: práctica cálida mezclada con fría, reflejo en vidrio
Acción: los dedos trazan el gesto, la UI responde con micro-animación
Sonido: clicks sintidos + pad que abre el filtro

[SHOT 03 · 0:06-0:10 · RESOLUCIÓN]
Cámara: Static Pan suave al logo asentado
Sujeto: el producto centrado, el polvo ya asentado
Look: la misma luz fría, ahora con un warm accent detrás
Acción: el tagline aparece por transparencia (si tu producto tiene uno como
        imagen @material02 — nunca pidas al modelo que genere texto)
Sonido: resolve musical + click final
```

Si el modelo es de-un-clip-por-prompt: cada [SHOT] es un prompt independiente
con su propia semilla, y el ensamble va en edición (Premiere/CapCut/ffmpeg).

Capas de sonido: **ambient** (el lugar) + **impact** (los beats) + **music**
(el arco) + **voice** (si hay). El sonido vende más que el visual — un click
satisfactorio hace "real" el software.

**Negativos**: pide explícitamente lo que NO quieres del modelo — "sin texto
generado en pantalla, sin logo deformado, sin manos extra, sin morphing entre
sujetos" — los generadores ignoran el negativo menos de lo que crees, pero
ignorarlo por completo cuesta caro en clips con producto.

## 5. Entrega

- El prompt sale **paste-ready** con: shots con timestamps, cámara por nombre
  exacto de preset, @materiales indicados, capas de sonido, aspect ratio
  recomendado por plataforma (9:16 vertical para Reels/TikTok/Shorts; 16:9
  para YouTube/embed).
- Log de generaciones: qué se generó, con qué modelo, coste en créditos, y
  qué variante ganó — para no pagar dos veces por el mismo experimento.
- Si el resultado sale "plano", el problema casi siempre es la escena (sección
  1), no el prompt: audita Reversal y Value Shift antes de quemar créditos en
  variaciones.

## 6. Fuentes y licencias

Condensado de:
- **OSideMedia/higgsfield-ai-prompt-skill v3.42.0** (MIT) — MCSLA, scene engine,
  camera presets. La lista completa de presets por modelo vive en SU
  `skills/higgsfield-camera/SKILL.md`; esta skill la referencia, no la duplica.
- **rediumvex/ai-video-generator-claude** — hooks de 2s, estructura por shots,
  sound layers.

Verificar la licencia vigente de cada fuente antes de redistribuir esta skill
fuera del repo interno. Complementa a `kanagawa-html` (escenas de código) —
mismo estándar de entrega: presentaciones exportables a PDF y composiciones
exportables a MP4 vía HyperFrames (receta en kanagawa-html sección 6).
