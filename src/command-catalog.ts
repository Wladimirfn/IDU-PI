export type TelegramCommandEntry = {
	command: string;
	description: string;
	help: string;
	usage?: string[];
};

export type LocalCommandEntry = {
	label: string;
	command: string;
};

export type TelegramApiCommand = {
	command: string;
	description: string;
};

export const TELEGRAM_COMMANDS: TelegramCommandEntry[] = [
	{
		command: "help",
		description: "Mostrar ayuda",
		help: "/help - mostrar ayuda y comandos principales",
	},
	{
		command: "comandos",
		description: "Ver comandos Telegram, CLI, Batch y PowerShell",
		help: "/comandos - ver comandos con argumentos y comandos locales",
	},
	{
		command: "status",
		description: "Ver estado del agente activo",
		help: "/status - ver estado RPC",
	},
	{
		command: "dashboard",
		description: "Ver panel operativo del bridge",
		help: "/dashboard - panel operativo",
	},
	{
		command: "idu_menu",
		description: "Abrir menú remoto guiado",
		help: "/idu_menu - abrir botones remotos del mismo CLI/supervisor",
		usage: ["/idu_menu"],
	},
	{
		command: "idu_projects",
		description: "Cambiar proyecto remoto",
		help: "/idu_projects - listar proyectos enrolados y activarlos con botones",
		usage: ["/idu_projects"],
	},
	{
		command: "idu",
		description: "Activar guardrails Idu-pi",
		help: "/idu - activar guardrails automáticos y ver conexión del proyecto activo",
		usage: ["/idu"],
	},
	{
		command: "idu_off",
		description: "Apagar guardrails Idu-pi",
		help: "/idu_off - desactivar guardrails automáticos para el proyecto activo",
		usage: ["/idu_off"],
	},
	{
		command: "idu_status",
		description: "Ver modo Idu-pi",
		help: "/idu_status - mostrar active/inactive, projectId, activatedAt y guardrails",
		usage: ["/idu_status"],
	},
	{
		command: "idu_prepare",
		description: "Preparar proyecto con Idu-pi",
		help: "/idu_prepare - ejecutar preparación segura del proyecto sin aplicar flows ni AgentLabs",
		usage: ["/idu_prepare"],
	},
	{
		command: "idu_supervisor_tick",
		description: "Ejecutar supervisor Idu-pi",
		help: "/idu_supervisor_tick - observar/auditar/compactar/proponer tareas de forma segura si /idu está activo",
		usage: ["/idu_supervisor_tick"],
	},
	{
		command: "idu_alerts_status",
		description: "Ver alertas autónomas Idu-pi",
		help: "/idu_alerts_status - ver estado, decisiones y honestidad cruda de alertas autónomas",
		usage: ["/idu_alerts_status"],
	},
	{
		command: "idu_alerts_tick",
		description: "Evaluar alertas Idu-pi",
		help: "/idu_alerts_tick - evaluar alertas en modo lectura; no crea tareas por Telegram en v2",
		usage: ["/idu_alerts_tick"],
	},
	{
		command: "idu_alerts_pause",
		description: "Pausar alertas Idu-pi",
		help: "/idu_alerts_pause - pausar alertas autónomas sin apagar todo Idu-pi",
		usage: ["/idu_alerts_pause", "/idu_alerts_pause 60"],
	},
	{
		command: "idu_alerts_resume",
		description: "Reanudar alertas Idu-pi",
		help: "/idu_alerts_resume - reanudar alertas autónomas pausadas",
		usage: ["/idu_alerts_resume"],
	},
	{
		command: "idu_alerts_off",
		description: "Apagar alertas Idu-pi",
		help: "/idu_alerts_off - desactivar alertas autónomas; /idu_off sigue siendo corte global",
		usage: ["/idu_alerts_off"],
	},
	{
		command: "idu_alerts_on",
		description: "Encender alertas Idu-pi",
		help: "/idu_alerts_on - activar alertas autónomas si Idu-pi está activo",
		usage: ["/idu_alerts_on"],
	},
	{
		command: "idu_master_plan_status",
		description: "Ver Plan Maestro",
		help: "/idu_master_plan_status - ver estado del Plan Maestro Idu-pi",
		usage: ["/idu_master_plan_status"],
	},
	{
		command: "idu_master_plan_review",
		description: "Revisar Plan Maestro",
		help: "/idu_master_plan_review [latest|ruta] - mostrar Plan Maestro sin aplicarlo",
		usage: ["/idu_master_plan_review latest"],
	},
	{
		command: "idu_master_plan_approve",
		description: "Aprobar Plan Maestro",
		help: "/idu_master_plan_approve [latest|ruta] - aprobar Plan Maestro sin aplicar flows",
		usage: ["/idu_master_plan_approve latest"],
	},
	{
		command: "idu_master_plan_reject",
		description: "Rechazar Plan Maestro",
		help: "/idu_master_plan_reject [latest|ruta] [motivo] - rechazar Plan Maestro sin borrar drafts",
		usage: ["/idu_master_plan_reject latest objetivo incompleto"],
	},
	{
		command: "idu_master_plan_redraft",
		description: "Rehacer Plan Maestro",
		help: "/idu_master_plan_redraft [motivo] - crear nuevo draft determinista sin borrar anteriores",
		usage: ["/idu_master_plan_redraft falta contexto"],
	},
	{
		command: "agentlab_request_create",
		description: "Crear solicitud AgentLab",
		help: "/agentlab_request_create [postflight|master-plan latest|skill-draft latest] - crear solicitudes formales sin ejecutar AgentLabs",
		usage: [
			"/agentlab_request_create postflight",
			"/agentlab_request_create master-plan latest",
			"/agentlab_request_create skill-draft latest",
		],
	},
	{
		command: "agentlab_request_review",
		description: "Revisar solicitud AgentLab",
		help: "/agentlab_request_review [latest|ruta] - validar solicitudes AgentLab sin ejecutarlas",
		usage: [
			"/agentlab_request_review latest",
			"/agentlab_request_review <ruta>",
		],
	},
	{
		command: "agentlab_review_run",
		description: "Ejecutar revisión AgentLab",
		help: "/agentlab_review_run [latest|ruta] - ejecutar revisión AgentLab review-only en workspace clone",
		usage: ["/agentlab_review_run latest", "/agentlab_review_run <ruta>"],
	},
	{
		command: "agentlab_review_status",
		description: "Ver informe AgentLab",
		help: "/agentlab_review_status [latest|ruta] - ver informe consolidado sin escribir archivos",
		usage: ["/agentlab_review_status latest", "/agentlab_review_status <ruta>"],
	},
	{
		command: "agentlab_report_consolidate",
		description: "Consolidar informe AgentLab",
		help: "/agentlab_report_consolidate [latest|ruta] - consolidar hallazgos y candidates sin aplicar cambios",
		usage: [
			"/agentlab_report_consolidate latest",
			"/agentlab_report_consolidate <ruta>",
		],
	},
	{
		command: "agentlab_report_status",
		description: "Ver consolidación AgentLab",
		help: "/agentlab_report_status [latest|ruta] - ver consolidación AgentLab sin aplicar cambios",
		usage: ["/agentlab_report_status latest", "/agentlab_report_status <ruta>"],
	},
	{
		command: "semantic_audit_status",
		description: "Ver auditoría semántica",
		help: "/semantic_audit_status - revisar conteos, checkpoint y decisión de auditoría semántica sin IA",
		usage: ["/semantic_audit_status"],
	},
	{
		command: "semantic_audit_run",
		description: "Registrar auditoría semántica manual",
		help: "/semantic_audit_run - registrar auditoría semántica manual sin compactar, borrar ni ejecutar AgentLabs",
		usage: ["/semantic_audit_run"],
	},
	{
		command: "semantic_compact_draft",
		description: "Crear draft de compactación semántica",
		help: "/semantic_compact_draft - crear borrador supervisado sin aplicar reglas ni ejecutar AgentLabs",
		usage: ["/semantic_compact_draft"],
	},
	{
		command: "semantic_compact_review",
		description: "Revisar draft de compactación semántica",
		help: "/semantic_compact_review [latest|ruta] - revisar borrador sin aplicar memoria ni reglas",
		usage: [
			"/semantic_compact_review latest",
			"/semantic_compact_review <ruta>",
		],
	},
	{
		command: "semantic_agent_tasks_review",
		description: "Revisar tareas AgentLab sugeridas",
		help: "/semantic_agent_tasks_review [latest|ruta] - ver tareas review desde compactación sin escribir cola",
		usage: [
			"/semantic_agent_tasks_review latest",
			"/semantic_agent_tasks_review <ruta>",
		],
	},
	{
		command: "semantic_agent_tasks_create",
		description: "Crear tareas review semánticas",
		help: "/semantic_agent_tasks_create [latest|ruta] - registrar tareas review sin ejecutar AgentLabs",
		usage: [
			"/semantic_agent_tasks_create latest",
			"/semantic_agent_tasks_create <ruta>",
		],
	},
	{
		command: "supervisor_improvements_review",
		description: "Revisar mejoras del supervisor",
		help: "/supervisor_improvements_review [latest|ruta] - ver propuestas de mejora sin aplicar reglas, skills ni Project Core",
		usage: [
			"/supervisor_improvements_review latest",
			"/supervisor_improvements_review <ruta>",
		],
	},
	{
		command: "supervisor_improvements_create",
		description: "Crear propuestas review-only",
		help: "/supervisor_improvements_create [latest|ruta] - guardar propuestas en reports sin mutar código ni ejecutar AgentLabs",
		usage: [
			"/supervisor_improvements_create latest",
			"/supervisor_improvements_create <ruta>",
		],
	},
	{
		command: "supervisor_improvements_status",
		description: "Ver decisiones de mejoras",
		help: "/supervisor_improvements_status [latest|ruta] - ver conteos y estados sin aplicar mejoras",
		usage: [
			"/supervisor_improvements_status latest",
			"/supervisor_improvements_status <ruta>",
		],
	},
	{
		command: "supervisor_improvements_approve",
		description: "Aprobar mejora propuesta",
		help: "/supervisor_improvements_approve latest <proposalId|all> - registrar aprobación humana sin aplicar cambios",
		usage: ["/supervisor_improvements_approve latest improvement-001"],
	},
	{
		command: "supervisor_improvements_reject",
		description: "Rechazar mejora propuesta",
		help: "/supervisor_improvements_reject latest <proposalId|all> [motivo] - registrar rechazo sin borrar propuestas",
		usage: ["/supervisor_improvements_reject latest improvement-001 no aplica"],
	},
	{
		command: "supervisor_improvements_defer",
		description: "Diferir mejora propuesta",
		help: "/supervisor_improvements_defer latest <proposalId|all> [motivo] - registrar diferido sin aplicar cambios",
		usage: [
			"/supervisor_improvements_defer latest improvement-001 requiere evidencia",
		],
	},
	{
		command: "supervisor_improvements_apply",
		description: "Aplicar reglas dinámicas aprobadas",
		help: "/supervisor_improvements_apply [latest|ruta] - crear reglas dinámicas sólo desde propuestas aprobadas",
		usage: ["/supervisor_improvements_apply latest"],
	},
	{
		command: "skill_improvements_review",
		description: "Revisar mejoras de skills",
		help: "/skill_improvements_review [latest|ruta] - ver propuestas de skills sin modificar .agents/.atl ni ejecutar AgentLabs",
		usage: [
			"/skill_improvements_review latest",
			"/skill_improvements_review <ruta>",
		],
	},
	{
		command: "skill_improvements_create",
		description: "Crear propuestas de skills",
		help: "/skill_improvements_create [latest|ruta] - guardar propuestas de skills en reports sin modificar skills",
		usage: [
			"/skill_improvements_create latest",
			"/skill_improvements_create <ruta>",
		],
	},
	{
		command: "skill_improvements_status",
		description: "Ver propuestas de skills",
		help: "/skill_improvements_status [latest|ruta] - ver conteos y estados de propuestas de skills",
		usage: [
			"/skill_improvements_status latest",
			"/skill_improvements_status <ruta>",
		],
	},
	{
		command: "skill_improvements_approve",
		description: "Aprobar propuesta de skill",
		help: "/skill_improvements_approve latest <proposalId|all> - registrar aprobación humana sin modificar skills",
		usage: ["/skill_improvements_approve latest skill-improvement-001"],
	},
	{
		command: "skill_improvements_reject",
		description: "Rechazar propuesta de skill",
		help: "/skill_improvements_reject latest <proposalId|all> [motivo] - registrar rechazo sin modificar skills",
		usage: [
			"/skill_improvements_reject latest skill-improvement-001 no aplica",
		],
	},
	{
		command: "skill_improvements_defer",
		description: "Diferir propuesta de skill",
		help: "/skill_improvements_defer latest <proposalId|all> [motivo] - registrar diferido sin modificar skills",
		usage: [
			"/skill_improvements_defer latest skill-improvement-001 requiere evidencia",
		],
	},
	{
		command: "skill_drafts_create",
		description: "Crear drafts de skills",
		help: "/skill_drafts_create [latest|ruta] - crear borradores de skills desde propuestas aprobadas sin modificar skills reales",
		usage: ["/skill_drafts_create latest", "/skill_drafts_create <ruta>"],
	},
	{
		command: "skill_drafts_review",
		description: "Revisar draft de skill",
		help: "/skill_drafts_review [latest|ruta] - revisar borrador de skill sin aplicar cambios",
		usage: ["/skill_drafts_review latest", "/skill_drafts_review <ruta>"],
	},
	{
		command: "supervisor_learning_rules_status",
		description: "Ver reglas dinámicas",
		help: "/supervisor_learning_rules_status - ver supervisor-learning-rules.json sin modificar nada",
		usage: ["/supervisor_learning_rules_status"],
	},
	{
		command: "supervisor_learning_rules_test",
		description: "Probar reglas dinámicas",
		help: "/supervisor_learning_rules_test - probar reglas contra casos internos sin escribir archivos",
		usage: ["/supervisor_learning_rules_test"],
	},
	{
		command: "supervisor_rules_disable",
		description: "Desactivar regla dinámica",
		help: "/supervisor_rules_disable <ruleId> [motivo] - desactivar regla y crear backup",
		usage: ["/supervisor_rules_disable learn-improvement-001 ruidosa"],
	},
	{
		command: "supervisor_learning_rules_enable",
		description: "Reactivar regla dinámica",
		help: "/supervisor_learning_rules_enable <ruleId> [motivo] - reactivar regla y crear backup",
		usage: ["/supervisor_learning_rules_enable learn-improvement-001 validada"],
	},
	{
		command: "supervisor_rules_rollback",
		description: "Restaurar backup de reglas",
		help: "/supervisor_rules_rollback latest - restaurar último backup validado",
		usage: ["/supervisor_rules_rollback latest"],
	},
	{
		command: "idu_define_project",
		description: "Definir Project Core manual",
		help: "/idu_define_project - iniciar wizard manual para crear config/project-core.json draft",
		usage: ["/idu_define_project"],
	},
	{
		command: "idu_core_status",
		description: "Ver estado Project Core",
		help: "/idu_core_status - ver si existe Project Core local, status, resumen y preguntas abiertas",
		usage: ["/idu_core_status"],
	},
	{
		command: "idu_research_core",
		description: "Generar research draft Project Core",
		help: "/idu_research_core - pedir a IA un borrador de investigación técnica basado en Project Core",
		usage: ["/idu_research_core"],
	},
	{
		command: "idu_review_core_research",
		description: "Revisar research draft Project Core",
		help: "/idu_review_core_research [latest|ruta] - revisar borrador IA sin aplicar decisiones",
		usage: [
			"/idu_review_core_research latest",
			"/idu_review_core_research <ruta>",
		],
	},
	{
		command: "idu_confirm_core",
		description: "Confirmar Project Core",
		help: "/idu_confirm_core [latest_research|ruta] - confirmar Project Core como verdad humana",
		usage: ["/idu_confirm_core", "/idu_confirm_core latest_research"],
	},
	{
		command: "idu_reject_core",
		description: "Rechazar Project Core",
		help: "/idu_reject_core [motivo] - marcar Project Core como draft/stale sin borrarlo",
		usage: ["/idu_reject_core alcance incompleto"],
	},
	{
		command: "idu_core_diff",
		description: "Comparar Project Core",
		help: "/idu_core_diff - ver campos completos, faltantes y research disponible",
		usage: ["/idu_core_diff"],
	},
	{
		command: "preflight",
		description: "Analizar riesgo antes de cambios",
		help: "/preflight <solicitud> - analizar riesgo, contexto faltante y siguiente acción",
		usage: ["/preflight <solicitud>"],
	},
	{
		command: "advisory",
		description: "Volante corto de riesgo Idu-pi",
		help: "/advisory <solicitud> - generar advisory corto y accionable",
		usage: ["/advisory <solicitud>"],
	},
	{
		command: "postflight",
		description: "Revisar impacto de cambios locales",
		help: "/postflight - analizar cambios locales e impacto en flujos, DB y orquestación",
		usage: ["/postflight"],
	},
	{
		command: "lab_review_plan",
		description: "Preparar revisión AgentLab",
		help: "/lab_review_plan [postflight|preflight <solicitud>] - preparar tarea de revisión sin ejecutar AgentLabs",
		usage: [
			"/lab_review_plan",
			"/lab_review_plan postflight",
			"/lab_review_plan preflight <solicitud>",
		],
	},
	{
		command: "server",
		description: "Controlar bridge y sesión Pi",
		help: "/reset o /server restart - reiniciar bridge completo; /server status - ver estado; /server off - apagar bridge",
		usage: ["/server status", "/server run", "/server restart", "/server off"],
	},
	{
		command: "reset",
		description: "Reiniciar bridge completo",
		help: "/reset - reiniciar bridge completo y avisar al volver",
		usage: ["/reset"],
	},
	{
		command: "review",
		description: "Revisar cambios actuales",
		help: "/review - revisar cambios",
	},
	{
		command: "fix_tests",
		description: "Correr tests y arreglar fallas",
		help: "/fix_tests - arreglar tests",
	},
	{
		command: "audit",
		description: "Auditar repo",
		help: "/audit - auditar repo",
	},
	{
		command: "safe_push",
		description: "Checklist seguro antes de push",
		help: "/safe_push - checklist seguro antes de push",
	},
	{
		command: "task",
		description: "Crear tarea guiada",
		help: "/task bug|feature|refactor|docs - plantilla de tarea",
		usage: [
			"/task bug <detalle>",
			"/task feature <detalle>",
			"/task refactor <detalle>",
			"/task docs <detalle>",
		],
	},
	{
		command: "queue",
		description: "Ver cola de tareas",
		help: "/queue - ver cola",
	},
	{
		command: "queue_detail",
		description: "Ver cola estructurada",
		help: "/queue_detail - ver cola estructurada",
		usage: ["/queue_detail"],
	},
	{
		command: "queue_clear",
		description: "Limpiar cola de tareas",
		help: "/queue_clear - limpiar cola",
	},
	{
		command: "queue_clear_structured",
		description: "Limpiar cola estructurada persistida",
		help: "/queue_clear_structured - limpiar solo reports/tasks.jsonl",
		usage: ["/queue_clear_structured"],
	},
	{
		command: "queue_approve",
		description: "Aprobar tarea en cola pausada",
		help: "/queue_approve <id> - aprobar y ejecutar tarea pausada por guard",
		usage: ["/queue_approve task-abc"],
	},
	{
		command: "queue_reject",
		description: "Rechazar tarea en cola pausada",
		help: "/queue_reject <id> - rechazar tarea pausada por guard",
		usage: ["/queue_reject task-abc"],
	},
	{
		command: "config",
		description: "Configuración guiada del proyecto",
		help: "/config [doctor|init_workspace|init_assets|init_project_config|inspect_project_map|scan_project_map|suggest_project_flows|draft_project_flows|review_project_flows_draft|apply_project_flows_draft|ai_draft_project_blueprint|ai_draft_project_flows|review_ai_blueprint_draft|review_ai_flows_draft|skills_sync|db_init|sync_commands] - configuración guiada del bridge/proyecto",
		usage: [
			"/config",
			"/config doctor",
			"/config init_workspace",
			"/config init_assets",
			"/config init_project_config",
			"/config inspect_project_map",
			"/config scan_project_map",
			"/config suggest_project_flows",
			"/config draft_project_flows",
			"/config review_project_flows_draft",
			"/config apply_project_flows_draft <ruta>",
			"/config ai_draft_project_blueprint",
			"/config ai_draft_project_flows",
			"/config review_ai_blueprint_draft latest",
			"/config review_ai_flows_draft latest",
			"/config skills_sync",
			"/config db_init",
			"/config sync_commands",
		],
	},
	{
		command: "doctor",
		description: "Diagnosticar configuración local",
		help: "/doctor - diagnosticar configuración local",
	},
	{
		command: "agents",
		description: "Elegir agente o modelo",
		help: "/agents - elegir agente/modelo",
	},
	{
		command: "model",
		description: "Alias informativo para agents",
		help: "/model - alias informativo para /agents",
	},
	{
		command: "testlab",
		description: "Ejecutar lab en agentes clone",
		help: "/testlab [profundidad] - tests en agentes lab",
		usage: [
			"/testlab quick",
			"/testlab 3tests",
			"/testlab 5tests",
			"/testlab full",
		],
	},
	{
		command: "testlab1",
		description: "Explicar agente 1 sin lab",
		help: "/testlab1 - explicar por qué agente 1 no usa lab",
	},
	{
		command: "testlab2",
		description: "Ejecutar lab en agente 2",
		help: "/testlab2 [profundidad] - tests en agente 2",
		usage: ["/testlab2 quick", "/testlab2 3tests"],
	},
	{
		command: "testlab3",
		description: "Ejecutar lab en agente 3",
		help: "/testlab3 [profundidad] - tests en agente 3",
		usage: ["/testlab3 quick", "/testlab3 3tests"],
	},
	{
		command: "gentest_model_lab",
		description: "Elegir agente lab",
		help: "/gentest_model_lab - elegir agente lab y profundidad",
	},
	{
		command: "triagereports",
		description: "Evaluar reportes lab",
		help: "/triagereports - evaluar reportes lab",
	},
	{
		command: "reports",
		description: "Listar reportes lab",
		help: "/reports - listar reportes lab",
	},
	{
		command: "report",
		description: "Ver o decidir reporte lab",
		help: "/report <id> - ver/decidir reporte lab",
		usage: [
			"/report <id>",
			"/report <id> defer",
			"/report <id> work",
			"/report <id> ignore",
			"/report <id> save",
		],
	},
	{
		command: "syncreports",
		description: "Guardar reportes aprobados",
		help: "/syncreports - guardar decisiones aprobadas en Engram",
	},
	{
		command: "projects",
		description: "Listar proyectos guardados",
		help: "/projects - listar proyectos guardados",
	},
	{
		command: "where",
		description: "Ver proyecto activo",
		help: "/where - ver proyecto activo",
	},
	{
		command: "addproject",
		description: "Agregar proyecto autorizado",
		help: "/addproject <id> <ruta> - agregar proyecto",
		usage: ["/addproject <id> <ruta>"],
	},
	{
		command: "useproject",
		description: "Cambiar proyecto activo",
		help: "/useproject <id> - cambiar proyecto activo",
		usage: ["/useproject <id>"],
	},
	{
		command: "cwd",
		description: "Cambiar carpeta activa",
		help: "/cwd <ruta> - cambiar carpeta/proyecto activo",
		usage: ["/cwd <ruta>"],
	},
	{
		command: "new",
		description: "Alias de cwd",
		help: "/new <ruta> - alias de /cwd",
		usage: ["/new <ruta>"],
	},
	{
		command: "trabajos",
		description: "Listar trabajos recientes",
		help: "/trabajos - elegir trabajo reciente",
		usage: ["/trabajos", "/trabajos all"],
	},
	{
		command: "work",
		description: "Alias de trabajos",
		help: "/work - alias de /trabajos",
	},
	{
		command: "ver",
		description: "Ver preview de trabajo",
		help: "/ver T<n> - ver preview del trabajo",
		usage: ["/ver T1"],
	},
	{
		command: "nametrabajo",
		description: "Nombrar trabajo",
		help: "/nametrabajo T<n> <nombre> - nombrar trabajo",
		usage: ["/nametrabajo T1 <nombre>"],
	},
	{
		command: "resume",
		description: "Retomar trabajo",
		help: "/resume T<n> - retomar trabajo listado",
		usage: ["/resume T1"],
	},
	{
		command: "last",
		description: "Retomar último trabajo",
		help: "/last - retomar último trabajo del proyecto activo",
	},
	{
		command: "sessions",
		description: "Alias legacy",
		help: "/sessions - alias legacy",
	},
	{ command: "use", description: "Alias legacy", help: "/use - alias legacy" },
	{
		command: "approve",
		description: "Alias legacy",
		help: "/approve - alias legacy",
	},
	{
		command: "reject",
		description: "Alias legacy",
		help: "/reject - alias legacy",
	},
	{
		command: "resumen",
		description: "Resumir proyecto o trabajo",
		help: "/resumen [n] - resumen del proyecto o trabajo",
		usage: ["/resumen", "/resumen T1"],
	},
	{
		command: "mem",
		description: "Buscar contexto en Engram",
		help: "/mem <query> - buscar contexto en Engram vía Pi",
		usage: ["/mem <query>"],
	},
	{
		command: "mode",
		description: "Ajustar modo de orquestación",
		help: "/mode interactive|auto|clear - ajustar orquestación",
		usage: ["/mode interactive", "/mode auto", "/mode clear"],
	},
	{
		command: "cancel",
		description: "Cancelar tarea actual",
		help: "/cancel - cancelar tarea actual",
	},
];

