# IDU Cross-CLI — Agent Router & Quality Harness

<p>
  <a href="https://github.com/Gentleman-Programming/gentle-ai">
    <img width="200" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
  </a>
</p>

**IDU Cross-CLI (`idu-pi`)** orquesta terminales de IA reales. No es otro chat: es el arnés que
decide **qué CLI, con qué modelo, bajo qué proceso** resuelve cada tarea, y que se niega a dar
por bueno un cambio sin evidencia.

Hace tres cosas:

1. **Delega** a terminales reales — Claude Code, OpenCode, Codex, Pi, Antigravity, Kimi, Qwen,
   MiniMax Code y Command Code — con perfiles por rol, sesiones reanudables y locks de
   concurrencia.
2. **Audita** cada cambio: `preflight` antes de tocar código, `postflight` contra el blast radius
   esperado, y un ledger durable de decisiones.
3. **Arbitra** decisiones autónomas (`idu_arbitrate`) con un motor de tres capas: Kev local en
   GPU, TypeSafe Jev en la nube, o fallback determinista Risk-First a costo cero.

Todo bajo la **ONE ORCHESTRATOR RULE**: un worker nunca vuelve a delegar. El alcance real de esa
guarda —y sus límites— está en [SECURITY.md](SECURITY.md).

---

## Índice

