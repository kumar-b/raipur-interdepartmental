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

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const departmentsRouter = require('./routes/departments');
const noticesRouter     = require('./routes/notices');
const contactRouter     = require('./routes/contact');
const authRouter        = require('./routes/auth');
const noticesAuthRouter = require('./routes/notices-auth');
const usersRouter       = require('./routes/users');

// Storage mode flag — tells us whether files go to S3 or local disk
const { isS3 } = require('./storage');

const app = express();

// ── Security headers ──────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ── CORS — restricted to allowed origins ──────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  exposedHeaders: ['Authorization']
}));

// ── Request logging ───────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Body parsing with size limits ─────────────────────
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ── Rate limiters (skipped during tests) ──────────────
const isTest = process.env.NODE_ENV === 'test';

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many requests. Please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: 'Too many submissions. Please try again later.' }
});

app.use(globalLimiter);

// ── Static files ──────────────────────────────────────
// Serve uploaded files from local disk only when not using S3.
// In S3 mode, files are accessed directly via their S3 URL.
if (!isS3) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => {
      res.set('Content-Disposition', 'attachment');
      res.set('X-Content-Type-Options', 'nosniff');
    }
  }));
}
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Public API ────────────────────────────────────────
app.use('/api/departments', departmentsRouter);
app.use('/api/notices',     noticesRouter);
app.use('/api/contact',     contactLimiter, contactRouter);

// ── Authenticated API ─────────────────────────────────
app.use('/api/auth',   authLimiter, authRouter);
app.use('/api/portal', noticesAuthRouter);
app.use('/api/portal', usersRouter);

// ── SPA fallback ──────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Centralized error handler ─────────────────────────
app.use((err, req, res, _next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE:       'File too large. Maximum size is 10 MB.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field.'
    };
    return res.status(400).json({ error: messages[err.code] || 'File upload error.' });
  }

  if (err.message && err.message.includes('Only PDF')) {
    return res.status(400).json({ error: err.message });
  }

  const status = err.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    console.error(err.stack || err);
  }

  res.status(status).json({
    error: isProduction ? 'Internal server error.' : (err.message || 'Internal server error.')
  });
});

module.exports = app;
