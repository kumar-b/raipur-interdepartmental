/**
 * routes/notices-auth.js — authenticated notice management endpoints.
 *
 * Mounted at /api/portal in app.js.
 * All routes require a valid JWT (via requireAuth or requireAdmin).
 *
 * Admin-only endpoints (requireAdmin):
 *   GET  /api/portal/notices/summary       — aggregate counts (total, pending, overdue)
 *   GET  /api/portal/notices/all           — full notice list with status metadata
 *   GET  /api/portal/notices/monthly-stats — completed actions grouped by calendar month
 *
 * Department/admin endpoints (requireAuth):
 *   GET  /api/portal/notices/inbox         — notices addressed to the logged-in dept
 *   GET  /api/portal/notices/outbox        — notices issued by the logged-in dept
 *   POST /api/portal/notices               — create a new notice (dept users only)
 *   GET  /api/portal/notices/:id           — notice detail + per-dept statuses
 *   PATCH /api/portal/notices/:id/status   — update acknowledgement (dept users only)
 *   DELETE /api/portal/notices/:id         — delete a fully completed notice
 */

const express = require('express');
const db      = require('../database/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const upload   = require('../middleware/upload');
const { saveFile, deleteFile } = require('../storage');

const router = express.Router();

// ── Helper: overdue detection ────────────────────────────────────────────────

/**
 * isOverdue — returns true if the notice deadline has passed and the notice
 * has not yet been completed by the target department.
 * @param {string} deadline — ISO date string (YYYY-MM-DD)
 * @param {string} status   — current notice_status.status value
 */
function isOverdue(deadline, status) {
  return status !== 'Completed' && new Date(deadline) < new Date();
}

/**
 * daysLapsed — calculates how many full days have elapsed since the deadline.
 * Returns 0 if the deadline has not yet passed.
 * @param  {string} deadline — ISO date string
 * @returns {number}         — number of days past the deadline
 */
function daysLapsed(deadline) {
  const diff = Date.now() - new Date(deadline).getTime();
  return Math.max(0, Math.floor(diff / 86400000)); // 86400000 ms = 1 day
}

// ── GET /api/portal/notices/summary  (admin only) ───────────────────────────
// Returns three KPI numbers shown on the admin dashboard stat cards:
//   total   — all notices ever created
//   pending — notice_status rows still in Pending state (cross-dept)
//   overdue — distinct notices past their deadline with at least one Pending dept
router.get('/notices/summary', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM notices').get().c;

  const pending = db.prepare(`
    SELECT COUNT(*) AS c FROM notice_status WHERE status = 'Pending'
  `).get().c;

  // Compare deadline against today's date (date part only, ignoring time).
  const now = new Date().toISOString().slice(0, 10);
  const overdue = db.prepare(`
    SELECT COUNT(DISTINCT n.id) AS c
    FROM notices n
    JOIN notice_status ns ON ns.notice_id = n.id
    WHERE n.deadline < ? AND ns.status = 'Pending'
  `).get(now).c;

  res.json({ total, pending, overdue });
});

// ── GET /api/portal/notices/all  (admin only) ───────────────────────────────
// Full notice list enriched with aggregated status counts and overdue metadata.
// Used to populate the admin notices table; clicking a row opens the detail modal.
router.get('/notices/all', requireAdmin, (req, res) => {
  const now = new Date().toISOString().slice(0, 10);

  const notices = db.prepare(`
    SELECT n.*,
           d.name  AS source_dept_name,
           d.code  AS source_dept_code,
           u.username AS created_by_username,
           -- Inline subqueries give per-notice status counts without extra round trips
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Pending')   AS pending_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Completed') AS completed_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id)                             AS total_targets
    FROM notices n
    JOIN departments d ON d.id = n.source_dept_id
    JOIN users u ON u.id = n.created_by
    ORDER BY n.created_at DESC
  `).all();

  // Append computed overdue fields (cannot be done purely in SQL portably).
  const result = notices.map(n => ({
    ...n,
    is_overdue:  n.deadline < now && n.pending_count > 0,
    days_lapsed: n.deadline < now ? daysLapsed(n.deadline) : 0
  }));

  res.json(result);
});

