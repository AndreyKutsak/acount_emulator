const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateText, isJobPost, similarity } = require("../src/services/threadsPostRules");

const codes = (r) => [...r.errors, ...r.warnings].map((i) => i.code);
const errorCodes = (r) => r.errors.map((i) => i.code);

const GOOD_JOB = `Junior QA у продуктову команду - 30-40 тис. на місяць, віддалено.
Беремо без комерційного досвіду, якщо є пет-проєкт з тест-кейсами.
Перший місяць - онбординг з ментором.
Пишіть у ПП 2-3 речення про себе.
#Вакансії`;

test("гарна вакансія проходить без помилок і попереджень", () => {
  const r = validateText(GOOD_JOB);
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r), []);
  assert.equal(r.stats.isJob, true);
});

test("порожній і задовгий текст — помилки", () => {
  assert.deepEqual(errorCodes(validateText("   ")), ["empty"]);
  assert.ok(errorCodes(validateText("а".repeat(501) + " #Тема")).includes("too_long"));
});

test("наживка на взаємодію блокує пост", () => {
  for (const t of [
    "Хочеш список вакансій? Пиши + у коментарях #Вакансії",
    "Постав лайк, якщо шукаєш роботу #Робота",
    "Напиши «хочу» в коментарях і я скину #Робота",
    "Розіграш консультації з резюме серед підписників #Робота",
    "Like if you agree, this is a long enough text #Jobs",
  ]) {
    assert.ok(errorCodes(validateText(t)).includes("engagement_bait"), t);
  }
});

test("справжнє питання до аудиторії — не наживка", () => {
  const r = validateText("Яку вимогу у вакансіях ви вважаєте найабсурднішою? Я - «3 роки досвіду для джуна». #ПошукРоботи");
  assert.ok(!errorCodes(r).includes("engagement_bait"));
  assert.equal(r.ok, true);
});

test("теги: два — помилка, жодного — попередження", () => {
  assert.ok(errorCodes(validateText("Текст про ринок праці в Україні сьогодні #Робота #Вакансії")).includes("many_tags"));
  assert.ok(codes(validateText("Текст про ринок праці в Україні сьогодні і завтра")).includes("no_tag"));
});

test("посилання: понад 5 — помилка, 3 — попередження", () => {
  const links = (n) => Array.from({ length: n }, (_, i) => `https://ex.com/${i}`).join(" ");
  assert.ok(errorCodes(validateText(`Добірка вакансій ${links(6)} #Вакансії`)).includes("too_many_links"));
  const r = validateText(`Добірка вакансій тижня ${links(3)} #Вакансії`);
  assert.equal(r.ok, true);
  assert.ok(codes(r).includes("many_links"));
});

test("вакансія без зарплати, формату й способу відгукнутися", () => {
  const r = validateText("Шукаємо менеджера з продажу в нашу команду, досвід від року. #Вакансії");
  assert.equal(r.stats.isJob, true);
  for (const c of ["job_no_salary", "job_no_format", "job_no_cta"]) assert.ok(codes(r).includes(c), c);
});

test("загальний перший рядок і капс", () => {
  assert.ok(codes(validateText("Увага!\nМенеджер, 30 тис., офіс у Києві, пишіть у ПП. #Вакансії")).includes("generic_opener"));
  assert.ok(codes(validateText("ТЕРМІНОВО ПОТРІБЕН ВОДІЙ НА ДОСТАВКУ, ДОБРА ОПЛАТА #Робота")).includes("caps"));
});

test("не вакансія не отримує чекліст вакансії", () => {
  assert.equal(isJobPost("Як я пройшов 12 співбесід за місяць і що з цього виніс"), false);
});

test("схожість тексту", () => {
  assert.ok(similarity("Шукаємо junior QA віддалено 30 тисяч", "Шукаємо junior QA віддалено 35 тисяч") >= 0.6);
  assert.ok(similarity("Про резюме", "Про погоду в Києві сьогодні") < 0.3);
});

test("довгі тире заборонені, дефіс дозволений", () => {
  assert.ok(errorCodes(validateText("Комірник у Rozetka — 27–32 тис., Вінниця. Пишіть у ПП. #Робота")).includes("long_dash"));
  assert.ok(!errorCodes(validateText("Комірник у Rozetka - 27-32 тис., Вінниця. Пишіть у ПП. #Робота")).includes("long_dash"));
});

test("валюта в будь-якому вигляді - помилка, сума без валюти - ні", () => {
  for (const t of ["27 500 грн на місяць", "від $1000", "1 500 USD", "800 євро", "35 тис. гривень", "100 zł за день", "200₴"]) {
    assert.ok(errorCodes(validateText(`Кухар у ресторан, Вінниця, ${t}. #Робота`)).includes("currency"), t);
  }
  for (const t of ["27 500 на місяць", "від 30 тис.", "200 за зміну", "З/п - за результатами співбесіди"]) {
    assert.ok(!errorCodes(validateText(`Кухар у ресторан, Вінниця, ${t}. #Робота`)).includes("currency"), t);
  }
});

test("Telegram та інші месенджери - помилка, схожі слова - ні", () => {
  for (const t of ["Пишіть у Telegram", "деталі в телеграмі", "наш тг-канал", "t.me/jobs", "Viber або WhatsApp", "пишіть у вайбер"]) {
    assert.ok(errorCodes(validateText(`Кухар у ресторан, Вінниця. ${t}. #Робота`)).includes("messenger"), t);
  }
  for (const t of ["Деталі - за посиланням у шапці профілю", "Telegraph", "тгк", "таргетолог"]) {
    assert.ok(!errorCodes(validateText(`Кухар у ресторан, Вінниця. ${t}. #Робота`)).includes("messenger"), t);
  }
});

test("ознаки шахрайської вакансії з правил Meta - помилки", () => {
  const cases = {
    scam_promise: ["Гарантований дохід щомісяця", "легкі гроші вдома", "Пасивний дохід з телефону", "Старт без вкладень"],
    advance_fee: ["Передоплата за матеріали", "оплата за навчання 500", "вступний внесок"],
    gambling_crypto: ["Оператор казино", "Заробіток на крипті"],
  };
  for (const [code, list] of Object.entries(cases)) {
    for (const t of list) assert.ok(errorCodes(validateText(`Оператор, Вінниця. ${t}. #Робота`)).includes(code), `${code}: ${t}`);
  }
  // Звичайні слова не ловляться.
  for (const t of ["Гарантуємо офіційне оформлення за КЗпП", "Оплата щомісяця двічі", "Навчання за рахунок компанії"]) {
    const r = validateText(`Оператор, Вінниця. ${t}. #Робота`);
    for (const code of ["scam_promise", "advance_fee", "gambling_crypto"]) assert.ok(!errorCodes(r).includes(code), `${code}: ${t}`);
  }
});

test("ризикові обіцянки - лише попередження", () => {
  const r = validateText("Менеджер, Вінниця. Дохід без стелі, виплати щодня. Деталі - за посиланням у шапці профілю. #Робота");
  assert.equal(r.ok, true);
  assert.ok(codes(r).includes("unlimited_income"));
  assert.ok(codes(r).includes("daily_pay"));
});
