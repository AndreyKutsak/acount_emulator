import api from "./client";

// Керування Android-емулятором через бекенд (/api/android/* -> Python-міст).
// --- керування самим емулятором (через ManyFaces) ---
export const emulatorProfiles = () =>
  api.get("/android/emulator/profiles").then((r) => r.data);
export const emulatorStatus = () =>
  api.get("/android/emulator/status").then((r) => r.data);
export const emulatorStart = (profileId) =>
  api.post("/android/emulator/start", { profileId }).then((r) => r.data);
export const emulatorStop = (profileId) =>
  api.post("/android/emulator/stop", { profileId }).then((r) => r.data);

export const androidHealth = () => api.get("/android/health").then((r) => r.data);
export const androidInfo = () => api.get("/android/info").then((r) => r.data);
export const androidDevices = () => api.get("/android/devices").then((r) => r.data);

export const androidApps = (thirdParty = true) =>
  api.get("/android/apps", { params: { third_party: thirdParty } }).then((r) => r.data);
export const androidStartApp = (pkg) =>
  api.post("/android/app/start", { package: pkg }).then((r) => r.data);
export const androidStopApp = (pkg) =>
  api.post("/android/app/stop", { package: pkg }).then((r) => r.data);
export const androidInstall = (source) =>
  api.post("/android/app/install", { source }).then((r) => r.data);
// Залити фото/відео з ПК у галерею (source — локальний шлях на хості бекенда/моста).
export const androidPushMedia = (source) =>
  api.post("/android/media/push", { source }, { timeout: 200000 }).then((r) => r.data);

export const androidTap = (x, y) =>
  api.post("/android/tap", { x, y }).then((r) => r.data);
export const androidTapText = (text) =>
  api.post("/android/tap-text", { text }).then((r) => r.data);
export const androidType = (text, resourceId) =>
  api.post("/android/type", { text, resourceId }).then((r) => r.data);
export const androidPress = (key) =>
  api.post("/android/press", { key }).then((r) => r.data);
export const androidSwipe = (direction) =>
  api.post("/android/swipe", { direction }).then((r) => r.data);

// Поведінка: пост у Threads. publish=false — заповнити, але не публікувати.
export const androidThreadsPost = (text, publish) =>
  api.post("/android/threads/post", { text, publish }).then((r) => r.data);

// --- профіль маскування пристрою (Шар A/Б) ---
// key — ключ сховища (ManyFaces profileId) для per-профіль конфігу; serial — adb-ціль.
export const deviceDefaults = () =>
  api.get("/android/device/defaults").then((r) => r.data);
export const deviceProfile = (serial, key) =>
  api.get("/android/device/profile", { params: { serial, key } }).then((r) => r.data);
export const deviceProfileSave = (profile, serial, key) =>
  api.put("/android/device/profile", { profile, serial, key }).then((r) => r.data);
export const deviceCurrent = (serial) =>
  api.get("/android/device/current", { params: { serial } }).then((r) => r.data);
export const deviceApply = (profile, serial, key) =>
  api.post("/android/device/apply", { profile, serial, key }).then((r) => r.data);
// Повна (persistent) підміна ro.* через build.prop + ребут. Довгий запит.
export const deviceApplyPersistent = (profile, serial, key) =>
  api
    .post(
      "/android/device/apply-persistent",
      { profile, serial, key },
      { timeout: 260000 },
    )
    .then((r) => r.data);

// --- оркестрація життєвого циклу ---
export const orchestrateAccount = (body) =>
  api.post("/android/orchestrate/account", body, { timeout: 300000 }).then((r) => r.data);
export const orchestrateQueue = (body) =>
  api.post("/android/orchestrate/queue", body, { timeout: 600000 }).then((r) => r.data);

// URL скріншота (PNG) для <img>. ts — щоб обходити кеш.
export const androidScreenshotUrl = () => `/api/android/screenshot?ts=${Date.now()}`;
