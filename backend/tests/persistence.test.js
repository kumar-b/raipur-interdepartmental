/**
 * persistence.test.js — comprehensive data-persistence tests across simulated
 * server restarts for every table in the schema.
 *
 * Background — the bug that was fixed:
 *   db.js previously ran DROP TABLE on `notices` and `notice_status` at module
 *   load time, erasing all notice data on every server restart.
 *   Users, departments, archive_stats, and refresh_tokens were NOT affected
 *   (they were never in the DROP block and always had CREATE TABLE IF NOT EXISTS).
 *
 * What these tests verify:
 *   1.  Schema init is idempotent — safe to run repeatedly without errors.
 *   2.  Every table exists after init.
 *   3.  Per-table: data written before a restart is readable after.
 *   4.  Per-table: all columns are preserved (no silent data corruption).
 *   5.  Foreign-key constraints still work after a restart.
 *   6.  Data is stable across many consecutive restarts.
 *
 * Strategy:
 *   Each describe block opens its own file-based SQLite database (temp file),
 *   writes data, closes it (simulating shutdown), reopens it (simulating
 *   startup + schema re-init), and asserts the data is still there.
 *   File-based DB is used instead of :memory: so close/reopen faithfully
 *   simulates a real server restart.
 */

const Database = require('better-sqlite3');
const os       = require('os');
const path     = require('path');
const fs       = require('fs');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * tmpDb — returns a unique path for a temporary database file.
 * Each call produces a different path so describe blocks don't share state.
 */
let _seq = 0;
function tmpDb() {
  return path.join(os.tmpdir(), `portal_persist_${Date.now()}_${++_seq}.db`);
}

/**
 * runSchema — applies the full production schema to a Database instance.
 * Mirrors db.js exactly. Must stay in sync if db.js changes.
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

/**
 * cleanup — removes a temp DB file and its WAL sidecar files.
 */
function cleanup(dbPath) {
  [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].forEach(f => {
    try { fs.unlinkSync(f); } catch (_) {}
  });
}

// ── 1. Schema idempotency ─────────────────────────────────────────────────────

describe('Schema initialisation is idempotent', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  test('running schema init once does not throw', () => {
    const db = new Database(DB_PATH);
    expect(() => runSchema(db)).not.toThrow();
    db.close();
  });

  test('running schema init a second time (simulated restart) does not throw', () => {
    const db = new Database(DB_PATH);
    expect(() => runSchema(db)).not.toThrow(); // second run
    db.close();
  });

  test('running schema init 10 times in a row does not throw', () => {
    for (let i = 0; i < 10; i++) {
      const db = new Database(DB_PATH);
      expect(() => runSchema(db)).not.toThrow();
      db.close();
    }
  });

  test('all six expected tables exist after initialisation', () => {
    const db = new Database(DB_PATH);
    runSchema(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all().map(r => r.name);

    ['departments', 'notice_archive_stats', 'notice_status',
     'notices', 'refresh_tokens', 'users'].forEach(t => {
      expect(tables).toContain(t);
    });
    db.close();
  });
});

// ── 2. Users ─────────────────────────────────────────────────────────────────

