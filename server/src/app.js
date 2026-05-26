const path = require('path');
const express = require('express');
const { createRouter } = require('./routes');

function createApp({ service }) {
  const app = express();
  app.use(express.json());

  // Read-only, no-auth public data: permissive CORS so the UI works whether it
  // is served by this backend or opened directly as a file.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.use('/api/sec', createRouter({ service }));

  // Serve the simple frontend.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 404 for unmatched API routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // Centralized error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.expose || status < 500 ? err.message : 'Internal server error';
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
