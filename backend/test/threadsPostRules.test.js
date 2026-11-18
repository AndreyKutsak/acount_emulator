const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateText, isJobPost, similarity } = require("../src/services/threadsPostRules");

const codes = (r) => [...r.errors, ...r.warnings].map((i) => i.code);
const errorCodes = (r) => r.errors.map((i) => i.code);

const GOOD_JOB = `Junior QA у п�-одуктову команду --- 30---40 тис. г�-н, віддалено.
Бе�-емо без коме�-ційного досвіду, якщо �- пет-п�-о�-кт з тест-кейсами.
Пе�-ший місяць --- онбо�-динг з менто�-ом.
Пишіть у ПП 2---3 �-ечення п�-о себе.
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
  assert.ok(codes(validateText("Увага!\nМенеджер, 30 тис. грн, офіс у Києві, пишіть у ПП. #Вакансії")).includes("generic_opener"));
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
  assert.ok(errorCodes(validateText("Комірник у Rozetka — 27–32 тис. грн, Вінниця. Пишіть у ПП. #Робота")).includes("long_dash"));
  assert.ok(!errorCodes(validateText("Комірник у Rozetka - 27-32 тис. грн, Вінниця. Пишіть у ПП. #Робота")).includes("long_dash"));
});