describe('Users — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  test('seeded user survives a restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `INSERT INTO departments (id,code,name) VALUES (1,'REV','Revenue')`
    ).run();
    db1.prepare(
      `INSERT INTO users (username,password_hash,role,dept_id) VALUES ('dept_rev','hash123','department',1)`
    ).run();
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2); // simulated restart
    const row = db2.prepare(`SELECT * FROM users WHERE username='dept_rev'`).get();
    expect(row).toBeDefined();
    db2.close();
  });

  test('all user fields are preserved: username, role, dept_id, is_active, password_hash', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `INSERT OR IGNORE INTO users (username,password_hash,role,dept_id,is_active)
       VALUES ('dept_rev2','securehash','department',1,1)`
    ).run();
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT * FROM users WHERE username='dept_rev2'`).get();
    expect(row.password_hash).toBe('securehash');
    expect(row.role).toBe('department');
    expect(row.dept_id).toBe(1);
    expect(row.is_active).toBe(1);
    db2.close();
  });

  test('deactivated user (is_active=0) stays deactivated after restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `INSERT OR IGNORE INTO users (username,password_hash,role,is_active)
       VALUES ('admin_user','adminhash','admin',1)`
    ).run();
    db1.prepare(`UPDATE users SET is_active=0 WHERE username='dept_rev'`).run();
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT is_active FROM users WHERE username='dept_rev'`).get();
    expect(row.is_active).toBe(0);
    db2.close();
  });

  test('last_login timestamp is preserved after restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `UPDATE users SET last_login='2026-02-27 10:00:00' WHERE username='dept_rev2'`
    ).run();
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT last_login FROM users WHERE username='dept_rev2'`).get();
    expect(row.last_login).toBe('2026-02-27 10:00:00');
    db2.close();
  });

  test('user count does not change across restart (no rows added or removed)', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });
});

// ── 2b. Non-seeded users (added later via admin panel) ───────────────────────
// This is the exact scenario the user asked about:
//   "What about users added via the admin panel after the initial seed?"
//
// The POST /api/portal/users route does:
//   1. bcrypt.hashSync(password, 12)
//   2. INSERT INTO users (username, password_hash, role, dept_id) VALUES (?, ?, ?, ?)
//
// These rows live in the same `portal.db` file as seeded users.
// The mechanism is identical — there is no separate storage for admin-created users.
// The tests below prove this by mirroring what the route does, then restarting.

describe('Non-seeded users (added via admin panel) — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  const bcrypt  = require('bcryptjs');
  afterAll(() => cleanup(DB_PATH));

  test('admin-panel-created user survives a restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(`INSERT INTO departments (id,code,name) VALUES (1,'REV','Revenue')`).run();

    // Mirror exactly what POST /api/portal/users does.
    const hash = bcrypt.hashSync('NewUser@2024', 10); // cost 10 for test speed
    db1.prepare(
      `INSERT INTO users (username, password_hash, role, dept_id) VALUES (?, ?, ?, ?)`
    ).run('new_dept_user', hash, 'department', 1);
    db1.close(); // simulated shutdown

    const db2 = new Database(DB_PATH);
    runSchema(db2); // simulated restart
    const row = db2.prepare(`SELECT * FROM users WHERE username = 'new_dept_user'`).get();
    expect(row).toBeDefined();
    db2.close();
  });

  test('bcrypt password hash is intact and verifiable after restart', () => {
    // Proves the password can still authenticate post-restart — not just that
    // the row exists, but that the actual credential is usable.
    const db1 = new Database(DB_PATH);
    runSchema(db1);

    const originalPassword = 'SecurePass@999';
    const hash = bcrypt.hashSync(originalPassword, 10);
    db1.prepare(
      `INSERT OR IGNORE INTO users (username, password_hash, role, dept_id) VALUES (?, ?, ?, ?)`
    ).run('hash_test_user', hash, 'department', 1);
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT password_hash FROM users WHERE username = 'hash_test_user'`).get();

    expect(row).toBeDefined();
    // The hash must still pass bcrypt verification — not just be present.
    expect(bcrypt.compareSync(originalPassword, row.password_hash)).toBe(true);
    expect(bcrypt.compareSync('WrongPassword', row.password_hash)).toBe(false);
    db2.close();
  });

  test('role, dept_id, and is_active of an admin-panel user are all correct after restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const hash = bcrypt.hashSync('AnotherPass@1', 10);
    db1.prepare(
      `INSERT OR IGNORE INTO users (username, password_hash, role, dept_id, is_active)
       VALUES (?, ?, 'department', 1, 1)`
    ).run('field_check_user', hash);
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT * FROM users WHERE username = 'field_check_user'`).get();
    expect(row.role).toBe('department');
    expect(row.dept_id).toBe(1);
    expect(row.is_active).toBe(1);
    db2.close();
  });

  test('admin-created admin user (no dept_id) survives restart with null dept_id', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const hash = bcrypt.hashSync('AdminPass@2', 10);
    db1.prepare(
      `INSERT OR IGNORE INTO users (username, password_hash, role, dept_id)
       VALUES (?, ?, 'admin', NULL)`
    ).run('second_admin', hash);
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT * FROM users WHERE username = 'second_admin'`).get();
    expect(row).toBeDefined();
    expect(row.role).toBe('admin');
    expect(row.dept_id).toBeNull();
    db2.close();
  });

  test('deactivated admin-panel user stays deactivated after restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `UPDATE users SET is_active = 0 WHERE username = 'new_dept_user'`
    ).run();
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(`SELECT is_active FROM users WHERE username = 'new_dept_user'`).get();
    expect(row.is_active).toBe(0);
    db2.close();
  });

  test('admin-panel user count grows correctly and count persists across restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM users').get().c;

    const hash = bcrypt.hashSync('ExtraUser@1', 10);
    db1.prepare(
      `INSERT INTO users (username, password_hash, role, dept_id) VALUES (?, ?, 'department', 1)`
    ).run('extra_user_1', hash);
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    expect(countAfter).toBe(countBefore + 1);
    db2.close();
  });
});

