/**
 * notices.test.js — tests for /api/portal/notices routes
 * Covers: summary, all, inbox, outbox, create, detail, status-update
 */

jest.mock('../database/db', () => require('./testDb').createDb());
jest.mock('../storage', () => ({
  saveFile: jest.fn().mockResolvedValue('/uploads/mock-test-file.pdf'),
  isS3:     false,
}));

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-for-jest-at-least-32-characters-long-xxx';

const request = require('supertest');
const app     = require('../app');

let adminToken, revenueToken, healthToken;
// ID of the primary notice: revenue → health (specific target)
let primaryNoticeId;

beforeAll(async () => {
  // Login all three users in parallel
  const [adminRes, revRes, healthRes] = await Promise.all([
    request(app).post('/api/auth/login').send({ username: 'admin',        password: 'Admin@Test123' }),
    request(app).post('/api/auth/login').send({ username: 'dept_revenue', password: 'Dept@Test123' }),
    request(app).post('/api/auth/login').send({ username: 'dept_health',  password: 'Dept@Test123' }),
  ]);

  adminToken   = adminRes.body.token;
  revenueToken = revRes.body.token;
  healthToken  = healthRes.body.token;
});

afterAll(() => {
  const db = require('../database/db');
  if (db && typeof db.close === 'function') db.close();
});

// ── GET /api/portal/notices/summary (admin only) ─────────────────────────────
describe('GET /api/portal/notices/summary', () => {
  test('admin receives summary with total, pending, overdue fields', async () => {
    const res = await request(app)
      .get('/api/portal/notices/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.pending).toBe('number');
    expect(typeof res.body.overdue).toBe('number');
  });

  test('department user is blocked with 403', async () => {
    const res = await request(app)
      .get('/api/portal/notices/summary')
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/notices/summary');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/portal/notices (create) ────────────────────────────────────────
describe('POST /api/portal/notices', () => {
  test('dept user creates a notice targeting a specific department', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Budget Report Request')
      .field('body',            'Please submit the Q4 budget report by the deadline.')
      .field('priority',        'High')
      .field('deadline',        '2026-12-31')
      .field('target_dept_ids', '2'); // Health dept (id=2)

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.noticeId).toBe('number');

    primaryNoticeId = res.body.noticeId; // used by later describe blocks
  });

  test('creates a notice targeting all departments', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',      'General Circular — All Departments')
      .field('body',       'This circular applies to all departments.')
      .field('priority',   'Normal')
      .field('deadline',   '2026-12-31')
      .field('target_all', '1');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('admin cannot create notices — returns 403', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('title',           'Admin Notice')
      .field('body',            'From admin')
      .field('priority',        'Normal')
      .field('deadline',        '2026-12-31')
      .field('target_dept_ids', '2');

    expect(res.status).toBe(403);
  });

  test('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title', 'Only a title'); // missing body, priority, deadline

    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid priority value', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Bad Priority Notice')
      .field('body',            'test body')
      .field('priority',        'Urgent') // invalid
      .field('deadline',        '2026-12-31')
      .field('target_dept_ids', '2');

    expect(res.status).toBe(400);
  });

  test('returns 400 for an invalid deadline format', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Bad Deadline')
      .field('body',            'test body')
      .field('priority',        'Normal')
      .field('deadline',        '31-12-2026') // wrong format
      .field('target_dept_ids', '2');

    expect(res.status).toBe(400);
  });

  test('returns 400 when neither target_all nor target_dept_ids is provided', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',    'No Target Notice')
      .field('body',     'test body')
      .field('priority', 'Low')
      .field('deadline', '2026-12-31');

    expect(res.status).toBe(400);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .field('title',           'Unauth Notice')
      .field('body',            'test body')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_dept_ids', '2');

    expect(res.status).toBe(401);
  });
});

