const VpnServer = require('../models/VpnServer');
const { checkHostPort } = require('./pingService');

async function checkAllServersNow() {
  const servers = await VpnServer.find();
  return Promise.all(
    servers.map(async (server) => {
      const isOnline = await checkHostPort(server.host, server.port);
      server.status = isOnline ? 'online' : 'offline';
      server.lastCheckedAt = new Date();
      await server.save();
      return server;
    })
  );
}

let intervalHandle = null;

function startScheduledChecks(intervalMs) {
  if (intervalHandle) return intervalHandle;

  // Run once immediately on startup, then on the interval — don't let a rejected
  // promise (e.g. DB hiccup) kill the interval itself.
  checkAllServersNow().catch((err) => console.error('VPN scheduled check failed:', err.message));

  intervalHandle = setInterval(() => {
    checkAllServersNow().catch((err) => console.error('VPN scheduled check failed:', err.message));
  }, intervalMs);

  return intervalHandle;
}

function stopScheduledChecks() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { checkAllServersNow, startScheduledChecks, stopScheduledChecks };
