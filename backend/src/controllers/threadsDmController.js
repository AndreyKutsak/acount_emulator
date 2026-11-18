const mongoose = require("mongoose");
const SocialAccount = require("../models/SocialAccount");
const ThreadsDmRule = require("../models/ThreadsDmRule");
const ThreadsDmLog = require("../models/ThreadsDmLog");
const matcher = require("../services/autoReplyMatcher");
const orchestrator = require("../services/androidOrchestrator");
const { channelFilter } = require("../services/threadsDm");
const { applyRule, badRequest } = require("../services/autoReplyRuleInput");

// Автовідповіді Threads на особисті (channel=dm, за замовчуванням) і на коментарі
// під нашими постами (channel=comments). Канал - у ?channel= або в тілі запиту.

function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      if (err.name === "ValidationError" || err.name === "CastError") {
        return res.status(400).json({ message: err.message });
      }
      next(err);
    }
  };
}

const channelOf = (req) => ((req.query.channel || req.body?.channel) === "comments" ? "comments" : "dm");
const SETTINGS_KEY = { dm: "dmAutoReply", comments: "commentAutoReply" };

const accountFilter = (accountId) =>
  accountId ? { $or: [{ accounts: { $size: 0 } }, { accounts: accountId }] } : {};

// ---------- правила ----------

exports.listRules = handle(async (req, res) => {
  res.json(
    await ThreadsDmRule.find({ ...channelFilter(channelOf(req)), ...accountFilter(req.query.accountId) }).sort({
      priority: -1,
      createdAt: 1,
    }),
  );
});

exports.createRule = handle(async (req, res) => {
  const rule = new ThreadsDmRule({ channel: channelOf(req) });
  applyRule(rule, req.body);
  await rule.save();
  res.status(201).json(rule);
});

exports.updateRule = handle(async (req, res) => {
  const rule = await ThreadsDmRule.findById(req.params.ruleId);
  if (!rule) return res.status(404).json({ message: "Rule not found" });
  applyRule(rule, req.body);
  await rule.save();
  res.json(rule);
});

exports.deleteRule = handle(async (req, res) => {
  const rule = await ThreadsDmRule.findByIdAndDelete(req.params.ruleId);
  if (!rule) return res.status(404).json({ message: "Rule not found" });
  res.json({ message: "Rule deleted" });
});

// Як буде класифіковано текст і що відповість. Нічого не надсилає.
exports.testRules = handle(async (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) throw badRequest("text is required");
  const rules = await ThreadsDmRule.find({
    enabled: true,
    ...channelFilter(channelOf(req)),
    ...accountFilter(req.body?.accountId),
  }).sort({ priority: -1, createdAt: 1 });
  const { category, candidates, match } = matcher.classify(rules, text);
  res.json({
    category,
    candidates: candidates.map((c) => ({
      ruleId: c.rule._id,
      ruleName: c.rule.name,
      category: c.category,
      priority: c.rule.priority || 0,
      matchedKeywords: c.matchedKeywords,
    })),
    match: match && {
      ruleId: match.rule._id,
      ruleName: match.rule.name,
      category: match.category,
      action: match.rule.action || "reply",
      fallback: match.fallback,
      matchedKeywords: match.matchedKeywords,
      reply: match.rule.action === "ignore" ? [] : matcher.renderReply(match.rule),
    },
  });
});

// ---------- налаштування акаунта ----------

const LIMITS = {
  dm: { maxPerSession: [0, 50], maxPerDay: [0, 500] },
  comments: { maxPerSession: [0, 50], maxPerDay: [0, 500], maxAgeHours: [1, 168] },
};
const FLAGS = { dm: ["enabled", "includeRequests"], comments: ["enabled", "skipAnswered"] };

async function threadsAccount(id) {
  const account = await SocialAccount.findById(id);
  if (!account || account.platform !== "threads") {
    throw Object.assign(new Error("Threads account not found"), { status: 404 });
  }
  return account;
}

