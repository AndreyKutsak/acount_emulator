// Оркестратор життєвого циклу Android-акаунтів.
//
// Ідея: кожен акаунт має власний ManyFaces Android-профіль (окремий «телефон»,
// поле SocialAccount.androidProfileId). Для виконання дії (напр. пост у Threads)
// оркестратор:
//   1) піднімає саме цей профіль-емулятор (якщо ще не запущений);
//   2) резолвить його adb-серіал (diff списку пристроїв до/після старту —
//      коректно навіть за кількох емуляторів одночасно);
//   3) чекає завершення завантаження;
//   4) застосовує профіль маскування цього акаунта (device_profiles.json,
//      ключ = androidProfileId);
//   5) виконує дію (threadsPost);
//   6) закриває застосунок;
//   7) за потреби гасить емулятор (stopAfter) — щоб звільнити ресурси й
//      послідовно підняти наступний акаунт з іншого профілю.
//
// runQueue([...]) робить це послідовно для списку акаунтів — один емулятор за раз.

const SocialAccount = require("../models/SocialAccount");
const emulator = require("./emulatorService");
const bridge = require("./androidBridgeService");

const THREADS_PACKAGE = process.env.ANDROID_THREADS_PACKAGE || "com.instagram.barcelona";
const BOOT_TIMEOUT_MS = Number(process.env.ANDROID_BOOT_TIMEOUT_MS || 180000);
const SERIAL_TIMEOUT_MS = Number(process.env.ANDROID_SERIAL_TIMEOUT_MS || 120000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Список adb-серіалів, які зараз бачить міст.
async function serials() {
  try {
    const d = await bridge.devices();
    return (d.devices || []).map((x) => x.serial);
  } catch {
    return [];
  }
}

// Дочекатись появи НОВОГО серіала (якого не було у `before`).
async function waitForNewSerial(before, timeoutMs = SERIAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const had = new Set(before);
  while (Date.now() < deadline) {
    const now = await serials();
    const fresh = now.find((s) => !had.has(s));
    if (fresh) return fresh;
    await sleep(3000);
  }
  throw Object.assign(new Error("новий емулятор не з'явився у adb за відведений час"), {
    status: 504,
  });
}

// Дочекатись завершення завантаження (info відповідає — отже boot завершено).
async function waitBooted(serial, timeoutMs = BOOT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const info = await bridge.info(serial);
      if (info && (info.sdk || info.model)) return info;
    } catch (err) {
      lastErr = err;
    }
    await sleep(4000);
  }
  throw Object.assign(
    new Error(`емулятор ${serial} не завантажився за відведений час${lastErr ? `: ${lastErr.message}` : ""}`),
    { status: 504 },
  );
}

// Переконатись, що профіль запущений, і повернути його серіал.
// Повертає { serial, started } — started=true, якщо ми його щойно підняли.
async function ensureProfileRunning(profileId) {
  const profiles = await emulator.listAndroidProfiles();
  const target = profiles.find((p) => p.id === profileId);
  if (!target) {
    throw Object.assign(new Error(`ManyFaces-профіль ${profileId} не знайдено`), { status: 404 });
  }

  if (target.running) {
    // Уже запущений: якщо пристрій рівно один — беремо його; інакше потрібен
    // явний ANDROID_SERIAL (неоднозначність за кількох запущених профілів).
    const now = await serials();
    if (now.length === 1) return { serial: now[0], started: false };
    const envSerial = process.env.ANDROID_SERIAL;
    if (envSerial && now.includes(envSerial)) return { serial: envSerial, started: false };
    throw Object.assign(
      new Error(
        `профіль ${profileId} уже запущений, але серіал неоднозначний (пристроїв: ${now.length}). ` +
          "Задайте ANDROID_SERIAL або гасіть зайві емулятори.",
      ),
      { status: 409 },
    );
  }

  const before = await serials();
  await emulator.startProfile(profileId);
  const serial = await waitForNewSerial(before);
  return { serial, started: true };
}

// Застосувати профіль маскування цього акаунта (best-effort — не валимо весь
// запуск, якщо частина полів read-only).
async function applySpoof(profileId, serial, log) {
  try {
    const r = await bridge.deviceApply(null, serial, profileId); // key=profileId
    log.push({ step: "spoof", ok: true, applied: r.applied_count, total: r.total, root: r.root });
    return r;
  } catch (err) {
    log.push({ step: "spoof", ok: false, error: err.message });
    return null;
  }
}

