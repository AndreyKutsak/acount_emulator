// Правила тексту поста для Threads. Чиста функція без БД: однаково працює в API,
// у живій перевірці форми й у тестах.
//
// Звідки правила:
//   * Meta Recommendation Guidelines — наживка на взаємодію («постав лайк», «пиши +»),
//     клікбейт і конкурси не потрапляють у рекомендації («Для вас»);
//   * Threads: один тег теми на пост, 500 символів, API відхиляє пости з >5 посиланнями;
//   * Meta ставить оригінальний контент вище за дублікати;
//   * практика: сильний перший рядок, для вакансій — зарплата, формат роботи і
//     зрозумілий спосіб відгукнутися;
//   * Meta Community Standards «Fraud, Scams and Deceptive Practices» (вакансії):
//     «advance promises of salary», «guaranteed jobs», «advance fee before the job
//     is granted», «unrealistic financial reward for unclear or minimal effort» -
//     такі пости видаляють або знижують у поширенні;
//   * правило власника: у постах без валюти й без згадок Telegram та інших
//     месенджерів (заклик «пишіть у Telegram» - типова схема шахраїв, а переходи за
//     межі Threads дають менше взаємодій і, отже, менше показів).
//
// severity: "error" — пост не зберігається; "warning" — підказка, зберегти можна.

const matcher = require("./autoReplyMatcher");

const MAX_CHARS = 500;
const MAX_LINKS = 5; // жорсткий ліміт Threads API
const SOFT_MAX_LINKS = 2;
const FIRST_LINE_MAX = 120;
const MIN_CHARS = 40;

// Межі слова для кирилиці: \b у JS бачить лише латиницю.
const W_START = "(?<![\\p{L}\\d])";
const W_END = "(?![\\p{L}\\d])";

function words(pattern) {
  return new RegExp(`${W_START}(?:${pattern})${W_END}`, "iu");
}