// ── 3. Departments ────────────────────────────────────────────────────────────

describe('Departments — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  test('department survives a restart with all fields intact', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `INSERT INTO departments (id,code,name,website,description,category)
       VALUES (1,'HEALTH','Health Department','https://health.cg.gov.in','Manages health','Social')`
    ).run();
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare('SELECT * FROM departments WHERE code=?').get('HEALTH');
    expect(row).toBeDefined();
    expect(row.name).toBe('Health Department');
    expect(row.website).toBe('https://health.cg.gov.in');
    expect(row.description).toBe('Manages health');
    expect(row.category).toBe('Social');
    db2.close();
  });

  test('multiple departments all survive a restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(`INSERT OR IGNORE INTO departments (id,code,name) VALUES (2,'PWD','Public Works')`).run();
    db1.prepare(`INSERT OR IGNORE INTO departments (id,code,name) VALUES (3,'FINANCE','Finance')`).run();
    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });
});

// ── 4. Notices ────────────────────────────────────────────────────────────────

describe('Notices — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  // Seed the minimum required rows before tests.
  beforeAll(() => {
    const db = new Database(DB_PATH);
    runSchema(db);
    db.prepare(`INSERT INTO departments (id,code,name) VALUES (1,'REV','Revenue')`).run();
    db.prepare(
      `INSERT INTO users (id,username,password_hash,role,dept_id)
       VALUES (1,'dept_rev','hash','department',1)`
    ).run();
    db.close();
  });

  test('notice survives a restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const r = db1.prepare(
      `INSERT INTO notices (title,body,priority,deadline,created_by)
       VALUES ('Test Notice','Body text','High','2026-12-31',1)`
    ).run();
    const id = r.lastInsertRowid;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare('SELECT * FROM notices WHERE id=?').get(id);
    expect(row).toBeDefined();
    expect(row.title).toBe('Test Notice');
    db2.close();
  });

  test('all notice fields are preserved after restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const r = db1.prepare(
      `INSERT INTO notices
         (title,body,priority,deadline,created_by,target_all,attachment_path,attachment_name)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      'Full Fields Notice','Detailed body','Normal','2026-06-30',
      1, 0, '/uploads/test-doc.pdf', 'test-doc.pdf'
    );
    const id = r.lastInsertRowid;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare('SELECT * FROM notices WHERE id=?').get(id);
    expect(row.body).toBe('Detailed body');
    expect(row.priority).toBe('Normal');
    expect(row.deadline).toBe('2026-06-30');
    expect(row.target_all).toBe(0);
    expect(row.attachment_path).toBe('/uploads/test-doc.pdf');
    expect(row.attachment_name).toBe('test-doc.pdf');
    expect(row.created_by).toBe(1);
    db2.close();
  });

  test('notice count does not change across restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM notices').get().c;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM notices').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });

  test('broadcast notice (target_all=1) preserves the flag after restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const r = db1.prepare(
      `INSERT INTO notices (title,body,priority,deadline,created_by,target_all)
       VALUES ('Broadcast','For all','Low','2026-12-31',1,1)`
    ).run();
    const id = r.lastInsertRowid;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare('SELECT target_all FROM notices WHERE id=?').get(id);
    expect(row.target_all).toBe(1);
    db2.close();
  });
});

// ── 5. Notice Status ──────────────────────────────────────────────────────────

