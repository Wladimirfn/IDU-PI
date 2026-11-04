# Estilo: pizarra

Una clase que se dibuja mientras se explica. El trazo aparece al ritmo de la
voz, como la mano de un profesor.

**Úsalo para:** razonamientos paso a paso, diagramas que se construyen, "cómo
funciona" con flechas y cajas.
**No lo uses para:** datos con muchas cifras (`editorial-datos`), frases de
impacto (`bold-kinetic`) o código (`terminal-tech`).

## Lienzo

- 1920×1080. Fondo de pizarra **con textura**: un verde pizarra con ruido suave
  y manchas de borrado (gradientes radiales casi transparentes). Sin textura es
  una diapositiva oscura, no una pizarra.
- Margen seguro: 120 px a los lados y 80 px arriba y abajo.

## Paleta

| Token | Hex | Uso |
| :--- | :--- | :--- |
| `--pizarra` | `#1f2b25` | fondo |
| `--tiza` | `#f1efe6` | **titulares** y trazo principal |
| `--tiza-amarilla` | `#f3d36b` | el acento: una idea por escena |
| `--tiza-azul` | `#9fd0e3` | conectores, flechas |
| `--tiza-rosa` | `#f2a9b8` | errores, advertencias |
| `--tiza-tenue` | `#f1efe6` al 55 % | texto secundario |

**Disciplina:** el titular va siempre en `--tiza` (blanco tiza), nunca gris.
Un solo acento amarillo por escena.

## Tipografía

| Rol | Fuente | Tamaño a 1080p |
| :--- | :--- | :--- |
| Titular | Cabin Sketch Bold | 88–110 px |
| Rótulos a mano | Patrick Hand | 40–52 px |
| Etiquetas técnicas | JetBrains Mono | ≥ 28 px |

Fuentes con licencia OFL. Para render sin red, usa los `.woff2` locales de
`@fontsource/*`.

## Trazo e ilustración

- Trazo de **5–7 px**, con extremos redondeados y un temblor leve (filtro SVG
  `feTurbulence` + `feDisplacementMap` con escala 1,5–2,5). Una línea perfecta
  delata al ordenador.
- **Los dibujos explican, no decoran.** Cada icono es un objeto reconocible:
  una caja con engranajes para un arnés, un cilindro para una base de datos.
  Prohibido representar un concepto con una raya o un punto.
- Los dibujos ocupan espacio: un diagrama usa al menos el 40 % del cuadro.

## Composición

- Titular arriba a la izquierda. El diagrama ocupa el centro y la frase clave va
  abajo o a la derecha, en amarillo.
- Todo texto que va dentro de una forma (una caja, un cilindro) cabe con al
  menos 24 px de margen interior. Si no cabe, se agranda la forma.

## Movimiento

- Los trazos **se dibujan** (`stroke-dashoffset`, 0,4–0,9 s por trazo, curva
  `inOut`) y el texto se escribe letra a letra o palabra a palabra al ritmo de la
  frase.
- Cada elemento aparece en la frase que lo nombra.
- Para pasar de escena: un borrado con trapo (una máscara que barre el cuadro en
  0,5 s), no un fundido a negro.

## Personajes

Opcional: la mascota dibujada con el mismo trazo de tiza, sin relleno.

## Sonido

Roce de tiza suave al dibujar los trazos largos, y un golpe seco de tiza en la
frase clave. Música tranquila, de 70 a 85 BPM.

## Errores prohibidos

- Titular gris o de bajo contraste.
- Iconos de 1–2 px, abstractos o diminutos.
- Texto que se sale de su forma (el caso del cilindro "engram").
- La mitad del cuadro vacía sin intención.
- Pizarra sin textura.
