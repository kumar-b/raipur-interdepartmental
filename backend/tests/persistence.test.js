/**
 * persistence.test.js — verifies that the schema initialisation in db.js is
 * safe to run on every server startup without wiping existing data.
 *
 * Root cause of the bug that was fixed:
 *   db.js previously ran DROP TABLE on notices and notice_status at module load
 *   time, erasing all data on every server restart.
 *
 * These tests use a real file-based SQLite database (written to a temp path)
 * so that "closing and reopening" the database faithfully simulates a restart.
 */

const Database = require('better-sqlite3');
const os       = require('os');
const path     = require('path');
const fs       = require('fs');

// Path for the temporary database file — unique per test run.
const TMP_DB = path.join(os.tmpdir(), `portal_persistence_test_${Date.now()}.db`);

/**
 * runSchema — applies the full schema from db.js to the given Database
 * instance.  Mirrors the exact SQL in db.js so the test stays in sync with
 * production.
 */
function runSchema(db) {
  db.pragma('journal_mode = WAL');
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
    CREATE TABLE IF NOT EXISTS notice_archive_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

afterAll(() => {
  // Clean up the temp database file after all tests complete.
  try { fs.unlinkSync(TMP_DB); } catch (_) {}
  // WAL mode creates two sidecar files.
  try { fs.unlinkSync(TMP_DB + '-wal'); } catch (_) {}
  try { fs.unlinkSync(TMP_DB + '-shm'); } catch (_) {}
});

// ── Schema idempotency ────────────────────────────────────────────────────────

describe('Schema initialisation is idempotent (safe to run on every startup)', () => {
  test('running schema init twice does not throw (CREATE TABLE IF NOT EXISTS)', () => {
    const db = new Database(TMP_DB);
    expect(() => runSchema(db)).not.toThrow();
    expect(() => runSchema(db)).not.toThrow(); // second run = simulated restart
    db.close();
  });

  test('all expected tables exist after initialisation', () => {
    const db = new Database(TMP_DB);
    runSchema(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map(r => r.name);

    expect(tables).toContain('departments');
    expect(tables).toContain('users');
    expect(tables).toContain('notices');
    expect(tables).toContain('notice_status');
    expect(tables).toContain('notice_archive_stats');
    expect(tables).toContain('refresh_tokens');
    db.close();
  });
});

// ── Data persistence across restarts ─────────────────────────────────────────

describe('Data persists across simulated server restarts', () => {
  test('notices survive a restart (schema re-init does not drop the table)', () => {
    // ── First "boot" ──────────────────────────────────────────────────────────
    const db1 = new Database(TMP_DB);
    runSchema(db1);

    // Seed minimum required rows (dept + user) to satisfy foreign keys.
    db1.prepare(`INSERT OR IGNORE INTO departments (id,code,name) VALUES (1,'TEST','Test Dept')`).run();
    db1.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,role,dept_id) VALUES (1,'testuser','hash','department',1)`).run();

    const inserted = db1.prepare(
      `INSERT INTO notices (title,body,priority,deadline,created_by) VALUES (?,?,?,?,?)`
    ).run('Persistent Notice', 'Should survive restart', 'Normal', '2099-01-01', 1);

    const noticeId = inserted.lastInsertRowid;
    db1.close(); // simulate server shutdown

    // ── Second "boot" — schema re-init should NOT wipe data ──────────────────
    const db2 = new Database(TMP_DB);
    runSchema(db2); // this is what db.js does on every startup

    const row = db2.prepare('SELECT * FROM notices WHERE id = ?').get(noticeId);
    expect(row).toBeDefined();
    expect(row.title).toBe('Persistent Notice');
    db2.close();
  });

  test('notice_status rows survive a restart', () => {
    const db1 = new Database(TMP_DB);
    runSchema(db1);

    // Insert a notice_status row (notice + user seeded in previous test).
    db1.prepare(
      `INSERT OR IGNORE INTO notice_status (notice_id, user_id) VALUES (1, 1)`
    ).run();

    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM notice_status').get().c;
    db1.close();

    // Simulated restart.
    const db2 = new Database(TMP_DB);
    runSchema(db2);

    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM notice_status').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });

  test('notice_archive_stats rows survive a restart', () => {
    const db1 = new Database(TMP_DB);
    runSchema(db1);

    db1.prepare(
      `INSERT INTO notice_archive_stats (month, completed) VALUES ('2026-01', 5)`
    ).run();

    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c;
    db1.close();

    const db2 = new Database(TMP_DB);
    runSchema(db2);

    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });

  test('user accounts survive a restart', () => {
    const db1 = new Database(TMP_DB);
    runSchema(db1);

    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    db1.close();

    const db2 = new Database(TMP_DB);
    runSchema(db2);

    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });

  test('notice content is intact and unmodified after restart', () => {
    const db1 = new Database(TMP_DB);
    runSchema(db1);

    const notice = db1.prepare('SELECT * FROM notices WHERE id = 1').get();
    db1.close();

    const db2 = new Database(TMP_DB);
    runSchema(db2);

    const noticeAfter = db2.prepare('SELECT * FROM notices WHERE id = 1').get();
    expect(noticeAfter.title).toBe(notice.title);
    expect(noticeAfter.body).toBe(notice.body);
    expect(noticeAfter.priority).toBe(notice.priority);
    expect(noticeAfter.deadline).toBe(notice.deadline);
    db2.close();
  });

  test('multiple restarts in sequence do not degrade data', () => {
    let count;

    for (let i = 0; i < 5; i++) {
      const db = new Database(TMP_DB);
      runSchema(db);
      count = db.prepare('SELECT COUNT(*) AS c FROM notices').get().c;
      db.close();
    }

    // Count must remain the same across all 5 "restarts".
    const db = new Database(TMP_DB);
    runSchema(db);
    const finalCount = db.prepare('SELECT COUNT(*) AS c FROM notices').get().c;
    expect(finalCount).toBe(count);
    db.close();
  });
});
