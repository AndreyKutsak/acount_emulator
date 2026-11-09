const TelegramAccount = require("../models/TelegramAccount");
const limits = require("../services/telegramLimits");

const FLAGS = ["enabled"];

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

async function loadAccount(req, res) {
  const account = await TelegramAccount.findById(req.params.id);
  if (!account) res.status(404).json({ message: "Account not found" });
  return account;
}

async function describe(account) {
  return {
    accountId: account._id,
    limits: account.toObject().limits,
    defaults: limits.defaults(),
    ...(await limits.usage(account)),
  };
}

exports.getLimits = handle(async (req, res) => {
  const account = await loadAccount(req, res);
  if (!account) return;
  res.json(await describe(account));
});

// Body: any of the TelegramAccount.limits fields; `reset: true` restores defaults.
exports.updateLimits = handle(async (req, res) => {
  const account = await loadAccount(req, res);
  if (!account) return;
  const body = req.body || {};
  const next = body.reset ? limits.defaults() : { ...account.toObject().limits };
  for (const [name, value] of Object.entries(body)) {
    if (name === "reset") continue;
    const path = TelegramAccount.schema.paths[`limits.${name}`];
    if (!path) throw badRequest(`Unknown limit: ${name}`);
    if (FLAGS.includes(name)) {
      next[name] = Boolean(value);
      continue;
    }
    const number = Number(value);
    const min = path.options.min ?? 0;
    const max = path.options.max ?? Infinity;
    if (!Number.isFinite(number) || number < min || number > max) {
      throw badRequest(`${name} must be a number from ${min} to ${max}`);
    }
    next[name] = Math.round(number);
  }
  account.limits = next;
  await account.save();
  res.json(await describe(account));
});

// Body: { what: "flood" | "spam" | "frozen" } — clears a pause recorded from a
// Telegram answer, e.g. after @SpamBot says the account is free again.
exports.clearBlock = handle(async (req, res) => {
  const account = await loadAccount(req, res);
  if (!account) return;
  const what = String(req.body?.what || "");
  if (what === "flood") account.floodWaitUntil = null;
  else if (what === "spam") {
    account.spamBlockedUntil = null;
    account.spamBlockReason = "";
  } else if (what === "frozen") account.frozenAt = null;
  else throw badRequest('what must be "flood", "spam" or "frozen"');
  await account.save();
  res.json(await describe(account));
});
