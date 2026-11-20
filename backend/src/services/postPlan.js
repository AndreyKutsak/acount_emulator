// Денний план постів для Threads-акаунтів і перевірки поста, яким потрібна БД:
// дублікати й ліміт постів на день.
//
// Пост зараховується акаунту на день D (за годинником POSTS_TIMEZONE), якщо для цього
// акаунта він або опублікований у D, або ще очікує й запланований на D.

const Post = require("../models/Post");
const SocialAccount = require("../models/SocialAccount");
const { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts, zonedTimeToDate, dayKey } = require("./zonedTime");
const { validateText, normalizeForCompare, similarity } = require("./threadsPostRules");
const jobTemplate = require("./threadsJobTemplate");

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const DAILY_MIN = positiveInt(process.env.THREADS_POSTS_PER_DAY_MIN, 3);
const DAILY_MAX = Math.max(DAILY_MIN, positiveInt(process.env.THREADS_POSTS_PER_DAY_MAX, 8));
const TIMEZONE = isValidTimeZone(process.env.POSTS_TIMEZONE || "")
  ? process.env.POSTS_TIMEZONE
  : DEFAULT_TIMEZONE;
const DUPLICATE_DAYS = positiveInt(process.env.THREADS_DUPLICATE_WINDOW_DAYS, 14);
const NEAR_DUPLICATE = 0.8;

function config() {
  return {
    min: DAILY_MIN,
    max: DAILY_MAX,
    timezone: TIMEZONE,
    duplicateWindowDays: DUPLICATE_DAYS,
    jobTemplateRequired: jobTemplate.REQUIRED,
  };
}

// [start, end) доби, в яку потрапляє `date`, за годинником TIMEZONE.
function dayRange(date = new Date()) {
  const parts = zonedParts(date, TIMEZONE);
  return {
    key: dayKey(parts),
    start: zonedTimeToDate(parts, 0, TIMEZONE),
    end: zonedTimeToDate(parts, 24 * 60, TIMEZONE),
  };
}

// "2026-11-16" -> та сама доба; некоректне значення -> сьогодні.
function dayRangeFromKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return dayRange();
  return dayRange(zonedTimeToDate({ year: +m[1], month: +m[2], day: +m[3] }, 12 * 60, TIMEZONE));
}

function entryCountsOnDay(post, entry, { start, end }) {
  const inDay = (d) => d && d >= start && d < end;
  if (entry.status === "published") return inDay(entry.publishedAt);
  if (entry.status === "pending") return inDay(post.scheduledAt);
  return false;
}

// { accountId: { published, scheduled } } за добу.
async function countsForDay(accountIds, range, { excludePostId } = {}) {
  const counts = {};
  for (const id of accountIds) counts[String(id)] = { published: 0, scheduled: 0 };
  if (!accountIds.length) return counts;

  const filter = {
    "accounts.account": { $in: accountIds },
    $or: [
      { scheduledAt: { $gte: range.start, $lt: range.end } },
      { "accounts.publishedAt": { $gte: range.start, $lt: range.end } },
    ],
  };
  if (excludePostId) filter._id = { $ne: excludePostId };

  const posts = await Post.find(filter, "scheduledAt accounts").lean();
  for (const post of posts) {
    for (const entry of post.accounts) {
      const c = counts[String(entry.account)];
      if (!c || !entryCountsOnDay(post, entry, range)) continue;
      if (entry.status === "published") c.published += 1;
      else c.scheduled += 1;
    }
  }
  return counts;
}

async function dailyPlan(dateKey) {
  const range = dateKey ? dayRangeFromKey(dateKey) : dayRange();
  const accounts = await SocialAccount.find({ platform: "threads" }, "username displayName").lean();
  const counts = await countsForDay(accounts.map((a) => a._id), range);

  const rows = accounts.map((a) => {
    const c = counts[String(a._id)];
    const total = c.published + c.scheduled;
    let status = "ok";
    if (total < DAILY_MIN) status = "below";
    else if (total > DAILY_MAX) status = "over";
    return {
      accountId: a._id,
      username: a.username,
      displayName: a.displayName,
      published: c.published,
      scheduled: c.scheduled,
      total,
      missing: Math.max(0, DAILY_MIN - total),
      status,
    };
  });

  return {
    date: range.key,
    ...config(),
    accounts: rows,
    accountsBelow: rows.filter((r) => r.status === "below").length,
    missingTotal: rows.reduce((s, r) => s + r.missing, 0),
  };
}

