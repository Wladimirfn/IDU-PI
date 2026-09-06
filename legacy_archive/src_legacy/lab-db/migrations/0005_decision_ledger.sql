-- 0005_decision_ledger.sql
-- Migration: add the decision_ledger table so the runtime can
-- record what the orchestrator decided about pending injections
-- (review / delegate / ignore) and other advisory events. This
-- preserves decision provenance between sessions: idu-pi becomes
-- the memory of decisions, not just the source of signals.

CREATE TABLE IF NOT EXISTS decision_ledger (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id      TEXT    NOT NULL,
	decided_at      TEXT    NOT NULL,
	decided_by      TEXT    NOT NULL,
	decision        TEXT    NOT NULL,
	target_kind     TEXT    NOT NULL,
	target_id       TEXT    NOT NULL,
	rationale       TEXT,
	profile_ref     TEXT
);

CREATE INDEX IF NOT EXISTS idx_decision_ledger_project_time
	ON decision_ledger (project_id, decided_at);
