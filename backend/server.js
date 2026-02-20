/**
 * server.js — Application entry point.
 *
 * Imports the configured Express app and starts the HTTP server.
 * The PORT is read from the environment variable; defaults to 3000
 * for local development.
 */

const app = require('./app');
const db  = require('./database/db');

const PORT = process.env.PORT || 3000;

// ── Startup validation ────────────────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and be at least 32 characters long.');
  console.error('Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

const server = app.listen(PORT, () => {
  console.log(`[${process.env.NODE_ENV || 'development'}] Raipur Interdepartmental Portal running on port ${PORT}`);
});

// ── Graceful shutdown ─────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    try { db.close(); } catch (_) {}
    console.log('Server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
