'use strict';

const express = require('express');
const ViteExpress = require('vite-express');
const path = require('path');
const { startScheduler } = require('./scheduler');
const { startPingMonitor } = require('./ping-monitor');
const apiRouter = require('./routes/api');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

app.use('/api', apiRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

const server = ViteExpress.listen(app, PORT, () => {
  console.log(`[server] Speed Test Server running at http://localhost:${PORT}`);
  startScheduler();
  startPingMonitor();

  const { syncServers } = require('./server-sync');
  syncServers()
    .then(count => console.log(`[server] Initial server sync: ${count} servers loaded`))
    .catch(err  => console.warn('[server] Initial server sync failed:', err.message));
});

function shutdown(signal) {
  console.log(`\n[server] Received ${signal}. Shutting down…`);
  server.close(() => {
    console.log('[server] HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
