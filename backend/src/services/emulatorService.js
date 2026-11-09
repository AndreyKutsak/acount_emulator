// Керування Android-емулятором через ManyFaces (:8000).
// ManyFaces піднімає/зупиняє профіль-пристрій (AVD). Бекенд проксує ці виклики,
// щоб емулятором можна було керувати з головного застосунку.
// Використовує вбудований fetch (Node 18+).

const MANYFACES_URL = process.env.MANYFACES_URL || "http://127.0.0.1:8000";
const TIMEOUT_MS = Number(process.env.MANYFACES_TIMEOUT_MS || 30000);

async function call(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(MANYFACES_URL + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    const e = new Error(`ManyFaces недоступний (${MANYFACES_URL}): ${err.message}`);
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
      /* non-JSON */
    }
    const e = new Error(`ManyFaces: ${detail}`);
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? {} : res.json();
}

// Стан Android-рушія (чи встановлено SDK/образ, чи є апаратне прискорення).
exports.engineStatus = () => call("GET", "/api/android/status");

// Лише Android-профілі (пристрої) з їх станом.
exports.listAndroidProfiles = async () => {
  const all = await call("GET", "/api/profiles");
  return (all || [])
    .filter((p) => p.engine === "android")
    .map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      running: p.running,
    }));
};

// Оновити поля ManyFaces-профілю (PATCH). Напр. android_gpu — режим GPU емулятора.
exports.updateProfile = (id, patch) => call("PATCH", `/api/profiles/${id}`, patch);

exports.startProfile = (id) => call("POST", `/api/profiles/${id}/start`);
exports.stopProfile = (id) => call("POST", `/api/profiles/${id}/stop`);
exports.profileStatus = (id) => call("GET", `/api/profiles/${id}/status`);

// Автостарт: підняти Android-профіль автоматично (ANDROID_AUTOSTART=true).
// Профіль за замовчуванням — ANDROID_PROFILE_ID, інакше перший у списку.
// Якщо якийсь Android-профіль уже запущений — нічого не робимо.
exports.autostart = async () => {
  const profiles = await exports.listAndroidProfiles();
  if (!profiles.length) return { skipped: "no android profiles" };

  const alreadyRunning = profiles.find((p) => p.running);
  if (alreadyRunning) {
    return { skipped: "already running", id: alreadyRunning.id, name: alreadyRunning.name };
  }

  const wantId = process.env.ANDROID_PROFILE_ID;
  const target = (wantId && profiles.find((p) => p.id === wantId)) || profiles[0];
  await exports.startProfile(target.id);
  return { started: target.id, name: target.name };
};

module.exports.MANYFACES_URL = MANYFACES_URL;
