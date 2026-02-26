/**
 * notices.test.js — tests for /api/portal/notices routes
 * Covers: summary, all, inbox, outbox, create, detail, status-update
 */

jest.mock('../database/db', () => require('./testDb').createDb());
jest.mock('../storage', () => ({
  saveFile:   jest.fn().mockResolvedValue('/uploads/mock-test-file.pdf'),
  // deleteFile is called when closing a notice — mock it so no real filesystem
  // operations happen in tests.
  deleteFile: jest.fn().mockResolvedValue(undefined),
  isS3:       false,
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
      .field('target_user_ids', '3'); // Health dept (id=2)

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
      .field('target_user_ids', '3');

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
      .field('target_user_ids', '3');

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
      .field('target_user_ids', '3');

    expect(res.status).toBe(400);
  });

  test('returns 400 when neither target_all nor target_user_ids is provided', async () => {
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
      .field('target_user_ids', '3');

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
      'SELECT is_read FROM notice_status WHERE notice_id = ? AND user_id = 3'
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
      .field('target_user_ids', '2'); // Revenue user (id=2)

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
      'SELECT status, remark FROM notice_status WHERE notice_id = ? AND user_id = 3'
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
      'SELECT status FROM notice_status WHERE notice_id = ? AND user_id = 3'
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
      .field('target_user_ids', '3');

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

// ── GET /api/portal/notices/delayed-response (admin only) ────────────────────
// Runs after the PATCH block so there are already Completed entries in the DB.
// Two notices are created here specifically to exercise the delay calculation:
//   • onTimeNoticeId  — future deadline  → response is early   (contributes 0 days)
//   • lateNoticeId    — past deadline    → response is delayed (contributes N days)
describe('GET /api/portal/notices/delayed-response', () => {
  let onTimeNoticeId; // deadline far in future — health responds early
  let lateNoticeId;   // deadline far in past   — health responds late

  beforeAll(async () => {
    // Notice 1: future deadline — any response today is early.
    const onTimeRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'On-Time Response Notice')
      .field('body',            'Deadline is far in the future — response will be early.')
      .field('priority',        'Normal')
      .field('deadline',        '2099-12-31')
      .field('target_user_ids', '3'); // health
    onTimeNoticeId = onTimeRes.body.noticeId;

    // Notice 2: past deadline — any response today is late.
    const lateRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Overdue Response Notice')
      .field('body',            'Deadline was in the past — response will be delayed.')
      .field('priority',        'High')
      .field('deadline',        '2025-01-01')
      .field('target_user_ids', '3'); // health
    lateNoticeId = lateRes.body.noticeId;

    // Health responds to both.
    await Promise.all([
      request(app)
        .patch(`/api/portal/notices/${onTimeNoticeId}/status`)
        .set('Authorization', `Bearer ${healthToken}`)
        .field('status', 'Completed')
        .field('remark', 'Responded well before deadline.'),
      request(app)
        .patch(`/api/portal/notices/${lateNoticeId}/status`)
        .set('Authorization', `Bearer ${healthToken}`)
        .field('status', 'Completed')
        .field('remark', 'Responding after the deadline has passed.'),
    ]);
  });

  test('admin receives 200 with an array', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('each entry has the required fields with correct types', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const entry = res.body[0];
    expect(entry).toHaveProperty('user_id');
    expect(entry).toHaveProperty('username');
    expect(entry).toHaveProperty('total_responded');
    expect(entry).toHaveProperty('total_days_delayed');
    expect(entry).toHaveProperty('delayed_count');
    expect(typeof entry.total_responded).toBe('number');
    expect(typeof entry.total_days_delayed).toBe('number');
    expect(typeof entry.delayed_count).toBe('number');
  });

  test('only includes users who have responded — pending-only users are excluded', async () => {
    // Create a notice targeting dept_civil (id=4) and leave it Pending.
    await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Pending Only — civil dept')
      .field('body',            'civil will not respond to this notice.')
      .field('priority',        'Low')
      .field('deadline',        '2025-01-01')
      .field('target_user_ids', '4'); // civil — intentionally left Pending

    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    // dept_civil appears in no Completed/Noted rows → must be absent.
    const civilEntry = res.body.find(e => e.username === 'dept_civil');
    expect(civilEntry).toBeUndefined();
  });

  test('late response (past deadline) contributes positive days to total_days_delayed', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    const healthEntry = res.body.find(e => e.username === 'dept_health');
    expect(healthEntry).toBeDefined();
    // lateNoticeId had deadline 2025-01-01; today is well past that.
    expect(healthEntry.total_days_delayed).toBeGreaterThan(0);
    expect(healthEntry.delayed_count).toBeGreaterThanOrEqual(1);
  });

  test('on-time response does not increase total_days_delayed', async () => {
    const db = require('../database/db');

    // Isolate: check the DB directly — the on-time notice row must have 0 delay.
    const row = db.prepare(`
      SELECT CAST(julianday(date(ns.updated_at)) - julianday(date(n.deadline)) AS INTEGER) AS diff
      FROM notice_status ns
      JOIN notices n ON n.id = ns.notice_id
      WHERE ns.notice_id = ? AND ns.user_id = 3
    `).get(onTimeNoticeId);

    // updated_at (today) is before 2099-12-31, so diff must be <= 0.
    expect(row.diff).toBeLessThanOrEqual(0);
  });

  test('total_responded counts all Noted + Completed rows for the user', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    const healthEntry = res.body.find(e => e.username === 'dept_health');
    expect(healthEntry).toBeDefined();
    // Health responded to onTimeNoticeId + lateNoticeId in this block,
    // plus primaryNoticeId from the PATCH block → at least 3 total.
    expect(healthEntry.total_responded).toBeGreaterThanOrEqual(3);
  });

  test('delayed_count is always <= total_responded and total_days_delayed >= 0', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    res.body.forEach(entry => {
      expect(entry.delayed_count).toBeLessThanOrEqual(entry.total_responded);
      expect(entry.total_days_delayed).toBeGreaterThanOrEqual(0);
    });
  });

  test('results are ordered by total_days_delayed descending', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${adminToken}`);

    const delays = res.body.map(e => e.total_days_delayed);
    const sorted = [...delays].sort((a, b) => b - a);
    expect(delays).toEqual(sorted);
  });

  test('department user is blocked with 403', async () => {
    const res = await request(app)
      .get('/api/portal/notices/delayed-response')
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(403);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/portal/notices/delayed-response');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/portal/notices/:id  (close a notice) ─────────────────────────
// "Closing" permanently removes a notice, deletes its files, and archives stats.
// Admin: can force-close ANY notice regardless of completion status.
// Dept:  can only close their OWN notices when ALL targets have completed.
describe('DELETE /api/portal/notices/:id — close notice', () => {
  // A notice that stays Pending — used to verify dept-user 400 and admin override.
  let pendingNoticeId;
  // A notice completed by all targets — used for archive-stats verification.
  let completedNoticeId;

  beforeAll(async () => {
    // Create a Pending notice (health dept is the target, not acknowledged)
    const pendingRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Pending Notice For Close Test')
      .field('body',            'This notice will remain pending throughout these tests.')
      .field('priority',        'Normal')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3'); // Health — left Pending intentionally
    pendingNoticeId = pendingRes.body.noticeId;

    // Create + fully complete a notice for the stats-archive tests
    const compRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Completed Notice For Stats Archive Test')
      .field('body',            'All targets will complete this so we can verify stat archiving.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3');
    completedNoticeId = compRes.body.noticeId;

    await request(app)
      .patch(`/api/portal/notices/${completedNoticeId}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Done — used to verify stats archiving after close.');
  });

  // ── Basic close behaviour ────────────────────────────────────────────────

  test('admin closes a fully completed notice — returns 200 and notice is gone (404)', async () => {
    // Create + complete a fresh notice so we don't disturb other tests.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Admin Closable Completed Notice')
      .field('body',            'Will be closed by admin after completion.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3');
    const nid = createRes.body.noticeId;

    await request(app)
      .patch(`/api/portal/notices/${nid}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Task done.');

    const res = await request(app)
      .delete(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/closed/i);

    // Verify the record is actually gone.
    const check = await request(app)
      .get(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.status).toBe(404);
  });

  test('dept user (revenue) closes their own fully completed notice — returns 200', async () => {
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Revenue Self-Close Notice')
      .field('body',            'Created and closed by revenue after health completes.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3');
    const nid = createRes.body.noticeId;

    await request(app)
      .patch(`/api/portal/notices/${nid}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Done by health.');

    const res = await request(app)
      .delete(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ── Dept-user restrictions ────────────────────────────────────────────────

  test('dept user cannot close a notice created by another dept — returns 403', async () => {
    // Revenue creates the notice; health (a target) tries to close it.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Revenue Notice — Health Cannot Close')
      .field('body',            'Only revenue or admin may close this.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3');

    const res = await request(app)
      .delete(`/api/portal/notices/${createRes.body.noticeId}`)
      .set('Authorization', `Bearer ${healthToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only close notices you created/i);
  });

  test('dept user cannot close their own notice when targets have not completed — returns 400', async () => {
    // pendingNoticeId is owned by revenue but health has not acknowledged it.
    const res = await request(app)
      .delete(`/api/portal/notices/${pendingNoticeId}`)
      .set('Authorization', `Bearer ${revenueToken}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not all/i);
  });

  // ── Admin force-close (pending/incomplete notices) ────────────────────────

  test('admin can force-close a Pending/incomplete notice — returns 200', async () => {
    // Create a fresh pending notice specifically for this test.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Admin Force-Close Pending Notice')
      .field('body',            'Admin will close this even though health has not responded.')
      .field('priority',        'High')
      .field('deadline',        '2026-01-01') // already overdue
      .field('target_user_ids', '3');
    const nid = createRes.body.noticeId;

    // Health has NOT acknowledged — notice is still Pending.
    const res = await request(app)
      .delete(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Confirm the notice is gone.
    const check = await request(app)
      .get(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.status).toBe(404);
  });

  test('admin force-closes a partially completed notice (some Completed, some Pending) — returns 200', async () => {
    // This is the key scenario: multiple target departments where SOME have
    // completed the notice and others have not yet responded.
    // The test database seeds three departments:
    //   id=1 (Revenue)  — the sender, not a target
    //   id=2 (Health)   — seeded user exists → will mark Completed
    //   id=3 (PWD)      — no seeded user   → stays Pending
    // Revenue creates a notice targeting BOTH Health and PWD.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Partially Completed — Admin Force-Close Test')
      .field('body',            'Health will complete; PWD stays Pending. Admin must still be able to close.')
      .field('priority',        'Normal')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3')   // Health — will be completed below
      .field('target_user_ids', '4');  // PWD   — seeded user (id=4), will stay Pending

    expect(createRes.status).toBe(201);
    const nid = createRes.body.noticeId;

    // Health marks the notice Completed.
    await request(app)
      .patch(`/api/portal/notices/${nid}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Health dept done. PWD still pending.');

    // Confirm mixed state in DB: one Completed row, one Pending row.
    const db = require('../database/db');
    const rows = db.prepare(
      'SELECT user_id, status FROM notice_status WHERE notice_id = ? ORDER BY user_id'
    ).all(nid);
    expect(rows.some(r => r.status === 'Completed')).toBe(true); // Health completed
    expect(rows.some(r => r.status === 'Pending')).toBe(true);   // PWD still pending

    // Admin closes the partially complete notice — must succeed despite PWD being Pending.
    const res = await request(app)
      .delete(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Notice must be fully removed from the database.
    const check = await request(app)
      .get(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.status).toBe(404);
  });

  test('admin force-close of a Pending notice does not add 0-completed entries to stats', async () => {
    // Record the total completed count before the force-close.
    const before = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const totalBefore = (before.body || []).reduce((s, e) => s + e.completed, 0);

    // Create + force-close without any completions.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Force-Close Zero Stats Notice')
      .field('body',            'No one will complete this before admin closes it.')
      .field('priority',        'Low')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3');

    await request(app)
      .delete(`/api/portal/notices/${createRes.body.noticeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const after = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const totalAfter = (after.body || []).reduce((s, e) => s + e.completed, 0);

    // Closing a 0-completed notice must not inflate the stats.
    expect(totalAfter).toBe(totalBefore);
  });

  // ── Statistics preservation after close ──────────────────────────────────

  test('closing a fully completed notice preserves its stats in monthly-stats', async () => {
    // completedNoticeId was created and completed in beforeAll.
    // Record stats before closing.
    const before = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const totalBefore = (before.body || []).reduce((s, e) => s + e.completed, 0);
    expect(totalBefore).toBeGreaterThanOrEqual(1); // at least the one we completed above

    // Close the notice (admin close so we don't need to worry about status).
    const closeRes = await request(app)
      .delete(`/api/portal/notices/${completedNoticeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(closeRes.status).toBe(200);

    // Stats should still be >= totalBefore (the archive preserved the count).
    const after = await request(app)
      .get('/api/portal/notices/monthly-stats')
      .set('Authorization', `Bearer ${adminToken}`);
    const totalAfter = (after.body || []).reduce((s, e) => s + e.completed, 0);
    expect(totalAfter).toBeGreaterThanOrEqual(totalBefore);
  });

  test('notice_archive_stats table has a row after closing a completed notice', async () => {
    // Create + complete + close a notice and verify the archive row exists.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Archive Row Verification Notice')
      .field('body',            'Verify archive row exists after close.')
      .field('priority',        'Normal')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3');
    const nid = createRes.body.noticeId;

    await request(app)
      .patch(`/api/portal/notices/${nid}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Done for archive test.');

    // Count archive rows before close.
    const db = require('../database/db');
    const countBefore = db.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c;

    await request(app)
      .delete(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Archive table should have gained at least one row.
    const countAfter = db.prepare('SELECT COUNT(*) AS c FROM notice_archive_stats').get().c;
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  // ── deleteFile mock verification ─────────────────────────────────────────

  test('deleteFile is called for attachment and reply files when closing', async () => {
    const { deleteFile } = require('../storage');
    deleteFile.mockClear();

    // Create a notice with a (mocked) attachment.
    const createRes = await request(app)
      .post('/api/portal/notices')
      .set('Authorization', `Bearer ${revenueToken}`)
      .field('title',           'Notice With Attachment For Close')
      .field('body',            'Has an attachment that should be deleted on close.')
      .field('priority',        'Normal')
      .field('deadline',        '2026-12-31')
      .field('target_user_ids', '3')
      .attach('attachment', Buffer.from('fake pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    const nid = createRes.body.noticeId;

    // Health responds with a (mocked) reply file.
    await request(app)
      .patch(`/api/portal/notices/${nid}/status`)
      .set('Authorization', `Bearer ${healthToken}`)
      .field('status', 'Completed')
      .field('remark', 'Reply attached.')
      .attach('reply', Buffer.from('fake reply pdf'), { filename: 'reply.pdf', contentType: 'application/pdf' });

    deleteFile.mockClear(); // reset after save calls triggered by attach

    // Close the notice.
    await request(app)
      .delete(`/api/portal/notices/${nid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    // deleteFile should have been called at least once (attachment + reply = 2).
    expect(deleteFile).toHaveBeenCalled();
    expect(deleteFile.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Both call arguments should be the mock path returned by saveFile.
    deleteFile.mock.calls.forEach(([calledPath]) => {
      expect(typeof calledPath).toBe('string');
      expect(calledPath.length).toBeGreaterThan(0);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  test('returns 404 for a non-existent notice id', async () => {
    const res = await request(app)
      .delete('/api/portal/notices/99999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  test('unauthenticated request returns 401', async () => {
    const res = await request(app)
      .delete(`/api/portal/notices/${pendingNoticeId}`);

    expect(res.status).toBe(401);
  });
});
