/**
 * routes/notices-auth.js — authenticated notice management endpoints.
 *
 * Mounted at /api/portal in app.js.
 *
 * Users are the central unit. Every notice is created BY a user and
 * addressed TO specific users (or all active users). Department is a
 * display label fetched from the user's profile — not a routing concern.
 *
 * Admin-only:
 *   GET  /notices/summary        — total / pending / overdue counts
 *   GET  /notices/all            — all notices with status metadata
 *   GET  /notices/monthly-stats  — completed actions grouped by month
 *
 * Authenticated (dept + admin):
 *   GET    /notices/inbox          — notices addressed to the logged-in user
 *   GET    /notices/outbox         — notices created by the logged-in user
 *   POST   /notices                — create a notice (dept users only)
 *   GET    /notices/:id            — full notice detail + recipient statuses
 *   PATCH  /notices/:id/status     — acknowledge / complete (recipient only)
 *   DELETE /notices/:id            — close a notice (creator or admin)
 */

const express = require('express');
const db      = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const upload  = require('../middleware/upload');
const { saveFile, deleteFile } = require('../storage');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOverdue(deadline, status) {
  return status !== 'Completed' && new Date(deadline) < new Date();
}

function daysLapsed(deadline) {
  const diff = Date.now() - new Date(deadline).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

// ── GET /notices/summary  (admin) ─────────────────────────────────────────────
router.get('/notices/summary', requireAdmin, (req, res) => {
  const total   = db.prepare('SELECT COUNT(*) AS c FROM notices').get().c;
  const pending = db.prepare("SELECT COUNT(*) AS c FROM notice_status WHERE status = 'Pending'").get().c;
  const now     = new Date().toISOString().slice(0, 10);
  const overdue = db.prepare(`
    SELECT COUNT(DISTINCT n.id) AS c
    FROM notices n
    JOIN notice_status ns ON ns.notice_id = n.id
    WHERE n.deadline < ? AND ns.status = 'Pending'
  `).get(now).c;

  res.json({ total, pending, overdue });
});

// ── GET /notices/all  (admin) ─────────────────────────────────────────────────
router.get('/notices/all', requireAdmin, (req, res) => {
  const now = new Date().toISOString().slice(0, 10);

  const notices = db.prepare(`
    SELECT n.*,
           u.username          AS created_by_username,
           d.name              AS source_dept_name,
           d.code              AS source_dept_code,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Pending')   AS pending_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Completed') AS completed_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id)                             AS total_targets
    FROM notices n
    JOIN  users u       ON u.id  = n.created_by
    LEFT JOIN departments d ON d.id  = u.dept_id
    ORDER BY n.created_at DESC
  `).all();

  const result = notices.map(n => ({
    ...n,
    is_overdue:  n.deadline < now && n.pending_count > 0,
    days_lapsed: n.deadline < now ? daysLapsed(n.deadline) : 0
  }));

  res.json(result);
});

// ── GET /notices/monthly-stats  (admin) ───────────────────────────────────────
router.get('/notices/monthly-stats', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT month, SUM(completed) AS completed
      FROM (
        SELECT strftime('%Y-%m', updated_at) AS month, COUNT(*) AS completed
        FROM notice_status
        WHERE status = 'Completed' AND updated_at IS NOT NULL
        GROUP BY month

        UNION ALL

        SELECT month, SUM(completed) AS completed
        FROM notice_archive_stats
        GROUP BY month
      )
      GROUP BY month
      ORDER BY month ASC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('[monthly-stats]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /notices/inbox  (dept user) ──────────────────────────────────────────
// Returns notices addressed directly to the logged-in user.
router.get('/notices/inbox', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.json([]);

  const now = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT n.id, n.title, n.body, n.priority, n.deadline, n.created_at,
           n.attachment_path, n.attachment_name, n.target_all,
           u.username          AS created_by_username,
           d.name              AS source_dept_name,
           d.code              AS source_dept_code,
           ns.status, ns.remark, ns.reply_path, ns.reply_name, ns.is_read, ns.updated_at
    FROM notices n
    JOIN  users u       ON u.id  = n.created_by
    LEFT JOIN departments d ON d.id  = u.dept_id
    JOIN  notice_status ns  ON ns.notice_id = n.id AND ns.user_id = ?
    ORDER BY
      CASE ns.status WHEN 'Pending' THEN 0 WHEN 'Noted' THEN 1 ELSE 2 END,
      n.deadline ASC
  `).all(req.user.id);

  const result = rows.map(r => ({
    ...r,
    is_overdue:  r.deadline < now && r.status !== 'Completed',
    days_lapsed: r.deadline < now ? daysLapsed(r.deadline) : 0
  }));

  res.json(result);
});

// ── GET /notices/outbox  (dept user) ─────────────────────────────────────────
// Returns notices created by the logged-in user.
router.get('/notices/outbox', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.json([]);

  const now = new Date().toISOString().slice(0, 10);

  const notices = db.prepare(`
    SELECT n.id, n.title, n.priority, n.deadline, n.target_all, n.created_at,
           n.attachment_path, n.attachment_name,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Pending')   AS pending_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Noted')     AS noted_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Completed') AS completed_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id)                             AS total_targets
    FROM notices n
    WHERE n.created_by = ?
    ORDER BY n.created_at DESC
  `).all(req.user.id);

  const result = notices.map(n => {
    let targets = [];
    if (n.target_all) {
      targets = [{ username: 'All Users' }];
    } else {
      targets = db.prepare(`
        SELECT u.username, d.code AS dept_code, ns.status, ns.is_read
        FROM notice_status ns
        JOIN  users u       ON u.id  = ns.user_id
        LEFT JOIN departments d ON d.id  = u.dept_id
        WHERE ns.notice_id = ?
      `).all(n.id);
    }
    return {
      ...n,
      targets,
      is_overdue:  n.deadline < now && n.pending_count > 0,
      days_lapsed: n.deadline < now ? daysLapsed(n.deadline) : 0
    };
  });

  res.json(result);
});

// ── POST /notices  (create) ───────────────────────────────────────────────────
router.post('/notices', requireAuth, upload.single('attachment'), async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin cannot create notices. Use a department login.' });
  }

  const { title, body, priority, deadline, target_all } = req.body;
  let target_user_ids = req.body.target_user_ids;

  if (!title || !body || !priority || !deadline) {
    return res.status(400).json({ error: 'title, body, priority, and deadline are required.' });
  }
  if (!['High', 'Normal', 'Low'].includes(priority)) {
    return res.status(400).json({ error: 'priority must be High, Normal, or Low.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return res.status(400).json({ error: 'deadline must be in YYYY-MM-DD format.' });
  }

  const isTargetAll = target_all === '1' || target_all === true || target_all === 1;

  if (!isTargetAll) {
    if (!target_user_ids) {
      return res.status(400).json({ error: 'Specify target users or select "All Users".' });
    }
    if (typeof target_user_ids === 'string') target_user_ids = [target_user_ids];
    target_user_ids = target_user_ids.map(Number).filter(id => id !== req.user.id);
    if (target_user_ids.length === 0) {
      return res.status(400).json({ error: 'At least one target user is required.' });
    }
  }

  const attachment_path = req.file ? await saveFile(req.file) : null;
  const attachment_name = req.file ? req.file.originalname : null;

  const result = db.prepare(`
    INSERT INTO notices (title, body, priority, deadline, created_by, target_all, attachment_path, attachment_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), body.trim(), priority, deadline,
    req.user.id, isTargetAll ? 1 : 0,
    attachment_path, attachment_name
  );
  const noticeId = result.lastInsertRowid;

  const insertStatus = db.prepare('INSERT OR IGNORE INTO notice_status (notice_id, user_id) VALUES (?, ?)');

  if (isTargetAll) {
    // Send to every active non-admin user except the sender.
    const allUsers = db.prepare(
      "SELECT id FROM users WHERE is_active = 1 AND role != 'admin' AND id != ?"
    ).all(req.user.id);
    allUsers.forEach(u => insertStatus.run(noticeId, u.id));
  } else {
    target_user_ids.forEach(id => insertStatus.run(noticeId, id));
  }

  res.status(201).json({ success: true, noticeId, message: 'Notice created successfully.' });
});

