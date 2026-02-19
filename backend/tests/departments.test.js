/**
 * departments.test.js — tests for /api/departments routes
 * Covers: list, filter by category, single dept by id,
 *         route ordering fix for /officials/all,
 *         POST /api/departments (admin-only, create department)
 */

jest.mock('../database/db', () => require('./testDb').createDb());

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-for-jest-at-least-32-characters-long-xxx';

const request = require('supertest');
const app     = require('../app');

let adminToken, revenueToken;

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

// ── GET /api/departments ──────────────────────────────────────────────────────
describe('GET /api/departments', () => {
  test('returns all departments as a JSON array', async () => {
    const res = await request(app).get('/api/departments');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3); // testDb seeds exactly 3 departments
  });

  test('each department object has required fields', async () => {
    const res = await request(app).get('/api/departments');

    res.body.forEach(dept => {
      expect(dept).toHaveProperty('id');
      expect(dept).toHaveProperty('code');
      expect(dept).toHaveProperty('name');
    });
  });

  test('filters departments by category query param', async () => {
    const res = await request(app).get('/api/departments?category=Administration');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Only Revenue is seeded with category=Administration
    expect(res.body.length).toBe(1);
    expect(res.body[0].code).toBe('REVENUE');
  });

  test('returns empty array for a category with no matching departments', async () => {
    const res = await request(app).get('/api/departments?category=DoesNotExist');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── GET /api/departments/:id ──────────────────────────────────────────────────
describe('GET /api/departments/:id', () => {
  test('returns the correct department for a valid numeric id', async () => {
    const res = await request(app).get('/api/departments/1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.code).toBe('REVENUE');
    expect(res.body.name).toBe('Revenue Department');
  });

  test('returns department 2 correctly', async () => {
    const res = await request(app).get('/api/departments/2');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(2);
    expect(res.body.code).toBe('HEALTH');
  });

  test('returns 404 for a non-existent department id', async () => {
    const res = await request(app).get('/api/departments/9999');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 for a non-numeric id (NaN guard)', async () => {
    const res = await request(app).get('/api/departments/notanumber');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ── GET /api/departments/officials/all ────────────────────────────────────────
// Critical regression test: validates the route-ordering bug fix.
// Before the fix, /officials/all was defined AFTER /:id, causing Express to
// match it as /:id with id='officials'. parseInt('officials') = NaN → 400/404.
// After the fix, /officials/all is defined BEFORE /:id → 200 (or 500 if the
// JSON data file is absent, which is not a routing issue).
describe('GET /api/departments/officials/all', () => {
  test('route is NOT swallowed by /:id — must not return 404', async () => {
    const res = await request(app).get('/api/departments/officials/all');

    // 404 = routing bug is back; we must never see this
    expect(res.status).not.toBe(404);
    // 200 = officials JSON file found; 500 = file missing (not a routing issue)
    expect([200, 500]).toContain(res.status);
  });

  test('if responding with 200, body must be an array', async () => {
    const res = await request(app).get('/api/departments/officials/all');

    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
});

// ── POST /api/departments ─────────────────────────────────────────────────────
describe('POST /api/departments', () => {
  test('admin creates a new department with a valid name', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Education Department' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Education Department');
    expect(res.body).toHaveProperty('code');
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code.length).toBeGreaterThan(0);
  });

  test('auto-generates an uppercase code from the department name', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Water Resources' });

    expect(res.status).toBe(201);
    // Code should be derived from the name — uppercase, no spaces
    expect(res.body.code).toMatch(/^[A-Z0-9_]+$/);
  });

  test('newly created department appears in GET /api/departments', async () => {
    await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Forest Department' });

    const listRes = await request(app).get('/api/departments');
    const names   = listRes.body.map(d => d.name);
    expect(names).toContain('Forest Department');
  });

  test('handles duplicate name gracefully by generating a unique code', async () => {
    // Create first
    await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Duplicate Dept' });

    // Create again with same name — code conflict should be resolved automatically
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Duplicate Dept' });

    // Should still succeed with a disambiguated code
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });

  test('returns 400 when name is missing from the request body', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('returns 400 when name is an empty string', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '   ' }); // whitespace only

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('department user cannot create departments — blocked with 403', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set('Authorization', `Bearer ${revenueToken}`)
      .send({ name: 'Unauthorized Dept' });

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/departments')
      .send({ name: 'No Auth Dept' });

    expect(res.status).toBe(401);
  });
});
