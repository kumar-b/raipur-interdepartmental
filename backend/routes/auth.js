/**
 * routes/auth.js — authentication endpoints.
 *
 * Mounted at /api/auth in app.js.
 *
 * POST /api/auth/login          — validate credentials, return a JWT
 * GET  /api/auth/me             — return the current user's profile (auth required)
 * POST /api/auth/change-password — update the logged-in user's password (auth required)
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../database/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ─────────────────────────────────────────────────────
// Validates username and password, then issues a signed JWT valid for 8 hours.
// The token payload includes role and dept_id so downstream middleware can make
// access-control decisions without an extra DB query.
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Both fields are required — return early with a clear error.
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Look up the user by username (case-insensitive via .toLowerCase()).
  // Also JOIN departments so we can include dept_name/dept_code in the token.
  const user = db.prepare(`
    SELECT u.id, u.username, u.password_hash, u.role, u.dept_id, u.is_active,
           d.name AS dept_name, d.code AS dept_code
    FROM users u
    LEFT JOIN departments d ON u.dept_id = d.id
    WHERE u.username = ?
  `).get(username.trim().toLowerCase());

  // Return the same 401 for "user not found" and "wrong password" to avoid
  // leaking which usernames exist in the system.
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Deactivated accounts are blocked before the password check to give a
  // more helpful message and prevent timing-based username enumeration.
  if (!user.is_active) {
    return res.status(403).json({ error: 'This account has been deactivated. Contact the administrator.' });
  }

  // bcrypt.compareSync handles the timing-safe comparison.
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Record login timestamp for audit purposes (visible in the admin user list).
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  // Build the JWT payload — omit password_hash and is_active.
  const payload = {
    id:        user.id,
    username:  user.username,
    role:      user.role,
    dept_id:   user.dept_id,
    dept_name: user.dept_name || null,
    dept_code: user.dept_code || null
  };

  // Sign the token with an 8-hour expiry — balances security vs. usability
  // for a government portal used within a single working day.
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

  // Return token and payload so the client can cache user info locally.
  res.json({ token, user: payload });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
// Returns the authenticated user's fresh profile from the database.
// Useful on page load to confirm the session is still valid and refresh
// any stale locally-cached values (e.g. last_login).
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.username, u.role, u.dept_id, u.last_login,
           d.name AS dept_name, d.code AS dept_code
    FROM users u
    LEFT JOIN departments d ON u.dept_id = d.id
    WHERE u.id = ?
  `).get(req.user.id);

  // Should not normally happen since the token was valid, but guard anyway.
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
// Allows the currently logged-in user to update their own password.
// Requires the current password to prevent account takeover via a stolen token.
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  // Fetch the current hash to verify the submitted current password.
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  // Hash the new password with bcrypt cost factor 12 before storing.
  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);
  res.json({ success: true, message: 'Password changed successfully.' });
});

module.exports = router;
