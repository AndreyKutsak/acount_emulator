const mongoose = require("mongoose");
const TelegramAccount = require("../models/TelegramAccount");
const TelegramAutoReplyRule = require("../models/TelegramAutoReplyRule");
const TelegramAutoReplyLog = require("../models/TelegramAutoReplyLog");
const autoReply = require("../services/telegramAutoReply");
const matcher = require("../services/autoReplyMatcher");

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

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

function cleanList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split("\n");
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}

// ---------- rules ----------

function applyRule(rule, body = {}) {
  if (body.name !== undefined) rule.name = String(body.name).trim();
  if (body.category !== undefined) rule.category = String(body.category || "").trim();
  if (body.action !== undefined) rule.action = body.action === "ignore" ? "ignore" : "reply";
  if (body.excludeKeywords !== undefined) rule.excludeKeywords = cleanList(body.excludeKeywords);
  if (body.accounts !== undefined) rule.accounts = cleanList(body.accounts);
  if (body.matchType !== undefined) rule.matchType = body.matchType;
  if (body.matchMode !== undefined) rule.matchMode = body.matchMode;
  if (body.keywords !== undefined) rule.keywords = cleanList(body.keywords);
  if (body.isFallback !== undefined) rule.isFallback = Boolean(body.isFallback);
  if (body.replies !== undefined) {
    // Replies may span several lines, so they are never split on new lines here.
    rule.replies = (Array.isArray(body.replies) ? body.replies : [body.replies])
      .map((r) => String(r || "").trim())
      .filter(Boolean);
  }
  if (body.priority !== undefined) {
    const priority = Number(body.priority);
    if (!Number.isFinite(priority)) throw badRequest("priority must be a number");
    rule.priority = priority;
  }
  if (body.oncePerUser !== undefined) rule.oncePerUser = Boolean(body.oncePerUser);
  if (body.enabled !== undefined) rule.enabled = Boolean(body.enabled);

  if (!rule.name) throw badRequest("name is required");
  if (!rule.isFallback && rule.keywords.length === 0) {
    throw badRequest("Add at least one keyword, or mark the rule as the fallback reply");
  }
  if (rule.action !== "ignore" && (!rule.replies || rule.replies.length === 0)) {
    throw badRequest("Add at least one reply text, or choose to classify without replying");
  }
  try {
    matcher.validateRule(rule);
  } catch (err) {
    throw badRequest(err.message);
  }
}

exports.listRules = handle(async (req, res) => {
  const filter = {};
  if (req.query.accountId) {
    filter.$or = [{ accounts: { $size: 0 } }, { accounts: req.query.accountId }];
  }
  res.json(await TelegramAutoReplyRule.find(filter).sort({ priority: -1, createdAt: 1 }));
});

exports.createRule = handle(async (req, res) => {
  const rule = new TelegramAutoReplyRule();
  applyRule(rule, req.body);
  await rule.save();
  res.status(201).json(rule);
});

exports.updateRule = handle(async (req, res) => {
  const rule = await TelegramAutoReplyRule.findById(req.params.ruleId);
  if (!rule) return res.status(404).json({ message: "Rule not found" });
  applyRule(rule, req.body);
  await rule.save();
  res.json(rule);
});

exports.deleteRule = handle(async (req, res) => {
  const rule = await TelegramAutoReplyRule.findByIdAndDelete(req.params.ruleId);
  if (!rule) return res.status(404).json({ message: "Rule not found" });
  res.json({ message: "Rule deleted" });
});

// How `text` is classified (for `accountId`'s rules, or all rules): its category,
// every category that matched, and the rule that would answer with a sample of
// the reply. Nothing is sent.
exports.testRules = handle(async (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) throw badRequest("text is required");
  const filter = { enabled: true };
  if (req.body?.accountId) {
    filter.$or = [{ accounts: { $size: 0 } }, { accounts: req.body.accountId }];
  }
  const rules = await TelegramAutoReplyRule.find(filter).sort({ priority: -1, createdAt: 1 });
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
      reply:
        match.rule.action === "ignore"
          ? []
          : matcher.renderReply(match.rule, { firstName: req.body?.firstName || "" }),
    },
  });
});

// ---------- per-account settings ----------

const SETTINGS_LIMITS = {
  readDelayMinSec: [0, 3600],
  readDelayMaxSec: [0, 3600],
  thinkDelayMinSec: [0, 600],
  thinkDelayMaxSec: [0, 600],
  typingCharsPerSec: [1, 50],
  typingMinSec: [0, 300],
  typingMaxSec: [0, 300],
  cooldownMinutes: [0, 1440],
  maxRepliesPerUserPerDay: [1, 1000],
  catchUpHours: [0, 168],
};
const SETTINGS_FLAGS = ["enabled", "replyToBots", "onlyNonContacts", "markReadWithoutMatch"];

function applySettings(account, body = {}) {
  const next = { ...account.toObject().autoReply };
  for (const [key, [min, max]] of Object.entries(SETTINGS_LIMITS)) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw badRequest(`${key} must be a number from ${min} to ${max}`);
    }
    next[key] = value;
  }
  for (const key of SETTINGS_FLAGS) {
    if (body[key] !== undefined) next[key] = Boolean(body[key]);
  }
  for (const [lo, hi] of [
    ["readDelayMinSec", "readDelayMaxSec"],
    ["thinkDelayMinSec", "thinkDelayMaxSec"],
    ["typingMinSec", "typingMaxSec"],
  ]) {
    if (next[lo] > next[hi]) throw badRequest(`${lo} cannot exceed ${hi}`);
  }
  account.autoReply = next;
}

async function describe(account) {
  return {
    accountId: account._id,
    authStatus: account.authStatus,
    settings: account.toObject().autoReply,
    status: autoReply.getStatus(account._id),
  };
}

exports.getSettings = handle(async (req, res) => {
  const account = await TelegramAccount.findById(req.params.id);
  if (!account) return res.status(404).json({ message: "Account not found" });
  res.json(await describe(account));
});

exports.updateSettings = handle(async (req, res) => {
  const account = await TelegramAccount.findById(req.params.id);
  if (!account) return res.status(404).json({ message: "Account not found" });
  applySettings(account, req.body || {});
  if (account.autoReply.enabled && account.authStatus !== "authorized") {
    throw Object.assign(new Error("Log the account in to Telegram first"), { status: 409 });
  }
  await account.save();
  // Start or stop listening right away instead of on the next reconcile.
  await autoReply.refresh();
  res.json(await describe(account));
});

exports.logs = handle(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const filter = { account: req.params.id };
  if (req.query.status) filter.status = String(req.query.status);
  // "" = messages without a category (older log rows have no field at all).
  if (req.query.category !== undefined) {
    const category = String(req.query.category);
    filter.category = category ? category : { $in: ["", null] };
  }
  res.json(await TelegramAutoReplyLog.find(filter).sort({ createdAt: -1 }).limit(limit));
});

// How the account's private messages were classified over the last `days` days:
// per category, how many batches came in and what happened to them.
exports.stats = handle(async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await TelegramAutoReplyLog.aggregate([
    {
      $match: {
        account: new mongoose.Types.ObjectId(String(req.params.id)),
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
  res.json({
    days,
    total: categories.reduce((sum, c) => sum + c.total, 0),
    categories,
  });
});

exports.status = (req, res) => {
  res.json(autoReply.getStatus());
};
