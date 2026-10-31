# idu-pi · iconografía con alma

**Entrega:** 8 iconos SVG dibujados a mano para el arnés idu-pi.
**Archivo vivo:** `icons-demo.html` — set animado en fila + prueba de familia a 16 px.

---

## 1. Extraer el alma

### ¿Qué hace idu-pi en una frase de acción?

**Delega una tarea a nueve IAs, la verifica con tests ocultos y arbitra el resultado con un motor de tres capas** (Kev local en GPU, Jev cloud, fallback determinista), bajo la regla de un solo orquestador: ningún worker vuelve a delegar.

### ¿Cuál es su metáfora física?

**El árbitro inmóvil en el centro de una órbita.**

Los workers giran a su alrededor; el arnés sujeta los cabos y el resultado vuelve al centro. Los cables van del centro hacia fuera (mando, emisión) o de fuera hacia el centro (verificación, arbitraje), **nunca en lateral**: esa es la forma física de la ONE ORCHestrator RULE.

Metáforas secundarias que alimentan el set: el arnés con mordazas que emite un nodo, la balanza orbital que pesa nueve resultados y la nave nodriza con drones.

### ¿Qué tres formas resumen su mundo?

1. **Órbita** — el círculo de workers alrededor del centro (radio 7.3 en el grid de 24).
2. **Nodo** — cada IA, cada resultado, el punto que se emite (trazo de longitud cero, remate redondo).
3. **Conector** — el cable que delega, verifica o arbitra (línea de 1.5; radial, no lateral).

Las tres se recombinan: la órbita abierta se vuelve arnés; el nodo en órbita, worker; el conector curvo, reanudación.

---

## 2. ADN de familia

| Primitiva | Regla exacta |
|---|---|
| Grid | `viewBox="0 0 24 24"`, nada fuera del viewBox, área segura 3–21 |
| Trazo | `stroke-width="1.5"`, `stroke-linecap="round"`, `stroke-linejoin="round"` |
| Relleno | `fill="none"`: **todo es trazo**. Los puntos de familia son trazos de longitud cero con remate redondo |
| Color | `currentColor` — hereda tema claro/oscuro sin duplicar el set |
| Órbita | Círculo de radio 7.3 a opacidad 0.25–0.35; los nodos se posan sobre ella |
| Nodo | Punto de 1.5 de diámetro (`M x y h.01`); el nodo focal puede ser un anillo mayor (delegar) o un target (centro) |
| Centro | Anillo de radio 2.2 + nodo central: el árbitro siempre es el mismo target |
| Dirección | Radial: emisión hacia fuera (delegar), retorno al centro (arbitrar), mando desde el centro (one-orchestrator) |
| Densidad | Máximo 2 detalles secundarios por icono; el foco siempre a opacidad plena, lo demás a 0.35–0.75 |
| Texto | Cero texto dentro del SVG. El nombre va debajo, en tipografía |

**Regla de la ONE ORCHestrator RULE en el dibujo:** los nodos exteriores de `one-orchestrator` no se conectan entre sí y no emiten líneas. Solo el centro tiene radios. Un worker que re-delegara tendría un conector de salida; aquí no existe.

---

## 3. Los ocho iconos

| # | Icono | Metáfora en 3 palabras | Punto focal | Secundarios |
|---|---|---|---|---|
| 01 | **Delegar** | el arnés emite | nodo fijo en el extremo + punto en vuelo | arnés en C + mordazas, conector |
| 02 | **Verificar** | check con pulso | check | halo orbital que respira |
| 03 | **Arbitrar** | balanza orbital | centro (anillo + nodo) | 9 nodos a 40°, órbita tenue, halo del nodo líder |
| 04 | **Sesión** | línea que reanuda | arco de reanudación | checkpoint circular, dos segmentos de línea |
| 05 | **Ledger** | bloques apilados | bloque superior (el más reciente) | dos bloques más tenues, dos enlaces, lomo |
| 06 | **Watchdog** | ojo que no duerme | pupila | ojo abierto, iris punteado que gira |
| 07 | **Quota** | barra con techo | techo en forma de П | track vertical, nivel que sube |
| 08 | **One Orchestrator** | un punto manda | centro (target) | 6 radios punteados, 6 nodos sin conexión lateral |