function describe(account, channel = "dm") {
  const s = account.toObject()[SETTINGS_KEY[channel]] || {};
  return {
    accountId: account._id,
    channel,
    hasPhone: orchestrator.hasPhone(account),
    androidPosting: process.env.ANDROID_THREADS_POSTING === "true",
    settings: {
      enabled: Boolean(s.enabled),
      maxPerSession: s.maxPerSession ?? 5,
      maxPerDay: s.maxPerDay ?? 30,
      ...(channel === "comments"
        ? { maxAgeHours: s.maxAgeHours ?? 24, skipAnswered: s.skipAnswered !== false }
        : { includeRequests: s.includeRequests !== false }),
    },
    lastRunAt: s.lastRunAt || null,
    lastError: s.lastError || "",
  };
}

exports.getSettings = handle(async (req, res) => {
  res.json(describe(await threadsAccount(req.params.id), channelOf(req)));
});

exports.updateSettings = handle(async (req, res) => {
  const account = await threadsAccount(req.params.id);
  const channel = channelOf(req);
  const prefix = SETTINGS_KEY[channel];
  const body = req.body || {};
  for (const [key, [min, max]] of Object.entries(LIMITS[channel])) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw badRequest(`${key} must be a whole number from ${min} to ${max}`);
    }
    account.set(`${prefix}.${key}`, value);
  }
  for (const key of FLAGS[channel]) {
    if (body[key] !== undefined) account.set(`${prefix}.${key}`, Boolean(body[key]));
  }
  if (account.get(`${prefix}.enabled`) && !orchestrator.hasPhone(account)) {
    throw Object.assign(new Error("Прив'яжіть до акаунта телефон: відповіді надсилаються із застосунку Threads"), {
      status: 409,
    });
  }
  await account.save();
  res.json(describe(account, channel));
});

// Підняти телефон і перевірити особисті чи коментарі зараз (поза публікацією).
exports.runNow = handle(async (req, res) => {
  const account = await threadsAccount(req.params.id);
  const channel = channelOf(req);
  if (!account.get(`${SETTINGS_KEY[channel]}.enabled`)) {
    throw Object.assign(new Error("Спершу увімкніть автовідповіді для акаунта"), { status: 409 });
  }
  const type = channel === "comments" ? "threadsComments" : "threadsDm";
  const run = await orchestrator.runForAccount(account, { type }, { stopAfter: true });
  res.json({ ...describe(account, channel), result: run.result });
});

// ---------- журнал і статистика ----------

exports.logs = handle(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const filter = { account: req.params.id, ...channelFilter(channelOf(req)) };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.category !== undefined) {
    const category = String(req.query.category);
    filter.category = category ? category : { $in: ["", null] };
  }
  res.json(await ThreadsDmLog.find(filter).sort({ createdAt: -1 }).limit(limit));
});

exports.stats = handle(async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await ThreadsDmLog.aggregate([
    {
      $match: {
        account: new mongoose.Types.ObjectId(String(req.params.id)),
        ...channelFilter(channelOf(req)),
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: { category: "$category", status: "$status" },
        count: { $sum: 1 },
        people: { $addToSet: "$peerId" },
        lastAt: { $max: "$createdAt" },
      },
    },
  ]);
  const byCategory = new Map();
  for (const row of rows) {
    const name = row._id.category || "";
    let entry = byCategory.get(name);
    if (!entry) {
      entry = { category: name, total: 0, statuses: {}, people: new Set(), lastAt: null };
      byCategory.set(name, entry);
    }
    entry.total += row.count;
    entry.statuses[row._id.status] = (entry.statuses[row._id.status] || 0) + row.count;
    for (const peer of row.people) entry.people.add(peer);
    if (!entry.lastAt || row.lastAt > entry.lastAt) entry.lastAt = row.lastAt;
  }
  const categories = [...byCategory.values()]
    .map((e) => ({ ...e, people: e.people.size }))
    .sort((a, b) => b.total - a.total);
  res.json({ days, total: categories.reduce((sum, c) => sum + c.total, 0), categories });
});
