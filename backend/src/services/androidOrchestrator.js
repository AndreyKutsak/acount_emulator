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
//   5) виконує дію (threadsPost); з opts.metricsAfterPost після підтвердженої
//      публікації ще й знімає «Статистику» в тому ж сеансі;
//   6) закриває застосунок;
//   7) за потреби гасить емулятор (stopAfter) — щоб звільнити ресурси й
//      послідовно підняти наступний акаунт з іншого профілю.
//
// runQueue([...]) робить це послідовно для списку акаунтів — один емулятор за раз.

const SocialAccount = require("../models/SocialAccount");
const emulator = require("./emulatorService");
const bridge = require("./androidBridgeService");
const { randomInt } = require("./humanize");
const threadsDm = require("./threadsDm");

const THREADS_PACKAGE = process.env.ANDROID_THREADS_PACKAGE || "com.instagram.barcelona";
const BOOT_TIMEOUT_MS = Number(process.env.ANDROID_BOOT_TIMEOUT_MS || 180000);
// Має покривати найгірший запуск ManyFaces: зависле відновлення зі знімка (до 120 с),
// примусове вбивство й видалення знімка, потім холодний старт (до 300 с) у тому ж
// запуску. Інакше ми здаємось раніше, ніж ManyFaces встигне відновити телефон.
const SERIAL_TIMEOUT_MS = Number(process.env.ANDROID_SERIAL_TIMEOUT_MS || 480000);
// Ексклюзивний режим (за замовчуванням увімкнено): одночасно працює лише один
// телефон. Перед стартом потрібного профілю всі інші запущені Android-профілі
// гасяться — два емулятори по 1.5 ГБ не вміщаються в пам'ять, і другий зависає
// на завантаженні. ANDROID_EXCLUSIVE=false — старий режим (кілька паралельно).
const EXCLUSIVE = !/^(0|false|no|off)$/i.test(process.env.ANDROID_EXCLUSIVE || "true");
const STOP_OTHERS_TIMEOUT_MS = Number(process.env.ANDROID_STOP_OTHERS_TIMEOUT_MS || 60000);

// Профілі-телефони, на яких зараз іде дія: дві дії на одному телефоні перезапускають
// Threads одна одній посеред публікації (ручна публікація + шедулер).
// Ключ — profileId емулятора або "phone:<serial>" фізичного телефону.
const busyProfiles = new Set();
const PHONE_PREFIX = "phone:";

// Чи прив'язаний акаунт до якогось телефону (фізичного чи емулятора).
const hasPhone = (account) => Boolean(account?.androidSerial || account?.androidProfileId);

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

async function findProfile(profileId) {
  const profiles = await emulator.listAndroidProfiles();
  const target = profiles.find((p) => p.id === profileId);
  if (!target) {
    throw Object.assign(new Error(`ManyFaces-профіль ${profileId} не знайдено`), { status: 404 });
  }
  return target;
}

// Серіал, який ManyFaces призначив саме цьому профілю, щойно він з'явиться в adb.
// Так кілька телефонів можуть працювати одночасно без вгадування.
async function waitForProfileSerial(profileId, timeoutMs = SERIAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const target = await findProfile(profileId);
    if (target.status === "error" || target.status === "stopped") {
      throw Object.assign(new Error(`емулятор профілю ${profileId} не стартував (${target.status})`), {
        status: 502,
      });
    }
    if (target.serial && (await serials()).includes(target.serial)) return target.serial;
    await sleep(3000);
  }
  throw Object.assign(new Error(`емулятор профілю ${profileId} не з'явився у adb за відведений час`), {
    status: 504,
  });
}

// Погасити всі запущені Android-профілі, крім `keepId`, і дочекатись, поки вони
// справді зупиняться. Викликається лише коли жоден інший телефон не зайнятий дією
// (див. перевірку busyProfiles у runForAccount), тож тут гасимо лише «забуті»
// емулятори — відкриті вручну з панелі чи після збою.
async function stopOtherProfiles(keepId, log) {
  const others = (await emulator.listAndroidProfiles()).filter(
    (p) => p.running && p.id !== keepId,
  );
  if (!others.length) return;

  for (const p of others) {
    try {
      await emulator.stopProfile(p.id);
      log.push({ step: "stopOther", ok: true, profileId: p.id, name: p.name });
    } catch (err) {
      log.push({ step: "stopOther", ok: false, profileId: p.id, name: p.name, error: err.message });
    }
  }

  const ids = new Set(others.map((p) => p.id));
  const deadline = Date.now() + STOP_OTHERS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const still = (await emulator.listAndroidProfiles()).filter((p) => p.running && ids.has(p.id));
    if (!still.length) return;
    await sleep(2000);
  }
  // Не валимо публікацію: емулятор міг зависнути на зупинці, але спробуємо далі.
  log.push({ step: "stopOther", ok: false, error: "не всі емулятори зупинились вчасно" });
}

