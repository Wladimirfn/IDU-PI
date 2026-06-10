-- 0002_bibliotecario.sql
-- B0 foundation: REQ-B0-1 bibliotecario schema.
-- This migration is re-runnable on existing lab.db files because it uses
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--
-- Tables:
--   skills                    (id, name, version, status, created_at, updated_at)
--   sources                   (id, kind, path, added_at, status)
--   digests                   (id, source_id, generated_at, body)
--   ratings                   (id, target_id, target_kind, score, rated_at)
--   bibliotecario_proposals   (id, kind, payload, created_at, status)
--
-- NOTE: The B0 proposals table is named bibliotecario_proposals to avoid
-- collision with the existing B5 proposals table (which has a different
-- schema: finding_id, proposal_type, summary, etc.).

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'proposed', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('markdown', 'pdf', 'txt', 'code', 'external')),
  path TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'extracted', 'digested', 'failed'))
);

CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  body TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('skill', 'source', 'digest', 'proposal')),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  rated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bibliotecario_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'deferred'))
);

-- Indexes for common queries.
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_updated_at ON skills(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources(kind);
CREATE INDEX IF NOT EXISTS idx_digests_source_id ON digests(source_id);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings(target_id);
CREATE INDEX IF NOT EXISTS idx_bibliotecario_proposals_status ON bibliotecario_proposals(status);
