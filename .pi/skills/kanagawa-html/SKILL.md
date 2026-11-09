---
name: kanagawa-html
description: >-
  Use when the project's art direction selects the Gentleman Kanagawa aesthetic
  or explicitly asks for a Kanagawa-styled page, dashboard, presentation, or
  composition; or when another declared HTML style needs the style-neutral craft
  in this skill (deterministic seek(t), spring motion, camera, dataviz palette
  validation, PDF/MP4 export). The Kanagawa tokens, serif typography, ambient
  blur, particle field and chart palette are a named preset and apply only when
  that aesthetic is selected. NOT for footage an AI video model must generate
  (actors, filmed products, real environments) — that is higgsfield-scene's job.
  Do not load this skill as the default visual answer for every page or video.
---

# Kanagawa HTML — un preset, no la respuesta por defecto

Esta skill tiene dos capas separables. Confundirlas es lo que convierte cualquier
pedido en el mismo dashboard oscuro con acento dorado.

| Capa | Qué incluye | Cuándo aplica |
| --- | --- | --- |
| **Preset Gentleman Kanagawa** | tokens, fuentes serif, ambient blur, partículas, paleta de gráficos | solo si el brief declara esta estética |
| **Craft** | springs deterministas, cámara, `seek(t)`, dataviz, export PDF/MP4 | con cualquier estética declarada |

## 0. Contrato de estilo (leer antes de escribir CSS)

1. El proyecto declara su lenguaje visual en `art-direction.md`
   (`video-production/references/art-direction.md`) o en su equivalente para una
   página. Si no existe, escribilo antes de elegir colores.
2. Si la estética declarada **no** es Gentleman Kanagawa, esta skill corre en
   **craft-only**: aplican las secciones de craft; NO se aplican los tokens, las
   fuentes, el ambient blur, las partículas ni la paleta de gráficos.
3. Cambiar los tokens no cambia el estilo. Pasar de azul a rosa no convierte un
   dashboard en cartoon. Si el brief pide cartoon, pixel art, 3D o hand-drawn,
   las formas, la composición, la textura y el movimiento los define el contrato,
   no este archivo.
4. Esta skill no decide composición, tipos de plano ni ritmo narrativo. Para
   video, eso vive en el contrato de dirección artística.

Una página hecha con el **preset** debe leerse como un producto caro (Linear,
Apple, Arc) y moverse como un film: algo pasa en cada beat, nada se siente
generado. Esa frase describe el preset, no una obligación universal.

## 1. Preset Gentleman Kanagawa (opt-in)

Aplicar solo cuando el brief elige esta estética.

```css
:root {
  --bg: #06080f;  --fg: #f3f6f9;  --subtext: #8394A3;
  --gray1: #1c212c; --gray2: #232a36; --gray3: #2a3142; --line: #313342;
  --red: #cb7c94; --green: #b7cc85; --yellow: #dfbd76; --purple: #a3b5d6;
  --magenta: #ff8dd7; --orange: #deba87; --blue: #7fb4ca; --cyan: #7aa89f;
  --accent: #e0c15a;
}
```

Tipografía: `Source Serif 4` (títulos, serif) + `Space Grotesk` (cuerpo) vía
Google Fonts. Títulos grandes con la serif; nada de Arial/system-ui como cara
visible.

## 2. Fondo del preset (solo modo preset, z: 0 → 1 → contenido)

Estas capas son la firma del preset. No son un requisito de ninguna otra
estética: en pixel art, cartoon, 3D o hand-drawn el fondo lo define el contrato.

1. **Ambient blur**: dos blobs (magenta y azul) de 40vw con `filter: blur(130px)`,
   `opacity: .16`, deriva lenta `26s alternate`. Es el sello del tema; sin esto
   la página se ve "plana".
2. **Campo de partículas**: `<canvas>` fijo, 60-80 partículas en los colores del
   tema, parpadeo sinusoidal, deriva lenta, repulsión leve al mouse.
3. Contenido en `z-index: 2`.

Respeta `prefers-reduced-motion: reduce` — sin canvas ni animaciones de entrada.

## 3. Craft: motion (reglas, no gustos)

Aplica a cualquier estética que tenga movimiento; no impone el look Kanagawa.

Medido de films reales; un defecto aquí se lee como "generado":

- **Entra lento, sale limpio**: las llegadas llevan cola larga (`expo.out`,
  springs con damping 0.72-0.9 para micro-overshoot premium; 1.0 para cámara y
  texto). Una salida es UN movimiento suave, nunca slide-stop-leave.