export const CLI_COMMANDS: LocalCommandEntry[] = [
	{ label: "Instalar dependencias", command: "corepack pnpm install" },
	{ label: "Setup inicial", command: "corepack pnpm run setup" },
	{ label: "Desarrollo", command: "corepack pnpm dev" },
	{ label: "Iniciar build existente", command: "corepack pnpm start" },
	{ label: "Servicio bridge", command: "corepack pnpm serve" },
	{ label: "Compilar", command: "corepack pnpm build" },
	{ label: "Tests", command: "corepack pnpm test" },
	{ label: "Limpiar outputs", command: "corepack pnpm clean" },
	{ label: "Idu activo", command: "corepack pnpm cli -- idu" },
	{ label: "Idu status", command: "corepack pnpm cli -- idu-status" },
	{ label: "Idu off", command: "corepack pnpm cli -- idu-off" },
	{ label: "Prepare seguro", command: "corepack pnpm cli -- idu-prepare" },
	{
		label: "Plan Maestro status",
		command: "corepack pnpm cli -- idu-master-plan-status",
	},
	{
		label: "Plan Maestro review",
		command: "corepack pnpm cli -- idu-master-plan-review latest",
	},
	{
		label: "Plan Maestro approve",
		command: "corepack pnpm cli -- idu-master-plan-approve latest",
	},
	{
		label: "Plan Maestro redraft",
		command: "corepack pnpm cli -- idu-master-plan-redraft latest",
	},
	{
		label: "Source Library status",
		command: "corepack pnpm cli -- idu-source-status",
	},
	{
		label: "Source Library read",
		command: "corepack pnpm cli -- idu-source-read <source-id>",
	},
	{
		label: "Source Library extract",
		command: "corepack pnpm cli -- idu-source-extract <source-id>",
	},
	{
		label: "Source Library report",
		command: "corepack pnpm cli -- idu-source-report <source-id>",
	},
	{
		label: "Source Library research",
		command: 'corepack pnpm cli -- idu-source-research "consulta"',
	},
	{
		label: "Source Digest",
		command: "corepack pnpm cli -- idu-source-digest <source-id>",
	},
	{
		label: "Source Digest status",
		command: "corepack pnpm cli -- idu-source-digest-status",
	},
	{
		label: "Source Chunk read",
		command:
			"corepack pnpm cli -- idu-source-chunk-read <source-id> <chunk-id>",
	},
	{
		label: "Source Recommend",
		command: 'corepack pnpm cli -- idu-source-recommend "tarea"',
	},
	{
		label: "Source required actions",
		command: "corepack pnpm cli -- idu-source-required-actions",
	},
	{
		label: "Source Library remove",
		command: "corepack pnpm cli -- idu-source-remove <source-id>",
	},
	{
		label: "Source Library refresh",
		command: "corepack pnpm cli -- idu-source-refresh",
	},
	{
		label: "Idu supervisor tick",
		command: "corepack pnpm cli -- idu-supervisor-tick",
	},
	{
		label: "Idu execution director tick",
		command: "corepack pnpm cli -- idu-execution-director-tick",
	},
	{
		label: "Idu proposal outbox",
		command: "corepack pnpm cli -- idu-proposal-outbox",
	},
	{
		label: "Idu proposal detail",
		command: "corepack pnpm cli -- idu-proposal-detail <proposal-id>",
	},
	{
		label: "Idu alerts status",
		command: "corepack pnpm cli -- alerts status",
	},
	{
		label: "Idu alerts tick",
		command: "corepack pnpm cli -- alerts tick",
	},
	{
		label: "Idu alerts scheduled tick",
		command: "corepack pnpm cli -- alerts scheduled-tick",
	},
	{
		label: "Idu automaticov1 cycle",
		command: "corepack pnpm cli -- automaticov1 cycle",
	},
	{
		label: "Idu alerts pause",
		command: "corepack pnpm cli -- alerts control pause 60",
	},
	{
		label: "Idu alerts resume",
		command: "corepack pnpm cli -- alerts control resume",
	},
	{
		label: "Preflight",
		command: 'corepack pnpm cli -- idu-preflight "solicitud"',
	},
	{
		label: "Advisory",
		command: 'corepack pnpm cli -- idu-advisory "solicitud"',
	},
	{ label: "Postflight", command: "corepack pnpm cli -- idu-postflight" },
	{
		label: "Lab review plan",
		command: "corepack pnpm cli -- idu-lab-review-plan postflight",
	},
	{
		label: "Crear task",
		command: 'corepack pnpm cli -- idu-task bug "detalle"',
	},
	{ label: "Queue detail", command: "corepack pnpm cli -- idu-queue-detail" },
	{
		label: "Queue clear",
		command: "corepack pnpm cli -- idu-queue-clear-structured",
	},
	{
		label: "Queue approve",
		command: "corepack pnpm cli -- idu-queue-approve <id>",
	},
	{
		label: "Queue reject",
		command: "corepack pnpm cli -- idu-queue-reject <id>",
	},
	{
		label: "AgentLab request create",
		command: "corepack pnpm cli -- idu-agentlab-request-create postflight",
	},
	{
		label: "AgentLab request review",
		command: "corepack pnpm cli -- idu-agentlab-request-review latest",
	},
	{
		label: "AgentLab review run",
		command: "corepack pnpm cli -- idu-agentlab-review-run latest",
	},
	{
		label: "AgentLab review status",
		command: "corepack pnpm cli -- idu-agentlab-review-status latest",
	},
	{
		label: "AgentLab report consolidate",
		command: "corepack pnpm cli -- idu-agentlab-report-consolidate latest",
	},
	{
		label: "AgentLab report consolidation status",
		command:
			"corepack pnpm cli -- idu-agentlab-report-consolidation-status latest",
	},
	{
		label: "Semantic audit status",
		command: "corepack pnpm cli -- idu-semantic-audit-status",
	},
	{
		label: "Semantic audit run",
		command: "corepack pnpm cli -- idu-semantic-audit-run",
	},
	{
		label: "Semantic compact draft",
		command: "corepack pnpm cli -- idu-semantic-compact-draft",
	},
	{
		label: "Semantic compact review",
		command: "corepack pnpm cli -- idu-semantic-compact-review latest",
	},
	{
		label: "Semantic agent tasks review",
		command: "corepack pnpm cli -- idu-semantic-agent-tasks-review latest",
	},
	{
		label: "Semantic agent tasks create",
		command: "corepack pnpm cli -- idu-semantic-agent-tasks-create latest",
	},
	{
		label: "Supervisor improvements review",
		command: "corepack pnpm cli -- idu-supervisor-improvements-review latest",
	},
	{
		label: "Supervisor improvements create",
		command: "corepack pnpm cli -- idu-supervisor-improvements-create latest",
	},
	{
		label: "Supervisor improvements status",
		command: "corepack pnpm cli -- idu-supervisor-improvements-status latest",
	},
	{
		label: "Supervisor improvements approve",
		command:
			"corepack pnpm cli -- idu-supervisor-improvements-approve latest improvement-001",
	},
	{
		label: "Supervisor improvements reject",
		command:
			"corepack pnpm cli -- idu-supervisor-improvements-reject latest improvement-001 motivo",
	},
	{
		label: "Supervisor improvements defer",
		command:
			"corepack pnpm cli -- idu-supervisor-improvements-defer latest improvement-001 motivo",
	},
	{
		label: "Supervisor improvements apply",
		command: "corepack pnpm cli -- idu-supervisor-improvements-apply latest",
	},
	{
		label: "Skill improvements review",
		command: "corepack pnpm cli -- idu-skill-improvements-review latest",
	},
	{
		label: "Skill improvements create",
		command: "corepack pnpm cli -- idu-skill-improvements-create latest",
	},
	{
		label: "Skill improvements status",
		command: "corepack pnpm cli -- idu-skill-improvements-status latest",
	},
	{
		label: "Skill improvements approve",
		command:
			"corepack pnpm cli -- idu-skill-improvements-approve latest skill-improvement-001",
	},
	{
		label: "Skill improvements reject",
		command:
			"corepack pnpm cli -- idu-skill-improvements-reject latest skill-improvement-001 motivo",
	},
	{
		label: "Skill improvements defer",
		command:
			"corepack pnpm cli -- idu-skill-improvements-defer latest skill-improvement-001 motivo",
	},
	{
		label: "Skill drafts create",
		command: "corepack pnpm cli -- idu-skill-drafts-create latest",
	},
	{
		label: "Skill drafts review",
		command: "corepack pnpm cli -- idu-skill-drafts-review latest",
	},
	{
		label: "Source skill candidates create",
		command: "corepack pnpm cli -- idu-source-skill-candidates-create all",
	},
	{
		label: "Source skill candidates review",
		command: "corepack pnpm cli -- idu-source-skill-candidates-review latest",
	},
	{
		label: "Supervisor learning rules status",
		command: "corepack pnpm cli -- idu-supervisor-learning-rules-status",
	},
	{
		label: "Supervisor learning rules test",
		command: "corepack pnpm cli -- idu-supervisor-learning-rules-test",
	},
	{
		label: "Supervisor learning rules disable",
		command:
			"corepack pnpm cli -- idu-supervisor-learning-rules-disable learn-improvement-001 ruidosa",
	},
	{
		label: "Supervisor learning rules enable",
		command:
			"corepack pnpm cli -- idu-supervisor-learning-rules-enable learn-improvement-001 validada",
	},
	{
		label: "Supervisor learning rules rollback",
		command:
			"corepack pnpm cli -- idu-supervisor-learning-rules-rollback latest",
	},
];

