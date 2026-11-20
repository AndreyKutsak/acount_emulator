// Шаблон вакансії для Threads: короткі рядки, кожен про одне.
// Коли шаблон обов'язковий (THREADS_JOB_TEMPLATE != "off"), Threads-пост, що не
// відповідає структурі, не зберігається, а отже й не публікується.
//
//   1. Посада (перший рядок)          Пакувальник подарункових наборів 🎁
//   2. Формат, без міста              🏠 Віддалено  /  🏢 Офіс  /  Гібрид
//   3. Графік                         📅 Графік вільний
//   4. Опис, 0-3 рядки                Коробки, стрічки й наповнення - надаються
//   5. Питання до читача              💬 Хто хоче спробувати?
//   6. Як відгукнутися                👉 Деталі та зв'язок з менеджером - за посиланням у шапці профілю
//   7. Один тег, без міста            #Робота
//
// Зарплата й назва міста в пості не потрібні: усе це - за посиланням у шапці профілю.
// Якщо вони таки є, перевірка лише попереджає. Валюта й Telegram/інші месенджери
// заборонені загальними правилами (threadsPostRules: currency, messenger).

const { forbiddenWordsReason } = require("./threadsPostRules");

const TEMPLATE = `Пакувальник подарункових наборів 🎁
🏠 Віддалено
📅 Графік вільний
Коробки, стрічки й наповнення - надаються
💬 Хто хоче спробувати?
👉 Деталі та зв'язок з менеджером - за посиланням у шапці профілю
#Робота`;

// Короткий шаблон «набір»: гачок + 1-3 рядки суті + куди йти. Без зарплати й графіка,
// тег необов'язковий. Приклад - пост, що «залетів»:
//   Шукаємо майбутніх SMM-спеціалістів 💙
//   Без досвіду або з мінімальним.
//   Навчимо та працевлаштуємо до нашої агенції.
//   Уся інформація в шапці.
const SHORT_TEMPLATE = `Шукаємо майбутніх SMM-спеціалістів 💙
Без досвіду або з мінімальним.
Навчимо та працевлаштуємо до нашої агенції.
Уся інформація в шапці.`;

const SHORT_MIN_LINES = 3;
const SHORT_MAX_LINES = 5;
const SHORT_HOOK_RE = /(?<![\p{L}])(?:шукає\p{L}*|запрошує\p{L}*|потрібн\p{L}*|набира\p{L}*|набір|відкрит\p{L}*\s+вакансі\p{L}*|вакансі\p{L}*)/iu;
const SHORT_CTA_RE = /(?<![\p{L}])(?:шапц\p{L}*|профіл\p{L}*|посилан\p{L}*|телефон\p{L}*|дзвон\p{L}*)|\+?380\d{9}/iu;

