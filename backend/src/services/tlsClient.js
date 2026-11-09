// Optional TLS-impersonating fetch for direct HTTP calls (NOT browser traffic).
//
// The current architecture makes all fingerprint-sensitive requests through a real
// browser, so this is mostly relevant for future direct API calls. It uses
// `impersonated-fetch` when installed and falls back to the global fetch otherwise —
// never breaking callers just because the optional dependency is missing.
//
// Install to enable: npm i impersonated-fetch

let lib = null;
let resolved = false;

function load() {
  if (!resolved) {
    resolved = true;
    try {
      // eslint-disable-next-line global-require
      const mod = require("impersonated-fetch");
      lib = mod && typeof mod.fetch === "function" ? mod : null;
    } catch {
      lib = null;
    }
  }
  return lib;
}

function available() {
  return Boolean(load());
}

async function fetch(url, options = {}) {
  const mod = load();
  if (mod) {
    const impersonate =
      options.impersonate || process.env.TLS_IMPERSONATE || "chrome124";
    return mod.fetch(url, { ...options, impersonate });
  }
  return globalThis.fetch(url, options);
}

module.exports = { fetch, available };
