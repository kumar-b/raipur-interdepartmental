/**
 * routes/notices.js — public notice board endpoints.
 *
 * Mounted at /api/notices in app.js.
 * No authentication required — data is served from a static JSON file
 * so the public-facing notices page works even when the portal DB is empty.
 *
 * GET /api/notices       — all notices (newest first); optional ?category= and ?priority= filters
 * GET /api/notices/:id   — single notice by ID
 */

const express = require('express');
const router  = express.Router();

// Static notice data — populated by the content team directly in the JSON file.
// This is separate from the authenticated portal notices stored in SQLite.
const notices = require('../data/notices.json');

// ── GET /api/notices ─────────────────────────────────────────────────────────
// Returns all public notices sorted by date descending (newest first).
// Supports optional query-string filters:
//   ?category=Meeting   — filter by notice category
//   ?priority=high      — filter by priority level
router.get('/', (req, res) => {
  const { category, priority } = req.query;

  // Clone the array before sorting so the original in-memory array is not mutated.
  let result = [...notices].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (category) result = result.filter(n => n.category === category);
  if (priority) result = result.filter(n => n.priority === priority);

  res.json(result);
});

// ── GET /api/notices/:id ─────────────────────────────────────────────────────
// Returns a single notice by its numeric ID.
// The ID is compared as an integer to handle string-typed URL params.
router.get('/:id', (req, res) => {
  const notice = notices.find(n => n.id === parseInt(req.params.id));
  if (!notice) return res.status(404).json({ error: 'Notice not found' });
  res.json(notice);
});

module.exports = router;