// ── GET /notices/:id  (detail) ────────────────────────────────────────────────
router.get('/notices/:id', requireAuth, (req, res) => {
  const noticeId = parseInt(req.params.id);
  if (isNaN(noticeId)) return res.status(400).json({ error: 'Invalid notice ID.' });

  const notice = db.prepare(`
    SELECT n.*,
           u.username          AS created_by_username,
           d.name              AS source_dept_name,
           d.code              AS source_dept_code
    FROM notices n
    JOIN  users u       ON u.id  = n.created_by
    LEFT JOIN departments d ON d.id  = u.dept_id
    WHERE n.id = ?
  `).get(noticeId);

  if (!notice) return res.status(404).json({ error: 'Notice not found.' });

  const statuses = db.prepare(`
    SELECT ns.user_id, ns.status, ns.remark, ns.reply_path, ns.reply_name, ns.is_read, ns.updated_at,
           u.username,
           d.name AS dept_name,
           d.code AS dept_code
    FROM notice_status ns
    JOIN  users u       ON u.id  = ns.user_id
    LEFT JOIN departments d ON d.id  = u.dept_id
    WHERE ns.notice_id = ?
  `).all(noticeId);

  // Mark as read for the requesting user.
  if (req.user.role !== 'admin') {
    db.prepare(`
      UPDATE notice_status SET is_read = 1
      WHERE notice_id = ? AND user_id = ? AND is_read = 0
    `).run(noticeId, req.user.id);
  }

  res.json({ ...notice, statuses });
});

