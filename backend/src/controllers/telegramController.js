const TelegramAccount = require("../models/TelegramAccount");
const { encrypt } = require("../services/cryptoService");
const telegramService = require("../services/telegramService");
const telegramAuth = require("../services/telegramAuth");
const { authLog, readAuthLog, describeError } = require("../services/telegramAuthLog");

const MAX_PAGE = 100;

// Plain-language hints for the Telegram error codes a user is most likely to hit.
const ERROR_HINTS = {
  API_ID_INVALID: "the api_id/api_hash pair is wrong",
  PHONE_NUMBER_INVALID: "the phone number is not valid",
  PHONE_NUMBER_BANNED: "this phone number is banned by Telegram",
  PHONE_CODE_INVALID: "the login code is wrong",
  PHONE_CODE_EXPIRED: "the login code has expired — request a new one",
  PHONE_CODE_EMPTY: "enter the login code",
  PHONE_CODE_HASH_EMPTY: "request a login code first",
  PHONE_NUMBER_FLOOD: "too many login attempts for this number — try again later",
  PHONE_NUMBER_UNOCCUPIED: "this phone number has no Telegram account",
  PHONE_PASSWORD_FLOOD: "too many password attempts — try again later",
  SEND_CODE_UNAVAILABLE:
    "Telegram has no other way to send the code — wait for it or start over",
  PASSWORD_HASH_INVALID: "the two-step verification password is wrong",
  PASSWORD_RECOVERY_NA: "no recovery email is set for this account",
  PASSWORD_RECOVERY_EXPIRED: "the recovery code has expired — request a new one",
  CODE_INVALID: "the code from the email is wrong",
  EMAIL_INVALID: "this email address cannot be used",
  EMAIL_NOT_ALLOWED: "Telegram does not accept this email address",
  EMAIL_VERIFY_EXPIRED: "the email code has expired — send it again",
  EMAIL_CODE_INVALID: "the code from the email is wrong",
  AUTH_TOKEN_EXPIRED: "the QR code has expired — a new one will be shown",
  AUTH_TOKEN_INVALID: "the QR code is no longer valid — start again",
  AUTH_TOKEN_ALREADY_ACCEPTED: "the QR code was already used",
  SESSION_PASSWORD_NEEDED: "the two-step verification password is required",
  MSG_ID_INVALID: "this post has no comment thread",
  CHAT_ADMIN_REQUIRED: "only admins can see this chat's history",
  PEER_ID_INVALID: "the chat is unknown to this account",
  CHAT_GUEST_SEND_FORBIDDEN:
    "join the channel's discussion group before commenting",
  CHAT_WRITE_FORBIDDEN:
    "this account is not allowed to write in the discussion group",
  USER_BANNED_IN_CHANNEL: "this account is restricted from writing in this chat",
  CHANNEL_PRIVATE: "the account has no access to this chat",
  PEER_FLOOD: "Telegram limited this account for spam — sending is paused for 24h, check @SpamBot",
  CHANNELS_TOO_MUCH: "the account is already in the maximum number of channels and groups",
  INVITE_HASH_EXPIRED: "the invite link has expired",
  INVITE_HASH_INVALID: "the invite link is not valid",
  USERNAME_NOT_OCCUPIED: "no chat with this username",
  USERNAME_INVALID: "the username is not valid",
  FROZEN_METHOD_INVALID: "Telegram has frozen this account",
  AUTH_KEY_UNREGISTERED: "the session is no longer valid — log in again",
  SESSION_REVOKED: "the session was terminated — log in again",
};

function toSafeAccount(account) {
  const obj = account.toObject();
  // Session = full access to the Telegram account; API hash and code hash are
  // secrets too. None of them ever leave the backend.
  delete obj.sessionEncrypted;
  delete obj.apiHashEncrypted;
  delete obj.phoneCodeHash;
  return obj;
}

function sendTelegramError(res, action, err) {
  // Our own errors with an HTTP status (validation, wrong login step, duplicates).
  if (err.status) {
    console.warn(`[telegram] ${action} failed (${err.status}): ${err.message}`);
    return res.status(err.status).json({ message: `${action} failed: ${err.message}` });
  }
  const code = err.errorMessage;
  // A bug in our code (TypeError etc.), not an answer from Telegram: log the stack
  // so it can be found, and do not present it as a Telegram error.
  if (!code && (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError)) {
    console.error(`[telegram] ${action} failed with an internal error:`, err);
    return res.status(500).json({ message: `${action} failed: internal error (${err.message})` });
  }
  console.warn(`[telegram] ${action} failed: ${code || err.message}`);
  // Flood / slow-mode waits: Telegram tells us exactly how long to back off.
  if (err.seconds) {
    return res.status(429).json({
      message: `${action} failed: Telegram asks to wait ${err.seconds}s before retrying`,
      retryAfter: err.seconds,
    });
  }
  const detail = ERROR_HINTS[code]
    ? `${ERROR_HINTS[code]} (${code})`
    : code || err.message;
  res.status(502).json({ message: `${action} failed: ${detail}` });
}

