const path = require('path');
const express = require('express');
const { createRouter } = require('./routes');

function createApp({ service }) {
  const app = express();
  app.use(express.json());

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
