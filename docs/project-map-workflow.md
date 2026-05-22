# Project map workflow

Esta rama agrega un ciclo seguro para describir el proyecto real, revisarlo con AgentLabs y aplicar cambios al mapa funcional solo cuando hay aprobación humana.

## Camino rápido

```text
/config init_project_config
/config inspect_project_map
/config scan_project_map
/config suggest_project_flows
/config draft_project_flows
/config review_project_flows_draft <ruta>
/config apply_project_flows_draft <ruta>
/config ai_draft_project_blueprint
/config ai_draft_project_flows
/config review_ai_blueprint_draft latest
/config review_ai_flows_draft latest
```

Flujo recomendado:

```text
scan → suggest → draft → review → apply con backup
```

## Project blueprint

`config/project-blueprint.json` describe el contrato maestro del proyecto activo.

| Área            | Qué documenta                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Objetivo        | Qué problema resuelve el proyecto real y qué debe preservar el orquestador.                            |
| Reglas maestras | Límites de seguridad, acciones prohibidas, criterios de aceptación y restricciones de operación.       |
| Jerarquía       | Humano decide; Orquestador coordina; AgentLabs auditan en clones; subagentes ejecutan tareas acotadas. |

Jerarquía operativa:

1. **Humano**: aprueba decisiones críticas, aplicación de drafts, commits, pushes y merges.
2. **Orquestador**: interpreta contexto, ejecuta comandos seguros, coordina laboratorios y aplica validaciones internas.
3. **AgentLabs**: actúan como supervisores técnicos en workspaces aislados; reportan hallazgos y propuestas.
4. **Subagentes**: reciben tareas concretas y no reemplazan la aprobación humana.

## Project flows

`config/project-flows.json` es el mapa funcional del proyecto real, no el mapa interno de Idu-pi.

| Sección             | Qué representa                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `modules`           | Áreas funcionales del producto real.                                               |
| `screens`           | Pantallas, páginas o superficies del proyecto real.                                |
| `uiElements`        | Botones, formularios, enlaces, acciones o controles relevantes.                    |
| `dataStores`        | APIs, tablas, archivos, storage o fuentes de datos usadas por el producto.         |
| `flows`             | Recorridos funcionales: disparador, pasos, resultado esperado y targets de prueba. |
| `moduleConnections` | Dependencias funcionales entre módulos y datos compartidos.                        |

El mapa sirve para comparar intención funcional contra código real. No describe comandos internos de Idu-pi, colas internas, SQLite interno ni la arquitectura del bridge salvo que el proyecto activo sea Idu-pi mismo como producto auditado.

## Idu-pi como supervisor de obra

`/idu` activa el modo automático del proyecto actual. Desde ese momento, Idu-pi usa contexto confirmado para supervisar `/task`, `/preflight`, `/advisory`, `/postflight` y planes de revisión antes de que el orquestador construya.

`/idu_off` apaga esas guardrails automáticas. Los comandos manuales siguen disponibles, pero la cola deja de bloquear tareas por riesgo automáticamente.

La cadena de supervisión es:

1. **Project Core**: corazón del proyecto. Define objetivo, alcance, usuarios, stack, sensibilidad de datos y criterios de éxito. Puede nacer como draft por wizard o por propuesta IA, pero solo vale como verdad cuando un humano lo confirma.
2. **Constitution**: reglas no negociables derivadas del Project Core confirmado. Traduce alcance, stack, seguridad, datos y aprobaciones humanas a reglas operativas.
3. **Gates**: validadores deterministas. Evalúan texto, archivos cambiados y riesgo sin usar IA. Si detectan `high` o `blocker`, piden confirmación humana.

Principio de decisión:

- La IA propone borradores o recomendaciones; no convierte nada en verdad por sí sola.
- El humano confirma Project Core, rechaza drafts, aprueba tareas bloqueadas y decide ejecución.
- AgentLabs revisan y preparan evidencia en contextos aislados; no deciden solos y no se ejecutan automáticamente desde `lab_review_plan`.

## Ciclo completo de comandos

| Paso | Comando                                           | Escritura                            | Propósito                                                                           |
| ---- | ------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| 1    | `/config init_project_config`                     | Crea solo configs faltantes          | Inicializa `project-blueprint` y `project-flows` desde defaults sin sobreescribir.  |
| 2    | `/config inspect_project_map`                     | No escribe                           | Valida/inspecciona el JSON funcional cargado.                                       |
| 3    | `/config scan_project_map`                        | No escribe                           | Escanea archivos estáticos del proyecto y compara hallazgos contra `project-flows`. |
| 4    | `/config suggest_project_flows`                   | No escribe                           | Devuelve sugerencias parciales desde el scan; no son fuente de verdad.              |
| 5    | `/config draft_project_flows`                     | Solo `AGENT_WORKSPACE_ROOT/reports/` | Guarda un draft revisable separado de `config/project-flows.json`.                  |
| 6    | `/config review_project_flows_draft <ruta>`       | No escribe                           | Revisa draft contra el mapa actual; acepta `latest` solo para revisar.              |
| 7    | `/config apply_project_flows_draft <ruta>`        | `config/project-flows.json` + backup | Aplica un draft con ruta explícita, merge aditivo y validación final.               |
| 8    | `/config ai_draft_project_blueprint`              | Solo `AGENT_WORKSPACE_ROOT/reports/` | Pide a Pi un borrador IA de blueprint con contexto seguro resumido.                 |
| 9    | `/config ai_draft_project_flows`                  | Solo `AGENT_WORKSPACE_ROOT/reports/` | Pide a Pi un borrador IA de flows usando scan + flows resumidos.                    |
| 10   | `/config review_ai_blueprint_draft [latest/ruta]` | No escribe                           | Revisa warning, JSON/schema y diferencias contra blueprint actual.                  |
| 11   | `/config review_ai_flows_draft [latest/ruta]`     | No escribe                           | Revisa warning, JSON/schema parcial, sugerencias, conflictos y duplicados.          |