export const BATCH_COMMANDS: LocalCommandEntry[] = [
	{ label: "Setup inicial", command: "setup-pi-telegram-bridge.bat" },
	{ label: "Iniciar bridge", command: "start-pi-telegram-bridge.bat" },
	{ label: "Apagar bridge", command: "stop-pi-telegram-bridge.bat" },
	{ label: "Instalar tarea Windows", command: "install-idu-pi-task.bat" },
	{ label: "Estado tarea Windows", command: "status-idu-pi-task.bat" },
	{ label: "Desinstalar tarea Windows", command: "uninstall-idu-pi-task.bat" },
];

export const POWERSHELL_COMMANDS: LocalCommandEntry[] = [
	{
		label: "Iniciar bridge",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-bridge.ps1",
	},
	{
		label: "Apagar bridge",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-bridge.ps1",
	},
	{
		label: "Instalar tarea Windows",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-scheduled-task.ps1",
	},
	{
		label: "Estado tarea Windows",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/scheduled-task-status.ps1",
	},
	{
		label: "Desinstalar tarea Windows",
		command:
			"powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-scheduled-task.ps1",
	},
];

export function formatHelpText(): string {
	return `Comandos:\n${TELEGRAM_COMMANDS.map((entry) => entry.help).join("\n")}\n\nDespués de /trabajos usá T1, T2...; en otros menús seguí la instrucción visible.\nPara ver usos con argumentos, CLI, Batch y PowerShell: /comandos`;
}

