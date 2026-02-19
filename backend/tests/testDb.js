/**
 * testDb.js — creates a fresh in-memory SQLite DB for each test file.
 *
 * Usage in test files:
 *   jest.mock('../database/db', () => require('./testDb').createDb());
 *
 * createDb() is called by Jest's mock factory once per test file,
 * giving each file its own isolated in-memory database.
 */
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, website TEXT, description TEXT, category TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','department')),
      dept_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, body TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('High','Normal','Low')),
      deadline TEXT NOT NULL, source_dept_id INTEGER NOT NULL,
      target_all INTEGER NOT NULL DEFAULT 0,
      attachment_path TEXT, attachment_name TEXT,
      created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notice_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      dept_id INTEGER NOT NULL, UNIQUE(notice_id, dept_id)
    );
    CREATE TABLE IF NOT EXISTS notice_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      dept_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending'
        CHECK(status IN ('Pending','Noted','Completed')),
      remark TEXT, reply_path TEXT, reply_name TEXT,
      is_read INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
      UNIQUE(notice_id, dept_id)
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed minimal data — 3 departments, 3 users
  db.prepare(`INSERT INTO departments (id,code,name,category) VALUES
    (1,'REVENUE','Revenue Department','Administration'),
    (2,'HEALTH','Health Department','Social Services'),
    (3,'PWD','Public Works Department','Infrastructure')
  `).run();

  // Cost factor 10 for faster test runs (vs 12 in production)
  const adminHash = bcrypt.hashSync('Admin@Test123', 10);
  const deptHash  = bcrypt.hashSync('Dept@Test123', 10);

  db.prepare(`INSERT INTO users (username,password_hash,role,dept_id) VALUES
    ('admin',        ?, 'admin',      NULL),
    ('dept_revenue', ?, 'department', 1),
    ('dept_health',  ?, 'department', 2)
  `).run(adminHash, deptHash, deptHash);

  return db;
}

module.exports = { createDb };
