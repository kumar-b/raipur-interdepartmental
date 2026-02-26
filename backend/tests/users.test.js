/**
 * users.test.js — tests for /api/portal/users routes (admin only)
 * Covers: list users, create user, toggle active, reset password
 */

jest.mock('../database/db', () => require('./testDb').createDb());

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-for-jest-at-least-32-characters-long-xxx';

const request = require('supertest');
const app     = require('../app');

let adminToken, revenueToken;
let createdUserId; // set in the "create user" test, reused in later tests

beforeAll(async () => {
  const [adminRes, revRes] = await Promise.all([
    request(app).post('/api/auth/login').send({ username: 'admin',        password: 'Admin@Test123' }),
    request(app).post('/api/auth/login').send({ username: 'dept_revenue', password: 'Dept@Test123' }),
  ]);

  adminToken   = adminRes.body.token;
  revenueToken = revRes.body.token;
});

afterAll(() => {
  const db = require('../database/db');
  if (db && typeof db.close === 'function') db.close();
});

// ── GET /api/portal/users ─────────────────────────────────────────────────────
describe('GET /api/portal/users', () => {
  test('admin receives a list of all users', async () => {
    const res = await request(app)
      .get('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3); // admin + dept_revenue + dept_health

    // password_hash must never be returned
    res.body.forEach(u => expect(u).not.toHaveProperty('password_hash'));
  });

  test('users include id, username, role, is_active fields', async () => {
    const res = await request(app)
      .get('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`);

    const admin = res.body.find(u => u.username === 'admin');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('admin');
    expect(admin.is_active).toBe(1);
  });

  test('department user is blocked with 403', async () => {
    const res = await request(app)
      .get('/api/portal/users')
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/users');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/portal/users ────────────────────────────────────────────────────
describe('POST /api/portal/users', () => {
  test('admin creates a new department user', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dept_pwd', password: 'PWD@Test123', role: 'department', dept_id: 3 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.userId).toBe('number');

    createdUserId = res.body.userId;
  });

  test('newly created user can log in immediately', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_pwd', password: 'PWD@Test123' });

    expect(res.status).toBe(200);
    expect(res.body.user.dept_id).toBe(3);
    expect(res.body.user.role).toBe('department');
  });

  test('admin creates a new admin user (no dept_id required)', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'admin2', password: 'Admin2@Test', role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('returns 409 for a duplicate username', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dept_pwd', password: 'Diff@Pass123', role: 'department', dept_id: 3 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  test('returns 400 for an invalid role value', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'baduser', password: 'Pass123', role: 'superuser' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when dept_id is missing for a department role', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dept_nodept', password: 'Pass123', role: 'department' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when required fields (username) are missing', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'Pass123', role: 'department', dept_id: 2 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when password is fewer than 6 characters', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dept_short', password: 'abc', role: 'department', dept_id: 2 });

    expect(res.status).toBe(400);
  });

  test('department user cannot create users — blocked with 403', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${revenueToken}`)
      .send({ username: 'dept_newuser', password: 'Pass1234', role: 'department', dept_id: 2 });

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/portal/users')
      .send({ username: 'noauth', password: 'Pass1234', role: 'department', dept_id: 2 });

    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/portal/users/:id/status ───────────────────────────────────────
describe('PATCH /api/portal/users/:id/status', () => {
  test('admin deactivates a user — subsequent login fails with 403', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: 0 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the deactivated user can no longer log in
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_pwd', password: 'PWD@Test123' });
    expect(loginRes.status).toBe(403);
  });

  test('admin reactivates a user — login succeeds again', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: 1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the user can log in again
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_pwd', password: 'PWD@Test123' });
    expect(loginRes.status).toBe(200);
  });

  test('admin cannot deactivate their own account — returns 400', async () => {
    const db    = require('../database/db');
    const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();

    const res = await request(app)
      .patch(`/api/portal/users/${admin.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot deactivate your own/i);
  });

  test('department user cannot toggle user status — blocked with 403', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${revenueToken}`)
      .send({ is_active: 0 });

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/status`)
      .send({ is_active: 0 });

    expect(res.status).toBe(401);
  });
});

// ── Admin-panel users persist through schema re-initialisation ────────────────
// Simulates a server restart by re-running every CREATE TABLE IF NOT EXISTS
// statement from db.js against the live in-memory test database.
// If any statement were a DROP TABLE the user created via the API would vanish.
describe('Users created via admin panel survive schema re-initialisation (simulated restart)', () => {
  let persistUserId;

  beforeAll(async () => {
    // Create a fresh user through the real API endpoint — exactly as the admin
    // panel does it.
    const res = await request(app)
      .post('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'dept_persist', password: 'Persist@1234', role: 'department', dept_id: 1 });

    persistUserId = res.body.userId;
  });

  test('user exists in DB before simulated restart', () => {
    const db  = require('../database/db');
    const row = db.prepare(`SELECT * FROM users WHERE username = 'dept_persist'`).get();
    expect(row).toBeDefined();
    expect(row.role).toBe('department');
  });

  test('user still exists after schema re-initialisation (CREATE TABLE IF NOT EXISTS is safe)', () => {
    const db = require('../database/db');

    // Re-run the exact schema statements from db.js — this is what happens on
    // every server restart. A DROP TABLE here would erase the user.
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

    const row = db.prepare(`SELECT * FROM users WHERE username = 'dept_persist'`).get();
    expect(row).toBeDefined();
    expect(row.id).toBe(persistUserId);
    expect(row.role).toBe('department');
    expect(row.is_active).toBe(1);
  });

  test('user can still log in after simulated restart', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_persist', password: 'Persist@1234' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.username).toBe('dept_persist');
    expect(res.body.user.role).toBe('department');
  });

  test('user appears in admin user list after simulated restart', async () => {
    const res = await request(app)
      .get('/api/portal/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const found = res.body.find(u => u.username === 'dept_persist');
    expect(found).toBeDefined();
    expect(found.id).toBe(persistUserId);
  });

  test('total user count is unchanged after schema re-init', () => {
    const db = require('../database/db');
    // Count before and after a second schema re-init — must be identical.
    const countBefore = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','department')),
      dept_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );`);
    const countAfter = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    expect(countAfter).toBe(countBefore);
  });
});

// ── PATCH /api/portal/users/:id/password ─────────────────────────────────────
describe('PATCH /api/portal/users/:id/password', () => {
  test('admin resets a user password and new password works for login', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'ResetPass@789' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the new password works
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_pwd', password: 'ResetPass@789' });
    expect(loginRes.status).toBe(200);
  });

  test('returns 400 when newPassword is fewer than 6 characters', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'abc' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when newPassword is missing', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('department user cannot reset passwords — blocked with 403', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/password`)
      .set('Authorization', `Bearer ${revenueToken}`)
      .send({ newPassword: 'NewPass123' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .patch(`/api/portal/users/${createdUserId}/password`)
      .send({ newPassword: 'NewPass123' });

    expect(res.status).toBe(401);
  });
});
