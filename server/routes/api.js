'use strict';

const express = require('express');
const router = express.Router();
const { runTest, listServers, testEvents, isTestRunning } = require('../speedtest');
const {
  saveResult,
  getResults,
  getResultById,
  getStats,
  getChartData,
  getAllSettings,
  getSetting,
  setSetting,
  getDistinctContinents,
  getDistinctResultServers,
  getMonitoredServers,
  setMonitoredServers,
  addMonitoredServer,
  updateMonitoredServer,
  deleteMonitoredServer,
  getServerCatalog,
  getDashboard,
  getServerHistory,
} = require('../db');
const { restartWithSchedule } = require('../scheduler');
const { getPingStatus, restartPingMonitor, pingEvents } = require('../ping-monitor');
const { getRecentOutages } = require('../db');
const broadcaster = require('../broadcaster');

router.get('/history/:host', (req, res) => {
  const host = decodeURIComponent(req.params.host || '');
  if (!host) return res.status(400).json({ error: 'host is required' });
  const from  = req.query.from  || null;
  const to    = req.query.to    || null;
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit) || 500));
  const rows  = getServerHistory({ host, from, to, limit });
  res.json({ host, rows, count: rows.length });
});

function normalizeMonitoredServerPayload(body) {
  if (!Array.isArray(body)) {
    return null;
  }

  return body
    .filter((server) => server && typeof server.host === 'string' && server.host.trim())
    .map((server, index) => ({
      host: server.host.trim(),        
      port: 5201,                      
      enabled: server.enabled === false || server.enabled === 0 ? 0 : 1,
      sort_order: Number.isInteger(server.sort_order) ? server.sort_order : index,
      label: server.label || null,
    }));
}

function normalizeSingleMonitoredServerPayload(body) {
  const id = (body && (body.server_id || body.host) || '').trim();
  if (!id) {
    return null;
  }

  return {
    host: id,                          
    port: 5201,                        
    enabled: body.enabled === false || body.enabled === 0 ? 0 : 1,
    sort_order: Number.isInteger(body.sort_order) ? body.sort_order : undefined,
    label: body.label || null,
  };
}

router.get('/dashboard', (req, res) => {
  const resultsLimit = Math.min(2000, Math.max(1, parseInt(req.query.results_limit) || 120));
  const serverLimit = Math.min(10000, Math.max(1, parseInt(req.query.server_limit) || 200));
  const from = req.query.from ? parseInt(req.query.from) : null;
  const to   = req.query.to   ? parseInt(req.query.to)   : null;
  res.json(getDashboard({ resultsLimit, serverLimit, from, to }));
});


router.get('/results', (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const order  = req.query.order === 'asc' ? 'asc' : 'desc';
  const server = req.query.server || null;
  res.json(getResults({ page, limit, order, server }));
});

router.get('/results/servers', (_req, res) => {
  res.json(getDistinctResultServers());
});

router.get('/results/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const row = getResultById(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.get('/stats', (_req, res) => {
  res.json(getStats());
});

router.get('/chart', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  res.json(getChartData(limit));
});


router.get('/servers', (req, res) => {
  const continent = req.query.continent || null;
  const search = req.query.search || null;
  const selectedOnly = req.query.selected === '1' || req.query.selected === 'true';
  res.json(getServerCatalog({ continent, search, selectedOnly }));
});

router.get('/servers/continents', (_req, res) => {
  res.json(getDistinctContinents());
});

router.get('/servers/search', (req, res) => {
  const search = (req.query.q || req.query.search || '').trim();
  const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit) || 200));
  const results = getServerCatalog({ search }).slice(0, limit);
  res.json(results);
});

