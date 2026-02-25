/**
 * testDb.js — in-memory SQLite database factory for the Jest test suite.
 *
 * Usage in any test file:
 *   jest.mock('../database/db', () => require('./testDb').createDb());
 *
 * Jest hoists jest.mock() calls above all require/import statements, so the
 * factory function runs the first time '../database/db' is required, returning
 * a fresh in-memory database with schema + minimal seed data.
 *
 * Each test *file* gets its own isolated database instance because Jest runs
 * each file in a separate worker. This means tests in different files cannot
 * interfere with each other's data.
 *
 * Design decisions:
 *   - bcrypt cost factor 10 (vs 12 in production) for faster test runs.
 *   - Only 3 departments and 3 users are seeded — enough to exercise all
 *     role/target combinations without slow setup.
 *   - Schema mirrors db.js exactly so route logic works without modification.
 */

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');

/**
 * createDb — creates and seeds a fresh in-memory SQLite database.
 * Called once per test file via the jest.mock factory.
 * @returns {Database} — a better-sqlite3 database instance
 */
function createDb() {
  // ':memory:' means the database exists only in RAM and is destroyed when
  // the process exits (or when db.close() is called in afterAll).
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); // enforce referential integrity in tests

  // ── Schema — mirrors backend/database/db.js exactly ───────────────────────
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
      deadline TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      target_all INTEGER NOT NULL DEFAULT 0,
      attachment_path TEXT, attachment_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notice_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'Pending'
        CHECK(status IN ('Pending','Noted','Completed')),
      remark TEXT, reply_path TEXT, reply_name TEXT,
      is_read INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
      UNIQUE(notice_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Archive table for completed-action counts from closed notices.
    -- Mirrors the production schema in db.js so the UNION in monthly-stats works.
    CREATE TABLE IF NOT EXISTS notice_archive_stats (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      month     TEXT    NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Seed: 3 departments — enough to test sender/target/uninvolved roles ───
  db.prepare(`INSERT INTO departments (id,code,name,category) VALUES
    (1,'REVENUE','Revenue Department','Administration'),
    (2,'HEALTH','Health Department','Social Services'),
    (3,'PWD','Public Works Department','Infrastructure')
  `).run();

  // ── Seed: 3 users — one admin, one per department ─────────────────────────
  // Cost factor 10 gives ~3× speedup over production factor 12 with no security
  // impact in a test environment (secrets are throwaway test values).
  const adminHash = bcrypt.hashSync('Admin@Test123', 10);
  const deptHash  = bcrypt.hashSync('Dept@Test123',  10);

  // Users: admin=1, dept_revenue=2, dept_health=3, dept_civil=4
  // 'dept_civil' avoids collision with 'dept_pwd' which users.test.js creates dynamically.
  db.prepare(`INSERT INTO users (username,password_hash,role,dept_id) VALUES
    ('admin',        ?, 'admin',      NULL),
    ('dept_revenue', ?, 'department', 1),
    ('dept_health',  ?, 'department', 2),
    ('dept_civil',   ?, 'department', 3)
  `).run(adminHash, deptHash, deptHash, deptHash);

  return db;
}

module.exports = { createDb };
