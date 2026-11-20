const assert = require("node:assert/strict");
const { test } = require("node:test");
const { planReplies, shouldRunDm, messageKey } = require("../src/services/threadsDm");

const rule = (over) => ({
  _id: over.name,
  name: over.name,
  category: "",
  action: "reply",
  matchType: "contains",
  matchMode: "any",
  keywords: [],
  excludeKeywords: [],
  replies: ["Деталі - у Telegram-групі, посилання в шапці профілю"],
  priority: 0,
  enabled: true,
  ...over,
});

const job = rule({ name: "Вакансія", keywords: ["вакансі*", "детальніше", "робот*"] });
const spam = rule({ name: "Спам", action: "ignore", keywords: ["підпишіться"], replies: [] });
const rules = [job, spam];
const chat = (username, text, folder = "requests") => ({ username, text, folder });

test("вакансія - відповідь, спам - без відповіді, решта - без збігу", () => {
  const plan = planReplies(
    [
      chat("a", "Можна детальніше про вакансію?"),
      chat("b", "Доброго дня підпишіться на мій ютуб", "inbox"),
      chat("c", "Бан", "inbox"),
    ],
    rules,
    { budget: 5 },
  );
  assert.deepEqual(
    plan.map((p) => [p.chat.username, p.status]),
    [["a", "reply"], ["b", "ignored"], ["c", "no_match"]],
  );
  assert.equal(plan[0].texts[0], job.replies[0]);
});

test("ліміт: понад бюджет - skipped, а не відповідь", () => {
  const plan = planReplies(
    [chat("a", "цікавить робота"), chat("b", "цікавить вакансія")],
    rules,
    { budget: 1 },
  );
  assert.deepEqual(plan.map((p) => p.status), ["reply", "skipped"]);
  assert.equal(plan[1].reason, "ліміт відповідей");
});

test("уже оброблене повідомлення й дублікати не чіпаємо", () => {
  const handled = new Set([messageKey("a", "Цікавить робота")]);
  const plan = planReplies(
    [chat("a", "цікавить   РОБОТА"), chat("b", "вакансія"), chat("b", "вакансія")],
    rules,
    { handled, budget: 5 },
  );
  assert.deepEqual(plan.map((p) => p.chat.username), ["b"]);
});

test("реакція на наше повідомлення - не текст, пропускаємо", () => {
  const plan = planReplies([chat("a", "Реагує «❤» на ваше повідомлення", "inbox")], rules, { budget: 5 });
  assert.equal(plan[0].status, "skipped");
});

test("правило «один раз на людину» вдруге не відповідає", () => {
  const once = rule({ name: "Привітання", keywords: ["вітаю"], oncePerUser: true });
  const usedRules = new Map([["a", new Set(["Привітання"])]]);
  const plan = planReplies([chat("a", "Вітаю")], [once], { usedRules, budget: 5 });
  assert.equal(plan[0].status, "no_match");
});

test("особисті перевіряємо після підтвердженого поста чи «Статистики», і за ручним запуском", () => {
  const post = { type: "threadsPost", publish: true };
  assert.equal(shouldRunDm(post, { confirmed: true }, { dmAfter: true }), true);
  assert.equal(shouldRunDm(post, { confirmed: false }, { dmAfter: true }), false);
  assert.equal(shouldRunDm(post, { confirmed: true }, {}), false);
  assert.equal(shouldRunDm({ type: "threadsMetrics" }, {}, { dmAfter: true }), true);
  assert.equal(shouldRunDm({ type: "threadsMetrics" }, {}, {}), false);
  assert.equal(shouldRunDm({ type: "threadsDm" }, undefined, {}), true);
});

const { eligibleComments, shouldRunComments, commentKey } = require("../src/services/threadsDm");

