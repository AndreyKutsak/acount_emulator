// Перевірка й нормалізація полів правила автовідповіді з тіла запиту. Спільна для
// правил Telegram (TelegramAutoReplyRule) і особистих Threads (ThreadsDmRule).
const matcher = require("./autoReplyMatcher");

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function cleanList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split("\n");
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}

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

module.exports = { applyRule, badRequest, cleanList };
