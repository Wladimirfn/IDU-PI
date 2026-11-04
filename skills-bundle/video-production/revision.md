# Revisiones

Cuatro puertas. Cada criterio se marca como **pasa**, **falla** o **no aplica**,
y cada fallo se corrige antes de seguir. Las medidas son para 1920×1080; en
1080×1920 aplican igual al lado corto.

**Mira las imágenes.** Una revisión visual hecha sin abrir la hoja de contacto
no es una revisión. Si no puedes ver imágenes, dilo en el informe y pide que una
persona la haga.

## §1. Storyboard (después de la etapa 4)

| Criterio | Pasa si |
| :--- | :--- |
| Objetivo | el brief tiene el objetivo en una frase y el guion lo cumple |
| Estructura | sigue una estructura de `estructuras.md`, en su orden |
| Una idea por escena | cada escena se resume en una frase |
| Metáfora | cada escena de concepto tiene una metáfora visual, no solo texto |
| Datos | todo número del guion está en `investigacion.md` con su fuente |
| Estilos | cada escena tiene estilo; como mucho 3 por video; la regla de mezcla se cumple |
| Duración | palabras del guion ÷ 2,75 ≈ duración objetivo (±15 %) |
| Beats | cada elemento que entra está atado a un id de frase |

## §2. Fotogramas clave (después de la etapa 6)

Sobre la hoja de contacto de los fotogramas quietos.

| Criterio | Pasa si |
| :--- | :--- |
| Desbordes | ningún texto se sale de su caja, forma o del cuadro |
| Solapes | ningún texto se monta sobre otro texto o sobre un trazo |
| Margen seguro | nada importante a menos de 96 px del borde lateral ni de 54 px del superior o el inferior |
| Contraste | texto ≥ 4,5:1 contra su fondo; titulares grandes ≥ 3:1. **El titular es lo más contrastado de la escena** |
| Tamaño | titular ≥ 72 px · texto ≥ 40 px · etiquetas ≥ 28 px |
| Trazo | líneas de ilustración ≥ 4 px (ver el mínimo de cada estilo) |
| Punto focal | se sabe dónde mirar en menos de 1 s; un solo elemento manda |
| Uso del cuadro | el protagonista ocupa ≥ 30 % del cuadro; no hay media pantalla vacía sin intención |
| Texto en pantalla | ≤ 12 palabras por escena, salvo terminal o datos |
| Prueba del teléfono | reducida a 480 px de ancho, la idea de la escena se sigue entendiendo |
| Estilo | cumple su archivo de `estilos/`, incluidos sus errores prohibidos |
| Coherencia | misma paleta base, fuente de cuerpo, trazo y personaje en todo el video |

## §3. Borrador (después de la etapa 8)

Sobre el borrador en movimiento y su hoja de contacto.

| Criterio | Pasa si |
| :--- | :--- |
| Sincronía | cada elemento entra en la frase que lo nombra (±0,3 s) |
| Lectura | cada escena queda quieta y legible ≥ 1,5 s antes de cambiar |
| Ritmo | ninguna escena dura más de 25 s sin un cambio visual |
| Movimiento | sin saltos, parpadeos ni elementos que aparecen sin animación |
| Transiciones | entre estilos distintos hay una transición puente |
| Voces | `validar_video_audio.py` da 0 errores |
| Continuidad | en las uniones entre segmentos de render no se repite ni falta ningún cuadro |

## §4. Final (después de la etapa 10)

| Criterio | Pasa si |
| :--- | :--- |
| Formato | H.264 `yuv420p`, 30 fps, la resolución del brief, AAC, `+faststart` |
| Volumen | −14 LUFS integrados (±1), picos ≤ −1,5 dBTP |
| Música | cubre el video, tiene `partitura.json` y queda bajo la voz |
| Subtítulos | texto original (no el léxico de pronunciación), tiempos de `timeline.json` |
| Miniatura | 1280×720; se entiende a 320 px de ancho |
| Capítulos | empiezan en `0:00` y cada uno dura ≥ 10 s |
| Licencias | fuentes, efectos, imágenes y música con licencia documentada |
| Honestidad | lo provisional (por ejemplo, una voz de prueba) está dicho en el informe |

## Plantilla de `informe-revision.md`

```markdown
# Informe de revisión: <título>

## §1 Storyboard
- pasa: …
- falla y se corrigió: <criterio> — <qué estaba mal> → <qué se cambió>

## §2 Fotogramas clave
(hoja: keyframes/hoja.png)
…

## §3 Borrador
(hoja: hoja-borrador.png)
…

## §4 Final
…

## Pendiente
- <lo que no se pudo cumplir y por qué>
```
