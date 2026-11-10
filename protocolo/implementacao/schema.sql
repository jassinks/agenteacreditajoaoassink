-- Schema para o banco Cloudflare D1 (SQLite).
-- Não publique o banco de dados nem dados pessoais no GitHub.
CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 form_id TEXT NOT NULL UNIQUE,
 protocol TEXT NOT NULL UNIQUE,
 access_hash TEXT NOT NULL,
 email TEXT NOT NULL,
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
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_updates_submission ON updates (submission_id, id);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at);