// Wraps an endpoint that talks to Telegram on behalf of one account: loads the
// account, optionally requires it to be logged in, and turns Telegram failures
// into a 429/502 instead of a generic 500.
function telegramAction(action, handler, { requireLogin = true } = {}) {
  return async (req, res, next) => {
    let account;
    try {
      account = await TelegramAccount.findById(req.params.id);
    } catch (err) {
      return next(err);
    }
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (requireLogin && account.authStatus !== "authorized") {
      return res
        .status(409)
        .json({ message: "Account is not logged in to Telegram" });
    }
    try {
      await handler(account, req, res);
    } catch (err) {
      sendTelegramError(res, action, err);
    }
  };
}

exports.telegramAction = telegramAction;
exports.sendTelegramError = sendTelegramError;

function normalizePhone(phone) {
  return telegramAuth.normalizePhone(phone);
}

function parseLimit(value, fallback) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(limit, MAX_PAGE);
}

// Paging cursor from the previous page's nextOffsetId; 0 means "start from the newest".
function parseOffsetId(value) {
  const offsetId = Number.parseInt(value, 10);
  return Number.isInteger(offsetId) && offsetId > 0 ? offsetId : 0;
}

function parsePostId(value) {
  const postId = Number(value);
  return Number.isInteger(postId) && postId > 0 ? postId : null;
}

exports.getAccounts = async (req, res, next) => {
  try {
    const accounts = await TelegramAccount.find().sort({ createdAt: -1 });
    res.json(accounts.map(toSafeAccount));
  } catch (err) {
    next(err);
  }
};

exports.createAccount = async (req, res, next) => {
  try {
    const { displayName, apiId, apiHash, notes } = req.body;
    const loginMethod = ["phone", "qr", "session"].includes(req.body.loginMethod)
      ? req.body.loginMethod
      : "phone";
    const phone = normalizePhone(req.body.phone);
    // QR and session logins learn the number from Telegram after logging in.
    if (loginMethod === "phone" && !phone) {
      return res.status(400).json({ message: "phone is required" });
    }
    if (phone && !/^\+\d{7,15}$/.test(phone)) {
      return res.status(400).json({ message: "phone must look like +380XXXXXXXXX" });
    }
    if (Boolean(apiId) !== Boolean(apiHash)) {
      return res
        .status(400)
        .json({ message: "apiId and apiHash must be set together" });
    }
    const account = new TelegramAccount({
      displayName,
      phone,
      loginMethod,
      apiId: apiId ? Number(apiId) : null,
      apiHashEncrypted: apiHash ? encrypt(String(apiHash).trim()) : "",
      notes,
    });
    // No pair given: the one from .env is stored on the account.
    try {
      telegramService.pinCredentials(account);
    } catch (err) {
      return res.status(err.status || 500).json({ message: err.message });
    }
    await account.save();
    res.status(201).json(toSafeAccount(account));
  } catch (err) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: "An account with this phone already exists" });
    }
    next(err);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const account = await TelegramAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });
    await telegramService.logOut(account);
    await account.deleteOne();
    res.json({ message: "Account deleted" });
  } catch (err) {
    next(err);
  }
};

// ---------- login ----------

// Every login step answers { next, account[, qr] }; `next` tells the dialog what
// to show: code | email_setup | email_code | password | recovery_code | qr | done.
// Login steps of one account run one after another. Two at once (a double click, a
// QR poll racing a code request) would tear down each other's connection and
// collide when saving the account.
const loginLocks = new Map();

function withLoginLock(accountId, fn) {
  const key = String(accountId);
  const previous = loginLocks.get(key) || Promise.resolve();
  const current = previous.then(fn, fn);
  const tail = current.catch(() => {});
  loginLocks.set(key, tail);
  tail.then(() => {
    if (loginLocks.get(key) === tail) loginLocks.delete(key);
  });
  return current;
}

function loginStep(action, run) {
  // The account is loaded inside the lock, so every step sees the previous one's result.
  const handler = loginStepHandler(action, run);
  return (req, res, next) => withLoginLock(req.params.id, () => handler(req, res, next));
}