// ── PATCH /notices/:id/status  (acknowledge / complete) ──────────────────────
router.patch('/notices/:id/status', requireAuth, upload.single('reply'), async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin cannot update notice status.' });
  }

  const noticeId = parseInt(req.params.id);
  if (isNaN(noticeId)) return res.status(400).json({ error: 'Invalid notice ID.' });

  const { status, remark } = req.body;

  if (!['Noted', 'Completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be Noted or Completed.' });
  }
  if (!remark || !remark.trim()) {
    return res.status(400).json({ error: 'Remark is required.' });
  }

  const existing = db.prepare(
    'SELECT id, status FROM notice_status WHERE notice_id = ? AND user_id = ?'
  ).get(noticeId, req.user.id);

  if (!existing) {
    return res.status(403).json({ error: 'This notice is not addressed to you.' });
  }
  if (existing.status === 'Completed') {
    return res.status(400).json({ error: 'This notice has already been marked as completed.' });
  }

  const reply_path = req.file ? await saveFile(req.file) : null;
  const reply_name = req.file ? req.file.originalname : null;

  db.prepare(`
    UPDATE notice_status
    SET status = ?, remark = ?, reply_path = ?, reply_name = ?, is_read = 1, updated_at = datetime('now')
    WHERE notice_id = ? AND user_id = ?
  `).run(status, remark.trim(), reply_path, reply_name, noticeId, req.user.id);

  res.json({ success: true, message: `Notice marked as ${status}.` });
});

// ── DELETE /notices/:id  (close a notice) ────────────────────────────────────
// Creator (dept user) can close only when all recipients have completed.
// Admin can force-close any notice regardless of status.
router.delete('/notices/:id', requireAuth, async (req, res) => {
  const noticeId = parseInt(req.params.id);
  if (isNaN(noticeId)) return res.status(400).json({ error: 'Invalid notice ID.' });

  const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(noticeId);
  if (!notice) return res.status(404).json({ error: 'Notice not found.' });

  // Auth: creator or admin.
  if (req.user.role !== 'admin' && notice.created_by !== req.user.id) {
    return res.status(403).json({ error: 'You can only close notices you created.' });
  }

  // Dept user: all recipients must have completed before closing.
  if (req.user.role !== 'admin') {
    const incomplete = db.prepare(
      "SELECT COUNT(*) AS count FROM notice_status WHERE notice_id = ? AND status != 'Completed'"
    ).get(noticeId);
    if (incomplete.count > 0) {
      return res.status(400).json({
        error: 'Cannot close: not all recipients have completed this notice.'
      });
    }
  }

  // Archive completion stats before deletion.
  const completedStats = db.prepare(`
    SELECT strftime('%Y-%m', updated_at) AS month, COUNT(*) AS completed
    FROM notice_status
    WHERE notice_id = ? AND status = 'Completed' AND updated_at IS NOT NULL
    GROUP BY month
  `).all(noticeId);

  const insertArchivedStat = db.prepare(
    'INSERT INTO notice_archive_stats (month, completed) VALUES (?, ?)'
  );
  completedStats.forEach(row => insertArchivedStat.run(row.month, row.completed));

  // Collect file paths before cascade deletes them.
  const replyPaths = db.prepare(
    'SELECT reply_path FROM notice_status WHERE notice_id = ? AND reply_path IS NOT NULL'
  ).all(noticeId).map(r => r.reply_path);

  db.prepare('DELETE FROM notices WHERE id = ?').run(noticeId);

  const filesToDelete = [notice.attachment_path, ...replyPaths].filter(Boolean);
  await Promise.all(filesToDelete.map(p => deleteFile(p)));

  res.json({ success: true, message: 'Notice closed successfully.' });
});

module.exports = router;
