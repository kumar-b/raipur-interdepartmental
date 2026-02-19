const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'portal.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS departments (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    website     TEXT,
    description TEXT,
    category    TEXT
  );

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

  CREATE TABLE IF NOT EXISTS notices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT    NOT NULL,
    body             TEXT    NOT NULL,
    priority         TEXT    NOT NULL CHECK(priority IN ('High','Normal','Low')),
    deadline         TEXT    NOT NULL,
    source_dept_id   INTEGER NOT NULL REFERENCES departments(id),
    target_all       INTEGER NOT NULL DEFAULT 0,
    attachment_path  TEXT,
    attachment_name  TEXT,
    created_by       INTEGER NOT NULL REFERENCES users(id),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notice_targets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
    dept_id   INTEGER NOT NULL REFERENCES departments(id),
    UNIQUE(notice_id, dept_id)
  );

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

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
