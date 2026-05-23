'use strict';

const { EventEmitter } = require('events');
const speedTest = require('speedtest-net');
const { getServers } = require('./db');

const testEvents = new EventEmitter();
testEvents.setMaxListeners(50);

let isRunning = false;


function listServers() {
  return getServers();
}


async function runTest({ serverId } = {}) {
  if (isRunning) throw new Error('A test is already in progress');

  const servers = listServers();
  let serverEntry = null;

  if (serverId != null) {
    serverEntry = servers.find(s => String(s.server_id) === String(serverId));
  }
  if (!serverEntry && servers.length) {
    serverEntry = servers[0];
  }
  if (!serverEntry) {
    throw new Error('No servers available — add servers to servers.json and trigger a sync');
  }

  const targetServerId = parseInt(serverEntry.server_id);
  const serverName = [serverEntry.sponsor, serverEntry.name, serverEntry.country]
    .filter(Boolean).join(' — ');

  isRunning = true;
  let detectedIsp = null;
  let detectedServer = null;

  try {
    testEvents.emit('start', { server: { name: serverName, id: targetServerId } });
    testEvents.emit('ping',     { latency: null, jitter: null, progress: 0 });
    testEvents.emit('download', { bandwidth_mbps: null, progress: 0 });
    testEvents.emit('upload',   { bandwidth_mbps: null, progress: 0 });

    const result = await speedTest({
      serverId: targetServerId,
      acceptLicense: true,
      acceptGdpr: true,
      progress(data) {
        if (data.type === 'testStart') {
          detectedIsp    = data.isp;
          detectedServer = data.server;
          return;
        }
        if (data.type === 'ping') {
          const { latency, jitter, progress } = data.ping;
          testEvents.emit('ping', {
            latency:  latency  != null ? +latency.toFixed(2)  : null,
            jitter:   jitter   != null ? +jitter.toFixed(2)   : null,
            progress: progress || 0,
          });
        } else if (data.type === 'download') {
          const { bandwidth, progress: pct } = data.download;
          testEvents.emit('download', {
            bandwidth_mbps: bandwidth != null ? +(bandwidth / 125000).toFixed(2) : null,
            progress: pct || 0,
          });
        } else if (data.type === 'upload') {
          const { bandwidth, progress: pct } = data.upload;
          testEvents.emit('upload', {
            bandwidth_mbps: bandwidth != null ? +(bandwidth / 125000).toFixed(2) : null,
            progress: pct || 0,
          });
        }
      },
    });

    const download_mbps = +(result.download.bandwidth / 125000).toFixed(2);
    const upload_mbps   = +(result.upload.bandwidth   / 125000).toFixed(2);
    const ping_latency  = +result.ping.latency.toFixed(2);
    const ping_jitter   = result.ping.jitter != null ? +result.ping.jitter.toFixed(2) : null;
    const packet_loss   = result.packetLoss  != null ? +result.packetLoss.toFixed(2)  : null;

    const srv = detectedServer || {};
    const resolvedName = srv.name
      ? [srv.name, srv.location, srv.country].filter(Boolean).join(' — ')
      : serverName;

    const resultObj = {
      timestamp:       new Date().toISOString(),
      download_mbps,
      upload_mbps,
      ping_latency,
      ping_jitter,
      packet_loss,
      isp:             detectedIsp              || null,
      server_id:       String(targetServerId),
      server_name:     resolvedName,
      server_location: srv.location             || serverEntry.name    || null,
      server_country:  srv.country              || serverEntry.country || null,
      result_url:      result.result?.url       || null,
      external_ip:     result.interface?.externalIp || null,
    };

    testEvents.emit('complete', { result: resultObj });
    return resultObj;
  } catch (err) {
    testEvents.emit('error', { message: err.message });
    throw err;
  } finally {
    isRunning = false;
  }
}

function isTestRunning() { return isRunning; }

module.exports = { runTest, listServers, testEvents, isTestRunning };
