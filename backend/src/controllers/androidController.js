// HTTP-контролер для керування Android-емулятором через міст uiautomator2.
// Маршрути монтуються в app.js під /api/android.
const bridge = require("../services/androidBridgeService");
const emulator = require("../services/emulatorService");
const orchestrator = require("../services/androidOrchestrator");

// Хелпер: обгортає виклик мосту, прокидає його статус-код у відповідь.
function handle(fn) {
  return async (req, res, next) => {
    try {
      const data = await fn(req, res);
      if (data !== undefined) res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  };
}

// --- керування самим емулятором (через ManyFaces) ---
exports.emulatorProfiles = handle(() => emulator.listAndroidProfiles());
exports.emulatorStatus = handle(() => emulator.engineStatus());
exports.emulatorStart = handle((req) => {
  const { profileId } = req.body;
  if (!profileId) throw Object.assign(new Error("body.profileId обов'язковий"), { status: 400 });
  return emulator.startProfile(profileId);
});
exports.emulatorStop = handle((req) => {
  const { profileId } = req.body;
  if (!profileId) throw Object.assign(new Error("body.profileId обов'язковий"), { status: 400 });
  return emulator.stopProfile(profileId);
});

exports.health = handle(() => bridge.health());
exports.devices = handle(() => bridge.devices());
exports.info = handle((req) => bridge.info(req.query.serial));

exports.installApp = handle((req) => {
  const { source, serial } = req.body;
  if (!source) throw Object.assign(new Error("body.source (шлях/URL APK) обов'язковий"), { status: 400 });
  return bridge.installApp(source, serial);
});

exports.startApp = handle((req) => {
  const { package: pkg, serial } = req.body;
  if (!pkg) throw Object.assign(new Error("body.package обов'язковий"), { status: 400 });
  return bridge.startApp(pkg, serial);
});

exports.stopApp = handle((req) => {
  const { package: pkg, serial } = req.body;
  if (!pkg) throw Object.assign(new Error("body.package обов'язковий"), { status: 400 });
  return bridge.stopApp(pkg, serial);
});

exports.currentApp = handle((req) => bridge.currentApp(req.query.serial));
exports.listApps = handle((req) =>
  bridge.listApps(req.query.third_party !== "false", req.query.serial),
);

exports.tapText = handle((req) => {
  const { text, serial, timeout } = req.body;
  if (!text) throw Object.assign(new Error("body.text обов'язковий"), { status: 400 });
  return bridge.tapText(text, serial, timeout);
});

exports.tap = handle((req) => {
  const { x, y, serial } = req.body;
  if (x == null || y == null) throw Object.assign(new Error("body.x та body.y обов'язкові"), { status: 400 });
  return bridge.tap(x, y, serial);
});

exports.type = handle((req) => {
  const { text, resourceId, serial, clear } = req.body;
  if (text == null) throw Object.assign(new Error("body.text обов'язковий"), { status: 400 });
  return bridge.type(text, resourceId, serial, clear);
});

// Поведінка: пост у Threads. publish:false — заповнити, але не публікувати.
exports.threadsPost = handle((req) => {
  const { text, publish = true, serial } = req.body;
  if (!text) throw Object.assign(new Error("body.text обов'язковий"), { status: 400 });
  return bridge.threadsPost(text, publish, serial);
});

// --- профіль маскування пристрою (Шар A/Б) ---
exports.deviceDefaults = handle(() => bridge.deviceDefaults());
exports.deviceProfile = handle((req) =>
  bridge.deviceProfile(req.query.serial, req.query.key),
);
exports.deviceProfileSave = handle((req) => {
  const { profile, serial, key } = req.body;
  if (!profile || typeof profile !== "object")
    throw Object.assign(new Error("body.profile обов'язковий"), { status: 400 });
  return bridge.deviceProfileSave(profile, serial, key);
});
exports.deviceCurrent = handle((req) => bridge.deviceCurrent(req.query.serial));
exports.deviceApply = handle(async (req) => {
  const { profile, serial, key } = req.body;
  const result = await bridge.deviceApply(profile, serial, key);
  // Прокинути режим GPU у ManyFaces-профіль, щоб він реально застосувався при
  // наступному старті емулятора (-gpu). Лише коли є key=profileId і gpu_mode.
  if (key && profile && profile.gpu_mode) {
    try {
      await emulator.updateProfile(key, { android_gpu: profile.gpu_mode });
      result.gpu_saved_to_profile = profile.gpu_mode;
    } catch (err) {
      result.gpu_save_error = err.message;
    }
  }
  return result;
});
// Повна (persistent) підміна ro.* через build.prop + ребут. Довга операція.
exports.deviceApplyPersistent = handle((req) =>
  bridge.deviceApplyPersistent(req.body.profile, req.body.serial, req.body.key),
);

// --- оркестрація життєвого циклу (per-акаунт / черга) ---
// Піднімає профіль-телефон акаунта → спуф → пост → закрити застосунок → (stopAfter) згасити.
exports.orchestrateAccount = handle((req) => {
  const { accountId, text, publish = false, stopAfter = true } = req.body;
  if (!accountId) throw Object.assign(new Error("body.accountId обов'язковий"), { status: 400 });
  if (!text) throw Object.assign(new Error("body.text обов'язковий"), { status: 400 });
  return orchestrator.runForAccount(
    accountId,
    { type: "threadsPost", text, publish: publish === true },
    { stopAfter: stopAfter !== false },
  );
});

// Послідовна черга акаунтів: по одному емулятору за раз.
exports.orchestrateQueue = handle((req) => {
  const { items, gapMs } = req.body;
  if (!Array.isArray(items) || !items.length)
    throw Object.assign(new Error("body.items[] обов'язковий"), { status: 400 });
  return orchestrator.runQueue(items, { gapMs: Number(gapMs) || 0 });
});

// Залити фото/відео з ПК у галерею пристрою (source — локальний шлях на хості).
exports.mediaPush = handle((req) => {
  const { source, serial, destDir } = req.body;
  if (!source) throw Object.assign(new Error("body.source (шлях до файлу) обов'язковий"), { status: 400 });
  return bridge.pushMedia(source, serial, destDir);
});

exports.press = handle((req) => bridge.press(req.body.key, req.body.serial));
exports.swipe = handle((req) => bridge.swipe(req.body.direction, req.body.serial));

// Віддає PNG поточного екрана прямо у відповідь.
exports.screenshot = handle(async (req, res) => {
  const png = await bridge.screenshot(req.query.serial);
  res.set("Content-Type", "image/png");
  res.send(png);
});

exports.hierarchy = handle(async (req, res) => {
  const xml = await bridge.hierarchy(req.query.serial);
  res.set("Content-Type", "application/xml");
  res.send(xml);
});
