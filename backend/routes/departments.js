const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

// POST create new department (admin only)
router.post('/', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required.' });

  const trimmed  = name.trim();
  const baseCode = trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 20) || 'DEPT';

  let code    = baseCode;
  let attempt = 0;
  while (attempt <= 10) {
    try {
      const result = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run(trimmed, code);
      const dept   = db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid);
      return res.status(201).json(dept);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE')) {
        attempt++;
        code = `${baseCode}_${attempt}`;
      } else {
        return res.status(500).json({ error: 'Failed to create department.' });
      }
    }
  }
  res.status(500).json({ error: 'Could not generate a unique department code.' });
});

// GET all departments
router.get('/', (req, res) => {
  const { category } = req.query;
  const rows = category
    ? db.prepare('SELECT * FROM departments WHERE category = ?').all(category)
    : db.prepare('SELECT * FROM departments').all();
  res.json(rows);
});

// NOTE: static routes must come BEFORE /:id to avoid being swallowed
// GET all officials (who's who — served from JSON file)
router.get('/officials/all', (req, res) => {
  const officials = require('../data/officials.json');
  res.json(officials);
});

// GET single department by ID
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid department ID.' });
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(dept);
});

module.exports = router;
