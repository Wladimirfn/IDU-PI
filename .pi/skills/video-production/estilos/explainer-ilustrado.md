# Estilo: explainer ilustrado

Un concepto abstracto convertido en objetos y personajes que actúan. El
espectador entiende el mecanismo porque lo *ve* pasar.

**Úsalo para:** "cómo funciona", arquitectura, flujos, reglas, cualquier idea
que en texto sería un párrafo.
**No lo uses para:** comandos (`terminal-tech`) ni tablas de números
(`editorial-datos`).

## Lienzo

- 1920×1080. Fondo oscuro con un brillo de color detrás del protagonista
  (degradado radial del acento al 15–25 %), o un fondo fotográfico desenfocado
  si el brief lo pide y hay imagen con licencia.
- Una escena es **un escenario**: los objetos se apoyan en una línea de suelo o
  flotan con sombra suave, nunca sueltos en el vacío.

## Paleta

Base de `kanagawa-html` §1 (fondo `#06080f`, tinta `#f3f6f9`) y **un color por
actor**: cada personaje o pieza tiene el suyo y lo mantiene en todo el video
(por ejemplo, el orquestador en acento `#e0c15a` y cada CLI en su color de
`soul-icons`).

## Tipografía

| Rol | Fuente | Tamaño a 1080p |
| :--- | :--- | :--- |
| Titular | Space Grotesk 700 | 72–96 px |
| Rótulos de objetos | Space Grotesk 600 | 36–44 px |
| Etiquetas técnicas | JetBrains Mono 500 | ≥ 28 px |

**Poco texto:** como mucho un titular y un rótulo por objeto. Lo demás lo
cuenta la acción y la voz.

## Trazo e ilustración

- Formas planas con relleno y contorno de **5–6 px** del mismo color más oscuro,
  esquinas redondeadas y volumen sugerido con una sola sombra plana. Todo con el
  ADN de `soul-icons`: órbita, nodo y conector.
- **Una metáfora por escena**, escrita en el storyboard: el arnés es un panel de
  control con perillas; delegar es un cable que lleva un paquete; la memoria es
  un archivador que todos abren.
- El protagonista ocupa al menos el 30 % del cuadro.

## Composición

- El protagonista en el centro o en el tercio izquierdo; el titular arriba.
- La acción va de izquierda a derecha (el orden de lectura); lo que *vuelve*
  (un resultado) va de derecha a izquierda.

## Movimiento

- Principios de animación clásicos, en versión sutil: **anticipación** (un
  pequeño retroceso antes de moverse), **rebote** al llegar (amortiguamiento
  0,7–0,85) y **movimiento secundario** (una antena o un cable que sigue con
  retraso).
- Los paquetes viajan por los cables con una curva `inOut` de 0,8–1,6 s.
- Cada acción empieza en la frase que la describe.

## Personajes

- La mascota de idu-pi (el orquestador) y los workers, con **expresiones**:
  neutra, atenta, contenta, sorprendida y negándose. Se cambia la expresión en el
  beat que la justifica (el orquestador se niega cuando un worker intenta
  delegar).
- Ojos con parpadeo cada 3–5 s (con semilla, no aleatorio puro).
- Los personajes son propios. Nunca se copia un personaje de otro creador.

## Sonido

*Pop* al aparecer cada actor, *whoosh* en los viajes y un sonido característico
por acción clave (un "clac" cuando el orquestador frena). Música con pulso suave,
de 85 a 100 BPM.

## Errores prohibidos

- Una escena que es solo texto.
- Objetos de trazo fino o del tamaño de un icono.
- Un personaje que no hace nada: si está en escena, reacciona.
- Cambiar el color de un actor entre escenas.
