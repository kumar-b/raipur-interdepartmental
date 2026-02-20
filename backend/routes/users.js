/**
 * routes/users.js — user management endpoints (admin only).
 *
 * Mounted at /api/portal in app.js (alongside notices-auth.js).
 * All routes require admin privileges via requireAdmin.
 *
 * GET   /api/portal/users              — list all portal user accounts
 * POST  /api/portal/users              — create a new user account
 * PATCH /api/portal/users/:id/status   — activate or deactivate an account
 * PATCH /api/portal/users/:id/password — reset a user's password (admin override)
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/portal/users — list all users ───────────────────────────────────
// Returns every user account joined with their department name/code.
// Ordered: admin accounts first (role DESC), then alphabetically by username.
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.dept_id, u.is_active, u.created_at, u.last_login,
           d.name AS dept_name, d.code AS dept_code
    FROM users u
    LEFT JOIN departments d ON u.dept_id = d.id
    ORDER BY u.role DESC, u.username ASC
  `).all();
  res.json(users);
});

// ── POST /api/portal/users — create a new user ───────────────────────────────
// Admin creates portal accounts for new department staff.
// Passwords are hashed with bcrypt before storage — never stored in plain text.
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role, dept_id } = req.body;

  // All three of username, password, and role are mandatory.
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, and role are required.' });
  }
  if (!['admin', 'department'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or department.' });
  }
  // Department users must be associated with a department.
  if (role === 'department' && !dept_id) {
    return res.status(400).json({ error: 'dept_id is required for department users.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Check for username collision before attempting the insert.
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Username already exists.' });
  }

  // bcrypt cost factor 12 — secure against brute force while staying fast enough.
  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, dept_id)
    VALUES (?, ?, ?, ?)
  `).run(
    username.trim().toLowerCase(),
    hash,
    role,
    role === 'department' ? dept_id : null // admin accounts have no associated dept
  );

  res.status(201).json({ success: true, userId: result.lastInsertRowid });
});

// ── PATCH /api/portal/users/:id/status — toggle account activation ───────────
// Setting is_active = 0 blocks login without deleting the user's history.
// An admin cannot deactivate their own account (self-lock prevention).
router.patch('/users/:id/status', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { is_active } = req.body;

  // Prevent the admin from accidentally locking themselves out.
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }

  // Store 1 (active) or 0 (inactive) — coerce the boolean to an integer.
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, userId);
  res.json({ success: true });
});

// ── PATCH /api/portal/users/:id/password — admin password reset ──────────────
// Allows an admin to set a new password for any user without knowing the old one.
// Useful when a department staff member cannot remember their credentials.
router.patch('/users/:id/password', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'newPassword must be at least 6 characters.' });
  }

  // Hash and store the new password.
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  res.json({ success: true, message: 'Password reset successfully.' });
});

module.exports = router;
