// Activity quotas that keep Telegram accounts clear of anti-spam limits.
//
// Telegram does not publish rate limits for user accounts. What it does document:
//   * FLOOD_WAIT_X / SLOWMODE_WAIT_X: wait X seconds before repeating
//     (core.telegram.org/api/errors);
//   * PEER_FLOOD: the account is limited for spam — mostly for unsolicited
//     private messages, links and invite links, and ads in groups
//     (telegram.org/faq_spam); @SpamBot tells how long the limit lasts;
//   * CHANNELS_TOO_MUCH: at most 500 channels/supergroups, 1000 with Premium
//     (core.telegram.org/api/config);
//   * FROZEN_METHOD_INVALID: the account is frozen.
// So every send and join of this app goes through here: it is refused when it
// would go over the account's quotas (TelegramAccount.limits), counted in
// TelegramActivity when done, and Telegram's own flood answers pause the account
// (or the chat) for as long as Telegram asks.

const TelegramAccount = require("../models/TelegramAccount");
const TelegramActivity = require("../models/TelegramActivity");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// After PEER_FLOOD nothing is sent for this long (a first spam limit lasts days;
// re-trying earlier only makes it longer).
const SPAM_PAUSE_MS = 24 * HOUR;

const LINK_RE =
  /(?:https?:\/\/|www\.|tg:\/\/|\bt\.me\/|\btelegram\.me\/|\b[a-z0-9-]+\.(?:com|net|org|info|biz|io|me|ru|ua|com\.ua|online|site|top|xyz|shop|link|ly|gg)\b)/i;

// accountId:chatId -> time until which the chat is in slow mode.
const slowmode = new Map();
// accountId:chatId -> Date the account joined the chat (or null: not a member).
const joinedAtCache = new Map();

class LimitError extends Error {
  constructor(reason, retryAt = null) {
    super(reason);
    this.name = "LimitError";
    this.status = 429;
    this.isLimit = true;
    this.retryAt = retryAt;
  }
}

function hasLink(text) {
  return LINK_RE.test(String(text || ""));
}

function defaults() {
  return new TelegramAccount().toObject().limits;
}

function limitsOf(account) {
  const stored = account.limits?.toObject ? account.limits.toObject() : account.limits;
  return { ...defaults(), ...(stored || {}) };
}

// Quotas in force right now: during warm-up every quota is cut to warmupPercent
// (but a non-zero quota never drops to 0).
function effectiveLimits(account, now = new Date()) {
  const limits = limitsOf(account);
  const added = account.createdAt ? new Date(account.createdAt).getTime() : now.getTime();
  const warmupUntil = added + limits.warmupDays * DAY;
  const warmingUp = limits.warmupDays > 0 && now.getTime() < warmupUntil;
  const factor = warmingUp ? limits.warmupPercent / 100 : 1;
  const cut = (value) => (value > 0 ? Math.max(1, Math.floor(value * factor)) : 0);
  const quotas = { ...limits };
  for (const key of [
    "messagesPerHour",
    "messagesPerDay",
    "dmChatsPerDay",
    "dmMessagesPerChatPerDay",
    "dmLinksPerDay",
    "chatMessagesPerHour",
    "chatMessagesPerDay",
    "chatMessagesPerChatPerDay",
    "chatLinksPerDay",
    "joinsPerDay",
    "joinsPerWeek",
    "freshChatMessagesPerDay",
  ]) {
    quotas[key] = cut(limits[key]);
  }
  return { quotas, warmingUp, warmupUntil: warmingUp ? new Date(warmupUntil) : null };
}

function key(account, chatId) {
  return `${account._id}:${chatId}`;
}

function since(now, windowMs) {
  return new Date(now.getTime() - windowMs);
}

// null when `adding` more rows fit into `limit` within the window; otherwise
// { retryAt } — when enough old rows leave the window (null: never, limit 0).
async function overWindow(filter, windowMs, limit, adding, now) {
  if (adding > limit) return { retryAt: null };
  const createdAt = { $gte: since(now, windowMs) };
  const count = await TelegramActivity.countDocuments({ ...filter, createdAt });
  if (count + adding <= limit) return null;
  const oldest = await TelegramActivity.findOne({ ...filter, createdAt })
    .sort({ createdAt: 1 })
    .skip(count + adding - limit - 1)
    .select("createdAt");
  return { retryAt: oldest ? new Date(oldest.createdAt.getTime() + windowMs) : null };
}

