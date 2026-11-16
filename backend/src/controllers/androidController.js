// HTTP-контролер для керування Android-емулятором через міст uiautomator2.
// Маршрути монтуються в app.js під /api/android.
const bridge = require("../services/androidBridgeService");
const emulator = require("../services/emulatorService");
const orchestrator = require("../services/androidOrchestrator");
const androidMetrics = require("../services/androidMetrics");
const SocialAccount = require("../models/SocialAccount");
const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

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

// --- підключені adb-пристрої (фізичні телефони й емулятори) ---
// Усі пристрої з деталями (модель, екран, блокування, чи встановлено Threads)
// + які акаунти до кожного прив'язані.
exports.phones = handle(async () => {
  const [d, accounts] = await Promise.all([
    bridge.devicesDetailed(),
    SocialAccount.find(
      { androidSerial: { $nin: [null, ""] } },
      "username displayName platform androidSerial",
    ),
  ]);
  const bySerial = {};
  for (const a of accounts) {
    (bySerial[a.androidSerial] ||= []).push({
      _id: a._id,
      username: a.username,
      displayName: a.displayName,
      platform: a.platform,
    });
  }
  const devices = (d.devices || []).map((x) => ({ ...x, accounts: bySerial[x.serial] || [] }));
  // Прив'язані телефони, яких зараз немає в adb, — щоб було видно, що вони відпали.
  const present = new Set(devices.map((x) => x.serial));
  for (const [serial, accs] of Object.entries(bySerial)) {
    if (!present.has(serial)) {
      devices.push({
        serial,
        state: "absent",
        ready: false,
        hint: "не підключений — під'єднайте кабель (або adb connect ip:port)",
        accounts: accs,
      });
    }
  }
  return { devices, required: d.required || [] };
});

exports.phoneCheck = handle((req) => {
  const { serial, package: pkg } = req.query;
  if (!serial) throw Object.assign(new Error("query.serial обов'язковий"), { status: 400 });
  return bridge.deviceCheck(serial, pkg);
});

// Прив'язати акаунт до фізичного телефону (serial="" — відв'язати).
exports.phoneBind = handle(async (req) => {
  const { accountId, serial = "" } = req.body;
  if (!accountId) throw Object.assign(new Error("body.accountId обов'язковий"), { status: 400 });
  const account = await SocialAccount.findById(accountId);
  if (!account) throw Object.assign(new Error("акаунт не знайдено"), { status: 404 });
  if (serial) {
    const chk = await bridge.deviceCheck(serial);
    if (chk.state === "absent") {
      throw Object.assign(new Error(`пристрою ${serial} немає в adb`), { status: 404 });
    }
    if (chk.emulator) {
      throw Object.assign(
        new Error("це емулятор — прив'язуйте його через Android-профіль ManyFaces, а не як фізичний телефон"),
        { status: 400 },
      );
    }
  }
  account.androidSerial = String(serial).trim();
  await account.save();
  return { _id: account._id, username: account.username, androidSerial: account.androidSerial };
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

// Підняти телефон акаунта, зчитати «Статистику» Threads і записати перегляди/
// лайки/відповіді у відповідні пости. stopAfter=false лишає емулятор увімкненим.
exports.threadsMetrics = handle(async (req) => {
  const { accountId, stopAfter = true } = req.body;
  if (!accountId) throw Object.assign(new Error("body.accountId обов'язковий"), { status: 400 });
  const account = await SocialAccount.findById(accountId);
  if (!account) throw Object.assign(new Error("акаунт не знайдено"), { status: 404 });
  return androidMetrics.collectForAccount(account, { stopAfter: stopAfter !== false });
});

// Послідовна черга акаунтів: по одному емулятору за раз.
exports.orchestrateQueue = handle((req) => {
  const { items, gapMs } = req.body;
  if (!Array.isArray(items) || !items.length)
    throw Object.assign(new Error("body.items[] обов'язковий"), { status: 400 });
  return orchestrator.runQueue(items, { gapMs: Number(gapMs) || 0 });
});

// --- завантаження файлів із браузера (провідник Windows) ---
// Браузер шле сирий файл (application/octet-stream, ім'я в ?name=). Пишемо його
// потоком на диск — без буферизації в пам'яті, тож і 200-МБ APK не проблема, —
// передаємо мосту (він на цій самій машині) і видаляємо тимчасову копію.
const UPLOAD_DIR = path.join(__dirname, "../../storage/android-uploads");
const APK_EXT = [".apk", ".xapk", ".apks", ".apkm"];
const MEDIA_EXT = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".bmp",
  ".mp4", ".mov", ".m4v", ".3gp", ".mkv", ".webm", ".avi",
];

async function receiveUpload(req, allowed) {
  const name = path.basename(String(req.query.name || "").trim());
  const ext = path.extname(name).toLowerCase();
  if (!allowed.includes(ext)) {
    throw Object.assign(new Error(`непідтримуваний тип файлу «${ext || name}» (дозволено: ${allowed.join(", ")})`), {
      status: 400,
    });
  }
  // Ім'я на телефоні — латиницею без пробілів: кирилиця й пробіли ламають
  // shell-команди медіасканера. Окрема тека на кожен файл — без колізій.
  const base = path.basename(name, ext).replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const dir = path.join(UPLOAD_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const file = path.join(dir, `${/[A-Za-z0-9]/.test(base) ? base : `file_${Date.now()}`}${ext}`);
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    await pipeline(req, fs.createWriteStream(file));
    const { size } = await fs.promises.stat(file);
    if (!size) throw Object.assign(new Error("порожній файл"), { status: 400 });
    return { dir, file, name, size };
  } catch (err) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw err;
  }
}

// POST /android/upload/apk?name=app.apk&serial=… (тіло — файл) -> встановити.
exports.uploadApk = handle(async (req) => {
  const up = await receiveUpload(req, APK_EXT);
  try {
    await bridge.installApp(up.file, req.query.serial || undefined);
    return { installed: true, name: up.name, size: up.size };
  } finally {
    await fs.promises.rm(up.dir, { recursive: true, force: true });
  }
});

// POST /android/upload/media?name=photo.jpg&serial=… (тіло — файл) -> у галерею
// телефону (DCIM/Camera + медіаскан), звідки його бачать галерея й Threads.
exports.uploadMedia = handle(async (req) => {
  const up = await receiveUpload(req, MEDIA_EXT);
  try {
    const r = await bridge.pushMedia(up.file, req.query.serial || undefined);
    return { ...r, name: up.name, size: up.size };
  } finally {
    await fs.promises.rm(up.dir, { recursive: true, force: true });
  }
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
