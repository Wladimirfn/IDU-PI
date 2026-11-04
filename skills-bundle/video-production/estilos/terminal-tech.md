# Estilo: terminal tech

Se ve como lo usa quien programa: una terminal real, comandos legibles y la
salida que confirma que funcionó.

**Úsalo para:** instalación, comandos, demos de CLI, "así se usa", tutoriales.
**No lo uses para:** conceptos abstractos ni datos comparativos.

## Lienzo

- 1920×1080, fondo oscuro con un brillo suave detrás de la ventana.
- Una ventana de terminal que ocupa al menos el 70 % del ancho, con barra de
  título (tres puntos) y el nombre de la carpeta real.

## Paleta

| Token | Hex | Uso |
| :--- | :--- | :--- |
| `--fondo` | `#06080f` | fondo de la escena |
| `--ventana` | `#0b0e15` | fondo de la terminal |
| `--texto` | `#f3f6f9` | comandos |
| `--prompt` | `#e0c15a` | el `$` y la ruta |
| `--ok` | `#b7cc85` | salida correcta, `✓` |
| `--error` | `#cb7c94` | errores |
| `--tenue` | `#8394a3` | salida secundaria y comentarios |

## Tipografía

| Rol | Fuente | Tamaño a 1080p |
| :--- | :--- | :--- |
| Comandos y salida | JetBrains Mono 400/500 | 30–36 px, interlineado 1,6–1,8 |
| Titular de la escena | Space Grotesk 600 | 64–80 px |
| Notas al margen | Space Grotesk 500 | 32–40 px |

**Un comando por línea**, sin cortes. Si un comando no cabe a 30 px, se acorta
(variables, `\`) o se muestra en dos escenas.

## Trazo e ilustración

- Sin iconos dentro de la terminal. Fuera, flechas o notas al margen que
  señalan la línea importante.
- Resaltar la línea clave con una franja suave detrás, no cambiando su color.

## Composición

- La ventana centrada o a la izquierda, con las notas a la derecha.
- Solo los comandos y la salida **reales** del proyecto: nada inventado. Si la
  salida es larga, se recorta con `…` y se dice.

## Movimiento

- Los comandos se escriben con efecto de máquina de escribir, a 25–40
  caracteres por segundo, sincronizados con la frase que los nombra. El cursor
  parpadea a 1 Hz mientras espera.
- La salida aparece de golpe o por líneas rápidas (60–120 ms por línea), como en
  una terminal real.
- Cada comando queda en pantalla **al menos 3 s** después de terminar de
  escribirse.

## Personajes

Ninguno dentro de la terminal. La mascota puede aparecer al lado para celebrar
el `✓` final.

## Sonido

Tecleo suave mientras se escribe y un tono corto en el `✓`. Música baja.

## Errores prohibidos

- Comandos o salidas inventadas.
- Texto de terminal de menos de 30 px.
- Un comando que se escribe y desaparece antes de poder leerlo.
