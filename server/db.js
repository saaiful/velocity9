'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../db/speed-test.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


db.exec(`
  CREATE TABLE IF NOT EXISTS results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    download_mbps REAL,
    upload_mbps   REAL,
    ping_latency  REAL,
    ping_jitter   REAL,
    packet_loss   REAL,
    isp           TEXT,
    server_id     TEXT,
    server_name   TEXT,
    server_location TEXT,
    server_country  TEXT,
    result_url    TEXT,
    external_ip   TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

{
  const cols = db.prepare('PRAGMA table_info(servers)').all();
  const isOldSchema = cols.some(c => c.name === 'port' || c.name === 'provider');
  if (isOldSchema) {
    db.exec('DROP TABLE IF EXISTS servers');
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL UNIQUE,
    name      TEXT,
    country   TEXT,
    cc        TEXT,
    sponsor   TEXT,
    host      TEXT,
    lat       TEXT,
    lon       TEXT
  );

  CREATE TABLE IF NOT EXISTS monitored_servers (
    host       TEXT PRIMARY KEY,
    port       INTEGER NOT NULL DEFAULT 5201,
    enabled    INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
`);

db.exec(`
  DROP TABLE IF EXISTS preferred_servers;
`);

try {
  db.exec(`ALTER TABLE monitored_servers ADD COLUMN label TEXT`);
} catch (_) { }

db.exec(`
  CREATE TABLE IF NOT EXISTS internet_outages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at INTEGER NOT NULL,
    restored_at INTEGER
  );
`);

const setDefault = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
);
setDefault.run('cron_schedule', '0 */1 * * *');
setDefault.run('ping_interval', '5');
db.prepare('DELETE FROM settings WHERE key = ?').run('preferred_server_id');
db.prepare('DELETE FROM settings WHERE key = ?').run('preferred_server_host');
db.prepare('DELETE FROM settings WHERE key = ?').run('preferred_server_port');


const stmtInsert = db.prepare(`
  INSERT INTO results
    (timestamp, download_mbps, upload_mbps, ping_latency, ping_jitter,
     packet_loss, isp, server_id, server_name, server_location, server_country,
     result_url, external_ip)
  VALUES
    (@timestamp, @download_mbps, @upload_mbps, @ping_latency, @ping_jitter,
     @packet_loss, @isp, @server_id, @server_name, @server_location, @server_country,
     @result_url, @external_ip)
`);

function saveResult(data) {
  const info = stmtInsert.run(data);
  return info.lastInsertRowid;
}

function getResults({ page = 1, limit = 20, order = 'desc', server = null } = {}) {
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * limit;
  let rows, total;
  if (server) {
    rows  = db.prepare(`SELECT * FROM results WHERE server_id = ? ORDER BY timestamp ${dir} LIMIT ? OFFSET ?`).all(server, limit, offset);
    total = db.prepare('SELECT COUNT(*) AS cnt FROM results WHERE server_id = ?').get(server).cnt;
  } else {
    rows  = db.prepare(`SELECT * FROM results ORDER BY timestamp ${dir} LIMIT ? OFFSET ?`).all(limit, offset);
    total = db.prepare('SELECT COUNT(*) AS cnt FROM results').get().cnt;
  }
  return { rows, total, page, limit };
}

function getDistinctResultServers() {
  return db.prepare(
    'SELECT DISTINCT server_id AS host, server_name AS name FROM results WHERE server_id IS NOT NULL ORDER BY server_name'
  ).all();
}

function getResultById(id) {
  return db.prepare(`SELECT * FROM results WHERE id = ?`).get(id);
}

function getStats() {
  return db.prepare(`
    SELECT
      COUNT(*)              AS total_tests,
      ROUND(AVG(download_mbps), 2) AS avg_download,
      ROUND(MAX(download_mbps), 2) AS max_download,
      ROUND(MIN(download_mbps), 2) AS min_download,
      ROUND(AVG(upload_mbps),   2) AS avg_upload,
      ROUND(MAX(upload_mbps),   2) AS max_upload,
      ROUND(MIN(upload_mbps),   2) AS min_upload,
      ROUND(AVG(ping_latency),  2) AS avg_ping,
      ROUND(MIN(ping_latency),  2) AS best_ping
    FROM results
  `).get();
}