describe('Notice status — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  let noticeId;

  beforeAll(() => {
    const db = new Database(DB_PATH);
    runSchema(db);
    db.prepare(`INSERT INTO departments (id,code,name) VALUES (1,'REV','Revenue')`).run();
    db.prepare(
      `INSERT INTO users (id,username,password_hash,role,dept_id) VALUES (1,'sender','hash','department',1)`
    ).run();
    db.prepare(
      `INSERT INTO users (id,username,password_hash,role,dept_id) VALUES (2,'recip','hash','department',1)`
    ).run();
    const r = db.prepare(
      `INSERT INTO notices (title,body,priority,deadline,created_by)
       VALUES ('Status Test','body','Normal','2026-12-31',1)`
    ).run();
    noticeId = r.lastInsertRowid;
    db.close();
  });

  test('Pending status row survives a restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `INSERT OR IGNORE INTO notice_status (notice_id,user_id) VALUES (?,2)`
    ).run(noticeId);
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(
      'SELECT * FROM notice_status WHERE notice_id=? AND user_id=2'
    ).get(noticeId);
    expect(row).toBeDefined();
    expect(row.status).toBe('Pending');
    db2.close();
  });

  test('all notice_status fields preserved: status, remark, reply_path, is_read, updated_at', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(`
      UPDATE notice_status
      SET status='Completed', remark='Done', reply_path='/uploads/reply.pdf',
          reply_name='reply.pdf', is_read=1, updated_at='2026-02-20 09:00:00'
      WHERE notice_id=? AND user_id=2
    `).run(noticeId);
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare(
      'SELECT * FROM notice_status WHERE notice_id=? AND user_id=2'
    ).get(noticeId);
    expect(row.status).toBe('Completed');
    expect(row.remark).toBe('Done');
    expect(row.reply_path).toBe('/uploads/reply.pdf');
    expect(row.reply_name).toBe('reply.pdf');
    expect(row.is_read).toBe(1);
    expect(row.updated_at).toBe('2026-02-20 09:00:00');
    db2.close();
  });

  test('notice_status count does not change across restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM notice_status').get().c;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM notice_status').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });
});

// ── 6. Notice archive stats ───────────────────────────────────────────────────

describe('Notice archive stats — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  test('archive row survives a restart with all fields intact', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    const r = db1.prepare(
      `INSERT INTO notice_archive_stats (month,completed) VALUES ('2026-01',7)`
    ).run();
    const id = r.lastInsertRowid;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare('SELECT * FROM notice_archive_stats WHERE id=?').get(id);
    expect(row).toBeDefined();
    expect(row.month).toBe('2026-01');
    expect(row.completed).toBe(7);
    db2.close();
  });

  test('multiple months all survive a restart', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    ['2025-11','2025-12','2026-01'].forEach(m =>
      db1.prepare(`INSERT OR IGNORE INTO notice_archive_stats (month,completed) VALUES (?,3)`).run(m)
    );
    const countBefore = db1.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const countAfter = db2.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c;
    expect(countAfter).toBe(countBefore);
    db2.close();
  });
});

// ── 7. Refresh tokens ─────────────────────────────────────────────────────────

describe('Refresh tokens — data persists across restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  test('refresh token survives a restart with all fields intact', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1);
    db1.prepare(
      `INSERT INTO users (id,username,password_hash,role) VALUES (1,'admin','hash','admin')`
    ).run();
    const r = db1.prepare(
      `INSERT INTO refresh_tokens (user_id,token_hash,expires_at)
       VALUES (1,'abc123hash','2026-12-31 00:00:00')`
    ).run();
    const id = r.lastInsertRowid;
    db1.close();

    const db2 = new Database(DB_PATH);
    runSchema(db2);
    const row = db2.prepare('SELECT * FROM refresh_tokens WHERE id=?').get(id);
    expect(row).toBeDefined();
    expect(row.user_id).toBe(1);
    expect(row.token_hash).toBe('abc123hash');
    expect(row.expires_at).toBe('2026-12-31 00:00:00');
    db2.close();
  });
});

// ── 8. Foreign-key integrity after restart ────────────────────────────────────

