/**
 * server.js — Application entry point.
 *
 * Imports the configured Express app and starts the HTTP server.
 * The PORT is read from the environment variable; defaults to 3000
 * for local development.
 */

const app  = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Raipur Interdepartmental Portal running on http://localhost:${PORT}`);
});
