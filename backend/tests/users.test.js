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