- **Ease por rol**: llegada → cola larga; cámara o flood de color → `inOut`;
  zoom/exit → acelera. `power2.out` a 0.5s en todo es el default plano que
  delata a un agente.
- **Springs de forma cerrada** (renderizable cuadro a cuadro, deterministic).
  Damping z: 1.0 nunca rebota (cámara/texto), 0.72-0.9 micro-overshoot premium.
  Para UI usar **ω ≈ 12-20** (rad/s); el tiempo de asentamiento ≈ `4/(z·ω)`
  (con ω=16, z=0.85: ~0.3s — ajusta ω si necesitas más rápido/lento):

```js
function stepR(tau, { w, z }) {           // respuesta escalonada amortiguada 0->1
  if (tau <= 0) return 0;
  if (z >= 1) { const x = w * tau; return 1 - Math.exp(-x) * (1 + x); }
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z * w / wd) * Math.sin(wd * tau));
}
```

- **Opacidad y color nunca rebotan**; posición y tamaño pueden hacerlo.
- **Determinismo para render**: si la composición va a exportarse a MP4, nada
  de `Math.random()` sin semilla ni timers — todo `seek(t)` puro (ver
  Craft: export).
- **Un movimiento = un tween.** Movimiento rápido 0.3-0.6s; blur de motion
  horizontal-only si el movimiento es horizontal.
- **Reveal on scroll** con `IntersectionObserver`: tablas/gráficos aparecen con
  fade+translate; las barras crecen de 0 escalonadas (120ms + idx*90ms);
  contadores KPI con easing cubic (`1 - (1-p)^3`).

## 4. Craft: dataviz — el color se calcula, no se elige

El procedimiento es neutral. La paleta `KANAGAWA-CHART` es el default del preset;
con otra estética, derivá la paleta del contrato y validala igual.

**Dos paletas, dos trabajos:**

- **`KANAGAWA-UI`** (los tokens de arriba): para UI, fondos, acentos, badges.
- **`KANAGAWA-CHART`**: para series de datos. Derivada de Kanagawa, pasa los
  5 checks del validador en modo dark — con el orden exacto que pasa limpio
  (el peor par vecino da ΔE 13.7, sin WARN):

```css
/* KANAGAWA-CHART — orden validado, NO reordenar */
--chart-1: #d15a94;  /* magenta profundo  */
--chart-2: #b3881a;  /* dorado            */
--chart-3: #3f89b8;  /* azul              */
--chart-4: #3f7a45;  /* verde             */
```

Validación (siempre con la superficie real del tema):
`node .agents/skills/kanagawa-html/validate_palette.js "#d15a94,#b3881a,#3f89b8,#3f7a45" --mode dark --surface "#06080f"`
→ ALL CHECKS PASS. La paleta UI/pastel (`#ff8dd7,#7fb4ca,...`) NO sirve para
gráficos: falla 4 de 5 checks — UI y datos no comparten paleta.
Si necesitas un 5º hue, re-valida; nunca inventes.

Antes de escribir el primer gráfico, decide el TRABAJO del dato:

| Trabajo | Forma | Color |
|---|---|---|
| Magnitud (cuánto) | barras apiladas horizontales o stat tile | secuencial: un hue, pasos 100→700 |
| Identidad (qué serie) | líneas o barras agrupadas | categórico: 8 hues en orden fijo, nunca cíclico |
| Polaridad (lado de una base) | diverging | 2 hues + gris neutro al centro |
| Estado (bien→crítico) | tag/stat tile | escala status fija, siempre icono+label |
| Un titular | **stat tile / hero number** — no siempre es un chart | — |

Reglas duras:
- **Barras nominales de una sola serie: TODAS del mismo hue slot-1.** Nunca
  colorees barras por su valor (gasta el canal de identidad que ya muestra el largo).
- Orden cíclico (funnel, S/M/L, cohorts) = **ordinal** → rampa de un hue con
  pasos de luminosidad; el extremo claro mantiene ≥ 2:1 contra el fondo.
- **Valida la paleta, no la razona**: corre
  `node validate_palette.js "<hex,hex,...>" --mode dark` (script de
  baoyu-design/dataviz) y exige pass en CVD-deparación de pares adyacentes.
  La paleta Kanagawa de arriba pasó validación con los 4 hues de partículas.
- Toda barra lleva su valor impreso (`tabular-nums`); el título nombra la serie,
  no una leyenda redundante.

## 5. Craft: motion de nivel film (hero, launches, presentaciones)

Para un hero o presentación que deba "parecer video" sin renderizar:

