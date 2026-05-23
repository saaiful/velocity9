'use strict';

const net = require('net');
const { EventEmitter } = require('events');
const cron = require('node-cron');
const { getSetting, setSetting } = require('./db');

const CHECK_TARGETS = [
  { host: '8.8.8.8',         port: 53  },  
  { host: '8.8.4.4',         port: 53  },  
  { host: '1.1.1.1',         port: 53  },  
  { host: '1.0.0.1',         port: 53  },  
  { host: '9.9.9.9',         port: 53  },  
  { host: '149.112.112.112', port: 53  },  
  { host: '208.67.222.222',  port: 53  },  
  { host: '208.67.220.220',  port: 53  },  
  { host: '94.140.14.14',    port: 53  },  
  { host: '94.140.15.15',    port: 53  },  
  { host: '185.228.168.9',   port: 53  },  
  { host: '76.76.2.0',       port: 53  },  

  { host: '93.184.216.34',   port: 80  },  
  { host: '208.80.153.224',  port: 80  },  
  { host: '151.101.1.195',   port: 443 },  
  { host: '151.101.65.195',  port: 443 },  
  { host: '104.18.2.161',    port: 443 },  
  { host: '104.16.123.96',   port: 443 },  
  { host: '13.107.42.14',    port: 443 },  
  { host: '17.253.144.10',   port: 443 },  
];

const TIMEOUT_MS   = 3000;  
const SAMPLE_COUNT = 8;     
const UP_THRESHOLD = 3;     
const DOWN_STRIKES = 2;     
const UP_STRIKES   = 2;     

const pingEvents = new EventEmitter();
pingEvents.setMaxListeners(20);

let _task       = null;
let _isDown     = false;
let _outageId   = null;
let _failStreak = 0;
let _passStreak = 0;
let _checkLock  = false;

function pickRandom(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock  = new net.Socket();
    let settled = false;

    function done(ok) {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ ok, rtt: Date.now() - start });
    }

    sock.setTimeout(TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error',   () => done(false));
    sock.connect(port, host);
  });
}

async function runCheck() {
  if (_checkLock) return;   
  _checkLock = true;
  try {
    const targets = pickRandom(CHECK_TARGETS, SAMPLE_COUNT);
    const results = await Promise.all(targets.map(t => tcpProbe(t.host, t.port)));
    const hits    = results.filter(r => r.ok).length;
    const pass    = hits >= UP_THRESHOLD;
    const rtts    = results.filter(r => r.ok).map(r => r.rtt);
    const avgRtt  = rtts.length
      ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)
      : null;

    pingEvents.emit('check', { up: pass, hits, total: SAMPLE_COUNT, rtt: avgRtt });

    if (pass) {
      _failStreak = 0;
      _passStreak++;

      if (_isDown && _passStreak >= UP_STRIKES) {
        _isDown = false;
        if (_outageId !== null) {
          const { closeOutage } = require('./db');
          closeOutage(_outageId, Date.now());
          _outageId = null;
        }
        pingEvents.emit('change', { status: 'up', at: Date.now(), rtt: avgRtt });
        console.log('[ping] Internet RESTORED — %d/%d reachable, %dms avg RTT',
          hits, SAMPLE_COUNT, avgRtt ?? 0);
      }
    } else {
      _passStreak = 0;
      _failStreak++;

      if (!_isDown && _failStreak >= DOWN_STRIKES) {
        _isDown = true;
        const { saveOutage } = require('./db');
        _outageId = saveOutage(Date.now());
        pingEvents.emit('change', { status: 'down', outageId: _outageId, at: Date.now() });
        console.log('[ping] Internet DOWN — %d/%d reachable after %d consecutive failures',
          hits, SAMPLE_COUNT, _failStreak);
      } else if (!_isDown) {
        console.log('[ping] Degraded check %d/%d — %d/%d reachable',
          _failStreak, DOWN_STRIKES, hits, SAMPLE_COUNT);
      }
    }
  } finally {
    _checkLock = false;
  }
}

function scheduleTask(seconds) {
  if (_task) { _task.stop(); _task = null; }
  const s = Math.min(60, Math.max(1, parseInt(seconds) || 5));
  _task = cron.schedule(`*/${s} * * * * *`, () => {
    runCheck().catch((err) => console.error('[ping]', err.message));
  });
  console.log('[ping] Monitor every %ds — down after %d×, restored after %d×',
    s, DOWN_STRIKES, UP_STRIKES);
  return s;
}

function startPingMonitor() {
  const s = parseInt(getSetting('ping_interval')) || 5;
  scheduleTask(s);
  runCheck().catch((err) => console.error('[ping] initial check:', err.message));
}

function restartPingMonitor(seconds) {
  setSetting('ping_interval', String(seconds));
  return scheduleTask(seconds);
}

function getPingStatus() {
  return { up: !_isDown };
}

module.exports = { startPingMonitor, restartPingMonitor, getPingStatus, pingEvents };