- [Instalación rápida](#instalación-rápida)
- [Por qué existe](#por-qué-existe)
- [Flota de agentes por rol](#flota-de-agentes-por-rol)
- [Herramientas MCP](#herramientas-mcp)
- [Perfiles de ejecución](#perfiles-de-ejecución)
- [Memoria compartida (Engram)](#memoria-compartida-engram)
- [Stack creativo](#stack-creativo-diseño-iconos-voz-y-música)
- [Configuración en clientes MCP](#configuración-en-clientes-mcp)
- [Comandos CLI](#comandos-cli)
- [Pruebas y construcción](#pruebas-y-construcción)
- [Gobernanza](#gobernanza)
- [Documentación](#documentación)

---

## Instalación rápida

### Requisitos

| Requisito | Versión | Nota |
| :--- | :--- | :--- |
| **Node.js** | ≥ 24 | Campo `engines` del `package.json` |
| **pnpm** | 11.x | Se activa con `corepack` |
| **Al menos un CLI de IA** | — | El arnés detecta cuáles tienes; no exige ninguno |

### Pasos

```bash
# 1. Clonar
git clone https://github.com/Wladimirfn/IDU-PI.git
cd IDU-PI

# 2. Activar pnpm y compilar
corepack enable
pnpm install
pnpm build

# 3. Instalar: dependencias, build, MCP de Pi y shim idu-pi
node scripts/install.mjs

# 4. Verificar qué detectó
pnpm run cli status
```

`scripts/install.mjs` instala dependencias, compila, agrega `idu-pi` al MCP de Pi
(`~/.pi/agent/mcp.json`, con backup y sin pisar otros servidores; `--no-mcp` lo omite) y crea el
shim `idu-pi`. Para hacer solo el paso de Pi: `pnpm run cli setup mcp-init` (`--dry-run` para ver
el resultado sin escribir, `--force` para reemplazar una entrada existente). **No escribe**
`~/.idu/config.json` ni `~/.idu/profiles.json`: sin ellos el arnés usa los 12 presets del
proyecto. La flota por rol se declara a mano en `~/.idu/profiles.json` (ver
[Perfiles de ejecución](#perfiles-de-ejecución)). `pnpm run cli status` muestra qué CLIs
detecta: los que no tengas simplemente no aparecen.

### Conectar el servidor MCP

El arnés expone sus herramientas por MCP. Cada cliente necesita la **ruta absoluta** a
`dist/src/mcp-server.js` — un path relativo resuelve contra el cwd del cliente, que no es el del
proyecto.

```jsonc
// ~/.config/opencode/opencode.jsonc  (equivalente en tu cliente)
{
  "mcp": {
    "idu-pi": {
      "type": "local",
      "command": ["node", "/ruta/absoluta/a/IDU-PI/dist/src/mcp-server.js"],
      "cwd": "/ruta/absoluta/a/IDU-PI",
      "enabled": true,
      "timeout": 1800
    }
  }
}
```

> **OpenCode y tareas largas.** Añade `"experimental": { "mcp_timeout": 1800000 }` en
> `~/.config/opencode/opencode.json`, o OpenCode cancelará las llamadas MCP que pasen de dos
> minutos.

Otros clientes: [docs/mcp-server.md](docs/mcp-server.md).

### Verificar la instalación

```bash
pnpm run verify
```

Compila, corre la suite y comprueba que no haya deriva entre el protocolo documentado y el
código. Si pasa, el arnés está sano.

---

## Por qué existe

Cada CLI trae su propio **arnés** — reglas, memoria, permisos y contratos distintos — y eso
cambia el resultado con el mismo modelo. En el benchmark interno, la misma tarea con el mismo
modelo tardó **28,5 s en un arnés y 64,3 s en otro**, con los mismos 13/13 tests.

| CLI | Arnés propio | Lo que aporta de verdad |
| :--- | :--- | :--- |
| **gentle-shell** | ODD + RDD (Judgment Day) | Especificación con requisitos numerados, tareas con evidencia RED/GREEN, **4 lentes de revisión** más refutador |
| **cmdc** (Command Code) | Taste + mods + statusline | Aprende el estilo del proyecto; mods propios; MCP nativo |
| **mcode** (MiniMax Code) | Herramientas propias + nativos | `mcode-tools`, binarios nativos, preview de imágenes |
| **opencode** | Subagentes declarados en JSON | Agentes con contrato de idioma; CodeGraph obligatorio |
| **claude** (Claude Code) | CLAUDE.md + hooks + subagentes | Persona estricta, CodeGraph primero, ~20 subagentes |
| **agy** (Antigravity) | CLI nativo | Sin capa de arnés configurable |

**La tesis:** ningún modelo gana en todo, y el arnés pesa más que el modelo. En vez de elegir
uno, el sistema asigna cada tarea al arnés que la resuelve mejor y los hace trabajar sobre una
memoria común.

---

## Flota de agentes por rol

Los perfiles se agrupan por **rol**, no por CLI. Cada rol ofrece entre 2 y 5 alternativas para
lanzar agentes en paralelo o cambiar de modelo según la tarea y la cuota.

| Rol | Perfiles | Escribe |
| :--- | :--- | :---: |
| **Exploración** | `explore-deepseek` · `explore-glm` · `explore-mimo` | No |
| **Consultas** | `consult-openai` · `consult-mimo` · `consult-claude` · `consult-gemini38` | No |
| **Arquitectura** | `arch-claude` · `arch-sol` · `arch-gemini` · `arch-deepseek` | No |
| **Diseño** | `design-opencode` · `design-gentle` | Sí (assets) |
| **Iconografía** | `iconographer` · `iconographer-mimo` | Sí (assets) |
| **Voz** | `voice-narrator` | Sí (assets) |
| **Música** | `music-composer` | Sí (assets) |
| **Auditoría** | `audit-claude` · `audit-gemini` · `audit-deepseek` · `audit-mimo` · `audit-minimax` | No |
| **Trabajo** | `work-glm` · `work-deepseek` · `work-mimo` | Sí (código) |

Los roles read-only no editan nada: su garantía está en el prompt del worker, no en un flag.

**El esfuerzo vive en el slug del modelo**, no en un campo del perfil: `glm5.3-flash:high`,
`mimo-v2.6-flash:max`.

---

## Herramientas MCP

El servidor de `dist/src/mcp-server.js` expone **14 herramientas** optimizadas para mínimo
consumo de contexto:

| Herramienta | Qué hace |
| :--- | :--- |
| `idu_status` | Workspace, rama Git, árbol sucio y salud del sistema |
| `idu_project_status` | Alias de compatibilidad de `idu_status` |
| `idu_preflight` | Riesgo, tree sucio e impacto antes de tocar código |
| `idu_postflight` | Diffs reales vs esperados y blast radius después de editar |
| `idu_decision_record` | Registra una decisión en el ledger durable |
| `idu_decision_list` | Consulta el historial de decisiones |
| `idu_delegate` | Lanza un worker terminal bajo un perfil |
| `idu_delegate_parallel` | Lanza varios workers concurrentemente |
| `idu_worker_status` | Estado, telemetría y logs en tiempo real |
| `idu_worker_wait` | Espera sin matar el worker si el timeout del cliente expira |
| `idu_worker_result` | Salida completa, diffs y reporte |
| `idu_session_list` | Sesiones con su CLI, timestamp y bloqueo |
| `idu_capabilities` | Perfiles disponibles y CLIs detectados (+ cuota con `include_quota`) |
| `idu_arbitrate` | Arbitraje autónomo: Kev GPU → Jev nube → fallback determinista |

---

## Perfiles de Ejecución

Los perfiles viven en `~/.idu/profiles.json` y **mergean sobre** los presets del proyecto. Para
ver los efectivos de tu máquina, con sus timeouts reales:

```bash
pnpm run cli capabilities
```

Hay **dos capas** que conviene no confundir:

| Capa | Qué es | Cuántos |
| :--- | :--- | :--- |
| **Presets del proyecto** | Los que trae el código en `DEFAULT_PROFILES` | 12 |
| **Flota por rol** | La que declaras en `~/.idu/profiles.json` (referencia abajo) | 25 |

Con `"replaceDefaults": true` —así está declarada la flota de referencia— los presets **dejan de inyectarse** y
tu archivo es la lista completa. Sin ese flag, tu archivo se suma a los 12 presets.

### Presets del proyecto (12)

Son el fallback. Si no instalas nada, estos son los perfiles disponibles.

| Perfil | CLI | Modelo | Trabajo | Inactividad | Techo máximo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `architecture` | Claude Code | opus | 60 min | 5 min | 240 min |
| `antigravity-advisory` | Antigravity (`agy`) | gemini-4-argon-high | 60 min | 5 min | 240 min |
| `deep-refactor` | Claude Code | sonnet | 60 min | 5 min | 240 min |
| `coding` | Codex CLI | gpt-5.6-luna | 60 min | — | 240 min |
| `cheap-explore` | OpenCode | MiniMax-M3 | 30 min | 5 min | 120 min |
| `cheap-debug` | OpenCode | deepseek-v4-flash | 30 min | 5 min | 120 min |
| `commandcode` | Command Code (`cmdc`) | deepseek/deepseek-v4.1-flash | 30 min | 5 min | 120 min |
| `mcode` | MiniMax Code (`mcode`) | minimax/MiniMax-M3.1-Flash-Preview | 30 min | 5 min | 120 min |
| `antigravity` | Antigravity (`agy`) | gemini-4-argon-high | 30 min | 5 min | 120 min |
| `kimi` | Kimi | (default del CLI) | 30 min | — | — |
| `qwen` | Qwen | (default del CLI) | 30 min | — | — |
| `fast` | Pi CLI | MiniMax-M3 | 3 min | — | — |

`—` significa que el perfil no declara ese techo: el único freno es el timeout total.

### Flota por rol (25)

La flota de referencia del autor. El instalador todavía no la escribe: copia a
`~/.idu/profiles.json` los perfiles que quieras usar. Cada perfil declara su `harness` y, cuando
aplica, el `provider` que lo enruta.

| Rol | Perfiles (CLI · modelo) |
| :--- | :--- |
| **Exploración** (3) | `explore-deepseek` (mcode · DeepSeek V4 Flash) · `explore-glm` (cmdc · GLM 5.3 Flash) · `explore-mimo` (opencode · MiMo 2.6 Flash) |
| **Consultas** (4) | `consult-openai` (opencode · GPT-6.1 Terra) · `consult-mimo` (cmdc · MiMo 2.6 Pro) · `consult-claude` (claude · Opus) · `consult-gemini38` (agy · Gemini 3.8 Flash) |
| **Arquitectura** (4) | `arch-claude` (claude · Opus) · `arch-sol` (opencode · GPT-6.1 Sol) · `arch-gemini` (agy · Gemini 4 Argon) · `arch-deepseek` (mcode · DeepSeek V4 Flash) |
| **Diseño** (2) | `design-opencode` (opencode · DeepSeek V4 Flash) · `design-gentle` (gentle-shell · DeepSeek V4 Flash) |
| **Iconografía** (2) | `iconographer` (mcode · GLM 5.3 Flash) · `iconographer-mimo` (opencode · MiMo 2.6 Flash) |
| **Voz** (1) | `voice-narrator` (cmdc · GLM 5.3 Flash) |
| **Música** (1) | `music-composer` (cmdc · GLM 5.3 Flash) |
| **Auditoría** (5) | `audit-claude` (claude · Opus) · `audit-gemini` (agy · Gemini 4 Argon) · `audit-deepseek` (cmdc · DeepSeek V4.1 Flash) · `audit-mimo` (cmdc · MiMo 2.6 Pro) · `audit-minimax` (cmdc · MiniMax M3.1 Flash) |
| **Trabajo** (3) | `work-glm` (gentle-shell · GLM 5.3 Flash `:high`) · `work-deepseek` (gentle-shell · DeepSeek V4 Flash `:high`) · `work-mimo` (gentle-shell · MiMo 2.6 Flash `:max`) |

**El identificador de modelo es un pass-through opaco.** El arnés no lo valida ni normaliza: lo
reenvía al CLI, que acepta lo que entienda. Por eso conviven formas distintas
(`nan/glm5.3-flash`, `custom_provider:nan/deepseek-v4-flash`, `xiaomi/mimo-v2.6-pro`) según cómo
exponga cada proveedor su catálogo. Para usar otro modelo, agrega un perfil — no hace falta tocar
código.

**El esfuerzo vive en el slug, no en un campo.** `work-glm` usa `glm5.3-flash:high`;
`work-mimo`, `mimo-v2.6-flash:max`. No hay un campo `effort` en el perfil.

**Inactividad vs. streaming.** `idleTimeoutMs` solo aplica a perfiles con `streams: true`. En un
perfil sin streaming el único freno es el timeout total: si delegas tareas largas, añade
`streams: true`.

Techos por perfil: `timeoutMs` (trabajo), `idleTimeoutMs` (silencio), `hardCapMs` (techo duro;
`0` lo desactiva).

---

## Memoria compartida (Engram)

[Engram](https://github.com/Gentleman-Programming/engram) es el pegamento de la flota: un
binario Go con SQLite + FTS5 que da **una sola memoria a todos los agentes**, expuesta por MCP.

- **Curado, no volcados.** Guarda resúmenes y decisiones, no salidas crudas de herramientas.
- **Sobrevive a la compactación.** Antes de que el contexto se reinicie, el protocolo empuja un
  resumen; la sesión siguiente lo recupera.
- **Un cerebro, muchos agentes.** Pi, Claude Code, OpenCode, Codex, Antigravity, Cursor, Windsurf
  y Command Code leen y escriben el mismo store.

```bash
engram mcp --tools=agent    # herramientas por stdio
engram tui                  # explorar sesiones, observaciones y proyectos
```

Añádelo junto a `idu-pi` en tu `mcp.json`:

```json
{
  "mcpServers": {
    "engram": { "transport": "stdio", "command": "engram", "args": ["mcp", "--tools=agent"] }
  }
}
```

**Por qué importa:** un worker de gentle-shell guarda una decisión y uno de cmdc la recupera sin
que el orquestador tenga que repetirla en el prompt. La memoria no es del modelo: es del sistema.

---

## Stack creativo: diseño, iconos, voz y música

Cuatro roles producen artefactos visuales y de audio. Todos escriben, pero acotados a su
artefacto: **el código central nunca se delega**.

| Rol | Skill | Qué produce |
| :--- | :--- | :--- |
| **Diseño** | `kanagawa-html` | UI, dashboards, benchmarks, reportes → PDF o MP4 |
| **Iconografía** | `soul-icons` | Sets SVG dibujados desde la metáfora del producto |
| **Voz** | `voice-narration` | Narración por escena con voicebox (Kokoro / Chatterbox) |
| **Música** | `music-composition` | Banda sonora compuesta por IA (Lofi Live AI) |

### Regla de decisión visual

Los modelos de video generativo renderizan mal el texto y la UI. Por eso:

- **Escena con datos legibles → código** (`kanagawa-html`): determinista, gratis, exportable.
- **Gente, producto filmado, emoción facial → footage IA** (`higgsfield-scene`).
- **Proyectos híbridos** usan ambas rutas.

### Qué garantiza la ruta de código

- **Design system Kanagawa**: paleta dark, ambient blur, partículas, serif + grotesk.
- **Motion craft de films**: springs de forma cerrada, ease por rol, "entra lento sale limpio".
- **Dataviz validado por script**: la paleta de gráficos pasa los 5 checks de colorblind-safety
  con `validate_palette.js`. El color se calcula, no se elige.
- **Export determinista**: receta de PDF (headless Chrome + `@media print`) y de MP4 (HyperFrames
  con `seek(t)` puro, sin `Math.random` ni `requestAnimationFrame` como reloj).

### Puerta de validación de audio

Los videos con narración tienen un validador ejecutable que **se niega a aprobar** lo que no
cumple:

```bash
python validar_video_audio.py --proyecto /ruta/al/video
```

Comprueba, por clip: duración declarada vs real, solapes entre voces, chasquidos de cierre y
colas audibles. Y sobre la música: que cubra el film y que exista la partitura que prueba la
autoría IA. **Código de salida 1 = no renderizar.**

### Demo

- [docs/idupi-showcase.html](docs/idupi-showcase.html) — la super-web: cámara de scroll, video del
  benchmark scrubable, veredicto.
- [docs/benchmark-harness-2026-10-30.html](docs/benchmark-harness-2026-10-30.html) — informe del
  benchmark (9 configuraciones, 3 pruebas).

---

## Configuración en clientes MCP

| Cliente | Archivo | Nota |
| :--- | :--- | :--- |
| OpenCode | `~/.config/opencode/opencode.jsonc` | Añadir `mcp_timeout` en `opencode.json` |
| Claude Code | `~/.claude/settings.json` | — |
| Command Code | `~/.commandcode/mcp.json` | — |
| Codex | `~/.codex/config.toml` | — |
| Antigravity | `~/.gemini/antigravity-cli/skills` | El instalador cubre esta ruta |

Detalle completo: [docs/mcp-server.md](docs/mcp-server.md).

---

## Comandos CLI

```bash
pnpm run cli status                 # CLIs detectados y salud
pnpm run cli capabilities           # perfiles en JSON
pnpm run cli capabilities --quota   # añade la cuota de cada cuenta
pnpm run cli preflight "tarea" --cwd "C:/ruta/proyecto"
pnpm run cli delegate "auditar X" --profile audit-claude
pnpm run cli arbitrate --option "a:desc" --option "b:desc" --state "contexto"
node dist/src/cli.js wait <run_id> --timeout 540000
pnpm run mcp                        # servidor MCP por stdio
```

`preflight` acepta `--cwd` (o `--working-dir`) y `--expected-files a,b`. Sin `--cwd` audita el
directorio actual.

---

## Pruebas y construcción

```bash
pnpm run build          # compilar TypeScript
pnpm test               # suite unitaria aislada
pnpm run verify         # suite + guardas de deriva e higiene
```

| Script | Qué comprueba |
| :--- | :--- |
| `pnpm test` | Suite completa contra un `IDU_HOME` temporal: arnés cross-cli, ciclo de vida, locks, watchdog, arbitraje, contrato de las 14 herramientas y capa de cuota |
| `pnpm run test:guarded` | La misma suite, fallando si los tests dejan archivos en el temp |
| `pnpm run test:protocol-drift` | Que el SKILL.md documente exactamente las 14 herramientas canónicas |
| `pnpm run test:protocol-params` | Que los parámetros documentados existan en el código |
| `pnpm run test:protocol-install` | Que el instalador de la skill esté correcto |
| `pnpm run test:repo-hygiene` | Que las pruebas no filtren estado a la raíz del repo |

### `IDU_HOME`

Todo el estado —ledger de decisiones, caché de cuota, árbol de sesiones, locks y logs— vive bajo
`~/.idu`. `IDU_HOME` redirige esa raíz:

```bash
IDU_HOME=/tmp/idu-sandbox pnpm run cli -- status
```

`pnpm test` la usa siempre, contra un directorio temporal. Sin eso, cada corrida escribía en tu
ledger real y la numeración de decisiones mostraba huecos.

**Alcance:** `IDU_HOME` cubre `~/.idu` y nada más. Los auth stores de los CLIs
(`~/.codex/auth.json`, `~/.commandcode/auth.json`) viven fuera y no se pueden redirigir. Por eso
`include_quota` es opt-in y pasa por una caché de 10 minutos.

---

## Gobernanza

| Regla | Alcance |
| :--- | :--- |
| **Modificar un perfil existente** | Libre: modelo, proveedor, descripción |
| **Crear un rol o perfil nuevo** | Requiere aprobación explícita del usuario |
| **Escalar un rol** | Añadir otra alternativa CLI/modelo **dentro** del rol, nunca un rol nuevo |
| **Un worker no delega** | Convención, no frontera: la identidad la declara el propio worker |
| **Rama protegida** | Issue + rama `feat/` o `fix/` + PR con label + CI verde |

El protocolo operativo completo está en
[.agents/skills/idu-pi-parent-protocol/SKILL.md](.agents/skills/idu-pi-parent-protocol/SKILL.md).

---

## Documentación

| Documento | Contenido |
| :--- | :--- |
| [AGENTS.md](AGENTS.md) | Puntero de entrada para cualquier orquestador |
| [SECURITY.md](SECURITY.md) | Alcance real de la ONE ORCHESTRATOR RULE y sus límites |
| [docs/architecture.md](docs/architecture.md) | Arquitectura vigente |
| [docs/mcp-server.md](docs/mcp-server.md) | Configuración por cliente |
| [openspec/](openspec/) | Intención canónica: propuestas, specs y criterios de aceptación |

---

<details>
<summary><strong>Historia del proyecto</strong></summary>

Todo el código heredado previo (bot de Telegram, 78 herramientas obsoletas, AgentLab, Plan
Maestro y cron loops) fue retirado en dos pasos: el commit `92f8380` y la purga de vestigios que
borró los 15 perfiles de `config/profiles/` y los 14 scripts del cron `supervisor-tick`. Su
código vive en el tag `legacy-archive-pre-purge` y ya no ocupa el árbol de trabajo.

> **Nombre de la carpeta.** El repositorio se llama `idu-cross-cli` (mismo `name` del
> `package.json`). Si tu clon todavía vive en un directorio llamado `pi-telegram-bridge`, es un
> nombre histórico: renómbralo y actualiza la ruta absoluta de tu cliente MCP.

</details>

<details>
<summary><strong>Novedades v2.3.0</strong></summary>

1. **Flota por roles**: perfiles agrupados en nueve roles con alternativas por rol.
2. **`replaceDefaults`**: `~/.idu/profiles.json` puede declararse como la lista completa.
3. **cmdc `--yolo` siempre**: en modo print, Command Code bloquea `shell_command` sin ese flag y
   abortaba el run con `permission_denied` incluso en perfiles read-only.
4. **Protocolo v2.3.0**: skill reescrita tras auditoría cruzada de cuatro modelos — fronteras de
   rol explícitas, gobernanza inequívoca y orden real del arbitraje.
5. **Instalación en Antigravity**: el instalador cubre `~/.gemini/antigravity-cli/skills`.
6. **Perfiles curados**: instalación de referencia sin los 16 heredados de benchmarks.

</details>

<details>
<summary><strong>Novedades v2.1.0</strong></summary>

1. **Watchdog adaptativo por inactividad**: monitorea el streaming de `stdout`/`stderr`; el
   worker nunca se corta mientras siga emitiendo actividad. Preserva salida parcial y `resumeHint`.
2. **Techos extendidos**: hasta 4 horas por perfil, o ilimitado con `hardCapMs = 0`.
3. **Terminación de procesos en Windows**: `taskkill /PID /T /F` elimina el árbol completo sin
   dejar procesos huérfanos.
4. **`idu_worker_wait`**: espera asíncrona no destructiva.
5. **Tríada de sesiones**: `--session-id`, `--resume` y `--fork` con afinidad de harness y turnos
   transaccionales.
6. **Codex CLI**: `codex exec --dangerously-bypass-approvals-and-sandbox --json`.
7. **Evaluación multirepositorio**: `working_dir`/`cwd` en preflight y postflight.

</details>
