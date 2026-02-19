const express = require('express');
const db      = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const upload  = require('../middleware/upload');

const router = express.Router();

// ── Helper: is a notice overdue? ──────────────────────
function isOverdue(deadline, status) {
  return status !== 'Completed' && new Date(deadline) < new Date();
}

function daysLapsed(deadline) {
  const diff = Date.now() - new Date(deadline).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

// ── GET /api/portal/notices/summary  (admin) ──────────
router.get('/notices/summary', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM notices').get().c;

  // Count pending: notice_status rows still Pending
  const pending = db.prepare(`
    SELECT COUNT(*) AS c FROM notice_status WHERE status = 'Pending'
  `).get().c;

  // Count overdue: notices past deadline with at least one Pending status
  const now = new Date().toISOString().slice(0, 10);
  const overdue = db.prepare(`
    SELECT COUNT(DISTINCT n.id) AS c
    FROM notices n
    JOIN notice_status ns ON ns.notice_id = n.id
    WHERE n.deadline < ? AND ns.status = 'Pending'
  `).get(now).c;

  res.json({ total, pending, overdue });
});

// ── GET /api/portal/notices/all  (admin) ─────────────
router.get('/notices/all', requireAdmin, (req, res) => {
  const now = new Date().toISOString().slice(0, 10);

  const notices = db.prepare(`
    SELECT n.*,
           d.name  AS source_dept_name,
           d.code  AS source_dept_code,
           u.username AS created_by_username,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Pending') AS pending_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Completed') AS completed_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id) AS total_targets
    FROM notices n
    JOIN departments d ON d.id = n.source_dept_id
    JOIN users u ON u.id = n.created_by
    ORDER BY n.created_at DESC
  `).all();

  const result = notices.map(n => ({
    ...n,
    is_overdue:  n.deadline < now && n.pending_count > 0,
    days_lapsed: n.deadline < now ? daysLapsed(n.deadline) : 0
  }));

  res.json(result);
});

// ── GET /api/portal/notices/monthly-stats  (admin) ────
router.get('/notices/monthly-stats', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', updated_at) AS month, COUNT(*) AS completed
    FROM notice_status
    WHERE status = 'Completed' AND updated_at IS NOT NULL
    GROUP BY month
    ORDER BY month ASC
  `).all();
  res.json(rows);
});

// ── GET /api/portal/notices/inbox  (dept/admin) ───────
router.get('/notices/inbox', requireAuth, (req, res) => {
  if (req.user.role === 'admin') {
    return res.json([]);
  }

  const dept_id = req.user.dept_id;
  const now     = new Date().toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT n.id, n.title, n.body, n.priority, n.deadline, n.created_at,
           n.attachment_path, n.attachment_name, n.target_all,
           d.name AS source_dept_name, d.code AS source_dept_code,
           ns.status, ns.remark, ns.reply_path, ns.reply_name, ns.is_read, ns.updated_at
    FROM notices n
    JOIN departments d ON d.id = n.source_dept_id
    JOIN notice_status ns ON ns.notice_id = n.id AND ns.dept_id = ?
    ORDER BY
      CASE ns.status WHEN 'Pending' THEN 0 WHEN 'Noted' THEN 1 ELSE 2 END,
      n.deadline ASC
  `).all(dept_id);

  const result = rows.map(r => ({
    ...r,
    is_overdue:  r.deadline < now && r.status !== 'Completed',
    days_lapsed: r.deadline < now ? daysLapsed(r.deadline) : 0
  }));

  res.json(result);
});

