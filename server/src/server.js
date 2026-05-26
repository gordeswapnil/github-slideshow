const config = require('./config');
const { createSecClient } = require('./secClient');
const { createSecService } = require('./secService');
const { createApp } = require('./app');

function start() {
  const client = createSecClient();
  const service = createSecService({ client });
  const app = createApp({ service });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`SEC EDGAR backend listening on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`Using SEC User-Agent: "${config.userAgent}"`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { start };