// ── GET /api/portal/notices/monthly-stats  (admin only) ─────────────────────
// Aggregates completed actions by calendar month for the admin bar chart.
// Combines TWO sources so stats are preserved even after notices are closed:
//   1. notice_status — live rows for active (not yet closed) notices.
//   2. notice_archive_stats — rows written at close time for deleted notices.
// The UNION ALL + outer GROUP BY correctly merges counts from both sources.
router.get('/notices/monthly-stats', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT month, SUM(completed) AS completed
    FROM (
      -- Live completed rows from notices that are still open
      SELECT strftime('%Y-%m', updated_at) AS month, COUNT(*) AS completed
      FROM notice_status
      WHERE status = 'Completed' AND updated_at IS NOT NULL
      GROUP BY month

      UNION ALL

      -- Archived counts from notices that have been closed
      SELECT month, SUM(completed) AS completed
      FROM notice_archive_stats
      GROUP BY month
    )
    GROUP BY month
    ORDER BY month ASC
  `).all();
  res.json(rows);
});

// ── GET /api/portal/notices/inbox  (dept/admin) ─────────────────────────────
// Returns notices addressed to the logged-in department, ordered by urgency:
//   Pending first, then Noted, then Completed; ties broken by deadline ascending.
// Admin users have no department inbox and always receive an empty array.
router.get('/notices/inbox', requireAuth, (req, res) => {
  // Admin role has no department, so inbox is meaningless for them.
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
    -- Join on both notice_id AND dept_id to retrieve only rows for this department.
    JOIN notice_status ns ON ns.notice_id = n.id AND ns.dept_id = ?
    ORDER BY
      -- Custom priority: Pending (0) > Noted (1) > Completed (2)
      CASE ns.status WHEN 'Pending' THEN 0 WHEN 'Noted' THEN 1 ELSE 2 END,
      n.deadline ASC
  `).all(dept_id);

  // Append computed overdue flags (requires JS date comparison).
  const result = rows.map(r => ({
    ...r,
    is_overdue:  r.deadline < now && r.status !== 'Completed',
    days_lapsed: r.deadline < now ? daysLapsed(r.deadline) : 0
  }));

  res.json(result);
});