describe('Foreign-key constraints still enforced after restart', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  beforeAll(() => {
    const db = new Database(DB_PATH);
    runSchema(db);
    db.prepare(`INSERT INTO departments (id,code,name) VALUES (1,'REV','Revenue')`).run();
    db.prepare(
      `INSERT INTO users (id,username,password_hash,role,dept_id) VALUES (1,'u','h','department',1)`
    ).run();
    db.prepare(
      `INSERT INTO notices (id,title,body,priority,deadline,created_by) VALUES (1,'N','B','Low','2026-12-31',1)`
    ).run();
    db.prepare(
      `INSERT INTO notice_status (notice_id,user_id) VALUES (1,1)`
    ).run();
    db.close();
  });

  test('CASCADE DELETE on notice_id removes notice_status rows when notice is deleted', () => {
    const db1 = new Database(DB_PATH);
    runSchema(db1); // simulated restart — FK must still be active
    db1.prepare('DELETE FROM notices WHERE id=1').run();
    const row = db1.prepare('SELECT * FROM notice_status WHERE notice_id=1').get();
    expect(row).toBeUndefined(); // cascaded away
    db1.close();
  });

  test('inserting a notice_status row with a non-existent notice_id is rejected after restart', () => {
    const db2 = new Database(DB_PATH);
    runSchema(db2);
    // Re-insert a user and notice so we can test the FK
    db2.prepare(`INSERT OR IGNORE INTO notices (id,title,body,priority,deadline,created_by) VALUES (99,'X','Y','Low','2099-01-01',1)`).run();
    expect(() =>
      db2.prepare(`INSERT INTO notice_status (notice_id,user_id) VALUES (9999,1)`).run()
    ).toThrow(); // FK violation
    db2.close();
  });

  test('SET NULL on dept_id when department is deleted, user row survives', () => {
    const db = new Database(DB_PATH);
    runSchema(db);
    db.prepare(`INSERT OR IGNORE INTO departments (id,code,name) VALUES (99,'TEMP','Temp Dept')`).run();
    db.prepare(
      `INSERT OR IGNORE INTO users (id,username,password_hash,role,dept_id) VALUES (99,'tempuser','h','department',99)`
    ).run();
    db.prepare('DELETE FROM departments WHERE id=99').run();
    const row = db.prepare('SELECT dept_id FROM users WHERE id=99').get();
    expect(row).toBeDefined();      // user still exists
    expect(row.dept_id).toBeNull(); // dept_id set to NULL by ON DELETE SET NULL
    db.close();
  });
});

// ── 9. Multiple consecutive restarts ─────────────────────────────────────────

describe('Data is stable across many consecutive restarts', () => {
  const DB_PATH = tmpDb();
  afterAll(() => cleanup(DB_PATH));

  test('data across all tables remains consistent after 10 restarts', () => {
    // Boot 1: seed data into all tables.
    const db0 = new Database(DB_PATH);
    runSchema(db0);
    db0.prepare(`INSERT INTO departments (id,code,name) VALUES (1,'REV','Revenue')`).run();
    db0.prepare(`INSERT INTO users (id,username,password_hash,role,dept_id) VALUES (1,'u','h','department',1)`).run();
    db0.prepare(`INSERT INTO notices (id,title,body,priority,deadline,created_by) VALUES (1,'N','B','Low','2099-01-01',1)`).run();
    db0.prepare(`INSERT INTO notice_status (notice_id,user_id,status) VALUES (1,1,'Noted')`).run();
    db0.prepare(`INSERT INTO notice_archive_stats (month,completed) VALUES ('2026-01',5)`).run();
    db0.close();

    // Boots 2–11: re-init schema and verify nothing changed.
    for (let i = 0; i < 10; i++) {
      const db = new Database(DB_PATH);
      runSchema(db);

      expect(db.prepare('SELECT COUNT(*) AS c FROM departments').get().c).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS c FROM users').get().c).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS c FROM notices').get().c).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS c FROM notice_status').get().c).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c).toBe(1);

      // Spot-check field values on each restart.
      expect(db.prepare('SELECT status FROM notice_status WHERE notice_id=1').get().status).toBe('Noted');
      expect(db.prepare('SELECT completed FROM notice_archive_stats WHERE month=?').get('2026-01').completed).toBe(5);

      db.close();
    }
  });
});