// ── GET /api/portal/notices/inbox ────────────────────────────────────────────
describe('GET /api/portal/notices/inbox', () => {
  test('health dept sees the notice that targets it', async () => {
    const res = await request(app)
      .get('/api/portal/notices/inbox')
      .set('Authorization', `Bearer ${healthToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const found = res.body.find(n => n.id === primaryNoticeId);
    expect(found).toBeDefined();
    expect(found.status).toBe('Pending');
    expect(found.is_read).toBe(0);
    expect(found).toHaveProperty('is_overdue');
    expect(found).toHaveProperty('days_lapsed');
  });

  test('admin inbox always returns empty array', async () => {
    const res = await request(app)
      .get('/api/portal/notices/inbox')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/notices/inbox');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/portal/notices/outbox ───────────────────────────────────────────
describe('GET /api/portal/notices/outbox', () => {
  test('revenue dept sees notices it created with target chips', async () => {
    const res = await request(app)
      .get('/api/portal/notices/outbox')
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const found = res.body.find(n => n.id === primaryNoticeId);
    expect(found).toBeDefined();
    expect(found).toHaveProperty('targets');
    expect(Array.isArray(found.targets)).toBe(true);
    expect(found).toHaveProperty('pending_count');
    expect(found).toHaveProperty('total_targets');
  });

  test('admin outbox returns empty array', async () => {
    const res = await request(app)
      .get('/api/portal/notices/outbox')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/notices/outbox');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/portal/notices/all (admin only) ─────────────────────────────────
describe('GET /api/portal/notices/all', () => {
  test('admin gets all notices with overdue metadata', async () => {
    const res = await request(app)
      .get('/api/portal/notices/all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const notice = res.body[0];
    expect(notice).toHaveProperty('is_overdue');
    expect(notice).toHaveProperty('days_lapsed');
    expect(notice).toHaveProperty('pending_count');
    expect(notice).toHaveProperty('total_targets');
    expect(notice).toHaveProperty('source_dept_name');
  });

  test('department user is blocked with 403', async () => {
    const res = await request(app)
      .get('/api/portal/notices/all')
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/notices/all');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/portal/notices/:id (detail) ─────────────────────────────────────
describe('GET /api/portal/notices/:id', () => {
  test('returns notice detail with statuses array', async () => {
    const res = await request(app)
      .get(`/api/portal/notices/${primaryNoticeId}`)
      .set('Authorization', `Bearer ${healthToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(primaryNoticeId);
    expect(res.body.title).toBe('Budget Report Request');
    expect(Array.isArray(res.body.statuses)).toBe(true);
    expect(res.body.statuses.length).toBeGreaterThanOrEqual(1);
  });

  test('fetching detail marks the notice as is_read=1 for requesting dept', async () => {
    // health already fetched the notice above — is_read should now be 1
    const db  = require('../database/db');
    const row = db.prepare(
      'SELECT is_read FROM notice_status WHERE notice_id = ? AND dept_id = 2'
    ).get(primaryNoticeId);

    expect(row.is_read).toBe(1);
  });

  test('returns 404 for a non-existent notice id', async () => {
    const res = await request(app)
      .get('/api/portal/notices/99999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .get(`/api/portal/notices/${primaryNoticeId}`);

    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/portal/notices/:id/status ─────────────────────────────────────
describe('PATCH /api/portal/notices/:id/status', () => {
  // Second notice: health → revenue, used for validation tests
  let validationNoticeId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${healthToken}`)
      .field('title',           'Validation Notice')
      .field('body',            'Created for status-update validation tests.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_dept_ids', '1'); // Revenue dept (id=1)

    validationNoticeId = res.body.noticeId;
  });

  test('health marks primaryNotice as Noted with a remark', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${primaryNoticeId}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Noted')
      .field('remark', 'Acknowledged by Health Department.');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db  = require('../database/db');
    const row = db.prepare(
      'SELECT status, remark FROM notice_status WHERE notice_id = ? AND dept_id = 2'
    ).get(primaryNoticeId);
    expect(row.status).toBe('Noted');
    expect(row.remark).toBe('Acknowledged by Health Department.');
  });

  test('health upgrades status from Noted to Completed', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${primaryNoticeId}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Action taken and task completed successfully.');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db  = require('../database/db');
    const row = db.prepare(
      'SELECT status FROM notice_status WHERE notice_id = ? AND dept_id = 2'
    ).get(primaryNoticeId);
    expect(row.status).toBe('Completed');
  });

  test('returns 400 when trying to update an already-Completed notice', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${primaryNoticeId}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Noted')
      .field('remark', 'Attempting to revert from Completed.');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been marked as completed/i);
  });

  test('returns 400 when remark is missing', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${validationNoticeId}/status`)
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('status', 'Noted'); // no remark field

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/remark/i);
  });

  test('returns 400 for an invalid status value (e.g. Pending)', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${validationNoticeId}/status`)
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('status', 'Pending') // not allowed via PATCH
      .field('remark', 'Trying to set back to pending');

    expect(res.status).toBe(400);
  });

  test('returns 403 when dept is not a target of the notice', async () => {
    // revenue tries to update primaryNoticeId which only targets health
    const res = await request(app)
      .patch(`/api/portal/notices/${primaryNoticeId}/status`)
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('status', 'Noted')
      .field('remark', 'Revenue trying to update a notice not addressed to it.');

    expect(res.status).toBe(403);
  });

  test('admin cannot update notice status — returns 403', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${validationNoticeId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('status', 'Completed')
      .field('remark', 'Admin attempting status update.');

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .patch(`/api/portal/notices/${validationNoticeId}/status`)
      .field('status', 'Noted')
      .field('remark', 'No token provided.');

    expect(res.status).toBe(401);
  });
});

// ── GET /api/portal/notices/monthly-stats (admin only) ───────────────────────
// Runs last so the PATCH tests above have already produced Completed entries.
describe('GET /api/portal/notices/monthly-stats', () => {
  test('admin receives an array with at least one entry after notices are completed', async () => {
    const res = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // PATCH tests completed primaryNoticeId, so there must be at least one entry
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('each entry has month in YYYY-MM format and a positive completed count', async () => {
    const res = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    res.body.forEach(entry => {
      expect(entry).toHaveProperty('month');
      expect(entry).toHaveProperty('completed');
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof entry.completed).toBe('number');
      expect(entry.completed).toBeGreaterThan(0);
    });
  });

  test('completed count increases after a new notice is marked complete', async () => {
    const before      = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const totalBefore = before.body.reduce((s, e) => s + e.completed, 0);

    // Create a fresh notice and complete it
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Stats Increment Notice')
      .field('body',            'Created to verify monthly stats increment.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_dept_ids', '2');

    await request(app)
      .patch(`/api/portal/notices/${createRes.body.noticeId}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Completed for stats increment test.');

    const after      = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const totalAfter = after.body.reduce((s, e) => s + e.completed, 0);

    expect(totalAfter).toBeGreaterThan(totalBefore);
  });

  test('results are ordered chronologically (oldest month first)', async () => {
    const res = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);

    const months = res.body.map(e => e.month);
    const sorted = [...months].sort();
    expect(months).toEqual(sorted);
  });

  test('department user is blocked with 403', async () => {
    const res = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/notices/monthly-stats');
    expect(res.status).toBe(401);
  });
});