function untilText(date) {
  if (!date) return "";
  return ` до ${date.toLocaleString("uk-UA", { timeZone: process.env.STEALTH_TIMEZONE || "Europe/Kyiv" })}`;
}

// When the account joined `chatId`: from our own join records, else asked from
// Telegram by the caller (`lookup`, e.g. channels.getParticipant) and cached.
async function joinedAt(account, chatId, lookup) {
  const cacheKey = key(account, chatId);
  if (joinedAtCache.has(cacheKey)) return joinedAtCache.get(cacheKey);
  const join = await TelegramActivity.findOne({ account: account._id, kind: "join", chatId })
    .sort({ createdAt: -1 })
    .select("createdAt");
  let date = join ? join.createdAt : null;
  if (!date && lookup) {
    try {
      date = (await lookup()) || null;
    } catch {
      date = null;
    }
  }
  joinedAtCache.set(cacheKey, date);
  return date;
}

// Why `op` may not run now, or null when it may.
//   op.kind:    "dm" | "chat" | "join"
//   op.chatId:  person id (dm) or marked chat id (chat, join)
//   op.texts:   the messages about to be sent (dm, chat)
//   op.joinedAt:     when the account joined the chat (chat), if known
//   op.channelCount: channels/supergroups the account is in now (join)
// Returns { reason, retryAt }.
async function check(account, op, now = new Date()) {
  const block = (reason, retryAt = null) => ({ reason, retryAt });

  if (account.frozenAt) {
    return block("Telegram заморозив акаунт (FROZEN). Будь-які дії неможливі, доки апеляцію не прийнято");
  }
  if (account.floodWaitUntil && account.floodWaitUntil > now) {
    return block(`Telegram попросив зачекати (FLOOD_WAIT)${untilText(account.floodWaitUntil)}`, account.floodWaitUntil);
  }
  if (account.spamBlockedUntil && account.spamBlockedUntil > now) {
    return block(
      `Акаунт обмежено за спам (PEER_FLOOD), пауза${untilText(account.spamBlockedUntil)}. Перевірте стан у @SpamBot`,
      account.spamBlockedUntil,
    );
  }
  if (op.kind !== "join") {
    const slow = slowmode.get(key(account, op.chatId));
    if (slow && slow > now.getTime()) {
      return block(`У чаті повільний режим${untilText(new Date(slow))}`, new Date(slow));
    }
  }

  const { quotas: q, warmingUp } = effectiveLimits(account, now);
  if (!q.enabled) return null;
  const warm = warmingUp ? " (прогрів нового акаунта: ліміти зменшено)" : "";
  const acc = { account: account._id };
  const texts = op.texts || [];
  const count = texts.length;
  const links = texts.filter(hasLink).length;

  const over = async (filter, windowMs, limit, adding, label) => {
    const hit = await overWindow({ ...acc, ...filter }, windowMs, limit, adding, now);
    if (!hit) return null;
    const what = limit === 0 ? `${label}: заборонено налаштуваннями` : `${label}: ліміт ${limit}${warm}`;
    return block(hit.retryAt ? `${what}, можна${untilText(hit.retryAt)}` : what, hit.retryAt);
  };

  if (op.kind === "dm" || op.kind === "chat") {
    const sent = { kind: { $in: ["dm", "chat"] } };
    const result =
      (await over(sent, HOUR, q.messagesPerHour, count, "Повідомлень за годину")) ||
      (await over(sent, DAY, q.messagesPerDay, count, "Повідомлень за добу"));
    if (result) return result;
  }

  if (op.kind === "dm") {
    const chat = { kind: "dm", chatId: op.chatId };
    const result =
      (await over(chat, DAY, q.dmMessagesPerChatPerDay, count, "Повідомлень одній людині за добу")) ||
      (links && (await over({ kind: "dm", hasLink: true }, DAY, q.dmLinksPerDay, links, "Посилань в особистих за добу")));
    if (result) return result;
    const talkedToday = await TelegramActivity.exists({
      ...acc,
      ...chat,
      createdAt: { $gte: since(now, DAY) },
    });
    if (!talkedToday) {
      const people = await TelegramActivity.distinct("chatId", {
        ...acc,
        kind: "dm",
        createdAt: { $gte: since(now, DAY) },
      });
      if (people.length + 1 > q.dmChatsPerDay) {
        return block(`Різних людей в особистих за добу: ліміт ${q.dmChatsPerDay}${warm}`);
      }
    }
    return null;
  }

  if (op.kind === "chat") {
    const result =
      (await over({ kind: "chat" }, HOUR, q.chatMessagesPerHour, count, "Повідомлень у чатах за годину")) ||
      (await over({ kind: "chat" }, DAY, q.chatMessagesPerDay, count, "Повідомлень у чатах за добу")) ||
      (links && (await over({ kind: "chat", hasLink: true }, DAY, q.chatLinksPerDay, links, "Посилань у чатах за добу")));
    if (result) return result;

    let perChat = q.chatMessagesPerChatPerDay;
    let perChatLabel = "Повідомлень в одному чаті за добу";
    const joined = op.joinedAt ? new Date(op.joinedAt) : null;
    if (joined) {
      const age = now.getTime() - joined.getTime();
      if (age < q.freshChatQuietHours * HOUR) {
        const at = new Date(joined.getTime() + q.freshChatQuietHours * HOUR);
        return block(`Акаунт щойно вступив у чат: перші ${q.freshChatQuietHours} год без повідомлень, можна${untilText(at)}`, at);
      }
      if (age < q.freshChatDays * DAY) {
        perChat = Math.min(perChat, q.freshChatMessagesPerDay);
        perChatLabel = `Повідомлень у чаті, куди акаунт вступив менше ${q.freshChatDays} дн тому, за добу`;
      }
    }
    return over({ kind: "chat", chatId: op.chatId }, DAY, perChat, count, perChatLabel);
  }

  if (op.kind === "join") {
    const result =
      (await over({ kind: "join" }, DAY, q.joinsPerDay, 1, "Вступів у чати за добу")) ||
      (await over({ kind: "join" }, WEEK, q.joinsPerWeek, 1, "Вступів у чати за тиждень"));
    if (result) return result;
    if (q.joinGapMinutes > 0) {
      const last = await TelegramActivity.findOne({ ...acc, kind: "join" })
        .sort({ createdAt: -1 })
        .select("createdAt");
      const next = last && new Date(last.createdAt.getTime() + q.joinGapMinutes * 60 * 1000);
      if (next && next > now) {
        return block(`Між вступами в чати пауза ${q.joinGapMinutes} хв, можна${untilText(next)}`, next);
      }
    }
    if (op.channelCount != null && op.channelCount >= q.maxChannels) {
      return block(`Акаунт уже в ${op.channelCount} каналах і групах (ліміт ${q.maxChannels}). Вийдіть із непотрібних`);
    }
  }
  return null;
}