### Geometría clave

- **Arbitrar:** 9 nodos sobre `r = 7.3`, separados 40°, el líder a −90° (arriba). Centro `r = 2.2` + nodo.
- **One Orchestrator:** centro `r = 2.2`; radios de `r = 3.1` a `r = 7.2`; 6 nodos a `r = 8.2` en ángulos de 60°.
- **Delegar:** arnés `M10 7.4C5.2 8.9 5.2 15.1 10 16.6`; nodo en `18.2` (`r = 1.5`); punto en vuelo de 12.9 a 15.6.
- **Sesión:** línea 3.5→9.7, checkpoint en 9.7 (`r = 1.15`), arco de reanudación 11.6→17.4, línea 17.4→20.5.
- **Quota:** techo `M5.6 7.2V5.6h12.8v1.6`; track `x 8.8, y 7, 6.4 × 13.3`; nivel en `y = 12.4`, sube 4.2 unidades y vuelve.
- **Watchdog:** ojo de 3.8 a 20.2; pupila `r = 1.8`; iris `r = 3.4` con `stroke-dasharray="2.8 2.6"`.

### Animación (misma metáfora, nunca decorativa)

| Icono | Movimiento | Razón |
|---|---|---|
| Delegar | Un punto recorre el conector y se desvanece; el nodo del extremo queda fijo | Emisión de una tarea |
| Verificar | El halo escala y respira; el check queda fijo | El test oculto confirma |
| Arbitrar | Los 9 nodos orbitan 40 s; el halo del líder late; el centro respira | La balanza nunca se detiene |
| Sesión | El checkpoint pulsa; el arco de reanudación respira | La línea se reanuda |
| Ledger | Un pulso de escritura recorre los bloques cada 6.4 s | Se añade un bloque |
| Watchdog | El iris gira 24 s; la mirada barre ±0.5 px | El ojo nunca duerme; no parpadea |
| Quota | El nivel sube 4.2 unidades hacia el techo y vuelve | Consumo contra límite |
| One Orchestrator | Los radios fluyen hacia fuera con desfase; el centro respira | Un solo punto emite órdenes |

Todas las animaciones se detienen con `prefers-reduced-motion: reduce` y dejan el icono **completo**, no a medio dibujar.

---

## 4. Pruebas aplicadas

- **Prueba de fila:** los 8 a 72–76 px, mismo color y misma separación. Ninguno grita: arbitrar y one-orchestrator concentran muchos elementos pero con trazo fino; sesión respira con líneas.
- **Prueba de alma:** tapando los nombres, la órbita + el nodo + el conector siguen contando la historia de idu-pi.
- **Prueba de 16 px:** los mismos trazos, sin animación, sobre sumi y sobre papel en `icons-demo.html`. La silueta se sostiene: la C del arnés, el check, la órbita de puntos, el ojo, la barra con techo y el hub con radios son reconocibles.
- **Prueba de reglas:** sin emojis, sin pictogramas copiados, sin texto dentro, sin rellenos.

## 5. Checklist de entrega

- [x] Metáfora del proyecto escrita y usada en todos los iconos
- [x] Misma `stroke-width`, `linecap` y `linejoin` en toda la familia
- [x] Legibles a 16 px (silueta)
- [x] Prueba de fila: densidad balanceada
- [x] Sin emojis, sin copias de librerías, sin texto dentro (salvo monograma)
- [x] `currentColor` + `aria-label` en cada icono
- [x] Animaciones con la metáfora y `prefers-reduced-motion` respetado
- [x] Consumidos inline por la página
