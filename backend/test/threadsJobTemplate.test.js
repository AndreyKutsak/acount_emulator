const assert = require("node:assert/strict");
const { test } = require("node:test");
const { TEMPLATE, checkJobTemplate } = require("../src/services/threadsJobTemplate");
const { validateText } = require("../src/services/threadsPostRules");

const codes = (r) => r.errors.map((i) => i.code);

test("сам шаблон проходить і шаблон, і загальні правила", () => {
  assert.deepEqual(codes(checkJobTemplate(TEMPLATE)), []);
  assert.equal(validateText(TEMPLATE).ok, true);
});

test("вакансія у шаблоні з телефоном - без попередження про схему", () => {
  const t = `Комірник у Rozetka
📍 Склад, Вінниця
💸 27-32 тис. на місяць
📅 Графік 2/2, 08:00-20:00
Офіційне працевлаштування
Хто шукає стабільну роботу?
📞 +380934336563
#РоботаВінниця`;
  const r = checkJobTemplate(t);
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.warnings, []);
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
  for (const c of ["tpl_salary", "tpl_schedule", "tpl_tag"]) assert.ok(r.includes(c), c);
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
