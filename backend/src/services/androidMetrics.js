// Метрики Threads-дописів, зібрані з нативного застосунку на емуляторі.
//
// Пости, опубліковані через Android, не мають postUrl, тож веб-скрапер
// (scheduler.refreshPublishedMetrics) їх не бачить. Натомість піднімаємо
// телефон акаунта, відкриваємо «Профіль → Статистика» і читаємо блок «Дописи»
// (automation/flows.py: threads_metrics). Threads показує там ~8 останніх
// дописів з урізаним текстом, тож зіставляємо їх із нашими постами за початком
// тексту.

const Post = require("../models/Post");
const orchestrator = require("./androidOrchestrator");

// Threads показує у «Статистиці» дописи за останні 90 днів.
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

// Порівнюємо лише літери й цифри: дамп UI віддає емодзі поза BMP (🌙, 🧵) як
// '..', а пробіли/переноси/пунктуація в урізаному тексті теж плавають.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
// Коротший початок (напр. допис із самих емодзі) зіставляємо лише точним збігом.
const MIN_PREFIX = 12;

// Опубліковані за останні 90 днів пости акаунта, найновіші першими.
async function recentPublishedEntries(accountId) {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const posts = await Post.find({
    accounts: {
      $elemMatch: { account: accountId, status: "published", publishedAt: { $gte: since } },
    },
  });
  const out = [];
  for (const post of posts) {
    const entry = post.accounts.find(
      (a) => a.account.toString() === accountId.toString() && a.status === "published",
    );
    if (entry) out.push({ post, entry, text: norm(post.text) });
  }
  return out.sort((a, b) => (b.entry.publishedAt || 0) - (a.entry.publishedAt || 0));
}

async function hasRecentPublished(accountId) {
  const since = new Date(Date.now() - LOOKBACK_MS);
  return Boolean(
    await Post.exists({
      accounts: {
        $elemMatch: { account: accountId, status: "published", publishedAt: { $gte: since } },
      },
    }),
  );
}

// Рядки статистики (найновіші першими) -> наші пости. Жадібно: кожен рядок
// забирає найновіший ще не зіставлений пост, текст якого починається з
// урізаного тексту рядка. Однакові початки у двох постів розводяться порядком.
function matchRows(rows, candidates) {
  const used = new Set();
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const prefix = norm(row.text);
    const fits = (c) =>
      prefix.length >= MIN_PREFIX ? c.text.startsWith(prefix) : c.text === prefix;
    const idx = prefix ? candidates.findIndex((c, i) => !used.has(i) && fits(c)) : -1;
    if (idx === -1) {
      unmatched.push(row);
      continue;
    }
    used.add(idx);
    matched.push({ row, ...candidates[idx] });
  }
  return { matched, unmatched };
}

// Підняти телефон акаунта, зчитати статистику й оновити метрики постів.
// opts.stopAfter — погасити емулятор після збору (як після публікації).
async function collectForAccount(account, { stopAfter = true } = {}) {
  const run = await orchestrator.runForAccount(
    account,
    { type: "threadsMetrics" },
    { stopAfter },
  );
  const rows = run.result?.posts || [];
  const candidates = await recentPublishedEntries(account._id);
  const { matched, unmatched } = matchRows(rows, candidates);

  const now = new Date();
  const touched = new Set();
  for (const { row, post, entry } of matched) {
    entry.views = row.views;
    entry.likes = row.likes;
    entry.comments = row.replies;
    entry.reposts = row.reposts;
    entry.shares = row.shares;
    entry.metricsUpdatedAt = now;
    touched.add(post);
  }
  for (const post of touched) await post.save();

  account.androidMetricsAt = now;
  await account.save();

  console.log(
    `${now.toISOString()} [android-metrics] ${account.username}: rows=${rows.length}`,
    `matched=${matched.length} unmatched=${unmatched.length}`,
  );
  return {
    account: account.username,
    rows: rows.length,
    matched: matched.map(({ row, post }) => ({ postId: post._id, ...row })),
    unmatched,
  };
}

module.exports = { collectForAccount, hasRecentPublished, matchRows, norm };
