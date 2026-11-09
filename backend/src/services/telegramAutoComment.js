// Automatic Telegram comments from ready-made templates.
//
// Each TelegramCommentTask says: from this account, in this chat, using templates in
// this language, on this schedule. A background loop runs every few seconds:
//   * "slots" tasks get a plan per local day — N random times inside the active
//     window, at least minIntervalMinutes apart. When a slot comes due the newest
//     suitable post gets a comment.
//   * "perPost" tasks poll the chat inside the active window and comment every new
//     post once its (randomised, per post) delay since publication has passed.
// Every attempt is logged; "sent" log rows are what keeps an account from
// commenting the same post twice.

const TelegramCommentTask = require("../models/TelegramCommentTask");
const TelegramCommentTemplate = require("../models/TelegramCommentTemplate");
const TelegramCommentLog = require("../models/TelegramCommentLog");
const TelegramCommentTopic = require("../models/TelegramCommentTopic");
const { classifyPost, postKeywordHits } = require("./commentTopics");
const telegramService = require("./telegramService");
const limits = require("./telegramLimits");
const spintax = require("./spintax");
const {
  zonedParts,
  zonedTimeToDate,
  dayKey,
  parseHHMM,
} = require("./zonedTime");

const ENABLED =
  process.env.SCHEDULER_ENABLED !== "false" &&
  process.env.TELEGRAM_AUTOCOMMENT_ENABLED !== "false";
const INTERVAL_MS =
  Number(process.env.TELEGRAM_AUTOCOMMENT_INTERVAL_MS) || 30 * 1000;
// Minimum pause between any two automated comments of one account, across all of
// its tasks — keeps a busy account clear of FLOOD_WAIT.
const ACCOUNT_GAP_MS =
  (Number(process.env.TELEGRAM_AUTOCOMMENT_ACCOUNT_GAP_SEC) || 60) * 1000;
// How often a perPost task re-reads its chat looking for new posts.
const POLL_MS =
  (Number(process.env.TELEGRAM_AUTOCOMMENT_POLL_SEC) || 120) * 1000;
// A slot this late (server was down, account was in flood wait) is dropped
// instead of being fired together with the next ones.
const LATE_TOLERANCE_MS = 20 * 60 * 1000;
const POSTS_SCAN = 30;
const RECENT_TEMPLATES = 10;
// A template used in a chat (by any account) is not reused there for this long,
// if other templates are available.
const RECENT_IN_CHAT_DAYS = 7;

const NO_POSTS = "Немає нових постів, що підходять під умови завдання";

// After these the task can never succeed until someone changes something in
// Telegram, so it is switched off instead of failing on every slot.
const FATAL_ERRORS = {
  CHAT_WRITE_FORBIDDEN: "акаунту заборонено писати в цьому чаті",
  CHAT_GUEST_SEND_FORBIDDEN: "щоб коментувати, акаунт має вступити в чат обговорень",
  USER_BANNED_IN_CHANNEL: "акаунт обмежений у цьому чаті",
  CHANNEL_PRIVATE: "акаунт не має доступу до чату",
  CHAT_ADMIN_REQUIRED: "потрібні права адміністратора",
  CHANNEL_INVALID: "чат не знайдено",
  PEER_ID_INVALID: "чат не знайдено",
  CHAT_SEND_PLAIN_FORBIDDEN: "у чаті заборонено текстові повідомлення",
};

let intervalHandle = null;
let running = false;
let lastRunAt = null;
let lastTickError = null;

// taskId: a tick or a manual action is working on it right now.
const busyTasks = new Set();
// taskId -> timestamp of the last perPost scan.
const lastPollAt = new Map();
// accountId -> timestamp of the last automated comment.
const lastAccountSendAt = new Map();

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function idOf(ref) {
  return String(ref?._id ?? ref);
}

// ---------- schedule ----------

function startOfLocalDay(now, timezone) {
  return zonedTimeToDate(zonedParts(now, timezone), 0, timezone);
}