function getChartData(limit = 100) {
  return db
    .prepare(`
      SELECT timestamp, download_mbps, upload_mbps, ping_latency
      FROM results
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    .all(limit)
    .reverse();
}

function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

function getAllSettings() {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}


const _replaceServers = db.transaction((servers) => {
  db.prepare('DELETE FROM servers').run();
  const ins = db.prepare(`
    INSERT INTO servers (server_id, name, country, cc, sponsor, host, lat, lon)
    VALUES (@server_id, @name, @country, @cc, @sponsor, @host, @lat, @lon)
  `);
  for (const s of servers) ins.run(s);
});

function replaceServers(servers) {
  _replaceServers(servers);
}

function getServers() {
  return db.prepare(
    'SELECT * FROM servers ORDER BY country, name, sponsor'
  ).all();
}

function getDistinctContinents() {
  return [];
}

function getServerCatalog({ continent = null, search = null, selectedOnly = false } = {}) {
  const clauses = [];
  const params = [];

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    clauses.push('(s.server_id LIKE ? OR s.sponsor LIKE ? OR s.name LIKE ? OR s.country LIKE ? OR s.cc LIKE ?)');
    params.push(term, term, term, term, term);
  }

  if (selectedOnly) {
    clauses.push('ms.host IS NOT NULL');
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT
      s.server_id,
      s.name,
      s.country,
      s.cc,
      s.sponsor,
      s.host,
      s.lat,
      s.lon,
      COALESCE(ms.enabled, 0) AS selected,
      COALESCE(ms.sort_order, 999999) AS sort_order,
      ms.updated_at AS selected_updated_at
    FROM servers s
    LEFT JOIN monitored_servers ms ON ms.host = s.server_id
    ${whereClause}
    ORDER BY selected DESC, sort_order ASC, s.country, s.name, s.sponsor
  `).all(...params);
}


function getScheduledServers() {
  return db.prepare(`
    SELECT host AS server_id
    FROM monitored_servers
    WHERE enabled = 1
    ORDER BY sort_order, host
  `).all();
}

function getMonitoredServers() {
  return db.prepare(`
    SELECT
      ms.host,
      ms.enabled,
      ms.sort_order,
      ms.label,
      ms.created_at,
      ms.updated_at,
      s.sponsor,
      s.name,
      s.country,
      s.cc,
      s.host AS ookla_host
    FROM monitored_servers ms
    LEFT JOIN servers s ON s.server_id = ms.host
    ORDER BY ms.sort_order, ms.host
  `).all();
}

const resequenceMonitoredServers = db.transaction(() => {
  const rows = db.prepare('SELECT host FROM monitored_servers ORDER BY sort_order, host').all();
  const update = db.prepare('UPDATE monitored_servers SET sort_order = ?, updated_at = ? WHERE host = ?');
  const now = new Date().toISOString();
  rows.forEach((row, index) => update.run(index, now, row.host));
});

const _setMonitoredServers = db.transaction((servers) => {
  db.prepare('DELETE FROM monitored_servers').run();

  const monitoredInsert = db.prepare(`
    INSERT INTO monitored_servers (host, port, enabled, sort_order, label, created_at, updated_at)
    VALUES (@host, @port, @enabled, @sort_order, @label, @created_at, @updated_at)
  `);
  const now = new Date().toISOString();

  servers.forEach((server, index) => {
    const record = {
      host: server.host,
      port: parseInt(server.port) || 5201,
      enabled: server.enabled === 0 ? 0 : 1,
      sort_order: Number.isInteger(server.sort_order) ? server.sort_order : index,
      label: server.label || null,
      created_at: server.created_at || now,
      updated_at: now,
    };
    monitoredInsert.run(record);
  });
});

function setMonitoredServers(servers) {
  _setMonitoredServers(
    servers
      .filter((server) => server && typeof server.host === 'string' && server.host.trim())
      .map((server, index) => ({
        host: server.host.trim(),
        port: parseInt(server.port) || 5201,
        enabled: server.enabled === false || server.enabled === 0 ? 0 : 1,
        sort_order: Number.isInteger(server.sort_order) ? server.sort_order : index,
        label: server.label || null,
        created_at: server.created_at || null,
      }))
  );
}