// ── GET /api/portal/notices/outbox  (dept/admin) ──────
router.get('/notices/outbox', requireAuth, (req, res) => {
  const dept_id = req.user.role === 'admin' ? null : req.user.dept_id;
  if (!dept_id) return res.json([]);

  const now = new Date().toISOString().slice(0, 10);

  const notices = db.prepare(`
    SELECT n.id, n.title, n.priority, n.deadline, n.target_all, n.created_at,
           n.attachment_path, n.attachment_name,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Pending') AS pending_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Noted') AS noted_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Completed') AS completed_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id) AS total_targets
    FROM notices n
    WHERE n.source_dept_id = ?
    ORDER BY n.created_at DESC
  `).all(dept_id);

  // Attach target department names
  const result = notices.map(n => {
    let targets = [];
    if (n.target_all) {
      targets = [{ name: 'All Departments' }];
    } else {
      targets = db.prepare(`
        SELECT d.name, d.code,
               ns.status, ns.is_read
        FROM notice_targets nt
        JOIN departments d ON d.id = nt.dept_id
        JOIN notice_status ns ON ns.notice_id = nt.notice_id AND ns.dept_id = nt.dept_id
        WHERE nt.notice_id = ?
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

// ── POST /api/portal/notices  (create) ────────────────
router.post('/notices', requireAuth, upload.single('attachment'), (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin cannot create notices. Use a department login.' });
  }

  const { title, body, priority, deadline, target_all } = req.body;
  let target_dept_ids = req.body.target_dept_ids;

  // Validation
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
    if (!target_dept_ids) {
      return res.status(400).json({ error: 'Specify target departments or select "All".' });
    }
    if (typeof target_dept_ids === 'string') {
      target_dept_ids = [target_dept_ids];
    }
    target_dept_ids = target_dept_ids.map(Number).filter(id => id !== req.user.dept_id);
    if (target_dept_ids.length === 0) {
      return res.status(400).json({ error: 'At least one target department is required.' });
    }
  }

  const attachment_path = req.file ? `/uploads/${req.file.filename}` : null;
  const attachment_name = req.file ? req.file.originalname : null;

  // Insert notice
  const stmt = db.prepare(`
    INSERT INTO notices (title, body, priority, deadline, source_dept_id, target_all, attachment_path, attachment_name, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(title.trim(), body.trim(), priority, deadline, req.user.dept_id, isTargetAll ? 1 : 0, attachment_path, attachment_name, req.user.id);
  const noticeId = result.lastInsertRowid;

  // Insert targets and status rows
  const insertTarget = db.prepare('INSERT OR IGNORE INTO notice_targets (notice_id, dept_id) VALUES (?, ?)');
  const insertStatus = db.prepare("INSERT OR IGNORE INTO notice_status (notice_id, dept_id) VALUES (?, ?)");

  if (isTargetAll) {
    const allDepts = db.prepare('SELECT id FROM departments WHERE id != ?').all(req.user.dept_id);
    allDepts.forEach(d => insertStatus.run(noticeId, d.id));
  } else {
    target_dept_ids.forEach(id => {
      insertTarget.run(noticeId, id);
      insertStatus.run(noticeId, id);
    });
  }

  res.status(201).json({ success: true, noticeId, message: 'Notice created successfully.' });
});

// ── GET /api/portal/notices/:id  (detail) ────────────
router.get('/notices/:id', requireAuth, (req, res) => {
  const noticeId = parseInt(req.params.id);

  const notice = db.prepare(`
    SELECT n.*, d.name AS source_dept_name, d.code AS source_dept_code,
           u.username AS created_by_username
    FROM notices n
    JOIN departments d ON d.id = n.source_dept_id
    JOIN users u ON u.id = n.created_by
    WHERE n.id = ?
  `).get(noticeId);

  if (!notice) return res.status(404).json({ error: 'Notice not found.' });

  // Get status for all target departments
  const statuses = db.prepare(`
    SELECT ns.dept_id, ns.status, ns.remark, ns.reply_path, ns.reply_name, ns.is_read, ns.updated_at,
           d.name AS dept_name, d.code AS dept_code
    FROM notice_status ns
    JOIN departments d ON d.id = ns.dept_id
    WHERE ns.notice_id = ?
  `).all(noticeId);

  // Mark as read for requesting dept
  if (req.user.role === 'department' && req.user.dept_id) {
    db.prepare(`
      UPDATE notice_status SET is_read = 1
      WHERE notice_id = ? AND dept_id = ? AND is_read = 0
    `).run(noticeId, req.user.dept_id);
  }

  res.json({ ...notice, statuses });
});

// ── PATCH /api/portal/notices/:id/status  (update) ───
router.patch('/notices/:id/status', requireAuth, upload.single('reply'), (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin cannot update notice status.' });
  }

  const noticeId = parseInt(req.params.id);
  const { status, remark } = req.body;
  const dept_id = req.user.dept_id;

  if (!['Noted', 'Completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be Noted or Completed.' });
  }
  if (!remark || !remark.trim()) {
    return res.status(400).json({ error: 'Remark is required.' });
  }

  // Verify this dept is a target
  const existing = db.prepare('SELECT id, status FROM notice_status WHERE notice_id = ? AND dept_id = ?').get(noticeId, dept_id);
  if (!existing) {
    return res.status(403).json({ error: 'This notice is not addressed to your department.' });
  }
  if (existing.status === 'Completed') {
    return res.status(400).json({ error: 'This notice has already been marked as completed.' });
  }

  const reply_path = req.file ? `/uploads/${req.file.filename}` : null;
  const reply_name = req.file ? req.file.originalname : null;

  db.prepare(`
    UPDATE notice_status
    SET status = ?, remark = ?, reply_path = ?, reply_name = ?, is_read = 1, updated_at = datetime('now')
    WHERE notice_id = ? AND dept_id = ?
  `).run(status, remark.trim(), reply_path, reply_name, noticeId, dept_id);

  res.json({ success: true, message: `Notice marked as ${status}.` });
});

module.exports = router;