// Comments the schedule (not manual runs) sent today, in the task's time zone.
async function sentToday(task, now = new Date()) {
  return TelegramCommentLog.countDocuments({
    task: task._id,
    status: "sent",
    trigger: "schedule",
    createdAt: { $gte: startOfLocalDay(now, task.schedule.timezone) },
  });
}

// Random times for today's remaining comments: inside the active window, not in
// the past, at least minIntervalMinutes apart (also from the last sent comment).
function buildPlan(task, now, remaining) {
  const { timezone, days, activeFrom, activeTo, minIntervalMinutes } =
    task.schedule;
  const today = zonedParts(now, timezone);
  const plan = { date: dayKey(today), timezone, slots: [] };
  if (task.mode !== "slots" || remaining <= 0 || !days.includes(today.weekday)) {
    return plan;
  }

  const windowStart = zonedTimeToDate(today, parseHHMM(activeFrom), timezone);
  const windowEnd = zonedTimeToDate(today, parseHHMM(activeTo), timezone);
  const gap = minIntervalMinutes * 60 * 1000;
  let start = Math.max(windowStart.getTime(), now.getTime() + 60 * 1000);
  if (task.lastSentAt) start = Math.max(start, task.lastSentAt.getTime() + gap);
  const end = windowEnd.getTime();
  if (start >= end) return plan;

  // Spread `count` points over the free time left after reserving the gaps, then
  // put the gaps back in: uniformly random yet never closer than `gap`.
  const count = Math.min(remaining, Math.floor((end - start) / gap) + 1);
  const free = end - start - (count - 1) * gap;
  const offsets = Array.from({ length: count }, () => Math.random() * free).sort(
    (a, b) => a - b,
  );
  plan.slots = offsets.map((offset, i) => ({
    at: new Date(Math.round(start + offset + i * gap)),
    status: "pending",
  }));
  return plan;
}

// Makes sure task.plan is today's. Returns true when it was (re)built.
async function ensurePlan(task, now = new Date(), force = false) {
  const { timezone } = task.schedule;
  const today = dayKey(zonedParts(now, timezone));
  if (!force && task.plan?.date === today && task.plan?.timezone === timezone) {
    return false;
  }
  const remaining = task.schedule.commentsPerDay - (await sentToday(task, now));
  task.plan = buildPlan(task, now, remaining);
  task.markModified("plan");
  return true;
}

function isInsideWindow(task, now) {
  const { timezone, days, activeFrom, activeTo } = task.schedule;
  const p = zonedParts(now, timezone);
  const minutes = p.hour * 60 + p.minute;
  return (
    days.includes(p.weekday) &&
    minutes >= parseHHMM(activeFrom) &&
    minutes < parseHHMM(activeTo)
  );
}

// ---------- picking what to comment and with what ----------

