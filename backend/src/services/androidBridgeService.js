// Клієнт до Python-мосту автоматизації Android (uiautomator2).
// Міст піднімається окремо: treds/automation/bridge.py (порт 8900 за замовчуванням).
// Базовий URL можна перевизначити через ANDROID_BRIDGE_URL у .env.
// Використовує вбудований fetch (Node 18+), тож додаткових залежностей не треба.

const BASE_URL = process.env.ANDROID_BRIDGE_URL || "http://127.0.0.1:8900";
const TIMEOUT_MS = Number(process.env.ANDROID_BRIDGE_TIMEOUT_MS || 60000);

// Низькорівневий запит до мосту з таймаутом і нормалізацією помилок.
async function call(method, path, { body, query, raw, timeoutMs } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    const e = new Error(`android-bridge недоступний (${BASE_URL}): ${err.message}`);
    e.status = 503;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* non-JSON error body */
    }
    const e = new Error(`android-bridge: ${detail}`);
    e.status = res.status;
    throw e;
  }

  if (raw === "buffer") return Buffer.from(await res.arrayBuffer());
  if (raw === "text") return res.text();
  return res.json();
}

module.exports = {
  baseUrl: BASE_URL,

  health: () => call("GET", "/health"),
  devices: () => call("GET", "/devices"),
  info: (serial) => call("GET", "/info", { query: { serial } }),

  // --- застосунки ---
  installApp: (source, serial) => call("POST", "/app/install", { body: { source, serial } }),
  startApp: (pkg, serial) => call("POST", "/app/start", { body: { package: pkg, serial } }),
  stopApp: (pkg, serial) => call("POST", "/app/stop", { body: { package: pkg, serial } }),
  currentApp: (serial) => call("GET", "/app/current", { query: { serial } }),
  listApps: (thirdParty = true, serial) =>
    call("GET", "/apps", { query: { third_party: thirdParty, serial } }),

  // --- дії ---
  tapText: (text, serial, timeout = 10) =>
    call("POST", "/tap_text", { body: { text, serial, timeout } }),
  tap: (x, y, serial) => call("POST", "/tap", { body: { x, y, serial } }),
  type: (text, resourceId, serial, clear = true) =>
    call("POST", "/type", { body: { text, resource_id: resourceId, serial, clear } }),
  press: (key = "home", serial) => call("POST", "/press", { body: { key, serial } }),
  swipe: (direction = "up", serial) => call("POST", "/swipe", { body: { direction, serial } }),

  // --- поведінки (flows) ---
  // publish=false => заповнити композер, але НЕ публікувати (безпечний тест)
  threadsPost: (text, publish = true, serial) =>
    call("POST", "/behavior/threads-post", { body: { text, publish, serial } }),

  // --- профіль маскування пристрою (Шар A/Б) ---
  // key — ключ сховища (напр. ManyFaces profileId) для per-профіль конфігу;
  // serial — adb-ціль. Для ручної панелі достатньо serial.
  deviceDefaults: () => call("GET", "/device/defaults"),
  deviceProfile: (serial, key) =>
    call("GET", "/device/profile", { query: { serial, key } }),
  deviceProfileSave: (profile, serial, key) =>
    call("PUT", "/device/profile", { body: { profile, serial, key } }),
  deviceCurrent: (serial) => call("GET", "/device/current", { query: { serial } }),
  deviceApply: (profile, serial, key) =>
    call("POST", "/device/apply", { body: { profile, serial, key } }),
  // Повна (persistent) підміна ro.* через build.prop + ребут. Довгий виклик.
  deviceApplyPersistent: (profile, serial, key) =>
    call("POST", "/device/apply-persistent", {
      body: { profile, serial, key },
      timeoutMs: 240000,
    }),

  // --- медіа: залити фото/відео з ПК у галерею ---
  pushMedia: (source, serial, destDir) =>
    call("POST", "/media/push", {
      body: { source, serial, dest_dir: destDir },
      timeoutMs: 180000,
    }),

  // --- бінарне / дерево ---
  screenshot: (serial) => call("GET", "/screenshot", { query: { serial }, raw: "buffer" }),
  hierarchy: (serial) => call("GET", "/hierarchy", { query: { serial }, raw: "text" }),
};