test("коментарі: не наші акаунти, свіжі, без відповідей, з текстом", () => {
  const list = [
    { author: "yulllie.b", text: "+", context: "Шукаємо SMM", age_minutes: 120, reply_count: 0 },
    { author: "liza_ni111", text: "А що трапилося?", context: "вода", age_minutes: 30, reply_count: 0 },
    { author: "old", text: "цікаво", context: "x", age_minutes: 3000, reply_count: 0 },
    { author: "answered", text: "цікаво", context: "x", age_minutes: 10, reply_count: 1 },
    { author: "noage", text: "цікаво", context: "x", age_minutes: null, reply_count: 0 },
    { author: "empty", text: "  ", context: "x", age_minutes: 10, reply_count: 0 },
  ];
  const own = new Set(["liza_ni111"]);
  assert.deepEqual(
    eligibleComments(list, { ownUsernames: own, maxAgeHours: 24 }).map((c) => c.author),
    ["yulllie.b"],
  );
  assert.deepEqual(
    eligibleComments(list, { ownUsernames: own, maxAgeHours: 24, skipAnswered: false }).map((c) => c.author),
    ["yulllie.b", "answered"],
  );
});

test("вакансія впізнається за нашим постом, а не лише за словами", () => {
  const { jobContextMatcher } = require("../src/services/threadsDm");
  const isJob = jobContextMatcher([
    { text: "Працівник складу, Польща\n📍 Czeladź, 10 км від Katowice\n💸 З/п - за результатами співбесіди", jobTemplate: true },
    { text: "Ой а що там по кримському мосту? Може на фоні цих новин підтримаємо один одного?", jobTemplate: false },
  ]);
  // У «Розмовах» видно лише початок поста, часом обрізаний «…».
  assert.equal(isJob("Працівник складу, Польща"), true);
  assert.equal(isJob("Працівник складу, Польща 📍 Czeladź, 10 км…"), true);
  assert.equal(isJob("Ой а що там по кримському мосту?"), false);
  // Невідомий контекст (наша відповідь під коментарем) - здогад за словами.
  assert.equal(isJob("Дякую, напишіть мені"), false);
  assert.equal(isJob("Шукаємо оператора чату"), true);

  const list = [
    { author: "a", text: "+", context: "Працівник складу, Польща", age_minutes: 30, reply_count: 0 },
    { author: "b", text: "+", context: "Ой а що там по кримському мосту?", age_minutes: 30, reply_count: 0 },
  ];
  assert.deepEqual(
    eligibleComments(list, { onlyJobPosts: true, isJob }).map((c) => c.author),
    ["a"],
  );
});

test("той самий коментар під різними постами - різні ключі", () => {
  const a = commentKey({ author: "X", text: "+", context: "Пост 1" });
  const b = commentKey({ author: "x", text: "+", context: "Пост 2" });
  assert.notEqual(a, b);
  assert.equal(a, commentKey({ author: "x", text: " + ", context: "пост 1" }));
});

test("коментарі перевіряємо там само, де й особисті; ручні запуски - лише своє", () => {
  assert.equal(shouldRunComments({ type: "threadsMetrics" }, {}, { dmAfter: true }), true);
  assert.equal(shouldRunComments({ type: "threadsComments" }, undefined, {}), true);
  assert.equal(shouldRunComments({ type: "threadsDm" }, undefined, { dmAfter: true }), false);
  assert.equal(shouldRunDm({ type: "threadsComments" }, undefined, { dmAfter: true }), false);
});

const matcher = require("../src/services/autoReplyMatcher");

test("ротація: на однакові «+» - різні відповіді, повтор лише після всіх варіантів", () => {
  const plus = rule({
    name: "Плюс",
    matchType: "exact",
    keywords: ["+"],
    replies: ["Варіант А", "Варіант Б", "Варіант В"],
  });
  const chats = ["a", "b", "c", "d", "e", "f"].map((u) => ({ username: u, text: "+", folder: "comments", key: u }));
  const plan = planReplies(chats, [plus], { budget: 10 });
  const texts = plan.map((p) => p.texts[0]);
  // Кожні три поспіль - усі різні.
  assert.equal(new Set(texts.slice(0, 3)).size, 3);
  assert.equal(new Set(texts.slice(3, 6)).size, 3);
  for (let i = 1; i < texts.length; i += 1) assert.notEqual(texts[i], texts[i - 1]);
});

test("ротація враховує варіанти з попередніх сеансів", () => {
  const r = { replies: ["А", "Б", "В"] };
  for (let i = 0; i < 20; i += 1) {
    const v = matcher.renderReplyVariant(r, { recent: [0, 1] });
    assert.equal(v.index, 2);
  }
  assert.equal(matcher.renderReplyVariant({ replies: [] }), null);
});
