const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TEMPLATE, SHORT_TEMPLATE, checkJobTemplate } = require("../src/services/threadsJobTemplate");
const { validateText } = require("../src/services/threadsPostRules");

const codes = (r) => r.errors.map((i) => i.code);

test("сам шаблон проходить і шаблон, і загальні правила", () => {
  assert.deepEqual(codes(checkJobTemplate(TEMPLATE)), []);
  assert.equal(validateText(TEMPLATE).ok, true);
});

test("короткий шаблон «набір» проходить, з тегом теж", () => {
  assert.deepEqual(codes(checkJobTemplate(SHORT_TEMPLATE)), []);
  assert.deepEqual(codes(checkJobTemplate(`${SHORT_TEMPLATE}\n#SMM`)), []);
  assert.equal(validateText(SHORT_TEMPLATE).ok, true);
});

test("короткий шаблон без гачка чи без «куди йти» не проходить", () => {
  assert.ok(codes(checkJobTemplate("Привіт усім\nБез досвіду\nНавчимо\nПишіть у шапку")).includes("tpl_lines"));
  assert.ok(codes(checkJobTemplate("Шукаємо SMM-спеціалістів\nБез досвіду\nНавчимо з нуля")).includes("tpl_lines"));
});

test("вакансія у шаблоні з телефоном - без попередження про схему", () => {
  const t = `Комірник у Rozetka
📍 Склад
📅 Графік 2/2, 08:00-20:00
Офіційне працевлаштування
Хто шукає стабільну роботу?
📞 +380934336563
#Робота`;
  const r = checkJobTemplate(t);
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.warnings, []);
});

test("зарплата й місто в пості - лише попередження, не помилка", () => {
  const t = `Комірник у Rozetka
📍 Склад, Вінниця
💸 27-32 тис. на місяць
📅 Графік 2/2
Офіційне працевлаштування
Хто шукає роботу?
Посилання в шапці профілю
#РоботаВінниця`;
  const r = checkJobTemplate(t);
  assert.deepEqual(codes(r), []);
  const w = r.warnings.map((x) => x.code);
  assert.ok(w.includes("tpl_salary_given"));
  assert.ok(w.includes("tpl_city_given"));
});

test("шаблон без зарплати й міста чистий", () => {
  const r = checkJobTemplate(TEMPLATE);
  assert.ok(!/\d{2}\s?\d{3}|Вінниц/.test(TEMPLATE));
  assert.ok(!r.warnings.some((x) => x.code === "tpl_salary_given" || x.code === "tpl_city_given"));
});

test("робота вдома без телефону - попередження", () => {
  assert.ok(checkJobTemplate(TEMPLATE).warnings.some((w) => w.code === "tpl_home_no_contact"));
});

test("суцільний абзац не проходить", () => {
  const r = codes(checkJobTemplate("Шукаємо комірника у Вінниці, зарплата 30 тис. грн, графік 5/2, пишіть у ПП. #Вакансії"));
  assert.ok(r.includes("tpl_lines"));
});

test("бракує зарплати, графіка й тегу", () => {
  const t = `Комірник у Rozetka
📍 Склад, Вінниця
Офіційне працевлаштування
Дружній колектив
Хто шукає роботу?
Посилання в шапці профілю`;
  const r = codes(checkJobTemplate(t));
  for (const c of ["tpl_schedule", "tpl_tag"]) assert.ok(r.includes(c), c);
});

test("зарплата в першому рядку і контакт не в кінці", () => {
  const t = `Комірник 30 тис. грн
📍 Склад, Вінниця
💸 30 тис. грн
📅 Графік 5/2
Посилання в шапці профілю
Хто хоче?
Дружній колектив
#РоботаВінниця`;
  const r = codes(checkJobTemplate(t));
  assert.ok(r.includes("tpl_title"));
  assert.ok(r.includes("tpl_cta"));
});
