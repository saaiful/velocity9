'use strict';

const https = require('https');
const { replaceServers, getServers, getSetting, setSetting } = require('./db');

const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_COUNTRIES = [
  'Bangladesh', 'India', 'Pakistan', 'Sri Lanka', 'Nepal', 'Maldives', 'Bhutan',
  'Singapore', 'Malaysia', 'Indonesia', 'Thailand', 'Philippines', 'Vietnam',
  'Myanmar', 'Cambodia', 'Laos', 'Brunei', 'Timor-Leste',
  'Japan', 'South Korea', 'China', 'Hong Kong', 'Taiwan', 'Macau', 'Mongolia',
  'Kazakhstan', 'Uzbekistan', 'UAE', 'Saudi Arabia', 'Qatar', 'Kuwait',
  'Bahrain', 'Oman', 'Jordan', 'Turkey', 'Israel', 'Iran', 'Iraq',
  'United Kingdom', 'Germany', 'France', 'Netherlands', 'Sweden', 'Norway',
  'Denmark', 'Finland', 'Switzerland', 'Austria', 'Spain', 'Italy', 'Poland',
  'Belgium', 'Portugal', 'Czech Republic', 'Hungary', 'Romania', 'Ukraine',
  'Russia', 'Greece', 'Ireland',
  'South Africa', 'Nigeria', 'Kenya', 'Egypt', 'Ghana', 'Ethiopia', 'Tanzania',
  'United States', 'Canada', 'Mexico',
  'Costa Rica', 'Panama', 'Dominican Republic',
  'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Ecuador', 'Venezuela',
  'Australia', 'New Zealand', 'Fiji',
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/json, text/plain, */*',
        'Referer':    'https://www.speedtest.net/',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from Ookla API`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Request timeout')); });
  });
}

function normalizeServer(s) {
  const id = s.id || s.server_id;
  if (!id) return null;
  return {
    server_id: String(id),
    name:    (s.name    || '').trim() || null,
    country: (s.country || '').trim() || null,
    cc:      (s.cc      || '').trim() || null,
    sponsor: (s.sponsor || '').trim() || null,
    host:    (s.host    || '').trim() || null,
    lat:     s.lat != null ? String(s.lat) : null,
    lon:     s.lon != null ? String(s.lon) : null,
  };
}

async function fetchCountry(country) {
  const url = `https://www.speedtest.net/api/js/config-sdk?engine=js&limit=1000&search=${encodeURIComponent(country)}`;
  const data = await fetchJson(url);
  const raw = Array.isArray(data) ? data : (data.servers || data.list || []);
  return raw.map(normalizeServer).filter(Boolean);
}

function needsSync() {
  const last = getSetting('last_server_sync');
  if (!last) return true;
  if ((Date.now() - new Date(last).getTime()) >= SYNC_INTERVAL_MS) return true;
  if (getServers().length < 500) return true;
  return false;
}

async function syncServers({ force = false } = {}) {
  if (!force && !needsSync()) {
    console.log('[server-sync] Skipping — last sync was less than 7 days ago');
    return 0;
  }

  let countryList = DEFAULT_COUNTRIES;
  const stored = getSetting('sync_countries');
  if (stored) {
    try { countryList = JSON.parse(stored); } catch (_) {}
  }

  console.log(`[server-sync] Fetching Ookla servers for ${countryList.length} countries…`);

  const seen = new Map();
  let errors = 0;

  for (const country of countryList) {
    try {
      const servers = await fetchCountry(country);
      for (const s of servers) {
        if (!seen.has(s.server_id)) seen.set(s.server_id, s);
      }
      console.log(`[server-sync]  ${country}: ${servers.length} servers`);
    } catch (err) {
      console.error(`[server-sync]  ${country}: failed — ${err.message}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 400));
  }

  const servers = [...seen.values()];
  replaceServers(servers);
  setSetting('last_server_sync', new Date().toISOString());
  console.log(`[server-sync] Done: ${servers.length} unique servers (${errors} country fetch errors)`);
  try { require('./broadcaster').emit('catalog-synced', { count: servers.length }); } catch (_) {}
  return servers.length;
}

module.exports = { syncServers, needsSync };