## Flujo seguro

1. **scan**: observar código real sin ejecutar código del proyecto.
2. **suggest**: generar sugerencias estructuradas desde el scan, sin escribir archivos.
3. **draft**: guardar un JSON revisable en `AGENT_WORKSPACE_ROOT/reports/`.
4. **review**: comparar draft contra el mapa actual, sin aplicar cambios.
5. **apply**: aplicar solo con ruta explícita, backup previo y validación antes/después.

Reglas de seguridad:

- `suggest_project_flows` no escribe archivos.
- `draft_project_flows` escribe solo bajo `AGENT_WORKSPACE_ROOT/reports/`.
- `review_project_flows_draft` no escribe archivos.
- `apply_project_flows_draft` requiere ruta explícita.
- `apply_project_flows_draft` rechaza `latest`.
- `apply_project_flows_draft` crea backup antes de escribir.
- `apply_project_flows_draft` fusiona solo elementos aditivos.
- `apply_project_flows_draft` no borra datos existentes.
- `apply_project_flows_draft` no sobrescribe IDs existentes.
- El ciclo estático `scan → suggest → draft → review → apply` no usa IA para generar flows.
- Los comandos `ai_draft_*` pueden pedir propuestas a Pi, pero solo guardan borradores en `reports/` con el warning `Borrador IA. No es fuente de verdad.`.
- Los comandos `review_ai_*` no usan IA, no escriben config y no aplican cambios.
- Ningún comando de scan/draft/review ejecuta código del proyecto.

## Qué ve el AgentLab

Cuando hay config válida, el prompt de laboratorio recibe contexto resumido:

- `project-blueprint`: objetivo, reglas maestras y restricciones del proyecto.
- `project-flows`: módulos, pantallas, dataStores y flows funcionales.
- `scan summary`: resumen corto del escaneo estático para contrastar mapa vs código.
- `AgentLabReport`: formato preferente para hallazgos/propuestas estructuradas.
- `rule-validator`: validador interno del Orquestador; no reemplaza al AgentLab ni a la aprobación humana.

Persistencia de reportes:

- JSONL sigue siendo la fuente principal de reportes.
- SQLite es complementario para tracking estructurado.
- Hallazgos/propuestas peligrosos se filtran antes de persistir propuestas críticas.

## Resumen sugerido para PR

### Título

```text
feat(config): add safe project map workflow
```

### Resumen

- Agrega `project-blueprint` y `project-flows` como contexto project-local para auditar el proyecto real.
- Añade comandos `/config` para inicializar, inspeccionar, escanear, sugerir, guardar drafts, revisar y aplicar drafts de `project-flows`.
- Inyecta contexto resumido en AgentLabs: blueprint, flows y scan summary.
- Integra validación secundaria con `rule-validator` sin reemplazar la supervisión técnica ni la aprobación humana.
- Mantiene JSONL como persistencia principal y SQLite como complemento.

### Tests

```text
corepack pnpm build
corepack pnpm test
```

Última verificación conocida en esta rama: `284 passing`.

### Borradores IA

Los comandos IA son opcionales y conservadores:

```text
/config ai_draft_project_blueprint
/config ai_draft_project_flows
/config review_ai_blueprint_draft latest
/config review_ai_flows_draft latest
```

`ai_draft_project_blueprint` lee solo contexto mínimo seguro: `README.md`, `package.json`, docs chicos y resumen del blueprint actual. `ai_draft_project_flows` usa `scan_project_map` y resumen del `project-flows` actual. No leen `.env`, `reports/` ni `workspaces/`, no mandan archivos grandes completos y no ejecutan código.

Los reviews IA muestran diferencias, faltantes, sugerencias, conflictos de IDs, duplicados, riesgos y errores. Si la IA devolvió JSON inválido, el draft conserva `rawOutput` y el review lo reporta sin romper.

### Riesgos y mitigaciones

| Riesgo                           | Mitigación                                                    |
| -------------------------------- | ------------------------------------------------------------- |
| Draft aplicado por accidente     | `apply` exige ruta explícita y rechaza `latest`.              |
| Pérdida de mapa actual           | Backup previo a cada apply.                                   |
| Sobrescritura/borrado            | Merge aditivo; IDs existentes se saltan/reportan.             |
| Sugerencias tomadas como verdad  | Draft/review separan sugerencia de aplicación humana.         |
| Ejecución de código no confiable | Scanner usa lectura estática; no ejecuta código del proyecto. |

### Comandos nuevos principales

```text
/config init_project_config
/config inspect_project_map
/config scan_project_map
/config suggest_project_flows
/config draft_project_flows
/config review_project_flows_draft [latest|ruta]
/config apply_project_flows_draft <ruta>
```
