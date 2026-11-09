// Automatic answers to private Telegram messages, the way a person would answer:
//
//   message arrives -> wait (read delay) -> classify it by keywords into a
//   category (TelegramAutoReplyRule) -> mark as read, go online -> short pause ->
//   "typing..." for as long as the text would take to type -> send the prepared
//   reply of that category (or nothing, for categories such as spam).
//
// Every reply goes through the account's activity limits (telegramLimits.js),
// so a busy account never sends more than its quotas allow.
//
// Messages a person sends in quick succession are handled as one batch: everything
// that arrives before the account "reads" the chat gets one answer.
//
// Each account with autoReply.enabled gets a worker that keeps its MTProto
// connection open and listens for NewMessage events. GramJS does not catch up on
// updates missed while offline, so the worker also sweeps unread private chats on
// start and every few minutes.

const { Api } = require("telegram");
const { NewMessage } = require("telegram/events");
const utils = require("telegram/Utils");
const TelegramAccount = require("../models/TelegramAccount");
const TelegramAutoReplyRule = require("../models/TelegramAutoReplyRule");
const TelegramAutoReplyLog = require("../models/TelegramAutoReplyLog");
const telegramService = require("./telegramService");
const matcher = require("./autoReplyMatcher");
const limits = require("./telegramLimits");

const ENABLED =
  process.env.SCHEDULER_ENABLED !== "false" &&
  process.env.TELEGRAM_AUTOREPLY_ENABLED !== "false";
// How often workers are started/stopped to follow the accounts' settings.
const RECONCILE_MS = 30 * 1000;
// How often unread private chats are re-checked in case an update was missed.
const SWEEP_MS =
  (Number(process.env.TELEGRAM_AUTOREPLY_SWEEP_SEC) || 180) * 1000;
const SWEEP_DIALOGS = 50;
const MAX_BATCH = 10;
// Telegram shows "typing..." for about 6 s per request; it is repeated until done.
const TYPING_REFRESH_MS = 4500;
// Telegram's own service account (login codes etc.) is never answered.
const SERVICE_USER_ID = "777000";