// Counts a done action: one row per message sent (dm, chat) or one per join.
async function record(account, op, source = "auto") {
  const base = { account: account._id, kind: op.kind, chatId: String(op.chatId), source };
  const rows =
    op.kind === "join"
      ? [base]
      : (op.texts || []).map((text) => ({ ...base, hasLink: hasLink(text) }));
  if (op.kind === "join") joinedAtCache.set(key(account, op.chatId), new Date());
  if (rows.length) await TelegramActivity.insertMany(rows);
}

// Reacts to Telegram's own limits. Returns a readable reason, or null when the
// error is not about limits.
async function handleError(account, err, op = {}) {
  const code = String(err?.errorMessage || "");
  const now = Date.now();
  if (code.startsWith("SLOWMODE_WAIT") && op.chatId != null) {
    slowmode.set(key(account, op.chatId), now + ((err.seconds || 60) + 2) * 1000);
    return `У чаті повільний режим: ${err.seconds} с`;
  }
  if (err?.seconds && (code.includes("FLOOD") || err.constructor?.name === "FloodWaitError")) {
    const until = new Date(now + (err.seconds + 5) * 1000);
    account.floodWaitUntil = until;
    await TelegramAccount.updateOne({ _id: account._id }, { $set: { floodWaitUntil: until } });
    return `Telegram попросив зачекати ${err.seconds} с (${code || "FLOOD_WAIT"})`;
  }
  if (code === "PEER_FLOOD") {
    const until = new Date(now + SPAM_PAUSE_MS);
    const reason = "Telegram обмежив акаунт за спам (PEER_FLOOD)";
    account.spamBlockedUntil = until;
    account.spamBlockReason = reason;
    await TelegramAccount.updateOne(
      { _id: account._id },
      { $set: { spamBlockedUntil: until, spamBlockReason: reason } },
    );
    console.warn(`[tg-limits] ${account._id}: PEER_FLOOD, sending paused for 24h`);
    return `${reason}. Надсилання зупинено на добу, перевірте стан у @SpamBot`;
  }
  if (code.startsWith("FROZEN_")) {
    account.frozenAt = new Date(now);
    await TelegramAccount.updateOne({ _id: account._id }, { $set: { frozenAt: account.frozenAt } });
    console.warn(`[tg-limits] ${account._id}: account frozen (${code})`);
    return `Telegram заморозив акаунт (${code})`;
  }
  if (code === "CHANNELS_TOO_MUCH") {
    return "Акаунт уже в максимальній кількості каналів і груп (CHANNELS_TOO_MUCH)";
  }
  return null;
}

