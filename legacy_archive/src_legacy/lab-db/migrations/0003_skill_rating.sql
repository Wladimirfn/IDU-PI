-- 0003_skill_rating.sql
-- B1 thin slice: REQ-B1-1 — score column on bibliotecario_proposals.
-- Idempotent: runner catches "duplicate column name" on re-run.
-- See B0 archive residual risk #2 for table name context.

ALTER TABLE bibliotecario_proposals
ADD COLUMN score INTEGER
CHECK (score IS NULL OR (score >= 0 AND score <= 10));
