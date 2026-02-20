/**
 * db.js — SQLite database connection and schema initialisation.
 *
 * Uses better-sqlite3 for synchronous, low-overhead database access.
 * WAL journal mode is enabled for better concurrent read performance.
 * Foreign key enforcement is turned on to maintain referential integrity.
 *
 * Tables created (if they do not already exist):
 *
 *   departments     — master list of government departments
 *   users           — portal login accounts (admin or department role)
 *   notices         — interdepartmental notice records
 *   notice_targets  — maps a notice to its specific target department(s)
 *                     (only populated when target_all = 0)
 *   notice_status   — per-department acknowledgement status for each notice
 *   refresh_tokens  — long-lived tokens for session refresh (future use)
 */

const Database = require('better-sqlite3');
const path = require('path');

// Open (or create) the SQLite database file next to this module.
const db = new Database(path.join(__dirname, 'portal.db'));

// WAL mode allows readers and a single writer to operate concurrently.
db.pragma('journal_mode = WAL');

// Enforce REFERENCES constraints so cascades and NULL-sets work correctly.
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  -- Master list of all government departments in the district.
  -- "code" is a short uppercase identifier used as a display tag (e.g. REVENUE).
  -- "category" groups departments on the public-facing page (Administration, etc.).
  CREATE TABLE IF NOT EXISTS departments (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    website     TEXT,
    description TEXT,
    category    TEXT
  );

  -- User accounts for portal login.
  -- role = 'admin'      → full access: view all, manage users, delete notices.
  -- role = 'department' → scoped to own dept: send notices, respond to inbox.
  -- dept_id is NULL for admin accounts; SET NULL on department deletion.
  -- is_active = 0 blocks login without deleting the account history.
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

  -- One row per notice issued by a department.
  -- target_all = 1 means every other department is a recipient;
  -- target_all = 0 means only the departments listed in notice_targets receive it.
  -- attachment_path holds either a local /uploads/<file> path or an S3 URL.
  CREATE TABLE IF NOT EXISTS notices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT    NOT NULL,
    body             TEXT    NOT NULL,
    priority         TEXT    NOT NULL CHECK(priority IN ('High','Normal','Low')),
    deadline         TEXT    NOT NULL,           -- ISO date string YYYY-MM-DD
    source_dept_id   INTEGER NOT NULL REFERENCES departments(id),
    target_all       INTEGER NOT NULL DEFAULT 0, -- 1 = broadcast to all depts
    attachment_path  TEXT,                       -- local path or S3 URL
    attachment_name  TEXT,                       -- original file name shown in UI
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Explicit target departments for a notice (only when target_all = 0).
  -- Cascade-deleted when the parent notice is removed.
  CREATE TABLE IF NOT EXISTS notice_targets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    dept_id   INTEGER NOT NULL REFERENCES departments(id),
    UNIQUE(notice_id, dept_id)
  );

  -- Per-department acknowledgement state for each notice.
  -- One row is inserted for every (notice, target dept) pair at creation time.
  -- status lifecycle: Pending → Noted → Completed.
  -- is_read tracks whether the department user has opened the notice detail.
  -- reply_path / reply_name store an optional response file uploaded by the dept.
  CREATE TABLE IF NOT EXISTS notice_status (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    notice_id   INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    dept_id     INTEGER NOT NULL REFERENCES departments(id),
    status      TEXT    NOT NULL DEFAULT 'Pending'
                        CHECK(status IN ('Pending','Noted','Completed')),
    remark      TEXT,
    reply_path  TEXT,
    reply_name  TEXT,
    is_read     INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT,
    UNIQUE(notice_id, dept_id)
  );

  -- Refresh tokens for extending sessions without re-entering credentials.
  -- token_hash stores a bcrypt / SHA hash of the raw token for safe storage.
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Archive of per-month completion counts from closed notices.
  -- When a notice is closed (deleted), its completed notice_status rows are
  -- counted per calendar month and saved here so the monthly-stats chart
  -- continues to reflect historical activity even after the notice is gone.
  -- The monthly-stats query UNIONs this table with live notice_status rows.
  CREATE TABLE IF NOT EXISTS notice_archive_stats (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    month     TEXT    NOT NULL,              -- YYYY-MM (e.g. '2026-02')
    completed INTEGER NOT NULL DEFAULT 0,    -- count of completed notice_status rows
    closed_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
