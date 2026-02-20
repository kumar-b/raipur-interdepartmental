/**
 * routes/contact.js — public contact form endpoint.
 *
 * Mounted at /api/contact in app.js.
 * No authentication is required — anyone visiting the public site can
 * use this form to reach the concerned department.
 *
 * POST /api/contact — receive and process a contact form submission.
 *
 * Current behaviour: logs the submission to the server console.
 * Production TODO: persist to DB and/or send an email via nodemailer.
 */

const express = require('express');
const router  = express.Router();

// ── POST / — receive a contact form submission ───────────────────────────────
// Required fields: name, email, subject, message.
// Optional fields: department, phone.
router.post('/', (req, res) => {
  const { name, department, subject, message, email, phone } = req.body;

  // Validate the minimum required fields before processing.
  if (!name || !subject || !message || !email) {
    return res.status(400).json({ error: 'Name, email, subject, and message are required.' });
  }

  // In production: save to DB or send email via nodemailer.
  // For now, log to console so submissions are visible in server output.
  console.log('Contact form submission:', { name, department, subject, email, phone, message });

  res.status(200).json({
    success: true,
    message: 'Your message has been received. The concerned department will respond within 3 working days.'
  });
});

module.exports = router;