const workers = new Map(); // accountId -> Worker
let reconcileHandle = null;
let reconciling = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomBetween(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

function secondsToMs(min, max) {
  return Math.round(randomBetween(min, max) * 1000);
}

// How long "typing..." is shown for a text: its length at the configured speed,
// +/-20% so equal texts do not take exactly equal time, clamped to [min, max].
function typingDurationMs(text, settings) {
  const seconds =
    (text.length / Math.max(settings.typingCharsPerSec, 1)) * randomBetween(0.8, 1.2);
  const clamped = Math.min(
    Math.max(seconds, settings.typingMinSec),
    Math.max(settings.typingMaxSec, settings.typingMinSec),
  );
  return Math.round(clamped * 1000);
}

function displayName(user) {
  if (!user) return "";
  return (
    utils.getDisplayName(user) ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.title ||
    ""
  );
}

// A media message is described by its kind, so rules can classify voice notes,
// photos and stickers too ("[голосове]", "[фотографія]", ...). A caption follows
// it. ("фотографія", not "фото": the word "фото" is a keyword of its own.)
function describeMessage(m) {
  const text = m.message || "";
  if (!m.media) return text;
  // A link with a preview is just text.
  if (m.media.className === "MessageMediaWebPage" && text) return text;
  let kind = "медіа";
  if (m.voice) kind = "голосове";
  else if (m.videoNote) kind = "кружечок";
  else if (m.sticker) kind = "стікер";
  else if (m.gif) kind = "gif";
  else if (m.video) kind = "відео";
  else if (m.audio) kind = "аудіо";
  else if (m.photo) kind = "фотографія";
  else if (m.document) kind = "файл";
  else if (m.contact) kind = "контакт";
  else if (m.geo || m.venue) kind = "геолокація";
  return text ? `[${kind}] ${text}` : `[${kind}]`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

class Worker {
  constructor(accountId) {
    this.accountId = String(accountId);
    this.client = null;
    this.handler = null;
    this.event = new NewMessage({ incoming: true });
    // peerId -> { queue: Message[], timer, running, lastHandledId }
    this.peers = new Map();
    this.startedAt = new Date();
    this.lastEventAt = null;
    this.lastSweepAt = null;
    this.lastError = null;
    this.stopped = false;
  }

  async loadAccount() {
    return TelegramAccount.findById(this.accountId);
  }

  // Connects (or re-attaches after the client was replaced, e.g. on reconnect).
  async attach(account) {
    telegramService.pinClient(this.accountId, true);
    const client = await telegramService.getClient(account);
    if (client === this.client) return false;
    this.detach();
    this.handler = (event) =>
      this.onMessage(event).catch((err) => this.fail("event", err));
    client.addEventHandler(this.handler, this.event);
    this.client = client;
    // Any request on the connection makes Telegram start pushing updates to it.
    await telegramService.withClient(account, (c) => c.getMe());
    return true;
  }

  detach() {
    if (this.client && this.handler) {
      this.client.removeEventHandler(this.handler, this.event);
    }
    this.client = null;
    this.handler = null;
  }

  stop() {
    this.stopped = true;
    this.detach();
    for (const state of this.peers.values()) clearTimeout(state.timer);
    this.peers.clear();
    telegramService.pinClient(this.accountId, false);
  }

  fail(stage, err) {
    this.lastError = `${stage}: ${err.errorMessage || err.message}`;
    console.error(`[tg-autoreply] ${this.accountId} ${this.lastError}`);
  }

  async onMessage(event) {
    const message = event.message;
    if (!event.isPrivate || !message || message.out) return;
    if (message.className !== "Message") return;
    this.lastEventAt = new Date();
    this.enqueue(String(message.senderId), message);
  }

  // Queues a message for its sender. The first message of a batch starts the read
  // timer; later ones simply join the batch.
  enqueue(peerId, message, settings) {
    if (this.stopped || peerId === SERVICE_USER_ID) return;
    let state = this.peers.get(peerId);
    if (!state) {
      state = { queue: [], timer: null, running: false, scheduling: false, lastHandledId: 0 };
      this.peers.set(peerId, state);
    }
    if (
      message.id <= state.lastHandledId ||
      state.queue.some((m) => m.id === message.id)
    ) {
      return;
    }
    state.queue.push(message);
    if (!state.timer && !state.running && !state.scheduling) {
      this.scheduleRead(peerId, state, settings).catch((err) => this.fail("schedule", err));
    }
  }

  async scheduleRead(peerId, state, knownSettings) {
    if (state.timer || state.running || state.scheduling) return;
    // Set before the await, so messages arriving meanwhile do not start a second timer.
    state.scheduling = true;
    try {
      const settings = knownSettings || (await this.loadAccount())?.autoReply;
      if (!settings || this.stopped) return;
      const delay = secondsToMs(settings.readDelayMinSec, settings.readDelayMaxSec);
      state.timer = setTimeout(() => this.runBatch(peerId), delay);
    } finally {
      state.scheduling = false;
    }
  }

  async runBatch(peerId) {
    const state = this.peers.get(peerId);
    if (!state || this.stopped) return;
    state.timer = null;
    state.running = true;
    const batch = state.queue.splice(0).sort((a, b) => a.id - b.id).slice(-MAX_BATCH);
    try {
      if (batch.length) await this.handleBatch(peerId, batch);
    } catch (err) {
      this.fail("reply", err);
    } finally {
      state.running = false;
      if (batch.length) {
        state.lastHandledId = Math.max(state.lastHandledId, ...batch.map((m) => m.id));
      }
      // Messages that came in while answering form the next batch.
      if (state.queue.length && !this.stopped) {
        this.scheduleRead(peerId, state).catch((err) => this.fail("schedule", err));
      }
      else if (!state.queue.length) this.peers.delete(peerId);
    }
  }

  async handleBatch(peerId, batch) {
    const account = await this.loadAccount();
    if (!account || account.authStatus !== "authorized" || !account.autoReply?.enabled) {
      return;
    }
    const settings = account.autoReply;
    const last = batch[batch.length - 1];
    const incomingText = batch.map(describeMessage).filter(Boolean).join("\n");

    await telegramService.withClient(account, async (client) => {
      const sender = await last.getSender();
      const peer = await last.getInputChat();
      const log = {
        account: account._id,
        peerId,
        peerName: displayName(sender),
        peerUsername: sender?.username || "",
        incomingText,
        lastMessageId: last.id,
        receivedAt: new Date(last.date * 1000),
      };
      const skip = (reason) =>
        TelegramAutoReplyLog.create({ ...log, status: "skipped", reason });

      // People only: no bots (unless allowed), no deleted accounts, no Telegram
      // service chats, and optionally no contacts.
      if (!sender || sender.self || sender.deleted || sender.support) {
        return skip("Службовий або видалений акаунт");
      }
      if (sender.bot && !settings.replyToBots) return skip("Відправник бот");
      if (settings.onlyNonContacts && sender.contact) {
        return skip("Відправник є в контактах");
      }

      const rules = await TelegramAutoReplyRule.find({
        enabled: true,
        $or: [{ accounts: { $size: 0 } }, { accounts: account._id }],
      }).sort({ priority: -1, createdAt: 1 });
      const usedRules = new Set(
        (
          await TelegramAutoReplyLog.distinct("rule", {
            account: account._id,
            peerId,
            status: "replied",
          })
        ).map(String),
      );
      const { category, candidates, match } = matcher.classify(rules, incomingText, {
        skipRuleIds: usedRules,
      });
      log.category = category;
      log.categories = [...new Set(candidates.map((c) => c.category))];

      // 1. Read the chat.
      if (match || settings.markReadWithoutMatch) {
        await client.invoke(new Api.account.UpdateStatus({ offline: false })).catch(() => {});
        await client.markAsRead(peer, last);
        log.readAt = new Date();
      }
      if (!match) {
        return TelegramAutoReplyLog.create({
          ...log,
          status: "no_match",
          reason: "Жодне правило не підійшло",
        });
      }
      log.rule = match.rule._id;
      log.ruleName = match.rule.name;
      log.matchedKeywords = match.matchedKeywords;
      if (!log.category) log.category = match.category;

      // Categories such as spam or insults: classified and read, not answered.
      if (match.rule.action === "ignore") {
        await TelegramAutoReplyRule.updateOne(
          { _id: match.rule._id },
          { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
        );
        return TelegramAutoReplyLog.create({
          ...log,
          status: "ignored",
          reason: `Категорія «${log.category}» без відповіді`,
        });
      }

      // 2. Limits against loops with other auto-responders and spam.
      const lastReply = await TelegramAutoReplyLog.findOne({
        account: account._id,
        peerId,
        status: "replied",
      }).sort({ createdAt: -1 });
      if (
        lastReply &&
        settings.cooldownMinutes > 0 &&
        Date.now() - lastReply.createdAt.getTime() < settings.cooldownMinutes * 60 * 1000
      ) {
        return skip(`Пауза: цій людині вже відповідали менше ${settings.cooldownMinutes} хв тому`);
      }
      const today = await TelegramAutoReplyLog.countDocuments({
        account: account._id,
        peerId,
        status: "replied",
        createdAt: { $gte: startOfToday() },
      });
      if (today >= settings.maxRepliesPerUserPerDay) {
        return skip(`Денний ліміт відповідей цій людині (${settings.maxRepliesPerUserPerDay})`);
      }

      const parts = matcher.renderReply(match.rule, { firstName: sender.firstName || "" });
      if (parts.length === 0) return skip("У правила немає тексту відповіді");

      // 3. The account's activity limits (messages per hour/day, people per day,
      // links in private chats, Telegram's own flood pauses).
      const op = { kind: "dm", chatId: peerId, texts: parts };
      const blocked = await limits.check(account, op);
      if (blocked) return skip(`Ліміт активності: ${blocked.reason}`);

      // 4. Think, then type and send each part. Each sent part is counted.
      await sleep(secondsToMs(settings.thinkDelayMinSec, settings.thinkDelayMaxSec));
      try {
        for (let i = 0; i < parts.length; i += 1) {
          if (i > 0) await sleep(secondsToMs(1, 3));
          await this.type(client, peer, typingDurationMs(parts[i], settings));
          await client.sendMessage(peer, { message: parts[i], parseMode: false });
          await limits.record(account, { ...op, texts: [parts[i]] });
        }
      } catch (err) {
        const limitReason = await limits.handleError(account, err, op);
        return TelegramAutoReplyLog.create({
          ...log,
          replyText: parts.join("\n---\n"),
          status: "failed",
          reason: limitReason || err.errorMessage || err.message,
        });
      }

      await TelegramAutoReplyRule.updateOne(
        { _id: match.rule._id },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
      );
      await TelegramAutoReplyLog.create({
        ...log,
        replyText: parts.join("\n---\n"),
        repliedAt: new Date(),
        status: "replied",
      });
      // Go offline a little later, like closing the app.
      setTimeout(() => {
        client.invoke(new Api.account.UpdateStatus({ offline: true })).catch(() => {});
      }, secondsToMs(20, 60)).unref();
    });
  }

  async type(client, peer, durationMs) {
    const until = Date.now() + durationMs;
    while (Date.now() < until && !this.stopped) {
      await client
        .invoke(
          new Api.messages.SetTyping({ peer, action: new Api.SendMessageTypingAction() }),
        )
        .catch(() => {});
      await sleep(Math.min(TYPING_REFRESH_MS, Math.max(until - Date.now(), 0)));
    }
  }

  // Picks up private chats that have unread incoming messages younger than
  // catchUpHours — those that arrived while the worker was not listening.
  async sweep(account) {
    const hours = account.autoReply.catchUpHours;
    this.lastSweepAt = new Date();
    if (!hours) return;
    const notBefore = Date.now() - hours * 3600 * 1000;
    await telegramService.withClient(account, async (client) => {
      const dialogs = await client.getDialogs({ limit: SWEEP_DIALOGS });
      for (const dialog of dialogs) {
        if (!dialog.isUser || !dialog.unreadCount || dialog.message?.out) continue;
        if (dialog.date * 1000 < notBefore) continue;
        const peerId = String(dialog.entity?.id ?? "");
        if (!peerId || peerId === SERVICE_USER_ID) continue;
        const state = this.peers.get(peerId);
        if (state && (state.running || state.timer)) continue;
        const messages = await client.getMessages(dialog.inputEntity, {
          limit: Math.min(dialog.unreadCount, MAX_BATCH),
        });
        for (const message of messages.reverse()) {
          if (message.className !== "Message" || message.out) continue;
          if (message.date * 1000 < notBefore) continue;
          this.enqueue(peerId, message, account.autoReply);
        }
      }
    });
  }

  status() {
    return {
      accountId: this.accountId,
      connected: Boolean(this.client?.connected),
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      lastSweepAt: this.lastSweepAt,
      pendingChats: [...this.peers.values()].filter((s) => s.queue.length || s.running).length,
      lastError: this.lastError,
    };
  }
}

// Starts workers for accounts that have auto-replies on, stops the rest, and
// re-attaches workers whose connection was replaced.
async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    const accounts = await TelegramAccount.find({
      "autoReply.enabled": true,
      authStatus: "authorized",
    });
    const wanted = new Set(accounts.map((a) => String(a._id)));

    for (const [id, worker] of workers) {
      if (!wanted.has(id)) {
        worker.stop();
        workers.delete(id);
      }
    }

    for (const account of accounts) {
      const id = String(account._id);
      let worker = workers.get(id);
      if (!worker) {
        worker = new Worker(id);
        workers.set(id, worker);
      }
      try {
        const attachedNow = await worker.attach(account);
        if (attachedNow || !worker.lastSweepAt || Date.now() - worker.lastSweepAt >= SWEEP_MS) {
          await worker.sweep(account);
        }
        worker.lastError = null;
      } catch (err) {
        worker.fail("connect", err);
        worker.detach();
      }
    }
  } finally {
    reconciling = false;
  }
}

function start() {
  if (!ENABLED) {
    console.log("[tg-autoreply] disabled");
    return null;
  }
  if (reconcileHandle) return reconcileHandle;
  const run = () =>
    reconcile().catch((err) => console.error("[tg-autoreply] reconcile failed:", err.message));
  setTimeout(run, 4000);
  reconcileHandle = setInterval(run, RECONCILE_MS);
  console.log("[tg-autoreply] running");
  return reconcileHandle;
}

function stop() {
  clearInterval(reconcileHandle);
  reconcileHandle = null;
  for (const worker of workers.values()) worker.stop();
  workers.clear();
}

// Called after an account's settings change, so it takes effect immediately.
function refresh() {
  if (!ENABLED) return Promise.resolve();
  return reconcile().catch((err) =>
    console.error("[tg-autoreply] reconcile failed:", err.message),
  );
}

function getStatus(accountId) {
  const base = { enabled: ENABLED, sweepSec: SWEEP_MS / 1000 };
  if (accountId) {
    return { ...base, worker: workers.get(String(accountId))?.status() || null };
  }
  return { ...base, workers: [...workers.values()].map((w) => w.status()) };
}

module.exports = {
  start,
  stop,
  refresh,
  getStatus,
  // exported for tests
  _Worker: Worker,
  _typingDurationMs: typingDurationMs,
  _describeMessage: describeMessage,
};
