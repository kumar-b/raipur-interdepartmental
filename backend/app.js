/**
 * app.js — Express application factory.
 *
 * Wires together all middleware, static file serving, and route
 * handlers, then exports the app so it can be used by server.js
 * (production) and supertest (test suite) without starting a
 * real TCP listener.
 *
 * Route namespaces:
 *   /api/departments  — public department list and officials data
 *   /api/notices      — public notice board (read-only, from JSON file)
 *   /api/contact      — public contact-form submission
 *   /api/auth         — login, /me, change-password
 *   /api/portal       — authenticated notices + user management (JWT required)
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// Route modules
const departmentsRouter  = require('./routes/departments');
const noticesRouter      = require('./routes/notices');
const contactRouter      = require('./routes/contact');
const authRouter         = require('./routes/auth');
const noticesAuthRouter  = require('./routes/notices-auth');
const usersRouter        = require('./routes/users');

// Storage mode flag — tells us whether files go to S3 or local disk
const { isS3 } = require('./storage');

const app = express();

// Allow cross-origin requests and expose the Authorization header
// so browser clients can read the JWT token returned after login.
app.use(cors({ exposedHeaders: ['Authorization'] }));

// Parse incoming JSON request bodies (used by POST/PATCH endpoints).
app.use(express.json());

// Serve uploaded files from local disk only when not using S3.
// In S3 mode, files are accessed directly via their S3 URL.
if (!isS3) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// Serve the entire frontend folder (HTML, CSS, JS, images) as static assets.
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Public API routes (no authentication required) ──────────────────────────
app.use('/api/departments', departmentsRouter);
app.use('/api/notices',     noticesRouter);
app.use('/api/contact',     contactRouter);

// ── Authenticated API routes (JWT required for protected endpoints) ──────────
app.use('/api/auth',   authRouter);        // login, /me, change-password
app.use('/api/portal', noticesAuthRouter); // inbox, outbox, create/update/delete
app.use('/api/portal', usersRouter);       // user management (admin only)

// SPA fallback — serve index.html for any unknown path so the frontend
// router (simple <a href> navigation) works correctly on page reload.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

module.exports = app;