// check -> fn() -> record, with Telegram's limit errors handled. Throws a
// LimitError (status 429) when the quotas do not allow `op` right now.
async function guard(account, op, fn, { source = "auto" } = {}) {
  const blocked = await check(account, op);
  if (blocked) throw new LimitError(blocked.reason, blocked.retryAt);
  let result;
  try {
    result = await fn();
  } catch (err) {
    await handleError(account, err, op);
    throw err;
  }
  await record(account, op, source);
  return result;
}

// Counters for the UI: what was used against what is allowed.
async function usage(account, now = new Date()) {
  const { quotas, warmingUp, warmupUntil } = effectiveLimits(account, now);
  const acc = { account: account._id };
  const n = (filter, windowMs) =>
    TelegramActivity.countDocuments({ ...acc, ...filter, createdAt: { $gte: since(now, windowMs) } });
  const [
    messagesHour,
    messagesDay,
    dmPeople,
    dmLinksDay,
    chatHour,
    chatDay,
    chatLinksDay,
    joinsDay,
    joinsWeek,
    lastJoin,
  ] = await Promise.all([
    n({ kind: { $in: ["dm", "chat"] } }, HOUR),
    n({ kind: { $in: ["dm", "chat"] } }, DAY),
    TelegramActivity.distinct("chatId", { ...acc, kind: "dm", createdAt: { $gte: since(now, DAY) } }),
    n({ kind: "dm", hasLink: true }, DAY),
    n({ kind: "chat" }, HOUR),
    n({ kind: "chat" }, DAY),
    n({ kind: "chat", hasLink: true }, DAY),
    n({ kind: "join" }, DAY),
    n({ kind: "join" }, WEEK),
    TelegramActivity.findOne({ ...acc, kind: "join" }).sort({ createdAt: -1 }).select("createdAt"),
  ]);
  return {
    quotas,
    warmingUp,
    warmupUntil,
    used: {
      messagesPerHour: messagesHour,
      messagesPerDay: messagesDay,
      dmChatsPerDay: dmPeople.length,
      dmLinksPerDay: dmLinksDay,
      chatMessagesPerHour: chatHour,
      chatMessagesPerDay: chatDay,
      chatLinksPerDay: chatLinksDay,
      joinsPerDay: joinsDay,
      joinsPerWeek: joinsWeek,
    },
    lastJoinAt: lastJoin?.createdAt || null,
    state: {
      floodWaitUntil: account.floodWaitUntil && account.floodWaitUntil > now ? account.floodWaitUntil : null,
      spamBlockedUntil:
        account.spamBlockedUntil && account.spamBlockedUntil > now ? account.spamBlockedUntil : null,
      spamBlockReason: account.spamBlockReason || "",
      frozenAt: account.frozenAt || null,
    },
  };
}

module.exports = {
  LimitError,
  hasLink,
  defaults,
  effectiveLimits,
  joinedAt,
  check,
  record,
  handleError,
  guard,
  usage,
};
