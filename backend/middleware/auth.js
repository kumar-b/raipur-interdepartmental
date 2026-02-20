/**
 * middleware/auth.js — JWT authentication and role-based access control.
 *
 * Exports two middleware functions:
 *
 *   requireAuth   — verifies the Bearer token in the Authorization header and
 *                   attaches the decoded user payload to req.user.
 *
 *   requireAdmin  — chains requireAuth then checks that the authenticated user
 *                   has the 'admin' role; returns 403 otherwise.
 */

const jwt = require('jsonwebtoken');

/**
 * requireAuth — ensures the request carries a valid JWT.
 *
 * Expects:  Authorization: Bearer <token>
 * On success: populates req.user with { id, username, role, dept_id }
 *             and calls next().
 * On failure: responds with 401 (missing header) or 401 (invalid/expired token).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  // Reject requests that have no Authorization header or use a different scheme.
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  // Strip the "Bearer " prefix (7 characters) to get the raw token string.
  const token = header.slice(7);

  try {
    // Verify signature and expiry using the application secret.
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Attach only the fields that downstream handlers need — never expose
    // password_hash or other sensitive columns from the DB row.
    req.user = {
      id:       payload.id,
      username: payload.username,
      role:     payload.role,
      dept_id:  payload.dept_id
    };
    next();
  } catch {
    // jwt.verify throws for expired tokens, wrong signature, malformed JWT, etc.
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * requireAdmin — ensures the authenticated user is an administrator.
 *
 * Internally calls requireAuth first so it doubles as an auth check.
 * Returns 403 if the user is authenticated but not an admin.
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