function loginStepHandler(action, run) {
  return telegramAction(
    action,
    async (account, req, res) => {
      let next;
      try {
        ({ next } = await run(account, req.body || {}));
      } catch (err) {
        // Login failures are logged so "the code doesn't work" can be diagnosed.
        authLog(account._id, "step.failed", { step: action, status: account.authStatus, ...describeError(err) });
        throw err;
      }
      authLog(account._id, "step.done", { step: action, next, status: account.authStatus });
      const body = { next, account: toSafeAccount(account) };
      if (next === "qr") body.qr = await telegramAuth.qrImage(account);
      res.json(body);
    },
    { requireLogin: false },
  );
}

exports.sendCode = loginStep("Sending the login code", (account) =>
  telegramAuth.sendCode(account),
);
exports.resendCode = loginStep("Sending the code again", (account) =>
  telegramAuth.resendCode(account),
);
// { code }, or { password } at the password step.
exports.signIn = loginStep("Login", (account, body) =>
  ["password_needed", "password_recovery"].includes(account.authStatus)
    ? telegramAuth.checkPassword(account, body)
    : telegramAuth.signIn(account, body),
);
exports.checkPassword = loginStep("Checking the password", (account, body) =>
  telegramAuth.checkPassword(account, body),
);
exports.sendLoginEmail = loginStep("Sending the email code", (account, body) =>
  telegramAuth.sendLoginEmail(account, body),
);
exports.verifyLoginEmail = loginStep("Verifying the email", (account, body) =>
  telegramAuth.verifyLoginEmail(account, body),
);
exports.requestPasswordRecovery = loginStep("Password recovery", (account) =>
  telegramAuth.requestPasswordRecovery(account),
);
exports.confirmPasswordRecovery = loginStep("Password recovery", (account, body) =>
  telegramAuth.confirmPasswordRecovery(account, body),
);
exports.startQrLogin = loginStep("QR login", (account) =>
  telegramAuth.startQrLogin(account),
);
exports.pollQrLogin = loginStep("QR login", (account) =>
  telegramAuth.pollQrLogin(account),
);
exports.importSession = loginStep("Importing the session", (account, body) =>
  telegramAuth.importSession(account, body),
);
exports.cancelLogin = loginStep("Cancelling the login", (account) =>
  telegramAuth.cancelLogin(account),
);

// Login diagnostics for the account (see services/telegramAuthLog.js).
exports.authLog = (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
  res.json(readAuthLog(req.params.id, limit));
};

exports.logOut = async (req, res, next) => {
  try {
    const account = await TelegramAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });
    await telegramService.logOut(account);
    account.sessionEncrypted = "";
    telegramAuth.clearLogin(account);
    account.authStatus = "unknown";
    account.authError = "";
    await account.save();
    res.json(toSafeAccount(account));
  } catch (err) {
    next(err);
  }
};

exports.refreshProfile = telegramAction(
  "Loading account data",
  async (account, req, res) => {
    await telegramService.refreshProfile(account);
    res.json(toSafeAccount(account));
  },
);

exports.listChats = telegramAction("Loading chats", async (account, req, res) => {
  res.json(await telegramService.listChats(account));
});

exports.getChat = telegramAction("Loading the chat", async (account, req, res) => {
  res.json(await telegramService.getChat(account, req.params.chatId));
});

exports.listPosts = telegramAction("Loading posts", async (account, req, res) => {
  res.json(
    await telegramService.listPosts(account, req.params.chatId, {
      limit: parseLimit(req.query.limit, 20),
      offsetId: parseOffsetId(req.query.offsetId),
    }),
  );
});

exports.listComments = telegramAction(
  "Loading comments",
  async (account, req, res) => {
    const postId = parsePostId(req.params.postId);
    if (!postId) {
      return res.status(400).json({ message: "postId must be a number" });
    }
    res.json(
      await telegramService.listComments(account, req.params.chatId, postId, {
        limit: parseLimit(req.query.limit, 30),
        offsetId: parseOffsetId(req.query.offsetId),
      }),
    );
  },
);

exports.sendComment = telegramAction(
  "Sending the comment",
  async (account, req, res) => {
    const postId = parsePostId(req.params.postId);
    if (!postId) {
      return res.status(400).json({ message: "postId must be a number" });
    }
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ message: "text is required" });
    const comment = await telegramService.sendComment(
      account,
      req.params.chatId,
      postId,
      text,
      { source: "manual" },
    );
    res.status(201).json(comment);
  },
);

exports.joinChat = telegramAction(
  "Joining the chat",
  async (account, req, res) => {
    const result = await telegramService.joinChat(account, req.body?.chat, {
      source: "manual",
    });
    res.status(result.status === "already" ? 200 : 201).json(result);
  },
);