function hashInt(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// perPost: each post gets its own delay inside [delayMin, delayMax], stable across
// ticks so that it does not get re-rolled every time the chat is scanned.
function postDelayMs(task, post) {
  const { delayMinMinutes, delayMaxMinutes } = task.schedule;
  const lo = Math.min(delayMinMinutes, delayMaxMinutes);
  const hi = Math.max(delayMinMinutes, delayMaxMinutes);
  const minutes = lo + (hashInt(`${task._id}:${post.id}`) % (hi - lo + 1));
  return minutes * 60 * 1000;
}

// Topics the task may use: its own list, or (legacy) its single category.
function taskTopics(task) {
  if (task.topics?.length) return task.topics;
  return task.category ? [task.category] : [];
}

async function loadTopics() {
  return TelegramCommentTopic.find({ enabled: true }).sort({ order: 1, name: 1 }).lean();
}

// Enabled templates of the task's language grouped by topic (= category).
async function loadTemplatesByTopic(language) {
  const templates = await TelegramCommentTemplate.find({ language, enabled: true })
    .select("_id text category")
    .lean();
  const byTopic = new Map();
  for (const template of templates) {
    const key = template.category || "";
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(template);
  }
  return byTopic;
}

// Which topics a comment under this post may come from, in order of preference.
// Returns null when the post must not be commented (avoid-topic, nothing fits).
function topicsForPost(task, post, topics) {
  const allowed = taskTopics(task);
  const allowedTopics = allowed.length ? topics.filter((t) => allowed.includes(t.name)) : topics;
  const universal = (allowed.length ? allowedTopics : topics).filter((t) => t.universal);
  const match = classifyPost(post.text, topics);

  // Sensitive posts (tragedies etc.) are never commented, whatever the mode.
  if (match?.avoid) {
    return { skip: `Чутлива тема «${match.avoid.name}» (${match.matchedKeywords.join(", ")})` };
  }

  if (task.topicMode === "fixed") {
    const names = allowed.length ? allowed : topics.filter((t) => !t.avoid).map((t) => t.name);
    return { candidates: [{ names, topic: allowed.join(", ") || "усі теми", matchedKeywords: [] }] };
  }

  const candidates = [];
  if (match && allowedTopics.some((t) => t.name === match.topic.name)) {
    candidates.push({
      names: [match.topic.name],
      topic: match.topic.name,
      matchedKeywords: match.matchedKeywords,
    });
  }
  if (task.fallbackUniversal) {
    candidates.push(
      universal.length
        ? { names: universal.map((t) => t.name), topic: universal[0].name, matchedKeywords: [] }
        : // No universal topic defined: any comment of the chat's topics (or any at all).
          { names: allowed.length ? allowed : null, topic: allowed.join(", ") || "будь-яка тема", matchedKeywords: [] },
    );
  }
  if (!candidates.length) {
    return {
      skip: match
        ? `Тема поста «${match.topic.name}» не входить у теми цього чату`
        : "Тему поста не визначено, а універсальні коментарі вимкнено",
    };
  }
  return { candidates };
}

// Least recently used template among `names`, skipping ones used lately in this
// chat (by any account) and by this task, when there is a choice.
function chooseTemplate(byTopic, names, avoidIds) {
  // names === null: any template of the language.
  const pool = names === null ? [...byTopic.values()].flat() : names.flatMap((name) => byTopic.get(name) || []);
  if (!pool.length) return null;
  const fresh = pool.filter((t) => !avoidIds.has(String(t._id)));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}

// Picks the post to comment and the comment for it.
//   { post, template, topic, matchedKeywords }  something to send;
//   { reason }                                   nothing suitable right now.
async function pickPostAndTemplate(task, account, now, { oldestFirst, applyDelay }) {
  const byTopic = await loadTemplatesByTopic(task.language);
  if (!byTopic.size) {
    return { reason: `Немає увімкнених заготовок мовою "${task.language}"`, noTemplates: true };
  }

  const { items } = await telegramService.listPosts(account, task.chatId, {
    limit: POSTS_SCAN,
  });
  const { maxPostAgeHours, onlyNewPosts, skipWithoutText, keywords } = task.targeting;
  const notBefore = Math.max(
    now.getTime() - maxPostAgeHours * 3600 * 1000,
    onlyNewPosts && task.startedAt ? task.startedAt.getTime() : 0,
  );

  const candidates = items.filter(
    (post) =>
      post.threadKind &&
      !post.own &&
      Date.parse(post.date) >= notBefore &&
      (!skipWithoutText || post.text.trim()),
  );
  if (candidates.length === 0) return { reason: NO_POSTS, noPost: true };

  const commented = new Set(
    await TelegramCommentLog.distinct("postId", {
      account: account._id,
      chatId: task.chatId,
      status: "sent",
      postId: { $in: candidates.map((post) => post.id) },
    }),
  );
  let eligible = candidates.filter(
    (post) =>
      !commented.has(post.id) &&
      (!applyDelay || now.getTime() - Date.parse(post.date) >= postDelayMs(task, post)),
  );
  if (eligible.length === 0) return { reason: NO_POSTS, noPost: true };
  // Posts come newest first.
  if (oldestFirst) eligible = eligible.reverse();

  const topics = await loadTopics();
  const usedInChat = await TelegramCommentLog.distinct("template", {
    chatId: task.chatId,
    status: "sent",
    createdAt: { $gte: new Date(now.getTime() - RECENT_IN_CHAT_DAYS * 86400 * 1000) },
  });
  const avoidIds = new Set([...usedInChat, ...task.recentTemplates].map(String));

  let lastReason = NO_POSTS;
  for (const post of eligible) {
    let postKeywords = [];
    if (keywords?.length) {
      postKeywords = postKeywordHits(post.text, keywords);
      if (!postKeywords.length) {
        lastReason = "Немає нових постів із заданими ключовими словами";
        continue;
      }
    }
    const plan = topicsForPost(task, post, topics);
    if (plan.skip) {
      lastReason = plan.skip;
      continue;
    }
    for (const candidate of plan.candidates) {
      const template = chooseTemplate(byTopic, candidate.names, avoidIds);
      if (template) {
        return {
          post,
          template,
          topic: candidate.topic,
          matchedKeywords: [...new Set([...postKeywords, ...candidate.matchedKeywords])],
        };
      }
      lastReason = `Немає заготовок мовою "${task.language}" для теми «${candidate.topic}»`;
    }
  }
  return { reason: lastReason, noPost: true };
}

async function countTemplates(language, topics = []) {
  const filter = { language, enabled: true };
  if (topics.length) filter.category = { $in: topics };
  return TelegramCommentTemplate.countDocuments(filter);
}

// ---------- sending ----------

function errorText(err) {
  const code = err.errorMessage;
  if (err.seconds) return `Telegram просить зачекати ${err.seconds} с (${code || "FLOOD_WAIT"})`;
  if (code && FATAL_ERRORS[code]) return `${FATAL_ERRORS[code]} (${code})`;
  return code || err.message || "Невідома помилка";
}

// Whether the account may comment in the task's chat now: Telegram's pauses and
// the account's activity limits (the reason is shown on the task), then the gap
// between two comments of one account.
async function accountReady(task, account, now) {
  const blocked = await limits.check(account, { kind: "chat", chatId: task.chatId, texts: [""] }, now);
  if (blocked) {
    const message = `Пауза: ${blocked.reason}`;
    if (task.lastError !== message) {
      setTaskError(task, message);
      await task.save();
    }
    return false;
  }
  const key = idOf(account);
  if (!lastAccountSendAt.has(key)) {
    const last = await TelegramCommentLog.findOne({
      account: account._id,
      status: "sent",
    })
      .sort({ createdAt: -1 })
      .select("createdAt");
    lastAccountSendAt.set(key, last ? last.createdAt.getTime() : 0);
  }
  return now.getTime() - lastAccountSendAt.get(key) >= ACCOUNT_GAP_MS;
}

function setTaskError(task, message) {
  task.lastError = message;
  task.lastErrorAt = new Date();
}

// One attempt: pick a post and a fitting comment, send, log. Never throws for
// Telegram errors — they end up in the log and in task.lastError. The caller
// saves the task.
async function commentOnce(task, account, { trigger, now, oldestFirst = false, applyDelay = false, logSkips = true }) {
  const base = {
    task: task._id,
    account: account._id,
    chatId: task.chatId,
    chatTitle: task.chatTitle,
    trigger,
  };

  const skip = async (reason, extra = {}) => {
    const log = logSkips
      ? await TelegramCommentLog.create({ ...base, status: "skipped", reason })
      : null;
    return { status: "skipped", reason, log, ...extra };
  };

  const fail = async (err, extra = {}) => {
    let reason = errorText(err);
    // FLOOD_WAIT pauses the account, PEER_FLOOD stops sending for a day, ...
    // (sendComment has done this already for its own errors; doing it twice is
    // harmless).
    await limits.handleError(account, err, { chatId: task.chatId });
    if (FATAL_ERRORS[err.errorMessage]) {
      task.enabled = false;
      reason += ". Завдання вимкнено";
    }
    const log = await TelegramCommentLog.create({
      ...base,
      ...extra,
      status: "failed",
      reason,
    });
    task.stats.failed += 1;
    setTaskError(task, reason);
    return { status: "failed", reason, log };
  };

  let picked;
  try {
    picked = await pickPostAndTemplate(task, account, now, { oldestFirst, applyDelay });
  } catch (err) {
    return fail(err);
  }
  if (!picked.post) {
    if (picked.noTemplates) setTaskError(task, picked.reason);
    return skip(picked.reason, { noPost: Boolean(picked.noPost) });
  }

  const { post, template, topic, matchedKeywords } = picked;
  const text = spintax.render(template.text);
  const postInfo = {
    postId: post.id,
    postUrl: post.url,
    postText: post.text.slice(0, 500),
    template: template._id,
    text,
    topic,
    matchedKeywords,
  };
  try {
    const sent = await telegramService.sendComment(account, task.chatId, post.id, text);
    const log = await TelegramCommentLog.create({
      ...base,
      ...postInfo,
      commentId: sent.id,
      status: "sent",
    });
    await TelegramCommentTemplate.updateOne(
      { _id: template._id },
      { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
    );
    task.recentTemplates = [
      template._id,
      ...task.recentTemplates.filter((id) => String(id) !== String(template._id)),
    ].slice(0, RECENT_TEMPLATES);
    task.lastSentAt = new Date();
    task.stats.sent += 1;
    task.lastError = "";
    lastAccountSendAt.set(idOf(account), Date.now());
    return { status: "sent", log };
  } catch (err) {
    // Over the account's activity limits: not a failure, just not now.
    if (err.isLimit) return skip(`Ліміт активності: ${err.message}`);
    return fail(err, postInfo);
  }
}

// ---------- per-task processing ----------

async function processSlots(task, account, now) {
  let changed = await ensurePlan(task, now);
  const due = task.plan.slots.filter((s) => s.status === "pending" && s.at <= now);
  for (const slot of due) {
    if (now - slot.at > LATE_TOLERANCE_MS) {
      slot.status = "missed";
      slot.note = "Час слота минув, поки акаунт був недоступний";
      changed = true;
    }
  }
  const slot = due.find((s) => s.status === "pending");
  if (slot && (await accountReady(task, account, now))) {
    const result = await commentOnce(task, account, { trigger: "schedule", now });
    slot.status = result.status;
    slot.note = result.reason || "";
    slot.log = result.log?._id || null;
    changed = true;
  }
  if (changed) {
    task.markModified("plan");
    await task.save();
  }
}

async function processPerPost(task, account, now) {
  const changed = await ensurePlan(task, now);
  const key = idOf(task);
  const lastPoll = lastPollAt.get(key) || 0;
  const ready =
    isInsideWindow(task, now) &&
    !(task.lastSentAt && now - task.lastSentAt < task.schedule.minIntervalMinutes * 60 * 1000) &&
    now.getTime() - lastPoll >= POLL_MS;
  if (
    ready &&
    (await sentToday(task, now)) < task.schedule.commentsPerDay &&
    (await accountReady(task, account, now))
  ) {
    lastPollAt.set(key, now.getTime());
    const result = await commentOnce(task, account, {
      trigger: "schedule",
      now,
      oldestFirst: true,
      applyDelay: true,
      logSkips: false,
    });
    if (result.status !== "skipped" || !result.noPost) {
      await task.save();
      return;
    }
  }
  if (changed) await task.save();
}

async function processTask(task, now) {
  const account = task.account;
  if (!account) return;
  if (account.authStatus !== "authorized") {
    const message = "Акаунт не авторизований у Telegram";
    if (task.lastError !== message) {
      setTaskError(task, message);
      await task.save();
    }
    return;
  }
  if (task.mode === "slots") await processSlots(task, account, now);
  else await processPerPost(task, account, now);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const tasks = await TelegramCommentTask.find({ enabled: true }).populate("account");
    for (const task of tasks) {
      const key = idOf(task);
      if (busyTasks.has(key)) continue;
      busyTasks.add(key);
      try {
        await processTask(task, new Date());
      } catch (err) {
        console.error(`[tg-autocomment] task ${key} failed:`, err.message);
      } finally {
        busyTasks.delete(key);
      }
    }
    lastRunAt = new Date();
    lastTickError = null;
  } catch (err) {
    lastTickError = err.message;
    throw err;
  } finally {
    running = false;
  }
}

// ---------- manual actions (used by the controller) ----------

// Runs `fn(task)` on a freshly loaded task while holding its lock, so a manual
// action never races the background loop on the same document.
async function withTask(taskId, fn) {
  const key = String(taskId);
  if (busyTasks.has(key)) {
    throw httpError(409, "Завдання зараз виконується, спробуйте за кілька секунд");
  }
  busyTasks.add(key);
  try {
    const task = await TelegramCommentTask.findById(taskId).populate("account");
    if (!task) throw httpError(404, "Завдання не знайдено");
    return await fn(task);
  } finally {
    busyTasks.delete(key);
  }
}

// One comment right now, outside the schedule (does not count toward the daily
// limit, but does respect FLOOD_WAIT).
async function runNow(taskId) {
  return withTask(taskId, async (task) => {
    const account = task.account;
    if (!account || account.authStatus !== "authorized") {
      throw httpError(409, "Акаунт не авторизований у Telegram");
    }
    const now = new Date();
    if (account.floodWaitUntil && account.floodWaitUntil > now) {
      throw httpError(
        429,
        `Telegram обмежив акаунт до ${account.floodWaitUntil.toISOString()}`,
      );
    }
    const result = await commentOnce(task, account, { trigger: "manual", now });
    await task.save();
    return { result, task };
  });
}

async function replan(taskId) {
  return withTask(taskId, async (task) => {
    await ensurePlan(task, new Date(), true);
    await task.save();
    return task;
  });
}

// Applies an update under the task lock; `apply(task)` returns whether the
// schedule changed, in which case today's plan is rebuilt.
async function updateTask(taskId, apply) {
  return withTask(taskId, async (task) => {
    const scheduleChanged = await apply(task);
    if (scheduleChanged) await ensurePlan(task, new Date(), true);
    await task.save();
    return task;
  });
}

function isBusy(taskId) {
  return busyTasks.has(String(taskId));
}

// ---------- loop ----------

function start(intervalMs = INTERVAL_MS) {
  if (!ENABLED) {
    console.log("[tg-autocomment] disabled");
    return null;
  }
  if (intervalHandle) return intervalHandle;
  const run = () =>
    tick().catch((err) => console.error("[tg-autocomment] tick failed:", err.message));
  setTimeout(run, 5000);
  intervalHandle = setInterval(run, intervalMs);
  console.log(`[tg-autocomment] running every ${intervalMs}ms`);
  return intervalHandle;
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function getStatus() {
  return {
    enabled: ENABLED,
    running,
    intervalMs: INTERVAL_MS,
    accountGapSec: ACCOUNT_GAP_MS / 1000,
    pollSec: POLL_MS / 1000,
    lastRunAt,
    lastError: lastTickError,
  };
}

module.exports = {
  start,
  stop,
  tick,
  runNow,
  replan,
  updateTask,
  ensurePlan,
  isBusy,
  sentToday,
  countTemplates,
  getStatus,
  // exported for tests
  _buildPlan: buildPlan,
  _topicsForPost: topicsForPost,
  taskTopics,
  _postDelayMs: postDelayMs,
};
