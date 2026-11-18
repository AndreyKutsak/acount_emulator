// Автовідповіді на особисті повідомлення Threads, у тому ж сеансі на телефоні,
// що й публікація чи «Статистика» (androidOrchestrator, opts.dmAfter):
//
//   1) threads_dm_scan: список «Вхідних» і «Запитів» - лише непрочитані чати.
//      Рядок списку містить повний текст останнього повідомлення, тож чати НЕ
//      відкриваються і нічого не позначається прочитаним;
//   2) тут: кожне повідомлення класифікується правилами ThreadsDmRule (той самий
//      збіг, що й у Telegram - autoReplyMatcher) і рахуються ліміти;
//   3) threads_dm_send: відкриваються лише чати, на які є відповідь.
//
// Чат без відповідного правила (no_match) чи категорії без відповіді (ignored)
// лишається непрочитаним - людина побачить його в застосунку сама.
// Кожне повідомлення обробляється один раз (ThreadsDmLog.messageKey); невдала
// відправка (failed) повторюється в наступних сеансах до MAX_ATTEMPTS разів.

const SocialAccount = require("../models/SocialAccount");
const ThreadsDmRule = require("../models/ThreadsDmRule");
const ThreadsDmLog = require("../models/ThreadsDmLog");
const bridge = require("./androidBridgeService");
const matcher = require("./autoReplyMatcher");
const { isJobPost } = require("./threadsPostRules");

const MAX_ATTEMPTS = 3;
// Не текст, а службовий рядок списку: реакція на наше повідомлення.
const REACTION_RE = /^(реагує|реагирует|reacted)(?!\p{L})/iu;
const DAY_MS = 24 * 60 * 60 * 1000;

const messageKey = (username, text) =>
  `${String(username).toLowerCase()}\n${matcher.normalize(text).slice(0, 500)}`;

// Чи перевіряти особисті в цьому сеансі: після підтвердженої публікації чи
// після «Статистики» (за opts.dmAfter), або коли це сама дія threadsDm.
function shouldRunDm(behavior, result, opts = {}) {
  if (behavior?.type === "threadsDm") return true;
  if (behavior?.type === "threadsComments") return false;
  if (opts.dmAfter !== true) return false;
  if (behavior?.type === "threadsMetrics") return true;
  return behavior?.type === "threadsPost" && behavior.publish === true && result?.confirmed === true;
}

// Чисте рішення для кожного чату, без бази й телефону.
//   chats:    [{ folder, username, text }] з threads_dm_scan;
//   rules:    увімкнені правила акаунта;
//   handled:  Set messageKey, які вже оброблено (повторно не чіпаємо);
//   usedRules: Map username -> Set ruleId, уже використаних правил oncePerUser;
//   budget:   скільки відповідей ще можна надіслати;
//   recentVariants: Map ruleId -> [індекси варіантів, найсвіжіший перший] - для ротації,
//             щоб однакові повідомлення («+») отримували різні відповіді. Доповнюється
//             по ходу, тож у межах одного сеансу варіанти теж не повторюються.
// -> [{ chat, key, status, match, category, candidates, texts, variant, reason }]
//   status: reply | ignored | no_match | skipped
function planReplies(
  chats,
  rules,
  { handled = new Set(), usedRules = new Map(), budget = 0, recentVariants = new Map() } = {},
) {
  const out = [];
  const seen = new Set();
  let left = budget;
  for (const chat of chats || []) {
    const text = String(chat.text || "").trim();
    const key = chat.key || messageKey(chat.username, text);
    if (!chat.username || !text || handled.has(key) || seen.has(key)) continue;
    seen.add(key);
    const base = { chat, key, match: null, category: "", candidates: [], texts: [], reason: "" };
    if (REACTION_RE.test(text)) {
      out.push({ ...base, status: "skipped", reason: "реакція, не повідомлення" });
      continue;
    }
    const skipRuleIds = usedRules.get(String(chat.username).toLowerCase()) || new Set();
    const { category, candidates, match } = matcher.classify(rules, text, { skipRuleIds });
    const decided = { ...base, match, category, candidates };
    if (!match) {
      out.push({ ...decided, status: "no_match" });
    } else if (match.rule.action === "ignore") {
      out.push({ ...decided, status: "ignored" });
    } else if (left <= 0) {
      out.push({ ...decided, status: "skipped", reason: "ліміт відповідей" });
    } else {
      const ruleId = String(match.rule._id);
      const picked = matcher.renderReplyVariant(match.rule, { recent: recentVariants.get(ruleId) || [] });
      if (!picked || !picked.parts.length) {
        out.push({ ...decided, status: "skipped", reason: "у правила порожня відповідь" });
        continue;
      }
      recentVariants.set(ruleId, [picked.index, ...(recentVariants.get(ruleId) || [])].slice(0, 20));
      left -= 1;
      out.push({ ...decided, status: "reply", texts: picked.parts, variant: picked.index });
    }
  }
  return out;
}

