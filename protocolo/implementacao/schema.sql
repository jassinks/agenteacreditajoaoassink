-- Cloudflare D1 - usar em banco NOVO e privado.
-- Nunca publicar os dados, somente este esquema.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 form_id TEXT NOT NULL UNIQUE,
 protocol TEXT NOT NULL UNIQUE,
 access_hash TEXT NOT NULL,
 email TEXT DEFAULT NULL,
 title TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'Recebida',
 next_step TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS updates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 status TEXT NOT NULL,
 public_note TEXT NOT NULL,
 next_step TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 notified_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_updates_submission ON updates (submission_id, id);
CREATE INDEX IF NOT EXISTS idx_updates_pending ON updates (notified_at, id);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at);
