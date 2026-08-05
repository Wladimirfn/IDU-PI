-- migration 0006: view_partial + original_severity for #474
-- Sensor findings from capped files (#458) carry a flag so the
-- escalation engine can distinguish "genuine critical" from "critical
-- on partial content" without relying on prose markers in `evidence`.
--
-- view_partial: true when the finding came from a file whose content
--   the sensor truncated at MAX_FILE_CONTENT_CHARS (4000).
-- original_severity: the finding's severity before #458's downgrade.
--   Only populated when view_partial = 1; NULL otherwise.

ALTER TABLE bug_findings ADD COLUMN view_partial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bug_findings ADD COLUMN original_severity TEXT;
