// Reads residential proxy config from env and builds a Playwright `proxy` object.
//
// Sticky sessions keep the same egress IP for an account within a time window by
// appending `-session-<id>` to the username (Oxylabs / BrightData convention;
// Smartproxy uses a different syntax — override the username template via env if
// your provider differs).
//
// Falls back to "no proxy" (with a one-time warning) when no endpoint is configured,
// so existing VPN-based setups keep working unchanged.

function enabled() {
  return Boolean(process.env.PROXY_ENDPOINT && process.env.PROXY_USERNAME);
}

function stickyIdFor(accountId, now = Date.now()) {
  const windowMinutes = Number(process.env.PROXY_STICKY_DURATION_MIN) || 30;
  const windowStart = Math.floor(now / (windowMinutes * 60 * 1000));
  // Account + time window → the same account keeps one id for the whole window,
  // different accounts never collide in the same window.
  const hash = Array.from(String(accountId)).reduce(
    (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
    7,
  );
  return `${windowStart}-${(hash % 100000).toString(36)}`;
}

// Returns { server, endpoint, username, password } or null when not configured.
function buildProxy(accountId) {
  if (!enabled()) return null;

  const endpoint = process.env.PROXY_ENDPOINT;
  const username = process.env.PROXY_USERNAME;
  const sticky = Number(process.env.PROXY_STICKY_DURATION_MIN) > 0;
  const effectiveUser = sticky
    ? `${username}-session-${stickyIdFor(accountId)}`
    : username;

  return {
    server: `http://${endpoint}`,
    endpoint,
    username: effectiveUser,
    password: process.env.PROXY_PASSWORD || "",
  };
}

let warned = false;
function warnIfFallback() {
  if (!enabled() && !warned) {
    warned = true;
    console.warn(
      "[proxy] no residential proxy configured (PROXY_ENDPOINT/PROXY_USERNAME) — falling back to direct/VPN egress",
    );
  }
}

module.exports = { enabled, buildProxy, stickyIdFor, warnIfFallback };