// Переконатись, що профіль запущений, і повернути його серіал.
// Повертає { serial, started } — started=true, якщо ми його щойно підняли.
async function ensureProfileRunning(profileId) {
  const target = await findProfile(profileId);

  if (target.running) {
    if (target.serial) return { serial: await waitForProfileSerial(profileId), started: false };
    // Старіший ManyFaces без поля serial: однозначно лише за одного пристрою.
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
  if ((await findProfile(profileId)).serial !== undefined) {
    return { serial: await waitForProfileSerial(profileId), started: true };
  }
  return { serial: await waitForNewSerial(before), started: true };
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

// Чи знімати «Статистику» одразу після поста, поки телефон уже піднятий. Лише
// коли Threads підтвердив публікацію: threads_metrics перезапускає застосунок, а
// непідтверджений пост ще в черзі завантаження - перезапуск відклав би його.
function shouldCollectAfterPost(behavior, result, opts = {}) {
  return (
    opts.metricsAfterPost === true &&
    behavior?.type === "threadsPost" &&
    behavior.publish === true &&
    result?.confirmed === true
  );
}

// Best-effort: збій статистики не робить публікацію невдалою - інакше пост
// позначили б failed і могли б опублікувати вдруге.
async function collectMetricsAfterPost(serial, log) {
  await sleep(randomInt(3000, 8000)); // людина не відкриває статистику в ту ж секунду
  try {
    const r = await bridge.threadsMetrics(serial);
    const posts = r?.posts || [];
    log.push({ step: "threadsMetrics", ok: true, afterPost: true, posts: posts.length });
    return { ok: true, posts };
  } catch (err) {
    log.push({ step: "threadsMetrics", ok: false, afterPost: true, error: err.message });
    return { ok: false, error: err.message };
  }
}

// Залити фото поста в галерею телефону по одному. Пауза між файлами - щоб
// галерея (сортує за часом додавання, з точністю до секунди) показала їх саме
// в цьому порядку: потік вибирає останні N плиток. -> шляхи на пристрої.
async function pushPostMedia(files, serial, log) {
  const dests = [];
  for (const file of files || []) {
    const r = await bridge.pushMedia(file, serial);
    dests.push(r.dest);
    await sleep(1500);
  }
  if (dests.length) log.push({ step: "media", ok: true, count: dests.length });
  return dests;
}

// Головне: виконати поведінку для одного акаунта в межах його «телефону».
// behavior: { type: "threadsPost", text, publish, media? } (media - локальні файли фото)
// opts: { stopAfter=true, applySpoofFirst=true, closeApp=true, metricsAfterPost=false,
//         dmAfter=false }
// З metricsAfterPost результат має поле metrics: { ok, posts } | { ok: false, error };
// записати їх у пости - androidMetrics.applyAfterPost, коли пост уже збережено.
// З dmAfter після поста/«Статистики» ще й відповідаємо на особисті й коментарі
// (threadsDm, якщо їх увімкнено для акаунта); підсумки - у полях dm і comments.
async function runForAccount(accountOrId, behavior, opts = {}) {
  const { stopAfter = true, applySpoofFirst = true, closeApp = true } = opts;
  const account =
    typeof accountOrId === "string"
      ? await SocialAccount.findById(accountOrId)
      : accountOrId;
  if (!account) throw Object.assign(new Error("акаунт не знайдено"), { status: 404 });

  // Фізичний телефон (androidSerial) має пріоритет над емулятором ManyFaces.
  const physical = Boolean(account.androidSerial);
  const profileId = account.androidProfileId;
  if (!physical && !profileId) {
    throw Object.assign(
      new Error(
        `акаунт ${account.username} не прив'язаний до телефону (androidSerial або androidProfileId)`,
      ),
      { status: 400 },
    );
  }
  const busyKey = physical ? `${PHONE_PREFIX}${account.androidSerial}` : profileId;

  if (busyProfiles.has(busyKey)) {
    throw Object.assign(new Error(`телефон ${physical ? account.androidSerial : profileId} уже виконує іншу дію`), {
      status: 409,
      code: "PROFILE_BUSY",
    });
  }
  // В ексклюзивному режимі не чіпаємо емулятор, що саме публікує: поточну дію
  // відкладаємо (шедулер повторить на наступному тіку). Перевірка синхронна —
  // дві паралельні дії не можуть погасити одна одну. Фізичні телефони пам'ять
  // ПК не їдять і емуляторів не гасять, тож їх ексклюзивність не стосується.
  const busyEmulator = [...busyProfiles].find((k) => !k.startsWith(PHONE_PREFIX));
  if (!physical && EXCLUSIVE && busyEmulator) {
    throw Object.assign(new Error(`інший телефон (${busyEmulator}) зараз виконує дію — спробуйте пізніше`), {
      status: 409,
      code: "PROFILE_BUSY",
    });
  }
  busyProfiles.add(busyKey);

  const log = [];
  const started = Date.now();
  // Кожен крок одразу видно в logs/backend.log, а не лише в результаті виклику.
  log.push = (...entries) => {
    for (const e of entries) {
      console.log(
        `${new Date().toISOString()} [android] ${account.username} +${((Date.now() - started) / 1000).toFixed(1)}s`,
        JSON.stringify(e),
      );
    }
    return Array.prototype.push.apply(log, entries);
  };
  log.push({
    step: "start",
    ...(physical ? { phone: account.androidSerial } : { profileId }),
    behavior: behavior.type,
    publish: behavior.publish === true,
  });
  let serial;
  let weStarted = false;

  try {
    if (physical) {
      // Фізичний телефон: нічого не запускаємо й не маскуємо — лише перевіряємо,
      // що він підключений, авторизований і має Threads.
      serial = account.androidSerial;
      const chk = await bridge.deviceCheck(serial, THREADS_PACKAGE);
      if (!chk.ready) {
        throw Object.assign(new Error(`телефон ${serial}: ${chk.hint || chk.state}`), {
          status: chk.state === "device" ? 412 : 503,
        });
      }
      const app = (chk.apps || []).find((a) => a.package === THREADS_PACKAGE);
      log.push({
        step: "phone",
        ok: true,
        serial,
        model: [chk.manufacturer, chk.model].filter(Boolean).join(" "),
        android: chk.android_version,
        screen: chk.width && `${chk.width}x${chk.height}`,
        locked: chk.locked,
        threads: app?.version,
      });
    } else {
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

      if (EXCLUSIVE) await stopOtherProfiles(profileId, log);

      const r = await ensureProfileRunning(profileId);
      serial = r.serial;
      weStarted = r.started;
      log.push({ step: "emulator", ok: true, serial, started: weStarted });

      await waitBooted(serial);
      log.push({ step: "boot", ok: true, serial });

      if (applySpoofFirst) await applySpoof(profileId, serial, log);
    }

    // --- виконання поведінки ---
    let result;
    if (behavior.type === "threadsPost") {
      const media = await pushPostMedia(behavior.media, serial, log);
      result = await bridge.threadsPost(behavior.text, behavior.publish === true, serial, media);
      log.push({ step: "threadsPost", ok: true, publish: behavior.publish === true, result });
    } else if (behavior.type === "threadsMetrics") {
      result = await bridge.threadsMetrics(serial);
      log.push({ step: "threadsMetrics", ok: true, posts: (result?.posts || []).length });
    } else if (behavior.type === "threadsDm" || behavior.type === "threadsComments") {
      // Лише особисті чи коментарі (ручний запуск з панелі) - виконуються нижче.
    } else {
      throw Object.assign(new Error(`невідома поведінка: ${behavior.type}`), { status: 400 });
    }

    let metrics;
    if (shouldCollectAfterPost(behavior, result, opts)) {
      metrics = await collectMetricsAfterPost(serial, log);
    }
    let dm;
    if (threadsDm.shouldRunDm(behavior, result, opts)) {
      dm = await threadsDm.handleInbox(account, serial, log);
      if (behavior.type === "threadsDm") result = dm;
    }
    let comments;
    if (threadsDm.shouldRunComments(behavior, result, opts)) {
      comments = await threadsDm.handleComments(account, serial, log);
      if (behavior.type === "threadsComments") result = comments;
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

    log.push({ step: "done", ok: true });
    return { account: account.username, profileId, serial, ok: true, log, result, metrics, dm, comments,
             tookMs: Date.now() - started };
  } catch (err) {
    log.push({ step: "error", error: err.message, status: err.status });
    throw err;
  } finally {
    // --- зупинити емулятор (звільнити ресурси перед наступним акаунтом) ---
    if (stopAfter && serial && !physical) {
      try {
        await emulator.stopProfile(profileId);
        log.push({ step: "stopEmulator", ok: true, profileId });
      } catch (err) {
        log.push({ step: "stopEmulator", ok: false, error: err.message });
      }
    }
    busyProfiles.delete(busyKey);
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
  hasPhone,
  shouldCollectAfterPost,
  runForAccount,
  runQueue,
  ensureProfileRunning,
  waitBooted,
  THREADS_PACKAGE,
};
