const assert = require("node:assert/strict");
const { test } = require("node:test");
const { render, dayPart } = require("../src/services/spintax");

// Київ взимку UTC+2, тому 06:00 UTC = 08:00 у Києві.
const at = (h) => new Date(Date.UTC(2026, 10, 19, h - 2, 0, 0));

test("пора доби за київським часом", () => {
  assert.equal(dayPart(at(8)), "morning");
  assert.equal(dayPart(at(13)), "day");
  assert.equal(dayPart(at(20)), "evening");
  assert.equal(dayPart(at(23)), "night");
  assert.equal(dayPart(at(3)), "night");
});

test("«Добрий день» зранку й увечері замінюється", () => {
  for (let i = 0; i < 30; i += 1) {
    assert.match(render("Добрий день, Олено!", { now: at(8) }), /^(Доброго ранку|Добрий ранок), Олено!$/);
    assert.match(render("Добрий день, Олено!", { now: at(20) }), /^(Добрий вечір|Доброго вечора), Олено!$/);
    assert.match(render("{Привіт|Добрий день}!", { now: at(13) }), /^(Привіт|Добрий день|Доброго дня)!$/);
  }
});

test("уночі лишається нейтральне слово, регістр зберігається", () => {
  assert.match(render("Добрий день!", { now: at(2) }), /^(Вітаю|Привіт)!$/);
  assert.match(render("Вітаю! доброго ранку, пишіть", { now: at(15) }), /^Вітаю! (добрий день|доброго дня), пишіть$/);
});

test("токен {привітання} і текст без привітань", () => {
  assert.match(render("{привітання}!", { now: at(9) }), /^(Доброго ранку|Добрий ранок)!$/);
  assert.equal(render("Дякую за звернення", { now: at(9) }), "Дякую за звернення");
  assert.equal(render("Добрий деньок", { now: at(9) }), "Добрий деньок");
});
