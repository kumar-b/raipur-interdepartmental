/**
 * routes/departments.js — department and officials endpoints.
 *
 * Mounted at /api/departments in app.js.
 *
 * POST /api/departments             — create a new department (admin only)
 * GET  /api/departments             — list all departments; optional ?category= filter
 * GET  /api/departments/officials/all — list all key officials (from JSON file)
 * GET  /api/departments/:id         — single department by ID
 *
 * NOTE: The static route /officials/all must be declared BEFORE /:id to prevent
 * Express from treating "officials" as a numeric ID parameter.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

// ── POST / — create a new department (admin only) ───────────────────────────
// Generates a short uppercase code from the department name (e.g. "Health Dept"
// becomes "HEALTH_DEPT"). If the generated code already exists, a numeric suffix
// is appended and retried up to 10 times before giving up.
router.post('/', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required.' });

  const trimmed = name.trim();

  // Derive a code: uppercase, non-alphanumeric replaced with _, trimmed, max 20 chars.
  const baseCode = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_') // replace special characters/spaces with underscore
    .replace(/^_+|_+$/g, '')     // strip leading/trailing underscores
    .substring(0, 20) || 'DEPT'; // fallback to 'DEPT' if the name yields nothing

  let code    = baseCode;
  let attempt = 0;

  // Retry loop to handle UNIQUE constraint violations on the code column.
  while (attempt <= 10) {
    try {
      const result = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run(trimmed, code);
      const dept   = db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid);
      return res.status(201).json(dept);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        // Code collision — append an incrementing suffix and retry.
        attempt++;
        code = `${baseCode}_${attempt}`;
      } else {
        // Unexpected error — propagate as a 500.
        return res.status(500).json({ error: 'Failed to create department.' });
      }
    }
  }

  // Exhausted all retry attempts without finding a unique code.
  res.status(500).json({ error: 'Could not generate a unique department code.' });
});

// ── GET / — list all departments ────────────────────────────────────────────
// Returns all departments from the database.
// An optional ?category= query parameter filters the list (e.g. Administration,
// Social Services, Infrastructure, etc.).
router.get('/', (req, res) => {
  const { category } = req.query;
  const rows = category
    ? db.prepare('SELECT * FROM departments WHERE category = ?').all(category)
    : db.prepare('SELECT * FROM departments').all();
  res.json(rows);
});

// ── GET /officials/all — list all key district officials ────────────────────
// Serves the officials directory from a static JSON file.
// This route MUST be declared before /:id to avoid being matched as an ID lookup.
router.get('/officials/all', (req, res) => {
  const officials = require('../data/officials.json');
  res.json(officials);
});

// ── GET /:id — single department by numeric ID ──────────────────────────────
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid department ID.' });
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(dept);
});

module.exports = router;
