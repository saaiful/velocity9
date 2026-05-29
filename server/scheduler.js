'use strict';

const cron = require('node-cron');
const { runTest, isTestRunning } = require('./speedtest');
const { saveResult, getSetting, setSetting, getScheduledServers } = require('./db');
const { syncServers, needsSync } = require('./server-sync');
const broadcaster = require('./broadcaster');

// Deadline slightly longer than the per-test timeout so the kill inside runTest fires first
const SCHEDULER_TEST_DEADLINE_MS = (parseInt(process.env.SPEEDTEST_TIMEOUT_MS, 10) || 5 * 60 * 1000) + 15_000;

let currentTask = null;

cron.schedule('0 3 * * *', async () => {
  if (!needsSync()) return;
  console.log('[scheduler] 7-day server sync triggered…');
  try {
    const count = await syncServers();
    console.log(`[scheduler] Server list updated: ${count} servers`);
  } catch (err) {
    console.error('[scheduler] Server sync failed:', err.message);
  }
});

function startScheduler() {
  const schedule = getSetting('cron_schedule') || '0 */1 * * *';
  console.log(`[scheduler] Starting with schedule: ${schedule}`);
  scheduleTask(schedule);
}

function scheduleTask(cronExpression) {
  if (!cron.validate(cronExpression)) {
    console.error(`[scheduler] Invalid cron expression: ${cronExpression}`);
    return false;
  }

  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  currentTask = cron.schedule(cronExpression, async () => {
    console.log('[scheduler] Running scheduled speed tests…');
    const monitored = getScheduledServers();
    if (!monitored.length) {
      console.log('[scheduler] No monitored servers configured, skipping');
      return;
    }
    for (const { server_id } of monitored) {
      const MAX_ATTEMPTS = 3;
      let lastErr;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`[scheduler] Retrying server ${server_id} (attempt ${attempt}/${MAX_ATTEMPTS})…`);
            await new Promise(r => setTimeout(r, 5000 * (attempt - 1)));
          } else {
            console.log(`[scheduler] Testing Ookla server ${server_id}…`);
          }

          // Outer deadline: if runTest's own cancel somehow doesn't fire, force-resolve here
          let deadlineHandle;
          const deadlinePromise = new Promise((_, reject) => {
            deadlineHandle = setTimeout(() => {
              console.error(`[scheduler] Outer deadline hit for server ${server_id} — forcing isRunning reset`);
              reject(new Error(`Scheduler outer deadline exceeded for server ${server_id}`));
            }, SCHEDULER_TEST_DEADLINE_MS);
          });

          const result = await Promise.race([runTest({ serverId: server_id }), deadlinePromise])
            .finally(() => clearTimeout(deadlineHandle));

          const id = saveResult(result);
          console.log(`[scheduler] ${server_id} → result #${id} (↓${result.download_mbps} ↑${result.upload_mbps} Mbps)`);
          broadcaster.emit('test-complete', { serverId: server_id, resultId: id });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`[scheduler] Attempt ${attempt}/${MAX_ATTEMPTS} failed for ${server_id}: ${err.message}`);
        }
      }
      if (lastErr) {
        console.error(`[scheduler] All ${MAX_ATTEMPTS} attempts failed for ${server_id}: ${lastErr.message}`);
      }
    }
  });

  return true;
}


function restartWithSchedule(newSchedule) {
  if (!newSchedule) {
    setSetting('cron_schedule', '');
    if (currentTask) {
      currentTask.stop();
      currentTask = null;
    }
    console.log('[scheduler] Scheduling disabled');
    return true;
  }

  if (!cron.validate(newSchedule)) return false;
  setSetting('cron_schedule', newSchedule);
  scheduleTask(newSchedule);
  console.log(`[scheduler] Rescheduled to: ${newSchedule}`);
  return true;
}

module.exports = { startScheduler, restartWithSchedule };