// Правила каналу; старі правила без поля channel - особисті.
const channelFilter = (channel) => (channel === "comments" ? { channel: "comments" } : { channel: { $in: ["dm", null] } });

// Останні використані варіанти відповіді кожного правила (для ротації між сеансами).
async function recentVariantsFor(accountId, channel) {
  const logs = await ThreadsDmLog.find({
    account: accountId,
    ...channelFilter(channel),
    status: "replied",
    rule: { $ne: null },
    replyVariant: { $ne: null },
  })
    .sort({ repliedAt: -1 })
    .limit(200)
    .select("rule replyVariant")
    .lean();
  const map = new Map();
  for (const l of logs) {
    const id = String(l.rule);
    if (!map.has(id)) map.set(id, []);
    if (map.get(id).length < 20) map.get(id).push(l.replyVariant);
  }
  return map;
}

async function rulesFor(accountId, channel = "dm") {
  return ThreadsDmRule.find({
    ...channelFilter(channel),
    enabled: true,
    $or: [{ accounts: { $size: 0 } }, { accounts: accountId }],
  }).sort({ priority: -1, createdAt: 1 });
}

function logFields(d, now) {
  return {
    peerId: d.chat.username,
    peerUsername: d.chat.username,
    peerName: d.chat.title || "",
    channel: d.chat.folder === "comments" ? "comments" : "dm",
    folder: ["requests", "comments"].includes(d.chat.folder) ? d.chat.folder : "inbox",
    incomingText: d.chat.text,
    contextText: d.chat.context || "",
    messageKey: d.key,
    rowSignature: d.chat.signature || "",
    receivedAt: now,
    rule: d.match?.rule?._id || null,
    ruleName: d.match?.rule?.name || "",
    category: d.category || d.match?.category || "",
    categories: [...new Set(d.candidates.map((c) => c.category))],
    matchedKeywords: d.match?.matchedKeywords || [],
    replyVariant: d.variant ?? null,
    reason: d.reason || "",
  };
}

