const net = require('net');

function checkHostPort(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (isOnline) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(isOnline);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, host);
  });
}

module.exports = { checkHostPort };