router.post('/servers/sync', async (req, res) => {
  try {
    const { syncServers } = require('../server-sync');
    const force = req.query.force === 'true' || req.body?.force === true;
    const count = await syncServers({ force });
    res.json({ ok: true, count, forced: force });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/monitored-servers', (_req, res) => {
  res.json(getMonitoredServers());
});

router.post('/monitored-servers', (req, res) => {
  const server = normalizeSingleMonitoredServerPayload(req.body);
  if (!server) return res.status(400).json({ error: 'Host is required' });

  try {
    const row = addMonitoredServer(server);
    broadcaster.emit('servers-changed');
    res.status(201).json({ ok: true, row });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/monitored-servers', (req, res) => {
  const servers = normalizeMonitoredServerPayload(req.body);
  if (!servers) return res.status(400).json({ error: 'Expected array' });
  setMonitoredServers(servers);
  broadcaster.emit('servers-changed');
  res.json({ ok: true, count: servers.length, rows: getMonitoredServers() });
});

router.patch('/monitored-servers/:host', (req, res) => {
  try {
    const row = updateMonitoredServer(req.params.host, req.body || {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    broadcaster.emit('servers-changed');
    res.json({ ok: true, row });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/monitored-servers/:host', (req, res) => {
  try {
    const deleted = deleteMonitoredServer(req.params.host);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    broadcaster.emit('servers-changed');
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


router.post('/test/run', async (req, res) => {
  if (isTestRunning()) {
    return res.status(409).json({ error: 'A test is already in progress' });
  }

  const serverId = req.body.server_id || req.body.host || null;

  res.json({ ok: true, message: 'Test started' });

  function onComplete({ result }) {
    try {
      const id = saveResult(result);
      console.log(`[api] Manual test complete — saved as result #${id}`);
      broadcaster.emit('test-complete', { serverId, resultId: id });
    } catch (err) {
      console.error('[api] Failed to save manual test result:', err.message);
    }
  }
  testEvents.prependOnceListener('complete', onComplete);

  try {
    await runTest({ serverId });
  } catch (err) {
    testEvents.removeListener('complete', onComplete);
    console.error('[api] Manual test error:', err.message);
  }
});


router.get('/test/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  req.socket.setTimeout(0);
  req.socket.setKeepAlive(true);

  res.write(`data: ${JSON.stringify({ type: 'status', running: isTestRunning() })}\n\n`);

  function send(type, payload) {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  }

  const onStart    = (p) => send('start', p);
  const onPing     = (p) => send('ping', p);
  const onDownload = (p) => send('download', p);
  const onUpload   = (p) => send('upload', p);
  const onComplete = (p) => { send('complete', p); cleanup(); };
  const onError    = (p) => { send('error', p); cleanup(); };

  function cleanup() {
    testEvents.off('start',    onStart);
    testEvents.off('ping',     onPing);
    testEvents.off('download', onDownload);
    testEvents.off('upload',   onUpload);
    testEvents.off('complete', onComplete);
    testEvents.off('error',    onError);
  }

  testEvents.on('start',    onStart);
  testEvents.on('ping',     onPing);
  testEvents.on('download', onDownload);
  testEvents.on('upload',   onUpload);
  testEvents.on('complete', onComplete);
  testEvents.on('error',    onError);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    cleanup();
  });
});


router.get('/ping/status', (_req, res) => {
  res.json(getPingStatus());
});

router.get('/ping/outages', (req, res) => {
  const from  = req.query.from  ? parseInt(req.query.from)  : null;
  const to    = req.query.to    ? parseInt(req.query.to)    : null;
  const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit)) : null;
  res.json(getRecentOutages({ from, to, limit }));
});

router.get('/ping/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  req.socket.setTimeout(0);
  req.socket.setKeepAlive(true);

  res.write(`data: ${JSON.stringify({ type: 'status', ...getPingStatus() })}\n\n`);

  const send = (type, payload) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const onChange = (p) => send('change', p);
  const onCheck  = (p) => send('check', p);

  pingEvents.on('change', onChange);
  pingEvents.on('check', onCheck);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pingEvents.off('change', onChange);
    pingEvents.off('check', onCheck);
  });
});


router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  req.socket.setTimeout(0);
  req.socket.setKeepAlive(true);

  const send = (type, payload = {}) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const onServersChanged = ()  => send('servers-changed');
  const onCatalogSynced  = (p) => send('catalog-synced', p);
  const onTestComplete   = (p) => send('test-complete', p);

  broadcaster.on('servers-changed', onServersChanged);
  broadcaster.on('catalog-synced',  onCatalogSynced);
  broadcaster.on('test-complete',   onTestComplete);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    broadcaster.off('servers-changed', onServersChanged);
    broadcaster.off('catalog-synced',  onCatalogSynced);
    broadcaster.off('test-complete',   onTestComplete);
  });
});


router.get('/settings', (_req, res) => {
  res.json(getAllSettings());
});

router.put('/settings', (req, res) => {
  const allowed = ['cron_schedule', 'ping_interval'];
  const updates = {};

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates[key] = String(req.body[key]);
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  if (updates.cron_schedule !== undefined) {
    const cron = require('node-cron');
    if (updates.cron_schedule && !cron.validate(updates.cron_schedule)) {
      return res.status(400).json({ error: 'Invalid cron expression' });
    }
  }

  if (updates.ping_interval !== undefined) {
    const v = parseInt(updates.ping_interval);
    if (!Number.isInteger(v) || v < 1 || v > 60) {
      return res.status(400).json({ error: 'ping_interval must be 1–60 seconds' });
    }
    updates.ping_interval = String(v);
  }

  for (const [key, value] of Object.entries(updates)) {
    setSetting(key, value);
  }

  if (updates.cron_schedule) {
    restartWithSchedule(updates.cron_schedule);
  }

  if (updates.ping_interval) {
    restartPingMonitor(parseInt(updates.ping_interval));
  }

  res.json({ ok: true, settings: getAllSettings() });
});

module.exports = router;
