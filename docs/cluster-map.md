# Cluster map for idu-pi MCP tools (89 tools)

> Auto-generated from `config/cluster-map.json` by `scripts/check-cluster-map-drift.mjs --emit-md`.
> Do not edit by hand. To change a cluster, edit the JSON and re-run the script.

Registered tools: **89**. Clusters: **32**.

| Cluster | Size | Tools |
|---|---:|---|
| `advisory` | 4 | `idu_ack_advisory`, `idu_advisory`, `idu_bibliotecario_proactive_advisory`, `idu_next_advisory_action` |
| `agentlab` | 3 | `idu_agentlab_request_create`, `idu_agentlab_review_run`, `idu_agentlab_review_status` |
| `alerts` | 3 | `idu_autonomous_alerts_control`, `idu_autonomous_alerts_status`, `idu_autonomous_alerts_tick` |
| `bibliotecario` | 1 | `idu_bibliotecario_init` |
| `birth` | 8 | `idu_birth_bibliotecario_discovery`, `idu_birth_existing_scan`, `idu_birth_general_spec`, `idu_birth_general_spec_derive`, `idu_birth_prototype_master`, `idu_birth_repo_plan`, `idu_birth_status`, `idu_birth_validate` |
| `continuation` | 1 | `idu_continuation_proposal` |
| `cron` | 1 | `idu_supervisor_cron_plan` |
| `cycle` | 3 | `idu_automaticov1_cycle`, `idu_execution_director_tick`, `idu_supervisor_tick` |
| `external` | 2 | `idu_external_intelligence_report`, `idu_external_source_recommend` |
| `genesis` | 2 | `idu_genesis_mission_confirm`, `idu_genesis_mission_draft` |
| `hygiene` | 2 | `idu_hygiene_migrate`, `idu_hygiene_sweep` |
| `injection` | 1 | `idu_pending_injections` |
| `lifecycle` | 6 | `idu_bootstrap_project`, `idu_prepare`, `idu_project_enroll`, `idu_project_reset_state`, `idu_project_status`, `idu_start` |
| `master-plan` | 6 | `idu_master_plan_approve`, `idu_master_plan_create`, `idu_master_plan_reject`, `idu_master_plan_review`, `idu_master_plan_status`, `idu_plan_snapshot` |
| `model` | 1 | `idu_model_invocation_status` |
| `objective` | 1 | `idu_objective_status` |
| `outbox` | 1 | `idu_outbox_prune` |
| `postflight` | 1 | `idu_postflight` |
| `preflight` | 1 | `idu_preflight` |
| `procedure` | 1 | `idu_orchestrator_procedure` |
| `proposal` | 2 | `idu_proposal_detail`, `idu_proposal_outbox` |
| `pruning` | 2 | `idu_architectural_pruning_plan`, `idu_context_pruning_advisory` |
| `queue` | 2 | `idu_queue_complete`, `idu_queue_detail` |
| `role` | 2 | `idu_role_engine_control`, `idu_role_engine_status` |
| `semantic` | 1 | `idu_semantic_audit_status` |
| `session` | 2 | `idu_activate`, `idu_deactivate` |
| `skill` | 3 | `idu_skill_draft_from_lessons`, `idu_skill_for_task`, `idu_skill_rating` |
| `source` | 15 | `idu_source_add`, `idu_source_chunk_read`, `idu_source_digest`, `idu_source_digest_status`, `idu_source_extract`, `idu_source_read`, `idu_source_recommend_for_task`, `idu_source_refresh`, `idu_source_remove`, `idu_source_report`, `idu_source_required_actions`, `idu_source_research_report`, `idu_source_skill_candidates_create`, `idu_source_skill_candidates_review`, `idu_source_status` |
| `status` | 1 | `idu_status` |
| `supervisor` | 4 | `idu_supervisor_consult`, `idu_supervisor_context_pack`, `idu_supervisor_responses`, `idu_supervisor_self_maintenance_advisory` |
| `task` | 3 | `idu_task`, `idu_task_context`, `idu_task_package_create` |
| `trigger` | 3 | `idu_subscribe_triggers`, `idu_supervisor_trigger`, `idu_trigger_engine` |

## All tools (alphabetical)

