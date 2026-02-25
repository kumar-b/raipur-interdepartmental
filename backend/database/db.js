/**
 * db.js — SQLite database connection and schema initialisation.
 *
 * Architecture: users are the central unit. Department is a display
 * label on a user, not a structural concept in the notice flow.
 *
 * Tables:
 *   departments        — reference lookup (code, name, category). No FK in notices.
 *   users              — login accounts; dept_id is a display label only.
 *   notices            — one row per notice; source = created_by user.
 *   notice_status      — one row per (notice, recipient user). Tracks acknowledgement.
 *   notice_archive_stats — archived monthly completion counts from closed notices.
 *   refresh_tokens     — long-lived session tokens (future use).
 *
 * Dropped:
 *   notice_targets     — eliminated; notice_status is the single source of truth.
 *   notices.source_dept_id — source is now derived from the created_by user.
 */

const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'portal.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Drop tables that are being redesigned (FK order: children first) ──────────
db.exec(`
  DROP TABLE IF EXISTS notice_status;
  DROP TABLE IF EXISTS notice_targets;
  DROP TABLE IF EXISTS notices;
`);

// ── Create all tables ─────────────────────────────────────────────────────────
db.exec(`
  -- Department reference table — pure lookup data.
  -- dept_id on users is a display label; it has no role in the notice flow.
  CREATE TABLE IF NOT EXISTS departments (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    website     TEXT,
    description TEXT,
    category    TEXT
  );

  -- Portal login accounts.
  -- role = 'admin'      → full access: view all notices, manage users.
  -- role = 'department' → personal inbox/outbox, compose notices.
  -- dept_id is a display label (e.g. "Revenue Dept") — NULL for admin accounts.
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK(role IN ('admin','department')),
    dept_id       INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT
  );

  -- One row per notice. Source is the creating user (created_by).
  -- target_all = 1: every active non-admin user is a recipient.
  -- target_all = 0: only users listed in notice_status are recipients.
  CREATE TABLE notices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    body            TEXT    NOT NULL,
    priority        TEXT    NOT NULL CHECK(priority IN ('High','Normal','Low')),
    deadline        TEXT    NOT NULL,
    created_by      INTEGER NOT NULL REFERENCES users(id),
    target_all      INTEGER NOT NULL DEFAULT 0,
    attachment_path TEXT,
    attachment_name TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-user acknowledgement state for each notice.
  -- One row per (notice, recipient user).
  -- status lifecycle: Pending → Noted → Completed.
  CREATE TABLE notice_status (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    notice_id   INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    status      TEXT    NOT NULL DEFAULT 'Pending'
                        CHECK(status IN ('Pending','Noted','Completed')),
    remark      TEXT,
    reply_path  TEXT,
    reply_name  TEXT,
    is_read     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT,
    UNIQUE(notice_id, user_id)
  );

  -- Archived monthly completion counts written when a notice is closed.
  -- The monthly-stats endpoint UNIONs this with live notice_status rows.
  CREATE TABLE IF NOT EXISTS notice_archive_stats (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    month     TEXT    NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Refresh tokens for future session-extension support.
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
