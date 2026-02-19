/**
 * auth.test.js — tests for /api/auth routes
 * Covers: login, /me, change-password
 */

// jest.mock is hoisted by Jest before any require/import.
// The factory is called once when db.js is first required, returning
// a fresh in-memory SQLite instance with schema + seed data.
jest.mock('../database/db', () => require('./testDb').createDb());

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-for-jest-at-least-32-characters-long-xxx';

const request = require('supertest');
const app     = require('../app');

afterAll(() => {
  // Close the in-memory DB to free resources
  const db = require('../database/db');
  if (db && typeof db.close === 'function') db.close();
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('admin logs in and receives token — password_hash not exposed', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@Test123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  test('department user logs in and receives correct dept_id', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_revenue', password: 'Dept@Test123' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('department');
    expect(res.body.user.dept_id).toBe(1);
    expect(res.body.user.dept_code).toBe('REVENUE');
  });

  test('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 401 for non-existent username', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost_user', password: 'whatever123' });

    expect(res.status).toBe(401);
  });

  test('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'Admin@Test123' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });

    expect(res.status).toBe(400);
  });

  test('returns 403 for a deactivated account', async () => {
    const db = require('../database/db');
    db.prepare("UPDATE users SET is_active = 0 WHERE username = 'dept_health'").run();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_health', password: 'Dept@Test123' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/i);

    // Restore for subsequent tests
    db.prepare("UPDATE users SET is_active = 1 WHERE username = 'dept_health'").run();
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  let adminToken;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@Test123' });
    adminToken = res.body.token;
  });

  test('returns current user info with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
    expect(res.body.role).toBe('admin');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.valid.jwt.at.all');

    expect(res.status).toBe(401);
  });

  test('returns 401 when Bearer prefix is missing', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', adminToken); // no "Bearer " prefix

    expect(res.status).toBe(401);
  });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
describe('POST /api/auth/change-password', () => {
  let healthToken;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_health', password: 'Dept@Test123' });
    healthToken = res.body.token;
  });

  test('changes password successfully with correct current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${healthToken}`)
      .send({ currentPassword: 'Dept@Test123', newPassword: 'NewHealth@456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify new password works
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'dept_health', password: 'NewHealth@456' });
    expect(loginRes.status).toBe(200);

    // Restore original password for subsequent tests
    const bcrypt = require('bcryptjs');
    const db     = require('../database/db');
    db.prepare("UPDATE users SET password_hash = ? WHERE username = 'dept_health'")
      .run(bcrypt.hashSync('Dept@Test123', 10));
  });

  test('returns 401 for incorrect current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${healthToken}`)
      .send({ currentPassword: 'wrongcurrentpass', newPassword: 'NewPass456' });

    expect(res.status).toBe(401);
  });

  test('returns 400 if new password is fewer than 6 characters', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${healthToken}`)
      .send({ currentPassword: 'Dept@Test123', newPassword: 'abc' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when a field is missing', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${healthToken}`)
      .send({ currentPassword: 'Dept@Test123' }); // newPassword missing

    expect(res.status).toBe(400);
  });

  test('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Dept@Test123', newPassword: 'NewPass456' });

    expect(res.status).toBe(401);
  });
});