// ── GET /api/portal/notices/outbox  (dept/admin) ─────────────────────────────
// Returns notices issued by the logged-in department with status breakdowns
// for each target. Admin users see nothing (they use /notices/all instead).
router.get('/notices/outbox', requireAuth, (req, res) => {
  // Admin has no source department, so outbox is not applicable.
  const dept_id = req.user.role === 'admin' ? null : req.user.dept_id;
  if (!dept_id) return res.json([]);

  const now = new Date().toISOString().slice(0, 10);

  const notices = db.prepare(`
    SELECT n.id, n.title, n.priority, n.deadline, n.target_all, n.created_at,
           n.attachment_path, n.attachment_name,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Pending')   AS pending_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Noted')     AS noted_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id AND ns.status = 'Completed') AS completed_count,
           (SELECT COUNT(*) FROM notice_status ns WHERE ns.notice_id = n.id)                             AS total_targets
    FROM notices n
    WHERE n.source_dept_id = ?
    ORDER BY n.created_at DESC
  `).all(dept_id);

  // For each notice, attach the list of target departments with their individual
  // status so the outbox UI can show coloured target chips.
  const result = notices.map(n => {
    let targets = [];
    if (n.target_all) {
      // Broadcast notice — no individual target rows; show a single label.
      targets = [{ name: 'All Departments' }];
    } else {
      // Fetch target departments joined with their current status.
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

// ── POST /api/portal/notices  (create) ──────────────────────────────────────
// Creates a new notice from the authenticated department user.
// Accepts multipart/form-data (upload.single handles the optional attachment).
// Admin users are blocked — they use department accounts to issue notices.
router.post('/notices', requireAuth, upload.single('attachment'), async (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin cannot create notices. Use a department login.' });
  }

  const { title, body, priority, deadline, target_all } = req.body;
  let target_dept_ids = req.body.target_dept_ids;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!title || !body || !priority || !deadline) {
    return res.status(400).json({ error: 'title, body, priority, and deadline are required.' });
  }
  if (!['High', 'Normal', 'Low'].includes(priority)) {
    return res.status(400).json({ error: 'priority must be High, Normal, or Low.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return res.status(400).json({ error: 'deadline must be in YYYY-MM-DD format.' });
  }

  // Normalise target_all — it arrives as a string from FormData ('1'/'0').
  const isTargetAll = target_all === '1' || target_all === true || target_all === 1;

  if (!isTargetAll) {
    if (!target_dept_ids) {
      return res.status(400).json({ error: 'Specify target departments or select "All".' });
    }
    // FormData sends multiple values as an array, but a single value as a string.
    if (typeof target_dept_ids === 'string') {
      target_dept_ids = [target_dept_ids];
    }
    // Parse to integers and exclude the sender's own department (they cannot
    // target themselves).
    target_dept_ids = target_dept_ids.map(Number).filter(id => id !== req.user.dept_id);
    if (target_dept_ids.length === 0) {
      return res.status(400).json({ error: 'At least one target department is required.' });
    }
  }

  // Save attachment to disk or S3 if one was uploaded; otherwise null.
  const attachment_path = req.file ? await saveFile(req.file) : null;
  const attachment_name = req.file ? req.file.originalname : null;

  // ── Database writes ────────────────────────────────────────────────────────
  const stmt = db.prepare(`
    INSERT INTO notices (title, body, priority, deadline, source_dept_id, target_all, attachment_path, attachment_name, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    title.trim(), body.trim(), priority, deadline,
    req.user.dept_id, isTargetAll ? 1 : 0,
    attachment_path, attachment_name,
    req.user.id
  );
  const noticeId = result.lastInsertRowid;

  const insertTarget = db.prepare('INSERT OR IGNORE INTO notice_targets (notice_id, dept_id) VALUES (?, ?)');
  const insertStatus = db.prepare("INSERT OR IGNORE INTO notice_status (notice_id, dept_id) VALUES (?, ?)");

  if (isTargetAll) {
    // Broadcast: create a Pending status row for every department except the sender.
    const allDepts = db.prepare('SELECT id FROM departments WHERE id != ?').all(req.user.dept_id);
    allDepts.forEach(d => insertStatus.run(noticeId, d.id));
  } else {
    // Targeted: create both a target row and a status row for each selected dept.
    target_dept_ids.forEach(id => {
      insertTarget.run(noticeId, id);
      insertStatus.run(noticeId, id);
    });
  }

  res.status(201).json({ success: true, noticeId, message: 'Notice created successfully.' });
});

// ── GET /api/portal/notices/:id  (detail) ───────────────────────────────────
// Returns full notice details plus the status of every target department.
// Also marks the notice as read (is_read = 1) for the requesting department.
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

  // Fetch acknowledgement status for all target departments.
  const statuses = db.prepare(`
    SELECT ns.dept_id, ns.status, ns.remark, ns.reply_path, ns.reply_name, ns.is_read, ns.updated_at,
           d.name AS dept_name, d.code AS dept_code
    FROM notice_status ns
    JOIN departments d ON d.id = ns.dept_id
    WHERE ns.notice_id = ?
  `).all(noticeId);

  // Automatically mark the notice as read when a department user opens it.
  // The is_read = 0 guard prevents unnecessary writes on repeat visits.
  if (req.user.role === 'department' && req.user.dept_id) {
    db.prepare(`
      UPDATE notice_status SET is_read = 1
      WHERE notice_id = ? AND dept_id = ? AND is_read = 0
    `).run(noticeId, req.user.dept_id);
  }

  res.json({ ...notice, statuses });
});

// ── PATCH /api/portal/notices/:id/status  (update) ──────────────────────────
// Allows a target department to acknowledge or complete a notice.
// Status can only move forward: Pending → Noted → Completed (never backwards).
// An optional reply file can be attached to document the action taken.
router.patch('/notices/:id/status', requireAuth, upload.single('reply'), async (req, res) => {
  // Admins do not have a department so they cannot acknowledge notices.
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admin cannot update notice status.' });
  }

  const noticeId  = parseInt(req.params.id);
  const { status, remark } = req.body;
  const dept_id   = req.user.dept_id;

  // Only Noted and Completed are permitted via this endpoint.
  // Departments cannot self-assign Pending (that is set at creation time).
  if (!['Noted', 'Completed'].includes(status)) {
    return res.status(400).json({ error: 'status must be Noted or Completed.' });
  }
  if (!remark || !remark.trim()) {
    return res.status(400).json({ error: 'Remark is required.' });
  }

  // Confirm this department is actually a target of the notice.
  const existing = db.prepare(
    'SELECT id, status FROM notice_status WHERE notice_id = ? AND dept_id = ?'
  ).get(noticeId, dept_id);
  if (!existing) {
    return res.status(403).json({ error: 'This notice is not addressed to your department.' });
  }
  // Prevent reverting a completed notice.
  if (existing.status === 'Completed') {
    return res.status(400).json({ error: 'This notice has already been marked as completed.' });
  }

  // Save optional reply file (same storage abstraction as attachments).
  const reply_path = req.file ? await saveFile(req.file) : null;
  const reply_name = req.file ? req.file.originalname : null;

  // Update the status row, marking it as read and recording the action timestamp.
  db.prepare(`
    UPDATE notice_status
    SET status = ?, remark = ?, reply_path = ?, reply_name = ?, is_read = 1, updated_at = datetime('now')
    WHERE notice_id = ? AND dept_id = ?
  `).run(status, remark.trim(), reply_path, reply_name, noticeId, dept_id);

  res.json({ success: true, message: `Notice marked as ${status}.` });
});

// ── DELETE /api/portal/notices/:id  (close a notice) ────────────────────────
// "Closing" a notice permanently removes it along with all associated data,
// deletes any uploaded files (attachments + reply files) from storage, and
// archives the completion statistics so the monthly chart is not affected.
//
// Authorization rules:
//   Admin      — can close ANY notice regardless of its completion status.
//                Use this to force-close stale or erroneous notices.
//   Dept user  — can only close notices THEY created (source_dept_id = user dept)
//                AND only when EVERY target department has reached 'Completed'.
//
// Stats preservation:
//   Before the notice record is deleted, all 'Completed' notice_status rows are
//   counted per YYYY-MM month and written to notice_archive_stats. The
//   monthly-stats endpoint then UNIONs this table so historical chart data
//   survives the deletion of the underlying notice.
//
// File cleanup:
//   The notice attachment and every department reply file are removed from
//   local disk or S3. Deletions are best-effort — a storage error is logged
//   but does NOT fail the close operation.
router.delete('/notices/:id', requireAuth, async (req, res) => {
  const noticeId = parseInt(req.params.id);
  const { role, dept_id } = req.user;

  const notice = db.prepare('SELECT * FROM notices WHERE id = ?').get(noticeId);
  if (!notice) return res.status(404).json({ error: 'Notice not found.' });

  // ── Authorization ────────────────────────────────────────────────────────
  // Admin can close any notice; dept users can only close their own.
  if (role !== 'admin' && notice.source_dept_id !== dept_id) {
    return res.status(403).json({ error: 'You can only close notices created by your department.' });
  }

  // ── Completion guard (dept users only) ───────────────────────────────────
  // Admins bypass this check — they can force-close pending/partial notices.
  if (role !== 'admin') {
    const incomplete = db.prepare(
      "SELECT COUNT(*) AS count FROM notice_status WHERE notice_id = ? AND status != 'Completed'"
    ).get(noticeId);
    if (incomplete.count > 0) {
      return res.status(400).json({
        error: 'Cannot close: not all target departments have completed this notice.'
      });
    }
  }

  // ── Archive completion statistics ─────────────────────────────────────────
  // Count 'Completed' notice_status rows grouped by the month they were updated.
  // These counts are stored in notice_archive_stats so the monthly-stats chart
  // continues to show historical data after the notice record is deleted.
  const completedStats = db.prepare(`
    SELECT strftime('%Y-%m', updated_at) AS month, COUNT(*) AS completed
    FROM notice_status
    WHERE notice_id = ? AND status = 'Completed' AND updated_at IS NOT NULL
    GROUP BY month
  `).all(noticeId);

  const insertArchivedStat = db.prepare(
    'INSERT INTO notice_archive_stats (month, completed) VALUES (?, ?)'
  );
  // Inserting zero rows is safe — forEach simply does nothing if the array is empty.
  completedStats.forEach(row => insertArchivedStat.run(row.month, row.completed));

  // ── Collect file paths before DB deletion ─────────────────────────────────
  // Read reply_path from every notice_status row before the cascade wipes them.
  const replyPaths = db.prepare(
    'SELECT reply_path FROM notice_status WHERE notice_id = ? AND reply_path IS NOT NULL'
  ).all(noticeId).map(r => r.reply_path);

  // ── Delete the database record ────────────────────────────────────────────
  // ON DELETE CASCADE removes notice_targets and notice_status automatically.
  db.prepare('DELETE FROM notices WHERE id = ?').run(noticeId);

  // ── Delete uploaded files from storage ────────────────────────────────────
  // Done AFTER the DB delete so a storage failure cannot leave an orphaned record.
  // Both attachment and all reply files are cleaned up.
  const filesToDelete = [notice.attachment_path, ...replyPaths].filter(Boolean);
  await Promise.all(filesToDelete.map(p => deleteFile(p)));

  res.json({ success: true, message: 'Notice closed successfully.' });
});

module.exports = router;
