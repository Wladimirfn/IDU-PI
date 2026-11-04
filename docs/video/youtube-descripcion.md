# Título sugerido

IDU-PI: el arnés que orquesta tus terminales de IA (Claude Code, OpenCode, Codex y más)

# Descripción

IDU-PI no es otro chat de IA: es el arnés que decide qué CLI, con qué modelo y bajo qué proceso resuelve cada tarea, y que se niega a dar por bueno un cambio sin evidencia.

🧩 El problema
Cada terminal de IA (Claude Code, OpenCode, Codex, Antigravity, Kimi, Qwen, Command Code…) trae su propio arnés: reglas, memoria y permisos distintos. En nuestro benchmark, la misma tarea con el mismo modelo tardó 28,5 s en un arnés y 64,3 s en otro.

💡 La tesis
Ningún modelo gana en todo, y el arnés pesa más que el modelo. IDU-PI asigna cada tarea al arnés que mejor la resuelve.

⚙️ Qué hace
• Delega: a terminales reales, con una flota de 9 roles y 25 perfiles, sesiones reanudables, locks y watchdog adaptativo.
• Audita: preflight antes de tocar código, postflight contra el blast radius esperado y un ledger durable de decisiones.
• Arbitra: motor de tres capas: Kev (local en GPU), Jev (nube) y fallback determinista Risk-First a costo cero.
• ONE ORCHESTRATOR RULE: un worker nunca vuelve a delegar.
• Memoria compartida con Engram: un cerebro, muchos agentes.
• 14 herramientas MCP para cualquier cliente compatible.

📊 Resultados medidos
9 configuraciones · 3 pruebas con tests ocultos · 127/133 tests superados · 0 cortes de comunicación en ~70 runs.

🚀 Repositorio
https://github.com/Wladimirfn/IDU-PI

⏱️ Capítulos
0:00 Qué es IDU-PI
0:10 El problema
0:30 El arnés importa
0:46 La tesis
0:59 Qué hace: Delega
1:26 Audita
1:45 Arbitra
1:58 One Orchestrator Rule
2:13 Memoria compartida
2:25 Resultados medidos
2:47 Por qué IDU-PI
3:06 Empezar
3:18 Cierre

Narración generada con voz IA (Kokoro) y música original sintetizada para este video.

# Etiquetas

idu-pi, agentes de ia, claude code, opencode, codex, mcp, orquestación de agentes, cli, inteligencia artificial, desarrollo de software, benchmark, harness