function telegramApiCommandEntries(): TelegramCommandEntry[] {
	return TELEGRAM_COMMANDS.filter((entry) => entry.command.length <= 32);
}

export function formatBotFatherCommands(): string {
	return telegramApiCommandEntries()
		.map((entry) => `${entry.command} - ${entry.description}`)
		.join("\n");
}

export function telegramCommandsForApi(): TelegramApiCommand[] {
	return telegramApiCommandEntries().map(({ command, description }) => ({
		command,
		description,
	}));
}

function formatLocalSection(
	title: string,
	entries: LocalCommandEntry[],
): string {
	return `${title}\n${entries.map((entry) => `- ${entry.label}: ${entry.command}`).join("\n")}`;
}

export function formatCommandCatalog(): string {
	const usage = TELEGRAM_COMMANDS.flatMap((entry) => entry.usage ?? []);
	return [
		`Telegram — /setcommands\n${formatBotFatherCommands()}`,
		`Telegram — usos con argumentos\n${usage.map((command) => `- ${command}`).join("\n")}`,
		formatLocalSection("CLI pnpm", CLI_COMMANDS),
		formatLocalSection("Batch directos", BATCH_COMMANDS),
		formatLocalSection("PowerShell directos", POWERSHELL_COMMANDS),
	].join("\n\n");
}
