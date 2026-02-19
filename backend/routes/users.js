const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/portal/users  — list all users (admin)
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

// POST /api/portal/users  — create user (admin)
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role, dept_id } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, and role are required.' });
  }
  if (!['admin', 'department'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or department.' });
  }
  if (role === 'department' && !dept_id) {
    return res.status(400).json({ error: 'dept_id is required for department users.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Username already exists.' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, dept_id)
    VALUES (?, ?, ?, ?)
  `).run(username.trim().toLowerCase(), hash, role, role === 'department' ? dept_id : null);

  res.status(201).json({ success: true, userId: result.lastInsertRowid });
});

// PATCH /api/portal/users/:id/status  — toggle is_active (admin)
router.patch('/users/:id/status', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { is_active } = req.body;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }

  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, userId);
  res.json({ success: true });
});

// PATCH /api/portal/users/:id/password  — admin resets a user's password
router.patch('/users/:id/password', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'newPassword must be at least 6 characters.' });
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
  res.json({ success: true, message: 'Password reset successfully.' });
});

module.exports = router;
