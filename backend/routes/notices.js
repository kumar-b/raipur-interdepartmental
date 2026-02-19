const express = require('express');
const router = express.Router();
const notices = require('../data/notices.json');

// GET all notices (sorted newest first, optional ?category= filter)
router.get('/', (req, res) => {
  const { category, priority } = req.query;
  let result = [...notices].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (category) result = result.filter(n => n.category === category);
  if (priority) result = result.filter(n => n.priority === priority);
  res.json(result);
});

// GET single notice by ID
router.get('/:id', (req, res) => {
  const notice = notices.find(n => n.id === parseInt(req.params.id));
  if (!notice) return res.status(404).json({ error: 'Notice not found' });
  res.json(notice);
});

module.exports = router;