- **Timeline determinística**: todo es `seek(t)` puro — cada frame es función de
  `t`, sin `setTimeout` ni CSS-transition para lo que importa. Reversible al
  scrollear y renderizable a MP4 después sin cambios.
- **Capas de escena**: `#bg` (bloom de marca) → `#world` (escena con cámara:
  `transform: translate(cx) scale(z)`) → `#hud` (overlays screen-space).
- **Cámara**: x, y y **log-zoom** con springs (zoom lineal en z se siente mal).
- **Swap de contenido con blur**: entra con spring, sale corto y temprano
  (`dOut ≈ 0.12s`).
- **Un takeaway por escena**; tiempo asentado suficiente para leer; el beat vivo
  por micro-interacciones (hover, ripple, settle de número), no por ruido.

## 6. Craft: export (PDF, MP4, PPTX)

Toda presentación hecha con esta skill debe exportarse sin re-trabajo.

### A PDF (verificado en Windows)

1. Cada slide es un `<section class="slide">` de 1280×720.
2. CSS de impresión obligatorio (sin esto se pierde el fondo oscuro y todo
   sale transparente):

```css
@media print {
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .reveal, table, .chart { opacity: 1 !important; transform: none !important; }
  .bar > i, .cbar > i { width: calc(var(--w) * 1%) !important; }
  #particles, .ambient { display: none !important; }
  .slide { break-after: page; page-break-after: always; }
  @page { size: 1280px 720px; margin: 0; }
}
```

3. Comando (Windows: chrome NO está en PATH; usar la ruta completa):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --no-pdf-header-footer --virtual-time-budget=5000 --print-to-pdf=out.pdf file:///ruta/index.html
```

En Linux/macOS el binario es `chromium`, `google-chrome` o
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, con los mismos flags.

`--virtual-time-budget=5000` da 5s para que corran las animaciones antes de
imprimir; sin él, los contadores quedan a mitad de camino.

### A MP4 con HyperFrames (composición determinista)

Requisitos ANALES de determinismo — sin esto cada render sale distinto:
- Nada de `Math.random()` sin semilla: PRNG con seed fija (mulberry32) cuyo
  estado depende solo de `t`.
- Nada de `requestAnimationFrame` como reloj: la composición expone
  `seek(t)` y todo estado es función pura de `t`.
- Estructura HyperFrames: root con `data-composition-id`, `data-width`,
  `data-height`, `data-duration`; cada elemento animado con `class="clip"
  data-start data-duration data-track-index`.
- El loop propio se conecta al reloj de HyperFrames registrando el timeline
  tras declarar los tweens (ver docs de HyperFrames en su repo).
- Verificar: `npx hyperframes check` antes de `npx hyperframes render`.
  Si el comando no existe en tu versión instalada, correr `npx hyperframes --help`
  y usar los subcomandos presentes (init/preview/render).

### A PPTX
No se convierte automáticamente: ofrece PDF como entrega, o HyperFrames si pidió video.

## 7. Checklist de entrega

### Craft (siempre)

- [ ] El lenguaje visual está declarado y cada eje (forma, profundidad, textura,
      color, tipografía, movimiento) se evidencia en la página, no sólo en el brief
- [ ] Paleta de GRÁFICOS validada con `validate_palette.js` contra la superficie
      real; texto con contraste ≥ 4.5:1 (3:1 solo texto grande)
- [ ] Barras/KPIs animados con springs (ω definido); contadores con easing cúbico
- [ ] Si va a render: `seek(t)` puro — sin random sin semilla, sin rAF como reloj
- [ ] Todo dato tiene su valor impreso; sin leyenda redundante
- [ ] Escala funcional sin red (fallback del CDN de fuentes OK)
- [ ] Si es presentación: PDF verificado con el `@media print` de Craft: export
- [ ] Si es video: subcomandos de hyperframes verificados con `--help` antes de render
- [ ] Decisión registrada: si el pedido incluía footage IA (gente/producto filmado),
      esa parte fue delegada a higgsfield-scene — no intentes generarlo con código

### Preset Gentleman Kanagawa (solo si la estética fue elegida)

- [ ] Tokens Kanagawa aplicados; ninguna familia tipográfica ni color de UI fuera
      de los declarados
- [ ] Ambient blur + partículas presentes (u off si reduced-motion)
- [ ] Títulos en Source Serif 4, cuerpo en Space Grotesk
- [ ] `KANAGAWA-CHART` en el orden validado para gráficos, no la paleta pastel
- [ ] La página usa las tres capas del preset y su tipografía, no sólo la paleta