function addMonitoredServer(server) {
  if (!server || typeof server.host !== 'string' || !server.host.trim()) {
    throw new Error('Host is required');
  }

  const host = server.host.trim();
  const now = new Date().toISOString();
  const currentMax = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM monitored_servers').get();
  db.prepare(`
    INSERT INTO monitored_servers (host, port, enabled, sort_order, label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    host,
    parseInt(server.port) || 5201,
    server.enabled === false || server.enabled === 0 ? 0 : 1,
    Number.isInteger(server.sort_order) ? server.sort_order : (currentMax.max_sort_order + 1),
    server.label || null,
    now,
    now
  );
  resequenceMonitoredServers();
  return db.prepare('SELECT * FROM monitored_servers WHERE host = ?').get(host);
}

function updateMonitoredServer(host, updates = {}) {
  const trimmedHost = String(host || '').trim();
  if (!trimmedHost) {
    throw new Error('Host is required');
  }

  const existing = db.prepare('SELECT * FROM monitored_servers WHERE host = ?').get(trimmedHost);
  if (!existing) {
    return null;
  }

  const next = {
    port: updates.port !== undefined ? (parseInt(updates.port) || 5201) : existing.port,
    enabled: updates.enabled !== undefined ? (updates.enabled === false || updates.enabled === 0 ? 0 : 1) : existing.enabled,
    sort_order: Number.isInteger(updates.sort_order) ? updates.sort_order : existing.sort_order,
    label: updates.label !== undefined ? (updates.label || null) : existing.label,
    updated_at: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE monitored_servers
    SET port = ?, enabled = ?, sort_order = ?, label = ?, updated_at = ?
    WHERE host = ?
  `).run(next.port, next.enabled, next.sort_order, next.label, next.updated_at, trimmedHost);
  resequenceMonitoredServers();
  return db.prepare('SELECT * FROM monitored_servers WHERE host = ?').get(trimmedHost);
}

function deleteMonitoredServer(host) {
  const trimmedHost = String(host || '').trim();
  if (!trimmedHost) {
    throw new Error('Host is required');
  }

  const info = db.prepare('DELETE FROM monitored_servers WHERE host = ?').run(trimmedHost);
  resequenceMonitoredServers();
  return info.changes > 0;
}


function saveOutage(detectedAt) {
  const info = db.prepare('INSERT INTO internet_outages (detected_at) VALUES (?)').run(detectedAt);
  return info.lastInsertRowid;
}

function closeOutage(id, restoredAt) {
  db.prepare('UPDATE internet_outages SET restored_at = ? WHERE id = ?').run(restoredAt, id);
}

function getRecentOutages({ from = null, to = null, limit = null } = {}) {
  const params = [];
  let sql = 'SELECT * FROM internet_outages';
  const conditions = [];
  if (from != null) { conditions.push('detected_at >= ?'); params.push(from); }
  if (to   != null) { conditions.push('detected_at <= ?'); params.push(to);   }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY detected_at DESC';
  if (limit != null) { sql += ' LIMIT ?'; params.push(limit); }
  return db.prepare(sql).all(...params);
}

function getServerHistory({ host, from = null, to = null, limit = 500 } = {}) {
  if (!host) return [];
  const params = [String(host)];
  let sql = 'SELECT * FROM results WHERE server_id = ?';
  if (from) { sql += ' AND timestamp >= ?'; params.push(from); }
  if (to)   { sql += ' AND timestamp <= ?'; params.push(to); }
  sql += ' ORDER BY timestamp ASC LIMIT ?';
  params.push(Math.min(2000, Math.max(1, Number(limit) || 500)));
  return db.prepare(sql).all(...params);
}

function getDashboard({ resultsLimit = 120, serverLimit = 200, from = null, to = null } = {}) {
  const params = [];
  const conditions = [];
  if (from != null) { conditions.push('timestamp >= ?'); params.push(new Date(from).toISOString()); }
  if (to   != null) { conditions.push('timestamp <= ?'); params.push(new Date(to).toISOString()); }
  let sql = 'SELECT * FROM results';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(resultsLimit);
  const results = db.prepare(sql).all(...params).reverse();

  return {
    stats: getStats(),
    results,
    monitoredServers: getMonitoredServers(),
    serverCatalog: getServerCatalog({}).slice(0, serverLimit),
    settings: getAllSettings(),
  };
}

module.exports = {
  saveResult,
  saveOutage,
  closeOutage,
  getRecentOutages,
  getResults,
  getResultById,
  getStats,
  getChartData,
  getSetting,
  setSetting,
  getAllSettings,
  replaceServers,
  getServers,
  getServerCatalog,
  getDistinctContinents,
  getScheduledServers,
  getMonitoredServers,
  setMonitoredServers,
  addMonitoredServer,
  updateMonitoredServer,
  deleteMonitoredServer,
  getDashboard,
  getDistinctResultServers,
  getServerHistory,
};
