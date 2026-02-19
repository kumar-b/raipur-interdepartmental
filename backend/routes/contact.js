const express = require('express');
const router = express.Router();

// POST contact form submission
router.post('/', (req, res) => {
  const { name, department, subject, message, email, phone } = req.body;

  if (!name || !subject || !message || !email) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
  }

  // In production: save to DB or send email via nodemailer
  console.log('Contact form submission:', { name, department, subject, email, phone, message });

  res.status(200).json({
    success: true,
    message: 'Your message has been received. The concerned department will respond within 3 working days.'
  });
});

module.exports = router;
