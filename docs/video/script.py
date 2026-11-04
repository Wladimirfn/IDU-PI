# Guion del video de presentación de IDU-PI.
# Cada escena es una lista de frases. Cada frase se sintetiza por separado, así
# las animaciones pueden engancharse al inicio exacto de cada frase (cue).

SCENES = [
    ("intro", [
        "Esto es IDU-PI.",
        "No es otro chat de inteligencia artificial.",
        "Es el arnés que orquesta terminales de IA reales.",
    ]),
    ("problema", [
        "Hoy trabajamos con muchos agentes de terminal:",
        "Claude Code, OpenCode, Codex, Antigravity, Kimi, Qwen, Command Code...",
        "Cada uno trae su propio arnés: sus reglas, su memoria, sus permisos.",
        "Y saltar entre ellos a mano significa repetir contexto, perder el hilo, y aceptar cambios sin pruebas.",
    ]),
    ("dato", [
        "Y hay algo más: el arnés cambia el resultado.",
        "En nuestro benchmark, la misma tarea, con el mismo modelo,",
        "tardó veintiocho segundos y medio en un arnés,",
        "y sesenta y cuatro en otro.",
        "Con los mismos trece de trece tests aprobados.",
    ]),
    ("tesis", [
        "De ahí nace la tesis de IDU-PI:",
        "ningún modelo gana en todo, y el arnés pesa más que el modelo.",
        "Así que, en vez de elegir uno, el sistema asigna cada tarea al arnés que mejor la resuelve.",
    ]),
    ("pilares", [
        "IDU-PI hace tres cosas.",
        "Delega.",
        "Audita.",
        "Y arbitra.",
    ]),
    ("delega", [
        "Delega a terminales reales, organizadas en una flota por roles:",
        "exploración, consultas, arquitectura, auditoría, trabajo, diseño, iconografía, voz y música.",
        "Nueve roles y veinticinco perfiles,",
        "con sesiones reanudables, bloqueos de concurrencia, y un watchdog adaptativo que vigila a cada worker.",
    ]),
    ("audita", [
        "Audita cada cambio.",
        "Antes de tocar código, el preflight mide el riesgo y el radio de impacto.",
        "Después, el postflight compara los cambios reales contra los esperados.",
        "Y cada decisión queda registrada en un ledger durable.",
        "IDU-PI se niega a dar por bueno un cambio sin evidencia.",
    ]),
    ("arbitra", [
        "Y arbitra decisiones autónomas con un motor de tres capas:",
        "Kev, un modelo local en GPU;",
        "Jev, en la nube;",
        "y si ninguno responde, un respaldo determinista Risk-First, a costo cero.",
    ]),
    ("regla", [
        "Todo bajo una regla: un solo orquestador.",
        "Los workers exploran, consultan y auditan, pero nunca vuelven a delegar.",
        "Así no hay bucles que quemen tokens, y el código central siempre lo implementa el orquestador.",
    ]),
    ("memoria", [
        "Y todos comparten una sola memoria, con Engram.",
        "Un worker guarda una decisión, y otro la recupera sin que nadie tenga que repetirla.",
        "La memoria no es del modelo: es del sistema.",
    ]),
    ("benchmark", [
        "Los resultados están medidos.",
        "Nueve configuraciones, tres pruebas con tests ocultos, ciento veintisiete de ciento treinta y tres tests superados,",
        "y cero cortes de comunicación en unos setenta runs.",
        "Y las diferencias de costo son enormes: para los mismos bugs, un arnés gastó ciento dos mil tokens, y otro, quinientos ochenta mil.",
    ]),
    ("porque", [
        "¿Por qué IDU-PI?",
        "Porque usas el mejor arnés para cada tarea.",
        "Porque ahorras tokens y tiempo.",
        "Porque cada cambio llega con evidencia.",
        "Porque no te casas con un solo proveedor.",
        "Y porque se conecta por MCP, con catorce herramientas, a cualquier cliente compatible.",
    ]),
    ("empezar", [
        "Empezar es simple:",
        "clona el repositorio, instala con pnpm y compila,",
        "ejecuta el instalador,",
        "y el arnés detecta solo qué terminales tienes.",
    ]),
    ("cierre", [
        "IDU-PI.",
        "Muchos agentes, un solo orquestador, y cero cambios sin evidencia.",
        "El enlace al repositorio está en la descripción.",
    ]),
]

# Re-escrituras fonéticas solo para la voz (los subtítulos usan el texto original).
SAY = [
    ("IDU-PI", "Idu Pi"),
    ("Claude Code", "Clod Cod"),
    ("OpenCode", "Ópen Cod"),
    ("Command Code", "Comand Cod"),
    ("Codex", "Códex"),
    ("Antigravity", "Antigráviti"),
    ("Qwen", "Chuén"),
    ("benchmark", "bénchmark"),
    ("tests", "tests"),
    ("watchdog", "uátchdog"),
    ("workers", "uórkers"),
    ("worker", "uórker"),
    ("preflight", "prifláit"),
    ("postflight", "postfláit"),
    ("ledger", "léyer"),
    ("GPU", "ge pe u"),
    ("Risk-First", "risk ferst"),
    ("tokens", "tóquens"),
    ("runs", "rans"),
    ("Engram", "Éngram"),
    ("MCP", "eme ce pe"),
    ("pnpm", "pe ene pe eme"),
    ("IA", "i a"),
]


def to_speech(text: str) -> str:
    for a, b in SAY:
        text = text.replace(a, b)
    return text