// Повна перевірка поста для Threads: текст + дублікати + денний ліміт.
// accountIds — усі акаунти поста; перевіряються лише threads-акаунти.
async function validatePost({ text, accountIds = [], scheduledAt = null, postId = null, useTemplate = true }) {
  const accounts = accountIds.length
    ? await SocialAccount.find({ _id: { $in: accountIds } }, "platform username").lean()
    : [];
  const threads = accounts.filter((a) => a.platform === "threads");
  const hasThreads = threads.length > 0 || accountIds.length === 0;

  const result = hasThreads
    ? validateText(text)
    : { ok: true, errors: [], warnings: [], stats: {} };
  result.appliesTo = threads.map((a) => a.username);
  if (!threads.length) return result;

  // Обов'язковий шаблон вакансії для всіх Threads-постів.
  if (jobTemplate.REQUIRED && useTemplate !== false && String(text || "").trim()) {
    const tpl = jobTemplate.checkJobTemplate(text);
    result.errors.push(...tpl.errors);
    result.warnings.push(...tpl.warnings);
    result.template = { required: true, ok: tpl.errors.length === 0 };
  }

  const ids = threads.map((a) => a._id);
  const nameOf = (id) => threads.find((a) => String(a._id) === String(id))?.username || "?";

  // Дублікати: той самий (або майже) текст на тому ж акаунті за останні N днів.
  const since = new Date(Date.now() - DUPLICATE_DAYS * 24 * 60 * 60 * 1000);
  const recentFilter = { "accounts.account": { $in: ids }, createdAt: { $gte: since } };
  if (postId) recentFilter._id = { $ne: postId };
  const recent = await Post.find(recentFilter, "text accounts.account").sort({ createdAt: -1 }).limit(300).lean();

  const norm = normalizeForCompare(text);
  const exact = new Set();
  const near = new Set();
  for (const p of recent) {
    if (!p.text) continue;
    const owners = p.accounts.map((e) => String(e.account)).filter((id) => ids.some((x) => String(x) === id));
    if (!owners.length) continue;
    if (normalizeForCompare(p.text) === norm) owners.forEach((id) => exact.add(nameOf(id)));
    else if (similarity(p.text, text) >= NEAR_DUPLICATE) owners.forEach((id) => near.add(nameOf(id)));
  }
  if (norm && exact.size) {
    result.errors.push({
      severity: "error",
      code: "duplicate",
      message: `Такий самий текст уже був за останні ${DUPLICATE_DAYS} днів на: ${[...exact].join(", ")}. Повтори Meta знижує як неоригінальний контент.`,
    });
  }
  if (norm && near.size) {
    result.warnings.push({
      severity: "warning",
      code: "near_duplicate",
      message: `Майже такий самий текст уже був на: ${[...near].join(", ")}. Перепишіть своїми словами, а не міняйте пару слів.`,
    });
  }

  // Денний ліміт: лише для запланованих постів (ручні не мають дня).
  if (scheduledAt) {
    const date = new Date(scheduledAt);
    if (!Number.isNaN(date.getTime())) {
      const range = dayRange(date);
      const counts = await countsForDay(ids, range, { excludePostId: postId });
      const over = [];
      for (const id of ids) {
        const c = counts[String(id)];
        if (c.published + c.scheduled + 1 > DAILY_MAX) over.push(nameOf(id));
      }
      if (over.length) {
        result.errors.push({
          severity: "error",
          code: "daily_max",
          message: `На ${range.key} у ${over.join(", ")} уже ${DAILY_MAX} постів — це максимум на день. Перенесіть пост на інший день.`,
        });
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

// Скільки постів акаунт уже опублікував сьогодні — для планувальника.
async function publishedToday(accountId) {
  const counts = await countsForDay([accountId], dayRange());
  return counts[String(accountId)].published;
}

module.exports = {
  config,
  dayRange,
  dailyPlan,
  validatePost,
  publishedToday,
  DAILY_MIN,
  DAILY_MAX,
};
