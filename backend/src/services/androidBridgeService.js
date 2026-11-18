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
  // Усі adb-пристрої (і unauthorized/offline) з моделлю, екраном, блокуванням і
  // наявністю потрібних застосунків.
  devicesDetailed: (pkg) =>
    call("GET", "/devices", { query: { details: true, package: pkg }, timeoutMs: 30000 }),
  // Один пристрій: { ready, state, hint, apps: [{package, installed, version}] }
  deviceCheck: (serial, pkg) =>
    call("GET", "/device/check", { query: { serial, package: pkg }, timeoutMs: 30000 }),
  info: (serial) => call("GET", "/info", { query: { serial } }),

  // --- застосунки ---
  // Встановлення великого APK/XAPK (Threads ~100+ МБ) на телефон триває хвилини.
  installApp: (source, serial) =>
    call("POST", "/app/install", { body: { source, serial }, timeoutMs: 600000 }),
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
  // Довгий виклик: після холодного старту потік спершу чекає звільнення черги
  // broadcast-ів Android (до 8 хв), а вже потім вводить текст.
  // media - шляхи фото на пристрої, уже залитих у галерею (pushMedia), у порядку поста.
  threadsPost: (text, publish = true, serial, media = []) =>
    call("POST", "/behavior/threads-post", {
      body: { text, publish, serial, media },
      timeoutMs: 900000,
    }),

  // Метрики останніх дописів зі «Статистики» Threads (нічого не публікує).
  // -> { posts: [{ text, views, likes, replies, reposts, shares }] }
  threadsMetrics: (serial) =>
    call("POST", "/behavior/threads-metrics", {
      body: { serial },
      timeoutMs: 300000,
    }),

  // Непрочитані особисті зі списків «Вхідні»/«Запити». Чат відкривається лише
  // коли замість тексту «N нові повідомлення»; known - підписи вже оброблених рядків.
  // -> { chats: [{ folder, username, title, preview, signature, messages, text }] }
  threadsDmScan: (serial, folders = ["inbox", "requests"], known = []) =>
    call("POST", "/behavior/threads-dm-scan", {
      body: { serial, folders, known },
      timeoutMs: 300000,
    }),

  // Відкрити кожен чат і надіслати тексти. items: [{ username, folder, texts }]
  // -> { results: [{ username, ok, error? }] } у тому ж порядку.
  // Коментарі під нашими постами з «Дії → Розмови».
  // -> { comments: [{ author, text, context, age_minutes, reply_count }] }
  threadsCommentsScan: (serial, maxRows = 30) =>
    call("POST", "/behavior/threads-comments-scan", {
      body: { serial, max_rows: maxRows },
      timeoutMs: 180000,
    }),

  // Відповісти на коментарі: items [{ author, text, context, reply }]
  // -> { results: [{ author, ok, error? }] } у тому ж порядку.
  threadsCommentsReply: (serial, items) =>
    call("POST", "/behavior/threads-comments-reply", {
      body: { serial, items },
      timeoutMs: 900000,
    }),

  threadsDmSend: (serial, items) =>
    call("POST", "/behavior/threads-dm-send", {
      body: { serial, items },
      timeoutMs: 600000,
    }),

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