// Головне: виконати поведінку для одного акаунта в межах його «телефону».
// behavior: { type: "threadsPost", text, publish }
// opts: { stopAfter=true, applySpoofFirst=true, closeApp=true }
async function runForAccount(accountOrId, behavior, opts = {}) {
  const { stopAfter = true, applySpoofFirst = true, closeApp = true } = opts;
  const account =
    typeof accountOrId === "string"
      ? await SocialAccount.findById(accountOrId)
      : accountOrId;
  if (!account) throw Object.assign(new Error("акаунт не знайдено"), { status: 404 });

  const profileId = account.androidProfileId;
  if (!profileId) {
    throw Object.assign(
      new Error(`акаунт ${account.username} не має androidProfileId (прив'яжіть профіль-телефон)`),
      { status: 400 },
    );
  }

  const log = [];
  const started = Date.now();
  let serial;
  let weStarted = false;

  try {
    // Фіксований VPN/проксі «телефону»: прокинути проксі акаунта в його ManyFaces-
    // профіль ПЕРЕД стартом — емулятор застосує його при запуску (-http-proxy).
    // Увага: cmdline-емулятор бере лише HTTP-проксі без автентифікації; для
    // авторизованих/SOCKS потрібен локальний релей або VPN-застосунок усередині.
    const pc = account.proxyConfig;
    if (pc && pc.host && pc.port) {
      try {
        await emulator.updateProfile(profileId, {
          proxy: {
            type: pc.type || "http",
            host: pc.host,
            port: Number(pc.port) || 0,
            username: pc.username || "",
            password: pc.password || "",
          },
        });
        log.push({ step: "proxy", ok: true, host: `${pc.host}:${pc.port}` });
      } catch (err) {
        log.push({ step: "proxy", ok: false, error: err.message });
      }
    }

    const r = await ensureProfileRunning(profileId);
    serial = r.serial;
    weStarted = r.started;
    log.push({ step: "emulator", ok: true, serial, started: weStarted });

    await waitBooted(serial);
    log.push({ step: "boot", ok: true, serial });

    if (applySpoofFirst) await applySpoof(profileId, serial, log);

    // --- виконання поведінки ---
    let result;
    if (behavior.type === "threadsPost") {
      result = await bridge.threadsPost(behavior.text, behavior.publish === true, serial);
      log.push({ step: "threadsPost", ok: true, publish: behavior.publish === true, result });
    } else {
      throw Object.assign(new Error(`невідома поведінка: ${behavior.type}`), { status: 400 });
    }

    // --- закрити застосунок ---
    if (closeApp) {
      try {
        await bridge.stopApp(THREADS_PACKAGE, serial);
        log.push({ step: "closeApp", ok: true, package: THREADS_PACKAGE });
      } catch (err) {
        log.push({ step: "closeApp", ok: false, error: err.message });
      }
    }

    return { account: account.username, profileId, serial, ok: true, log, result,
             tookMs: Date.now() - started };
  } finally {
    // --- зупинити емулятор (звільнити ресурси перед наступним акаунтом) ---
    if (stopAfter && serial) {
      try {
        await emulator.stopProfile(profileId);
        log.push({ step: "stopEmulator", ok: true, profileId });
      } catch (err) {
        log.push({ step: "stopEmulator", ok: false, error: err.message });
      }
    }
  }
}

// Послідовна черга: по одному емулятору за раз (кожен gasиться перед наступним).
// items: [{ accountId, text, publish }]
async function runQueue(items, opts = {}) {
  const results = [];
  for (const it of items || []) {
    try {
      const r = await runForAccount(
        it.accountId,
        { type: "threadsPost", text: it.text, publish: it.publish === true },
        { stopAfter: true, ...opts },
      );
      results.push(r);
    } catch (err) {
      results.push({ accountId: it.accountId, ok: false, error: err.message });
    }
    if (opts.gapMs) await sleep(opts.gapMs);
  }
  return { count: results.length, results };
}

module.exports = {
  runForAccount,
  runQueue,
  ensureProfileRunning,
  waitBooted,
  THREADS_PACKAGE,
};
