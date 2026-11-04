# Estilo: editorial de datos

El dato es el protagonista, como en un gráfico de un diario serio: un titular
que dice qué significa el número, el gráfico y la fuente.

**Úsalo para:** resultados, comparaciones, benchmarks, antes y después medidos.
**No lo uses para:** conceptos sin números ni frases de impacto.

## Lienzo

- 1920×1080. Fondo oscuro liso (`#06080f`) o papel claro (`#f5f2ef`); elige uno
  por video y no lo cambies entre escenas de datos.
- Margen seguro: 120 px. La fuente va siempre abajo a la izquierda.

## Paleta

Para la interfaz, los tokens de `kanagawa-html` §1. **Para las series de
datos, la paleta validada `KANAGAWA-CHART`** (`kanagawa-html` §4), en su orden:
`#d15a94`, `#b3881a`, `#3f89b8`, `#3f7a45`. No se inventan colores para
gráficos: si hace falta otro, se valida con `validate_palette.js`.

**Disciplina:** una serie, un color (todas las barras de una serie del mismo
tono). Para destacar un valor se resalta *ese* valor (más opaco o con un
contorno), no se pinta cada barra de un color distinto.

## Tipografía

| Rol | Fuente | Tamaño a 1080p |
| :--- | :--- | :--- |
| Titular | Source Serif 4 Semibold | 72–88 px |
| Número héroe | Source Serif 4 Semibold, cifras tabulares | 140–220 px |
| Etiquetas de eje y valores | Space Grotesk 500, cifras tabulares | ≥ 30 px |
| Fuente | JetBrains Mono | ≥ 22 px |

## Trazo e ilustración

- Ejes de 2 px en el color tenue, sin cuadrícula densa (como mucho 3 líneas
  guía).
- Barras con extremos rectos o con un radio de 4 px. Cada barra lleva su valor
  escrito: sin leyendas redundantes.

## Composición

- **El titular dice la conclusión**, no el tema: "commandcode gastó 4× menos
  tokens", no "Tokens por harness".
- Un gráfico por escena. Si hay dos ideas, son dos escenas.

## Movimiento

- Las barras crecen desde 0, escalonadas (120 ms + 90 ms por barra), al ritmo de
  la frase que las nombra. Los contadores usan la curva cúbica `1 − (1 − p)³`.
- El número héroe cuenta hasta su valor en 1–1,5 s y queda quieto.
- Nada se mueve mientras el espectador debe leer un valor.

## Personajes

Normalmente ninguno: el dato compite mal con un personaje. Como mucho, la
mascota señala el valor clave en una escena de cierre.

## Sonido

Un tic suave por barra y un tono al llegar el número héroe. Música neutra.

## Errores prohibidos

- Un número en pantalla sin su fuente.
- Colorear las barras por su valor.
- Un titular que no dice qué significa el dato.
- Un eje que no empieza en 0 sin avisarlo.