// Повертає список помилок короткого шаблону (порожній - пост йому відповідає).
function checkShortTemplate(rawText) {
  const lines = String(rawText || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const body = lines.length && /^#[\p{L}\d_]+$/u.test(lines[lines.length - 1]) ? lines.slice(0, -1) : lines;
  const bad = [];
  if (body.length < SHORT_MIN_LINES || body.length > SHORT_MAX_LINES) bad.push("short_lines");
  if (lines.some((l) => [...l].length > MAX_LINE)) bad.push("short_long_line");
  const hook = body[0] || "";
  const hookLen = [...hook].length;
  if (hookLen < TITLE_MIN || hookLen > TITLE_MAX || !SHORT_HOOK_RE.test(hook)) bad.push("short_hook");
  if (!SHORT_CTA_RE.test(body[body.length - 1] || "")) bad.push("short_cta");
  return bad;
}

const MODE = String(process.env.THREADS_JOB_TEMPLATE || "required").toLowerCase();
const REQUIRED = MODE !== "off";

const MAX_LINE = 100;
const TITLE_MIN = 5;
const TITLE_MAX = 80;
const MIN_LINES = 6;
const MAX_LINES = 12;

const W_START = "(?<![\\p{L}\\d])";
const words = (p) => new RegExp(`${W_START}(?:${p})`, "iu");

const PLACE_RE = /[🏠🏢📍]|(?<![\p{L}])(?:вдома|віддален\p{L}*|дистанційн\p{L}*|удален\p{L}*|офіс\p{L}*|гібрид\p{L}*|вінниц\p{L}*|київ\p{L}*|львів\p{L}*|м\.\s*\p{L}+|адрес\p{L}*|склад\p{L}*|магазин\p{L}*)/iu;
// Зарплата цифрою: з «тис.» або з періодом («на місяць», «за зміну»). Валюта заборонена.
const SALARY_RE = /\d[\d\s.,]*\s*(?:тис\.?|к)(?![\p{L}])|\d[\d\s.,]*\s*(?:\/|на|за|в)\s*(?:місяць|міс\.?|день|добу|годину|год\.?|зміну|тиждень)/iu;
// Чесне «з/п за результатами співбесіди» краще за вигадану цифру: дозволено, з порадою.
const CITY_RE = /(?<![\p{L}])(?:вінниц|київ|києв|львів|харків|одес|дніпр|запоріж|полтав|чернівц|тернопіл|житомир|хмельницьк|черкас|чернігів|миколаїв|херсон|ужгород)\p{L}*/iu;
const SALARY_TBD_RE = /(?<![\p{L}])(?:з\/п|зп|зарплат\p{L}*|оплат\p{L}*)(?![\p{L}]).*(?:співбесід\p{L}*|договірн\p{L}*|домовлен\p{L}*)/iu;
const SCHEDULE_RE = /[📅🕘🕗⏰]|\d{1,2}[:.]\d{2}|\b\d\/\d\b|(?<![\p{L}])(?:графік\p{L}*|змін\p{L}*|годин\p{L}*|вихідн\p{L}*|гнучк\p{L}*|вільн\p{L}*\s+графік|повн\p{L}*\s+(?:день|зайнят\p{L}*)|часткова\s+зайнят\p{L}*)/iu;
const CTA_RE = words("шапц\\p{L}*\\s+профіл\\p{L}*|описі\\s+профіл\\p{L}*|телефон\\p{L}*|дзвон\\p{L}*|\\+?380\\d{9}");
const PHONE_RE = /\+?380\d{9}|(?<!\d)0\d{9}(?!\d)/;
const HOME_RE = words("вдома|віддален\\p{L}*|дистанційн\\p{L}*|удален\\p{L}*");
const TAG_LINE_RE = /^#[\p{L}\d_]+$/u;

function err(code, message) {
  return { severity: "error", code, message };
}

// Повертає { errors, warnings } щодо відповідності шаблону.
function checkJobTemplate(rawText) {
  const errors = [];
  const warnings = [];
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { errors, warnings };

  // Короткий шаблон «набір» - рівноправна альтернатива повному.
  if (!checkShortTemplate(rawText).length) return { errors, warnings };

  const hint = "Скористайтеся кнопкою «Вставити шаблон» (повний або короткий).";

  if (lines.length < MIN_LINES || lines.length > MAX_LINES) {
    errors.push(err("tpl_lines", `Шаблон: ${lines.length} рядків, потрібно ${MIN_LINES}-${MAX_LINES} коротких рядків (посада, формат, графік, питання, як відгукнутися, тег). ${hint}`));
  }

  const long = lines.filter((l) => [...l].length > MAX_LINE).length;
  if (long) {
    errors.push(err("tpl_long_line", `Шаблон: ${long} рядк(ів) довші за ${MAX_LINE} символів. Один рядок - одна думка.`));
  }

  // Останній рядок - один тег.
  const last = lines[lines.length - 1];
  if (!TAG_LINE_RE.test(last)) {
    errors.push(err("tpl_tag", "Шаблон: останній рядок має бути одним тегом, наприклад #Робота."));
  }
  const body = TAG_LINE_RE.test(last) ? lines.slice(0, -1) : lines;

  // 1. Посада.
  const title = body[0] || "";
  const titleLen = [...title].length;
  if (titleLen < TITLE_MIN || titleLen > TITLE_MAX || SALARY_RE.test(title) || title.endsWith("?")) {
    errors.push(err("tpl_title", `Шаблон: перший рядок - лише назва посади (${TITLE_MIN}-${TITLE_MAX} символів, без зарплати, міста й питання).`));
  }

  const find = (re, from = 1) => {
    for (let i = from; i < body.length; i += 1) if (re.test(body[i])) return i;
    return -1;
  };
  const place = find(PLACE_RE);
  const salary = Math.max(find(SALARY_RE), find(SALARY_TBD_RE));
  if (salary >= 0) {
    warnings.push({
      severity: "warning",
      code: "tpl_salary_given",
      message: "Зарплату в пості не вказуємо: вона - за посиланням у шапці профілю. Приберіть рядок із сумою.",
    });
  }
  if (CITY_RE.test(body.join("\n")) || CITY_RE.test(last)) {
    warnings.push({
      severity: "warning",
      code: "tpl_city_given",
      message: "Місто в пості не вказуємо: лише формат (офіс, віддалено, гібрид), без назви міста, в тому числі в тезі.",
    });
  }
  const schedule = find(SCHEDULE_RE);
  const question = (() => {
    for (let i = body.length - 1; i >= 1; i -= 1) if (body[i].endsWith("?")) return i;
    return -1;
  })();
  const cta = (() => {
    for (let i = body.length - 1; i >= 1; i -= 1) if (CTA_RE.test(body[i])) return i;
    return -1;
  })();

  if (place < 0) errors.push(err("tpl_place", "Шаблон: немає рядка з місцем чи форматом роботи (🏠 Віддалено / 🏢 Офіс / Гібрид, без назви міста)."));
  if (schedule < 0) errors.push(err("tpl_schedule", "Шаблон: немає рядка з графіком (📅 5/2, 9:00-18:00 або «Графік вільний»)."));
  if (question < 0) errors.push(err("tpl_question", "Шаблон: немає питання до читача, рядок із «?» (💬 Хто хоче спробувати?)."));
  if (cta < 0 || cta < body.length - 2) {
    errors.push(err("tpl_cta", "Шаблон: передостанній рядок (перед тегом) - як відгукнутися: телефон або «посилання в шапці профілю»."));
  }

  const fields = [place, schedule].filter((i) => i >= 0);
  if (fields.length && question >= 0 && Math.max(...fields) > question) {
    errors.push(err("tpl_order", "Шаблон: формат і графік ідуть одразу після посади, питання і контакт - у кінці."));
  }

  // Робота вдома без телефону - типова ознака схеми з «оплатіть матеріали».
  if (HOME_RE.test(body.join("\n")) && !PHONE_RE.test(body.join("\n"))) {
    warnings.push({
      severity: "warning",
      code: "tpl_home_no_contact",
      message: "Робота вдома без телефону чи назви роботодавця часто виявляється схемою «спершу оплатіть матеріали». Додайте компанію або контакт, якщо вони є.",
    });
  }

  return { errors, warnings };
}

// Для публікації: null - можна, інакше текст причини. Заборонені слова блокують
// завжди (пост міг бути створений до того, як слово додали в список), шаблон - якщо
// він обов'язковий.
// useTemplate=false - пост без шаблону (галочка у формі): лише заборонені слова.
function publishBlockReason(text, { useTemplate = true } = {}) {
  const words = forbiddenWordsReason(text);
  if (words) return words;
  if (!REQUIRED || useTemplate === false) return null;
  const { errors } = checkJobTemplate(text);
  return errors.length ? `Пост не за шаблоном вакансії: ${errors.map((e) => e.code).join(", ")}` : null;
}

module.exports = { TEMPLATE, SHORT_TEMPLATE, checkShortTemplate, REQUIRED, checkJobTemplate, publishBlockReason };