| Tool | Cluster |
|---|---|
| `idu_ack_advisory` | `advisory` |
| `idu_activate` | `session` |
| `idu_advisory` | `advisory` |
| `idu_agentlab_request_create` | `agentlab` |
| `idu_agentlab_review_run` | `agentlab` |
| `idu_agentlab_review_status` | `agentlab` |
| `idu_architectural_pruning_plan` | `pruning` |
| `idu_automaticov1_cycle` | `cycle` |
| `idu_autonomous_alerts_control` | `alerts` |
| `idu_autonomous_alerts_status` | `alerts` |
| `idu_autonomous_alerts_tick` | `alerts` |
| `idu_bibliotecario_init` | `bibliotecario` |
| `idu_bibliotecario_proactive_advisory` | `advisory` |
| `idu_birth_bibliotecario_discovery` | `birth` |
| `idu_birth_existing_scan` | `birth` |
| `idu_birth_general_spec` | `birth` |
| `idu_birth_general_spec_derive` | `birth` |
| `idu_birth_prototype_master` | `birth` |
| `idu_birth_repo_plan` | `birth` |
| `idu_birth_status` | `birth` |
| `idu_birth_validate` | `birth` |
| `idu_bootstrap_project` | `lifecycle` |
| `idu_context_pruning_advisory` | `pruning` |
| `idu_continuation_proposal` | `continuation` |
| `idu_deactivate` | `session` |
| `idu_execution_director_tick` | `cycle` |
| `idu_external_intelligence_report` | `external` |
| `idu_external_source_recommend` | `external` |
| `idu_genesis_mission_confirm` | `genesis` |
| `idu_genesis_mission_draft` | `genesis` |
| `idu_hygiene_migrate` | `hygiene` |
| `idu_hygiene_sweep` | `hygiene` |
| `idu_master_plan_approve` | `master-plan` |
| `idu_master_plan_create` | `master-plan` |
| `idu_master_plan_reject` | `master-plan` |
| `idu_master_plan_review` | `master-plan` |
| `idu_master_plan_status` | `master-plan` |
| `idu_model_invocation_status` | `model` |
| `idu_next_advisory_action` | `advisory` |
| `idu_objective_status` | `objective` |
| `idu_orchestrator_procedure` | `procedure` |
| `idu_outbox_prune` | `outbox` |
| `idu_pending_injections` | `injection` |
| `idu_plan_snapshot` | `master-plan` |
| `idu_postflight` | `postflight` |
| `idu_preflight` | `preflight` |
| `idu_prepare` | `lifecycle` |
| `idu_project_enroll` | `lifecycle` |
| `idu_project_reset_state` | `lifecycle` |
| `idu_project_status` | `lifecycle` |
| `idu_proposal_detail` | `proposal` |
| `idu_proposal_outbox` | `proposal` |
| `idu_queue_complete` | `queue` |
| `idu_queue_detail` | `queue` |
| `idu_role_engine_control` | `role` |
| `idu_role_engine_status` | `role` |
| `idu_semantic_audit_status` | `semantic` |
| `idu_skill_draft_from_lessons` | `skill` |
| `idu_skill_for_task` | `skill` |
| `idu_skill_rating` | `skill` |
| `idu_source_add` | `source` |
| `idu_source_chunk_read` | `source` |
| `idu_source_digest` | `source` |
| `idu_source_digest_status` | `source` |
| `idu_source_extract` | `source` |
| `idu_source_read` | `source` |
| `idu_source_recommend_for_task` | `source` |
| `idu_source_refresh` | `source` |
| `idu_source_remove` | `source` |
| `idu_source_report` | `source` |
| `idu_source_required_actions` | `source` |
| `idu_source_research_report` | `source` |
| `idu_source_skill_candidates_create` | `source` |
| `idu_source_skill_candidates_review` | `source` |
| `idu_source_status` | `source` |
| `idu_start` | `lifecycle` |
| `idu_status` | `status` |
| `idu_subscribe_triggers` | `trigger` |
| `idu_supervisor_consult` | `supervisor` |
| `idu_supervisor_context_pack` | `supervisor` |
| `idu_supervisor_cron_plan` | `cron` |
| `idu_supervisor_responses` | `supervisor` |
| `idu_supervisor_self_maintenance_advisory` | `supervisor` |
| `idu_supervisor_tick` | `cycle` |
| `idu_supervisor_trigger` | `trigger` |
| `idu_task` | `task` |
| `idu_task_context` | `task` |
| `idu_task_package_create` | `task` |
| `idu_trigger_engine` | `trigger` |