// Фрази, за які Meta знижує поширення (engagement bait / конкурси).
const ENGAGEMENT_BAIT = [
  { re: words("постав(?:те)?\\s+(?:лайк|сердечко|вподобайку)|став(?:те)?\\s+(?:лайк|сердечко)|ставь(?:те)?\\s+лайк|лайкни(?:те)?"), label: "просьба поставити лайк" },
  { re: words("лайк,?\\s+якщо|лайк,?\\s+если|like\\s+if"), label: "«лайк, якщо…»" },
  { re: /(?:пиши|пишіть|пишите|напиши|напишіть|напишите|став(?:те)?|ставь(?:те)?|кинь(?:те)?|comment)\s*["«']?\s*(?:\+|плюс|plus)(?![\p{L}\d])/iu, label: "«пиши +» у коментарях" },
  { re: /(?:\+|плюс)\s*(?:в|у)\s+(?:коментар|коментах|комент|комменты|комментарии)/iu, label: "«+ у коментарях»" },
  { re: words("(?:пиши|пишіть|пишите|напиши|напишіть|напишите)\\s+[\"«']?(?:хочу|дай|скинь|го|я)[\"»']?\\s+(?:в|у)\\s+(?:коментар\\p{L}*|комент\\p{L}*|коммент\\p{L}*)"), label: "«напиши “хочу” в коментарях»" },
  { re: words("зроби(?:ть)?\\s+репост|сделай(?:те)?\\s+репост|репост\\s*=|поділи(?:ться|сь)\\s+з\\s+друзями|tag\\s+a\\s+friend|відміть\\s+друга|отметь\\s+друга"), label: "просьба зробити репост / відмітити друзів" },
  { re: words("підпиши(?:сь|ться)|подпиши(?:сь|тесь)|follow\\s+for|фоловь|фолов\\s+за\\s+фолов"), label: "заклик підписатися" },
  { re: words("розіграш\\p{L}*|розыгрыш\\p{L}*|giveaway|конкурс\\p{L}*"), label: "розіграш / конкурс" },
];

// --- Заборонені й ризикові слова ------------------------------------------
// Слова й фрази редагуються в інтерфейсі (вкладка «Пости» -> «Заборонені слова»,
// колекція PostWordRule, services/postWords.js). Тут - групи з поясненнями,
// стандартний набір (з ним працюють тести й бекенд до завантаження бази) і збіг.
//
// Фраза: слова через пробіл, «*» у кінці слова - будь-яке закінчення («долар*»).
// Шукається цілим словом, без урахування регістру; латинські літери, схожі на
// кириличні, розпізнаються («грн» з латинською «p»). Фраза без літер і цифр
// («$», «₴») шукається як є.

const WORD_GROUPS = {
  currency: {
    label: "Валюта",
    severity: "error",
    message: "Валюта в тексті. Пишіть суму без валюти: «27 500 на місяць», «від 30 тис.», «200 за зміну».",
  },
  messenger: {
    label: "Telegram та інші месенджери",
    severity: "error",
    message:
      "Згадка Telegram чи іншого месенджера. Вакансія з переходом у месенджер - типова схема шахраїв, яку фільтрує Meta, а переходи за межі Threads знижують охоплення. Пишіть «Деталі - за посиланням у шапці профілю».",
  },
  scam_promise: {
    label: "Обіцянки легкого заробітку",
    severity: "error",
    message:
      "Обіцянка гарантованої роботи чи легкого заробітку. За правилами Meta це ознака шахрайської вакансії: такі пости видаляють або не показують. Опишіть роботу й умови як є.",
  },
  advance_fee: {
    label: "Оплата наперед",
    severity: "error",
    message: "Згадка оплати до початку роботи (навчання, матеріали, внесок). За правилами Meta це ознака шахрайства.",
  },
  gambling_crypto: {
    label: "Казино, ставки, крипта",
    severity: "error",
    message: "Казино, ставки чи крипта. Meta обмежує такі теми, а у вакансії вони виглядають як шахрайство.",
  },
  custom: {
    label: "Мої заборонені слова",
    severity: "error",
    message: "Слово з вашого списку заборонених.",
  },
  unlimited_income: {
    label: "Необмежений дохід",
    severity: "warning",
    message: "«Дохід без стелі» схоже на «нереалістичну фінансову винагороду» з правил Meta. Краще конкретна вилка.",
  },
  daily_pay: {
    label: "Виплати щодня чи наперед",
    severity: "warning",
    message:
      "Обіцянка щоденних виплат чи виплат наперед - Meta відносить «попередні обіцянки зарплати» до ознак шахрайських вакансій.",
  },
  custom_warning: {
    label: "Мої ризикові слова",
    severity: "warning",
    message: "Слово з вашого списку ризикових: охоплення може впасти.",
  },
};

// Стандартний набір. Порядок груп - як у WORD_GROUPS.
const DEFAULT_WORDS = {
  currency: [
    "грн", "гривн*", "гривень", "uah", "usd", "eur", "pln", "євро", "евро", "долар*", "доллар*",
    "бакс*", "злот*", "руб*", "$", "₴", "€", "£", "zł",
  ],
  messenger: [
    "телеграм*", "telegram", "тг", "tg", "t.me", "т.ме", "вайбер*", "viber", "ватсап*", "вотсап*",
    "whatsapp", "whats app",
  ],
  scam_promise: [
    "гарантован* робот*", "гарантован* дох*", "гарантован* заробіт*", "гарантован* заробот*",
    "гарантован* працевлаштуван*", "гарантован* виплат*", "гарантуємо роботу", "гарантуємо дохід",
    "гарантуємо заробіток", "гарантуємо працевлаштування", "гарантуємо виплати", "легкі гроші",
    "легк* заробіт*", "легк* заробот*", "швидкі гроші", "швидк* заробіт*", "швидк* заробот*",
    "пасивн* дох*", "без вкладень", "без вложений", "без зусиль",
  ],
  advance_fee: [
    "передоплат*", "предоплат*", "оплат* за навчання", "оплат* навчання", "оплат* за матеріал*",
    "оплат* матеріал*", "сплат* за навчання", "внес* за навчання", "оплат* за реєстрац*",
    "оплат* за оформленн*", "вступн* внес*", "страхов* внес*",
  ],
  gambling_crypto: ["казино", "casino", "ставк* на спорт", "букмекер*", "крипт*", "біткоїн*", "bitcoin", "арбітраж трафік*"],
  unlimited_income: ["дохід без стел*", "без стелі", "необмежен* дох*", "необмежен* заробіт*", "заробляй від", "заробляйте від"],
  daily_pay: ["виплат* щодня", "оплат* щодня", "щоденн* виплат*", "виплат* наперед", "аванс одразу"],
};

const NOT_WORD = "(?<![\\p{L}\\p{N}])";
const NOT_WORD_END = "(?![\\p{L}\\p{N}])";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Як у автовідповідях: нижній регістр, один апостроф, латинські двійники кирилиці.
function normalizeWords(text) {
  return matcher.normalize(text);
}

// Фраза -> перевірка нормалізованого тексту, або null для порожньої фрази.
function compilePhrase(phrase) {
  const norm = normalizeWords(phrase);
  if (!norm) return null;
  if (!/[\p{L}\p{N}]/u.test(norm)) return (text) => text.includes(norm);
  const body = norm
    .split(/\s+/)
    .map((w) => escapeRe(w).replace(/\\\*/g, "[\\p{L}\\p{N}]*"))
    .join("\\s+");
  const re = new RegExp(`${NOT_WORD}${body}${NOT_WORD_END}`, "u");
  return (text) => re.test(text);
}

function compileRules(list) {
  return list
    .filter((r) => r.enabled !== false && WORD_GROUPS[r.group])
    .map((r) => ({ phrase: r.phrase, group: r.group, test: compilePhrase(r.phrase) }))
    .filter((r) => r.test);
}

const defaultWordList = () =>
  Object.entries(DEFAULT_WORDS).flatMap(([group, phrases]) => phrases.map((phrase) => ({ phrase, group })));

let activeRules = compileRules(defaultWordList());

// Підмінити набір (з бази): [{ phrase, group, enabled }].
function setWordRules(list) {
  activeRules = compileRules(list || []);
}

// Знайдені слова за групами: { group: [phrase, ...] }.
function findWords(text) {
  const norm = normalizeWords(text);
  const found = {};
  for (const r of activeRules) {
    if (r.test(norm)) (found[r.group] ||= []).push(r.phrase);
  }
  return found;
}

// Одна проблема на групу: пояснення групи + які саме слова знайдено.
function wordIssues(text) {
  return Object.entries(findWords(text)).map(([group, phrases]) => {
    const g = WORD_GROUPS[group];
    return issue(g.severity, group, `${g.message} Знайдено: ${phrases.map((p) => `«${p}»`).join(", ")}.`);
  });
}

// Для публікації: null - можна, інакше причина (лише заборонені слова).
function forbiddenWordsReason(text) {
  const bad = Object.entries(findWords(text)).filter(([group]) => WORD_GROUPS[group].severity === "error");
  if (!bad.length) return null;
  return `Заборонені слова: ${bad.flatMap(([, p]) => p).map((p) => `«${p}»`).join(", ")}`;
}

const CLICKBAIT = [
  words("ти\\s+не\\s+повіриш|ви\\s+не\\s+повірите|ты\\s+не\\s+поверишь|шок|шокуюч\\p{L}*|you\\s+won'?t\\s+believe"),
];

// Ознаки, що пост — вакансія.
const JOB_RE = words(
  "ваканс\\p{L}*|шукаємо|шукає|запрошує|набирає|шукаю\\s+(?:в\\s+команду|співробітник\\p{L}*)|ищем|hiring|we'?re\\s+hiring|запрошуємо\\s+(?:на\\s+роботу|в\\s+команду)|потрібен|потрібна|потрібні|вимоги|обов'?язки|резюме|робота\\s+для|job|position|відгукуйтес\\p{L}*",
);
// Зарплата без валюти: число з «тис.»/«к» або з періодом («на місяць», «за зміну»),
// або слова «з/п», «зарплата».
const SALARY_RE = /(?:\d[\d\s.,]*\s*(?:k|к|тис\.?|тыс\.?)(?![\p{L}])|\d[\d\s.,]*\s*(?:\/|на|за|в)\s*(?:місяць|міс\.?|день|добу|годину|год\.?|зміну|тиждень)|(?<![\p{L}])(?:зп|з\/п|зарплат\p{L}*|оплата|ставка|дохід|salary)(?![\p{L}]))/iu;
const FORMAT_RE = words(
  "віддален\\p{L}*|дистанційн\\p{L}*|удален\\p{L}*|remote|офіс\\p{L}*|офис\\p{L}*|office|гібрид\\p{L}*|гибрид\\p{L}*|hybrid|релокац\\p{L}*|м\\.\\s*\\p{L}+|київ\\p{L}*|львів\\p{L}*|харків\\p{L}*|одес\\p{L}*|дніпр\\p{L}*|вінниц\\p{L}*|kyiv|lviv",
);
const CTA_RE = words(
  "телефон\\p{L}*|дзвон\\p{L}*|шапц\\p{L}*\\s+профіл\\p{L}*|\\+?380\\d{9}|пиши|пишіть|пишите|напиши|напишіть|напишите|надсилай(?:те)?|надішли|надішліть|відгук\\p{L}*|резюме|cv|в\\s+пп|в\\s+приват\\p{L}*|в\\s+директ|директ|dm|посиланн\\p{L}*|за\\s+лінк\\p{L}*|link|apply|заповни(?:ть)?\\s+анкету|анкет\\p{L}*",
);
const GENERIC_OPENERS = /^\s*(?:увага|внимание|attention|ми\s+шукаємо|шукаємо|мы\s+ищем|ищем|вакансія|вакансия|терміново|срочно|hiring)\s*[!:.\-–—]*\s*$/iu;

const LINK_RE = /(?:https?:\/\/|www\.)[^\s]+|(?<![@\p{L}\d.])[a-z0-9-]+\.(?:com|ua|me|io|net|org|link|ly|app|co|pro|info)\/[^\s]*/giu;
const TAG_RE = /(?:^|\s)#[\p{L}\d_]/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function issue(severity, code, message) {
  return { severity, code, message };
}

function firstLine(text) {
  return (text.split(/\r?\n/).find((line) => line.trim()) || "").trim();
}

// Детектор вакансії: експортується, щоб UI міг показувати чекліст вакансії.
function isJobPost(text) {
  return JOB_RE.test(String(text || ""));
}

function validateText(rawText) {
  const text = String(rawText || "");
  const trimmed = text.trim();
  const issues = [];
  const chars = [...trimmed].length;

  if (!trimmed) {
    issues.push(issue("error", "empty", "Текст поста порожній."));
    return summarize(issues, { chars: 0, links: 0, tags: 0, isJob: false });
  }

  if (chars > MAX_CHARS) {
    issues.push(issue("error", "too_long", `Текст задовгий: ${chars} із ${MAX_CHARS} символів. Скоротіть або винесіть деталі в коментар-продовження.`));
  } else if (chars < MIN_CHARS) {
    issues.push(issue("warning", "too_short", `Лише ${chars} символів — замало, щоб людина зрозуміла суть і захотіла відповісти.`));
  }

  // Правило власника: лише звичайний дефіс "-", без довгого (—) і середнього (–) тире.
  const dashes = (trimmed.match(/[—–]/g) || []).length;
  if (dashes) {
    issues.push(issue("error", "long_dash", `Довгі тире (— або –): ${dashes} шт. Використовуйте лише звичайний дефіс "-".`));
  }

  const links = (trimmed.match(LINK_RE) || []).length;
  if (links > MAX_LINKS) {
    issues.push(issue("error", "too_many_links", `${links} посилань — Threads не публікує пости з понад ${MAX_LINKS} посиланнями.`));
  } else if (links > SOFT_MAX_LINKS) {
    issues.push(issue("warning", "many_links", `${links} посилання — суть має бути в тексті, посилання лише як доповнення (1–2).`));
  }

  const tags = (trimmed.match(TAG_RE) || []).length;
  if (tags > 1) {
    issues.push(issue("error", "many_tags", `${tags} хештеги — у Threads працює лише один тег теми на пост, решта виглядає як спам.`));
  } else if (tags === 0) {
    issues.push(issue("warning", "no_tag", "Немає тегу теми (#Тема) — пости з тегом отримують більше переглядів. Наприклад: #Вакансії, #ПошукРоботи."));
  }

  for (const { re, label } of ENGAGEMENT_BAIT) {
    if (re.test(trimmed)) {
      issues.push(issue("error", "engagement_bait", `Наживка на взаємодію: ${label}. Meta не показує такі пости в рекомендаціях. Поставте справжнє питання замість цього.`));
    }
  }
  issues.push(...wordIssues(trimmed));
  if (CLICKBAIT.some((re) => re.test(trimmed))) {
    issues.push(issue("warning", "clickbait", "Схоже на клікбейт — такі формулювання Meta знижує в рекомендаціях."));
  }

  const opener = firstLine(trimmed);
  if ([...opener].length > FIRST_LINE_MAX) {
    issues.push(issue("warning", "long_first_line", `Перший рядок довший за ${FIRST_LINE_MAX} символів — у стрічці видно лише початок. Винесіть головну думку в короткий перший рядок.`));
  }
  if (GENERIC_OPENERS.test(opener)) {
    issues.push(issue("warning", "generic_opener", `Перший рядок «${opener}» нічого не каже. Почніть з конкретики: посада + зарплата, цифра або питання.`));
  }

  const letters = trimmed.match(/\p{L}/gu) || [];
  const upper = trimmed.match(/\p{Lu}/gu) || [];
  if (letters.length >= 20 && upper.length / letters.length > 0.4) {
    issues.push(issue("warning", "caps", "Забагато ВЕЛИКИХ ЛІТЕР — читається як крик і спам."));
  }
  const emoji = (trimmed.match(EMOJI_RE) || []).length;
  if (emoji > 8) {
    issues.push(issue("warning", "emoji", `${emoji} емодзі — забагато, текст виглядає як реклама.`));
  }
  if (/[!?]{3,}/.test(trimmed)) {
    issues.push(issue("warning", "punctuation", "«!!!» / «???» — виглядає як спам, достатньо одного знака."));
  }

  const isJob = isJobPost(trimmed);
  if (isJob) {
    if (!SALARY_RE.test(trimmed)) {
      issues.push(issue("warning", "job_no_salary", "Вакансія без зарплати — довіра й відгуки помітно нижчі. Вкажіть вилку без валюти (наприклад, 25-35 тис. на місяць)."));
    }
    if (!FORMAT_RE.test(trimmed)) {
      issues.push(issue("warning", "job_no_format", "Не вказано формат чи місце роботи: віддалено / офіс / гібрид, місто."));
    }
    if (!CTA_RE.test(trimmed)) {
      issues.push(issue("warning", "job_no_cta", "Незрозуміло, як відгукнутися: телефон роботодавця або «Деталі - за посиланням у шапці профілю»."));
    }
  }

  return summarize(issues, { chars, links, tags, isJob });
}

function summarize(issues, stats) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { ok: errors.length === 0, errors, warnings, stats: { ...stats, maxChars: MAX_CHARS } };
}

// Нормалізація для пошуку дублікатів: регістр, пробіли, пунктуація й емодзі не важать.
function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\d\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Схожість за множинами слів (0..1).
function similarity(a, b) {
  const wa = new Set(normalizeForCompare(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(normalizeForCompare(b).split(" ").filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / (wa.size + wb.size - common);
}

module.exports = {
  WORD_GROUPS,
  DEFAULT_WORDS,
  defaultWordList,
  setWordRules,
  findWords,
  forbiddenWordsReason,
  compilePhrase,
  MAX_CHARS,
  MAX_LINKS,
  validateText,
  isJobPost,
  normalizeForCompare,
  similarity,
};