// Перевірити особисті й відповісти. Ніколи не кидає: збій тут не має робити
// невдалою публікацію, після якої він іде. log - журнал кроків оркестратора.
async function handleInbox(account, serial, log = []) {
  const settings = account.dmAutoReply || {};
  if (!settings.enabled) return null;
  const summary = { scanned: 0, replied: 0, failed: 0, noMatch: 0, ignored: 0, skipped: 0 };
  try {
    const folders = settings.includeRequests === false ? ["inbox"] : ["inbox", "requests"];
    // Рядки «N нові повідомлення», уже прочитані й оброблені: не відкривати знову.
    const knownRows = await ThreadsDmLog.distinct("rowSignature", {
      account: account._id,
      rowSignature: { $ne: "" },
      createdAt: { $gte: new Date(Date.now() - 30 * DAY_MS) },
      $or: [{ status: { $ne: "failed" } }, { attempts: { $gte: MAX_ATTEMPTS } }],
    });
    const scan = await bridge.threadsDmScan(serial, folders, knownRows);
    const chats = scan?.chats || [];
    summary.scanned = chats.length;

    const keys = chats.map((c) => messageKey(c.username, c.text));
    const known = await ThreadsDmLog.find({ account: account._id, messageKey: { $in: keys } });
    const byKey = new Map(known.map((l) => [l.messageKey, l]));
    // Невдала відправка повторюється, решта - вже оброблена.
    const handled = new Set(
      known.filter((l) => l.status !== "failed" || l.attempts >= MAX_ATTEMPTS).map((l) => l.messageKey),
    );

    const peers = [...new Set(chats.map((c) => String(c.username)))];
    const usedRules = new Map();
    for (const l of await ThreadsDmLog.find({
      account: account._id,
      peerId: { $in: peers },
      ...channelFilter("dm"),
      status: "replied",
      rule: { $ne: null },
    }).select("peerId rule")) {
      const peer = l.peerId.toLowerCase();
      if (!usedRules.has(peer)) usedRules.set(peer, new Set());
      usedRules.get(peer).add(String(l.rule));
    }

    const repliedToday = await ThreadsDmLog.countDocuments({
      account: account._id,
      ...channelFilter("dm"),
      status: "replied",
      repliedAt: { $gte: new Date(Date.now() - DAY_MS) },
    });
    const budget = Math.max(
      0,
      Math.min(settings.maxPerSession ?? 5, (settings.maxPerDay ?? 30) - repliedToday),
    );

    const plan = planReplies(chats, await rulesFor(account._id, "dm"), {
      handled,
      usedRules,
      budget,
      recentVariants: await recentVariantsFor(account._id, "dm"),
    });
    const now = new Date();
    const upsert = async (d, patch) => {
      const doc = byKey.get(d.key) || new ThreadsDmLog({ account: account._id });
      doc.set({ ...logFields(d, now), ...patch });
      await doc.save();
      return doc;
    };

    const toSend = [];
    for (const d of plan) {
      if (d.status === "reply") {
        toSend.push({ d, doc: await upsert(d, { status: "failed", reason: "надсилається..." }) });
      } else {
        await upsert(d, { status: d.status });
        if (d.status === "no_match") summary.noMatch += 1;
        else if (d.status === "ignored") summary.ignored += 1;
        else summary.skipped += 1;
      }
    }

    if (toSend.length) {
      const res = await bridge.threadsDmSend(
        serial,
        toSend.map(({ d }) => ({ username: d.chat.username, folder: d.chat.folder, texts: d.texts })),
      );
      const results = res?.results || [];
      for (const [i, { d, doc }] of toSend.entries()) {
        const r = results[i] || { ok: false, error: "немає відповіді від мосту" };
        doc.attempts = (doc.attempts || 0) + 1;
        if (r.ok) {
          doc.set({ status: "replied", replyText: d.texts.join("\n---\n"), repliedAt: new Date(), readAt: new Date(), reason: "" });
          summary.replied += 1;
          await ThreadsDmRule.updateOne(
            { _id: d.match.rule._id },
            { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
          );
        } else {
          doc.set({ status: "failed", reason: r.error || "не вдалося надіслати" });
          summary.failed += 1;
        }
        await doc.save();
      }
    }

    account.set("dmAutoReply.lastRunAt", new Date());
    account.set("dmAutoReply.lastError", "");
    log.push({ step: "threadsDm", ok: true, ...summary });
  } catch (err) {
    account.set("dmAutoReply.lastRunAt", new Date());
    account.set("dmAutoReply.lastError", err.message);
    log.push({ step: "threadsDm", ok: false, error: err.message, ...summary });
    summary.error = err.message;
  }
  await account.save().catch(() => {});
  return summary;
}

// --- коментарі під нашими постами ------------------------------------------
// threads_comments_scan читає «Дії → Розмови»: хто відповів, на що (наш пост
// чи наша відповідь), текст, давність і чи вже є відповіді під коментарем.

// Один коментар = автор + на що відповів + текст.
const commentKey = (c) =>
  `c|${String(c.author).toLowerCase()}|${matcher.normalize(c.context).slice(0, 60)}|${matcher.normalize(c.text).slice(0, 300)}`;

// Які коментарі взагалі розглядати (без бази): не наші акаунти, свіжі, без
// наявних відповідей (якщо skipAnswered), з текстом.
function eligibleComments(
  comments,
  { ownUsernames = new Set(), maxAgeHours = 24, skipAnswered = true, onlyJobPosts = false } = {},
) {
  return (comments || []).filter((c) => {
    if (!c.author || !String(c.text || "").trim()) return false;
    if (ownUsernames.has(String(c.author).toLowerCase())) return false;
    if (c.age_minutes == null || c.age_minutes > maxAgeHours * 60) return false;
    if (skipAnswered && c.reply_count > 0) return false;
    if (onlyJobPosts && !isJobPost(c.context)) return false;
    return true;
  });
}

function shouldRunComments(behavior, result, opts = {}) {
  if (behavior?.type === "threadsComments") return true;
  if (behavior?.type === "threadsDm") return false;
  return shouldRunDm(behavior, result, opts);
}

// Перевірити коментарі й відповісти. Ніколи не кидає (як handleInbox).
async function handleComments(account, serial, log = []) {
  const settings = account.commentAutoReply || {};
  if (!settings.enabled) return null;
  const summary = { scanned: 0, replied: 0, failed: 0, noMatch: 0, ignored: 0, skipped: 0 };
  try {
    const scan = await bridge.threadsCommentsScan(serial);
    const own = await SocialAccount.find({ platform: "threads" }).select("username");
    const ownUsernames = new Set(own.map((a) => String(a.username).toLowerCase()));
    ownUsernames.add(String(account.username).toLowerCase());
    const comments = eligibleComments(scan?.comments, {
      ownUsernames,
      maxAgeHours: settings.maxAgeHours ?? 24,
      skipAnswered: settings.skipAnswered !== false,
      onlyJobPosts: settings.onlyJobPosts !== false,
    });
    summary.scanned = comments.length;
    const chats = comments.map((c) => ({
      username: c.author,
      text: c.text,
      context: c.context || "",
      folder: "comments",
      key: commentKey(c),
    }));

    const keys = chats.map((c) => c.key);
    const known = await ThreadsDmLog.find({ account: account._id, messageKey: { $in: keys } });
    const byKey = new Map(known.map((l) => [l.messageKey, l]));
    const handled = new Set(
      known.filter((l) => l.status !== "failed" || l.attempts >= MAX_ATTEMPTS).map((l) => l.messageKey),
    );
    const usedRules = new Map();
    for (const l of await ThreadsDmLog.find({
      account: account._id,
      channel: "comments",
      peerId: { $in: [...new Set(chats.map((c) => c.username))] },
      status: "replied",
      rule: { $ne: null },
    }).select("peerId rule")) {
      const peer = l.peerId.toLowerCase();
      if (!usedRules.has(peer)) usedRules.set(peer, new Set());
      usedRules.get(peer).add(String(l.rule));
    }
    const repliedToday = await ThreadsDmLog.countDocuments({
      account: account._id,
      channel: "comments",
      status: "replied",
      repliedAt: { $gte: new Date(Date.now() - DAY_MS) },
    });
    const budget = Math.max(0, Math.min(settings.maxPerSession ?? 5, (settings.maxPerDay ?? 30) - repliedToday));

    const plan = planReplies(chats, await rulesFor(account._id, "comments"), {
      handled,
      usedRules,
      budget,
      recentVariants: await recentVariantsFor(account._id, "comments"),
    });
    const now = new Date();
    const upsert = async (d, patch) => {
      const doc = byKey.get(d.key) || new ThreadsDmLog({ account: account._id });
      doc.set({ ...logFields(d, now), ...patch });
      await doc.save();
      return doc;
    };

    const toSend = [];
    for (const d of plan) {
      if (d.status === "reply") {
        // Публічна відповідь - один коментар: частини «---» йдуть рядками.
        d.reply = d.texts.join("\n");
        toSend.push({ d, doc: await upsert(d, { status: "failed", reason: "надсилається..." }) });
      } else {
        await upsert(d, { status: d.status });
        if (d.status === "no_match") summary.noMatch += 1;
        else if (d.status === "ignored") summary.ignored += 1;
        else summary.skipped += 1;
      }
    }

    if (toSend.length) {
      const res = await bridge.threadsCommentsReply(
        serial,
        toSend.map(({ d }) => ({ author: d.chat.username, text: d.chat.text, context: d.chat.context, reply: d.reply })),
      );
      const results = res?.results || [];
      for (const [i, { d, doc }] of toSend.entries()) {
        const r = results[i] || { ok: false, error: "немає відповіді від мосту" };
        doc.attempts = (doc.attempts || 0) + 1;
        if (r.ok) {
          doc.set({ status: "replied", replyText: d.reply, repliedAt: new Date(), reason: "" });
          summary.replied += 1;
          await ThreadsDmRule.updateOne(
            { _id: d.match.rule._id },
            { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
          );
        } else {
          doc.set({ status: "failed", reason: r.error || "не вдалося опублікувати відповідь" });
          summary.failed += 1;
        }
        await doc.save();
      }
    }

    account.set("commentAutoReply.lastRunAt", new Date());
    account.set("commentAutoReply.lastError", "");
    log.push({ step: "threadsComments", ok: true, ...summary });
  } catch (err) {
    account.set("commentAutoReply.lastRunAt", new Date());
    account.set("commentAutoReply.lastError", err.message);
    log.push({ step: "threadsComments", ok: false, error: err.message, ...summary });
    summary.error = err.message;
  }
  await account.save().catch(() => {});
  return summary;
}

module.exports = {
  handleInbox,
  handleComments,
  planReplies,
  eligibleComments,
  shouldRunDm,
  shouldRunComments,
  messageKey,
  commentKey,
  channelFilter,
  REACTION_RE,
};
