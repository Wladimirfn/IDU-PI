---
name: soul-icons
description: >-
  Use when creating or revising icons, icon sets, logos, favicons, or any SVG
  glyph for a web page, app, or presentation — whenever icons look "generic"
  (library pictograms, emojis) and must instead represent the identity of the
  specific product: its domain, its metaphor, its soul. Draws original SVG by
  hand from first principles (grid, strokes, metáfora del dominio), validates
  coherence as a family, and never invents text inside icons. Complements
  kanagawa-html (which consumes the icons).
---

# Soul Icons — iconografía con alma, no pictogramas genéricos

Un icono genérico dice "esto es una app". Un icono con alma dice "esto ES este
producto". La diferencia no es talento: es un procedimiento.

## 0. La regla de oro

**Prohibido**: emojis como iconos, copiar pictogramas de Font Awesome/Lucide/
Feather/Material sin transformarlos, cliparts.

**Obligatorio**: cada icono nace de una **metáfora del dominio** del producto
y comparte **ADN visual** con su familia (ver sección 3). Antes de dibujar,
responde: ¿qué ES este proyecto? ¿qué imagen se queda en la retina?

## 1. Extraer el alma (3 preguntas, respuesta escrita antes de dibujar)

1. **¿Qué hace el producto en una frase de acción?**
   ("idu-pi delega tareas a 9 IAs y arbitra el resultado")
2. **¿Cuál es su metáfora física?**
   (el árbitro en el centro de una órbita; un arnés que conecta cabos; una
   nave nodriza con drones)
3. **¿Qué 3 formas resumen su mundo?**
   (órbita, nodo, conector — para idu-pi)

La metáfora se elige una vez por proyecto y TODA la familia la respeta.

## 2. Procedimiento de dibujo SVG (a mano, no de librería)

1. **Grid 24×24** (o 48×48 para detalles finos). Nada fuera del viewBox.
2. **Trazos, no rellenos** (stroke-based): `stroke-width` fijo para la familia
   (típicamente 1.5 en 24px), `stroke-linecap="round"`, `stroke-linejoin="round"`.
3. **Geometría con intención**: círculos perfectos, ángulos de 45°/90°,
   simetrías reales. Los iconos "a ojo" se ven torpes al escalar.
4. **Un punto focal por icono**: el elemento que cuenta la historia (el nodo
   central, la flecha, el pulso). Todo lo demás es secundario y más tenue
   (opacity 0.6-0.75).
5. **Silueta legible a 16px**: si al reducir no se entiende, sobra detalle.
   Regla: un icono de familia soporta máx 2 detalles secundarios.
6. **Sin texto dentro del SVG** — el texto es tipografía, no icono (excepción:
   monograma de logo).

### Plantilla base

```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
     role="img" aria-label="descripción">
  <!-- geometría propia del dominio aquí -->
</svg>
```

`currentColor` para heredar el color del contexto (tema claro/oscuro gratis).

## 3. ADN de familia (lo que hace que sea "un set")

Toda la familia comparte:
- **Stroke-width** idéntico.
- **Radio de curvatura** consistente (si los nodos son redondeados, todos lo son).
- **Vocabulario geométrico**: elige 3-5 primitivas del proyecto y recombínalas.
  (idu-pi: círculo-órbita, punto-nodo, línea-conector, chevron-flujo).
- **Dirección de la metáfora**: si el producto "conecta", los iconos fluyen
  izquierda→derecha; si "protege", envuelven de afuera hacia adentro.
- **Peso visual** balanceado: ningún icono se ve más denso que otro al
  colocarlos en fila (prueba de la fila: alineados a 20px, ¿alguno grita?).

## 4. Procedimiento para el set completo

1. Lista los conceptos a iconizar (máx 8-12 por familia; más de eso diluye).
2. Para cada uno: **metáfora de dominio en 3 palabras** (ej: "delegar =
   órbita emite nodo").
3. Dibuja el punto focal primero, secundarios después.
4. **Prueba de familia**: todos en fila, mismo tamaño, mismo color. Ajusta
   densidades hasta que respiren igual.
5. **Prueba de alma**: tapa los textos, ¿se entiende qué es el producto solo
   con los iconos? Si no, la metáfora es débil — rehacer, no retocar.
6. Exporta como sprite `<symbol>` inline o archivos separados según el
   consumo (kanagawa-html los consume inline).

## 5. Animación (cuando el diseño lo pide)

Los iconos con alma se animan con la misma metáfora:
- **Dibujo**: `stroke-dasharray`/`dashoffset` para que el trazo se dibuje
  (1-1.5s, ease out).
- **Vida**: un elemento secundario late o orbita (los nodos de idu-pi pulsan
  — la órbita es su mundo).
- **Nunca**: rotaciones sin sentido, bounces genéricos, parpadeos.
- Respeta `prefers-reduced-motion` (iconos estáticos).

## 6. Checklist de entrega

- [ ] Metáfora del proyecto escrita y usada en todos los iconos
- [ ] Misma stroke-width, linecap y linejoin en toda la familia
- [ ] Legibles a 16px (silueta)
- [ ] Prueba de fila: densidad balanceada
- [ ] Sin emojis, sin copias de librerías, sin texto dentro (salvo monograma)
- [ ] `currentColor` + `aria-label` en cada icono
- [ ] Animaciones con la metáfora y reduced-motion respetado
- [ ] Consumidos inline por la página (kanagawa-html) o como sprite
