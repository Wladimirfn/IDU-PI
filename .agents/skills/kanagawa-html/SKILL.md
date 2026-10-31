---
name: kanagawa-html
description: >-
  Use when generating or revising any HTML page, report, dashboard, presentation,
  slide deck, or animated composition for this project: landing pages, benchmark
  reports, data visualizations, product launches, "hazme una página bonita",
  presentaciones descargables, video-like web scenes, or anything that should
  look premium and cinematic. Provides the Gentleman Kanagawa design system
  (validated palette, ambient blur, particle field), Claude-grade motion craft
  (springs, camera, beat-sync), a dataviz procedure with runnable palette
  validation, and export paths to PDF and MP4 (HyperFrames). NOT for footage an
  AI video model must generate (actors, filmed products, real environments) —
  that is higgsfield-scene's job. Both deliver PDF/Presentations or MP4.
---

# Kanagawa HTML — diseño premium con motion cinematográfico

Una página hecha con esta skill debe leerse como un producto caro (Linear, Apple,
Arc) y moverse como un film: algo pasa en cada beat, nada se siente generado.
El método es diseño-sistema-agnóstico: estos tokens son la instancia por defecto;
sustitúyelos por los de otra marca y no toques nada más.

## 1. Design tokens (Gentleman Kanagawa)

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

## 2. Las tres capas de fondo (en orden z: 0 → 1 → contenido)

1. **Ambient blur**: dos blobs (magenta y azul) de 40vw con `filter: blur(130px)`,
   `opacity: .16`, deriva lenta `26s alternate`. Es el sello del tema; sin esto
   la página se ve "plana".
2. **Campo de partículas**: `<canvas>` fijo, 60-80 partículas en los colores del
   tema, parpadeo sinusoidal, deriva lenta, repulsión leve al mouse.
3. Contenido en `z-index: 2`.

Respeta `prefers-reduced-motion: reduce` — sin canvas ni animaciones de entrada.

## 3. Motion craft (reglas, no gustos)

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
  de `Math.random()` sin semilla ni timers — todo `seek(t)` puro (ver sección 6).
- **Un movimiento = un tween.** Movimiento rápido 0.3-0.6s; blur de motion
  horizontal-only si el movimiento es horizontal.
- **Reveal on scroll** con `IntersectionObserver`: tablas/gráficos aparecen con
  fade+translate; las barras crecen de 0 escalonadas (120ms + idx*90ms);
  contadores KPI con easing cubic (`1 - (1-p)^3`).

## 4. Dataviz: el color se calcula, no se elige

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

## 5. Motion de nivel film (hero, launches, presentaciones)

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

## 6. Presentaciones y video: recetas exactas

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

- [ ] Paleta de GRÁFICOS validada con script (`--surface "#06080f"`, orden exacto de KANAGAWA-CHART); texto con contraste ≥ 4.5:1 (3:1 solo texto grande)
- [ ] Ambient blur + partículas presentes (u off si reduced-motion)
- [ ] Barras/KPIs animados con springs (ω definido); contadores con easing cúbico
- [ ] Si va a render: seek(t) puro — sin random sin semilla, sin rAF como reloj
- [ ] Todo dato tiene su valor impreso; sin leyenda redundante
- [ ] Escala funcional sin red (fallback del CDN de fuentes OK)
- [ ] Si es presentación: PDF verificado con el @media print de la sección 6
- [ ] Si es video: subcomandos de hyperframes verificados con --help antes de render
- [ ] Decisión registrada: si el pedido incluía footage IA (gente/producto filmado),
      esa parte fue delegada a higgsfield-scene — no intentes generarlo con código
