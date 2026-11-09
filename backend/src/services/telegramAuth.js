// Every way to log a user account in to Telegram over MTProto:
//
//   phone code   auth.sendCode -> code arrives in the Telegram app, by SMS, by a
//                phone call, to the login email or on Fragment -> auth.signIn.
//                "Send again" (auth.resendCode) switches to the next channel.
//   login email  newer accounts may first have to set up a login email
//                (account.sendVerifyEmailCode / verifyEmail); then the code flow.
//   QR code      auth.exportLoginToken -> tg://login?token=... scanned in the app
//                (Settings > Devices > Link Desktop Device).
//   session      import of an existing GramJS/Telethon string session or a
//                Pyrogram session string.
//
// Any of them may end in two-step verification: the cloud password is checked by
// SRP (it never leaves this process and is not stored); a forgotten password can
// be reset through the recovery email.
//
// The state between HTTP calls lives in the account document (status, phone code
// hash, non-secret details in `login`) and in its encrypted session, so a login
// survives a backend restart half-way.

const { Api } = require("telegram");
const { Raw } = require("telegram/events");
const { StringSession } = require("telegram/sessions");
const { computeCheck } = require("telegram/Password");
const { AuthKey } = require("telegram/crypto/AuthKey");
const QRCode = require("qrcode");
const TelegramAccount = require("../models/TelegramAccount");
const TelegramCodeRequest = require("../models/TelegramCodeRequest");
const { DEFAULT_TIMEZONE } = require("./zonedTime");
const tg = require("./telegramService");
const { encrypt } = require("./cryptoService");
const {
  authLog,
  maskPhone,
  describeSentCode,
  describeError,
} = require("./telegramAuthLog");

const dcOf = (client) => client?.session?.dcId ?? null;

const CODE_TYPES = {
  "auth.SentCodeTypeApp": "app",
  "auth.SentCodeTypeSms": "sms",
  "auth.SentCodeTypeSmsWord": "sms",
  "auth.SentCodeTypeSmsPhrase": "sms",
  "auth.SentCodeTypeFirebaseSms": "sms",
  "auth.SentCodeTypeCall": "call",
  "auth.SentCodeTypeFlashCall": "flash_call",
  "auth.SentCodeTypeMissedCall": "missed_call",
  "auth.SentCodeTypeEmailCode": "email",
  "auth.SentCodeTypeSetUpEmailRequired": "email_setup",
  "auth.SentCodeTypeFragmentSms": "fragment",
};

const NEXT_CODE_TYPES = {
  "auth.CodeTypeSms": "sms",
  "auth.CodeTypeCall": "call",
  "auth.CodeTypeFlashCall": "flash_call",
  "auth.CodeTypeMissedCall": "missed_call",
  "auth.CodeTypeFragmentSms": "fragment",
};

// Production data centres, needed to turn a Pyrogram session (which stores only
// the DC number) into a GramJS one (which stores the address).
const DC_ADDRESSES = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};

// accountId: Telegram pushed UpdateLoginToken, i.e. the QR code was scanned.
const qrScanned = new Set();
// Clients that already listen for UpdateLoginToken.
const qrListening = new WeakSet();

function authError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function expectStatus(account, statuses, message) {
  if (!statuses.includes(account.authStatus)) throw authError(message, 409);
}

// Explicit empty values: replacing a nested path with {} would drop its defaults.
const EMPTY_LOGIN = {
  codeType: "",
  nextCodeType: "",
  codeLength: null,
  codeSentAt: null,
  codeTimeout: null,
  emailPattern: "",
  fragmentUrl: "",
  passwordHint: "",
  hasRecovery: false,
  recoveryEmailPattern: "",
  qrUrl: "",
  qrExpiresAt: null,
};

function clearLogin(account) {
  account.phoneCodeHash = "";
  account.login = { ...EMPTY_LOGIN };
}

function saveSession(account, client) {
  account.sessionEncrypted = encrypt(client.session.save());
}

// Starts a login from a clean slate: the previous session (if any) is dropped.
async function freshClient(account) {
  await tg.dropClient(account._id);
  account.sessionEncrypted = "";
  clearLogin(account);
  account.authError = "";
  return tg.getClient(account);
}

// ---------- finishing ----------

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

// Session is valid: store it, load the profile, make sure the same Telegram account
// is not added twice.
async function finish(account, client) {
  saveSession(account, client);
  // Accounts created before credentials were stored per account get them now.
  tg.pinCredentials(account);
  clearLogin(account);
  await tg.refreshProfile(account); // sets authorized and saves

  const telegramId = account.profile.telegramId;
  const phone = normalizePhone(account.profile.phone) || account.phone;
  authLog(account._id, "login.success", {
    method: account.loginMethod,
    dc: dcOf(client),
    telegramId,
    username: account.profile.username || "",
    phone: maskPhone(phone),
  });
  const duplicate = await TelegramAccount.findOne({
    _id: { $ne: account._id },
    $or: [{ "profile.telegramId": telegramId }, ...(phone ? [{ phone }] : [])],
  });
  if (account.phone && phone && account.phone !== phone) {
    authLog(account._id, "login.other_account", {
      expectedPhone: maskPhone(account.phone),
      loggedInPhone: maskPhone(phone),
      method: account.loginMethod,
    });
  }
  if (duplicate) {
    authLog(account._id, "login.duplicate", { error: "already added", other: String(duplicate._id) });
    // Close the session just created so no orphaned login is left behind.
    await tg.logOut(account);
    account.sessionEncrypted = "";
    account.authStatus = "unknown";
    account.profile = {};
    await account.save();
    throw authError(
      `Цей Telegram-акаунт уже додано: "${duplicate.displayName || duplicate.phone}"`,
      409,
    );
  }
  account.phone = phone;
  await account.save();
  return { next: "done" };
}

async function requirePassword(account, client) {
  const password = await client.invoke(new Api.account.GetPassword());
  saveSession(account, client);
  account.authStatus = "password_needed";
  account.login.passwordHint = password.hint || "";
  account.login.hasRecovery = Boolean(password.hasRecovery);
  await account.save();
  authLog(account._id, "password.required", {
    hasHint: Boolean(password.hint),
    hasRecovery: Boolean(password.hasRecovery),
    dc: dcOf(client),
  });
  return { next: "password" };
}

// Runs a step; when Telegram answers SESSION_PASSWORD_NEEDED the login moves on to
// two-step verification instead of failing.
async function orPassword(account, client, step) {
  try {
    return await step();
  } catch (err) {
    if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return requirePassword(account, client);
    }
    throw err;
  }
}

// ---------- phone code ----------

async function applySentCode(account, client, sent) {
  authLog(account._id, "code.sent", { ...describeSentCode(sent), dc: dcOf(client) });
  if (sent instanceof Api.auth.SentCodeSuccess) return finish(account, client);
  const type = sent.type || {};
  const kind = CODE_TYPES[type.className] || "other";
  account.phoneCodeHash = sent.phoneCodeHash;
  account.login = {
    ...EMPTY_LOGIN,
    codeType: kind,
    nextCodeType: sent.nextType ? NEXT_CODE_TYPES[sent.nextType.className] || "" : "",
    codeLength: type.length ?? null,
    codeSentAt: new Date(),
    codeTimeout: sent.timeout ?? null,
    emailPattern: type.emailPattern || "",
    fragmentUrl: type.url || "",
  };
  account.authStatus = kind === "email_setup" ? "email_setup_needed" : "code_sent";
  saveSession(account, client);
  await account.save();
  return { next: kind === "email_setup" ? "email_setup" : "code" };
}

const CONNECT_ATTEMPTS = 3;

// Telegram keeps answering "code sent" after many requests but quietly stops
// delivering the codes. Requests are therefore spaced out and capped per phone
// number (not per account record: re-adding the account must not reset it).
const CODE_MIN_GAP_SEC = 60;
const CODE_MAX_PER_WINDOW = 5;

async function checkCodeRate(account) {
  const now = Date.now();
  const recent = (
    await TelegramCodeRequest.find({
      phone: account.phone,
      at: { $gt: new Date(now - TelegramCodeRequest.WINDOW_SECONDS * 1000) },
    }).sort({ at: 1 })
  ).map((r) => r.at.getTime());
  const last = recent[recent.length - 1];
  if (last && now - last < CODE_MIN_GAP_SEC * 1000) {
    const wait = Math.ceil((CODE_MIN_GAP_SEC * 1000 - (now - last)) / 1000);
    authLog(account._id, "code.rate_limited", { error: "too soon", waitSec: wait });
    throw authError(
      `Новий код можна запросити через ${wait} с. Кожен новий запит скасовує попередній код`,
      429,
    );
  }
  if (recent.length >= CODE_MAX_PER_WINDOW) {
    const freeAt = new Date(recent[0] + TelegramCodeRequest.WINDOW_SECONDS * 1000);
    const hours = TelegramCodeRequest.WINDOW_SECONDS / 3600;
    authLog(account._id, "code.rate_limited", { error: "too many", requests: recent.length, freeAt });
    throw authError(
      `За останні ${hours} год код для цього номера запитували ${recent.length} разів. Після такої кількості Telegram часто перестає доставляти коди. Увійдіть через QR-код або запросіть код після ${freeAt.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: DEFAULT_TIMEZONE })}`,
      429,
    );
  }
  return recent.length;
}

// Counted only once Telegram confirmed a code went out.
async function recordCodeRequest(account) {
  if (account.phone) await TelegramCodeRequest.create({ phone: account.phone });
}

// A dropped connection (not an answer from Telegram): typically the switch to the
// account's own data centre after PHONE_MIGRATE failing to connect once.
function isNetworkError(err) {
  return (
    !err.errorMessage &&
    /not connected|timeout|timed out|disconnect|econn|socket|closed|network/i.test(
      err.message || "",
    )
  );
}

// Runs `step(client)` on a fresh connection, starting over on network failures.
async function withFreshConnection(account, step) {
  for (let attempt = 1; ; attempt += 1) {
    const client = await freshClient(account);
    try {
      return await step(client);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      authLog(account._id, "connection.failed", {
        ...describeError(err),
        attempt,
        of: CONNECT_ATTEMPTS,
        dc: dcOf(client),
      });
      if (attempt >= CONNECT_ATTEMPTS) {
        await tg.dropClient(account._id);
        throw authError(
          "Не вдалося з'єднатися з Telegram. Перевірте інтернет або VPN і спробуйте ще раз",
          503,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

async function sendCode(account) {
  if (!account.phone) throw authError("Вкажіть номер телефону");
  const { apiId, apiHash } = tg.getCredentials(account);
  const earlierRequests = await checkCodeRate(account);
  account.loginMethod = "phone";
  authLog(account._id, "code.request", {
    earlierRequestsIn3h: earlierRequests,
    phone: maskPhone(account.phone),
    apiId,
    apiIdSource: process.env.TELEGRAM_API_ID && Number(process.env.TELEGRAM_API_ID) === apiId ? ".env" : "account",
  });
  return withFreshConnection(account, async (client) => {
    const dcBefore = dcOf(client);
    // PHONE_MIGRATE (the number lives on another DC) is handled inside invoke.
    let sent;
    try {
      sent = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: account.phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      }),
    );
    } catch (err) {
      authLog(account._id, "code.request.failed", { ...describeError(err), dcBefore, dc: dcOf(client) });
      throw err;
    }
    if (dcOf(client) !== dcBefore) {
      authLog(account._id, "dc.migrated", { from: dcBefore, to: dcOf(client) });
    }
    await recordCodeRequest(account);
    return applySentCode(account, client, sent);
  });
}

// "Send again": Telegram moves to the next channel (e.g. app -> SMS -> call).
async function resendCode(account) {
  expectStatus(account, ["code_sent"], "Спершу запросіть код");
  await checkCodeRate(account);
  const client = await tg.getClient(account);
  authLog(account._id, "code.resend", { previousType: account.login?.codeType, dc: dcOf(client) });
  let sent;
  try {
    sent = await client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: account.phone,
        phoneCodeHash: account.phoneCodeHash,
      }),
    );
  } catch (err) {
    authLog(account._id, "code.resend.failed", { ...describeError(err), dc: dcOf(client) });
    throw err;
  }
  await recordCodeRequest(account);
  return applySentCode(account, client, sent);
}

async function signIn(account, { code }) {
  expectStatus(account, ["code_sent"], "Спершу запросіть код");
  const value = String(code || "").replace(/\s/g, "");
  if (!value) throw authError("Введіть код");
  const client = await tg.getClient(account);
  const byEmail = account.login?.codeType === "email";
  const codeAge = account.login?.codeSentAt
    ? Math.round((Date.now() - new Date(account.login.codeSentAt).getTime()) / 1000)
    : null;
  authLog(account._id, "signin.attempt", {
    codeLength: value.length,
    expectedLength: account.login?.codeLength ?? null,
    codeType: account.login?.codeType,
    codeAgeSec: codeAge,
    dc: dcOf(client),
  });
  return orPassword(account, client, async () => {
    let result;
    try {
      result = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: account.phone,
          phoneCodeHash: account.phoneCodeHash,
          ...(byEmail
            ? { emailVerification: new Api.EmailVerificationCode({ code: value }) }
            : { phoneCode: value }),
        }),
      );
    } catch (err) {
      authLog(account._id, "signin.failed", { ...describeError(err), dc: dcOf(client) });
      throw err;
    }
    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      authLog(account._id, "signin.failed", { error: "SIGN_UP_REQUIRED" });
      throw authError("Цей номер не зареєстрований у Telegram");
    }
    return finish(account, client);
  });
}

// ---------- login email set-up ----------

function loginSetupPurpose(account) {
  return new Api.EmailVerifyPurposeLoginSetup({
    phoneNumber: account.phone,
    phoneCodeHash: account.phoneCodeHash,
  });
}

async function sendLoginEmail(account, { email }) {
  expectStatus(
    account,
    ["email_setup_needed", "email_code_sent"],
    "Telegram не просив прив'язати пошту",
  );
  const address = String(email || "").trim();
  if (!/^\S+@\S+\.\S+$/.test(address)) throw authError("Вкажіть коректну адресу пошти");
  const client = await tg.getClient(account);
  const sent = await client.invoke(
    new Api.account.SendVerifyEmailCode({ purpose: loginSetupPurpose(account), email: address }),
  );
  account.authStatus = "email_code_sent";
  account.login.emailPattern = sent.emailPattern || address;
  account.login.codeLength = sent.length ?? null;
  await account.save();
  authLog(account._id, "email.code_sent", { emailPattern: account.login.emailPattern });
  return { next: "email_code" };
}

async function verifyLoginEmail(account, { code }) {
  expectStatus(account, ["email_code_sent"], "Спершу надішліть код на пошту");
  const value = String(code || "").replace(/\s/g, "");
  if (!value) throw authError("Введіть код із листа");
  const client = await tg.getClient(account);
  const result = await client.invoke(
    new Api.account.VerifyEmail({
      purpose: loginSetupPurpose(account),
      verification: new Api.EmailVerificationCode({ code: value }),
    }),
  );
  authLog(account._id, "email.verified", { result: result.className });
  if (!(result instanceof Api.account.EmailVerifiedLogin)) {
    throw authError("Telegram відповів неочікувано, почніть вхід заново");
  }
  // The login code itself is sent now.
  return applySentCode(account, client, result.sentCode);
}

// ---------- two-step verification ----------

async function checkPassword(account, { password }) {
  expectStatus(
    account,
    ["password_needed", "password_recovery"],
    "Пароль зараз не потрібен",
  );
  if (!password) throw authError("Введіть пароль");
  const client = await tg.getClient(account);
  authLog(account._id, "password.attempt", { dc: dcOf(client) });
  try {
    const srp = await client.invoke(new Api.account.GetPassword());
    await client.invoke(
      new Api.auth.CheckPassword({ password: await computeCheck(srp, password) }),
    );
  } catch (err) {
    authLog(account._id, "password.failed", describeError(err));
    throw err;
  }
  return finish(account, client);
}

// Sends a recovery code to the email set for two-step verification.
async function requestPasswordRecovery(account) {
  expectStatus(
    account,
    ["password_needed", "password_recovery"],
    "Відновлення пароля зараз недоступне",
  );
  const client = await tg.getClient(account);
  const result = await client.invoke(new Api.auth.RequestPasswordRecovery());
  account.authStatus = "password_recovery";
  account.login.recoveryEmailPattern = result.emailPattern || "";
  await account.save();
  authLog(account._id, "password.recovery_sent", { emailPattern: result.emailPattern || "" });
  return { next: "recovery_code" };
}

// Logs in with the recovery code. Telegram turns two-step verification OFF for the
// account; a new password has to be set in the Telegram app afterwards.
async function confirmPasswordRecovery(account, { code }) {
  expectStatus(account, ["password_recovery"], "Спершу запросіть код відновлення");
  const value = String(code || "").replace(/\s/g, "");
  if (!value) throw authError("Введіть код із листа");
  const client = await tg.getClient(account);
  try {
    await client.invoke(new Api.auth.RecoverPassword({ code: value }));
  } catch (err) {
    authLog(account._id, "password.recovery_failed", describeError(err));
    throw err;
  }
  authLog(account._id, "password.recovered", {});
  return finish(account, client);
}

// ---------- QR code ----------

const STEP_BY_STATUS = {
  code_sent: "code",
  email_setup_needed: "email_setup",
  email_code_sent: "email_code",
  password_needed: "password",
  password_recovery: "recovery_code",
  authorized: "done",
};

function listenForQrScan(account, client) {
  if (qrListening.has(client)) return;
  qrListening.add(client);
  const key = String(account._id);
  client.addEventHandler(
    () => {
      authLog(key, "qr.scanned", {});
      qrScanned.add(key);
    },
    new Raw({ types: [Api.UpdateLoginToken] }),
  );
}

async function handleLoginToken(account, client, result) {
  if (result instanceof Api.auth.LoginTokenSuccess) return finish(account, client);
  if (result instanceof Api.auth.LoginTokenMigrateTo) {
    // The account lives on another DC: move there and redeem the token.
    authLog(account._id, "qr.migrate", { from: dcOf(client), to: result.dcId });
    await client._switchDC(result.dcId);
    const imported = await client.invoke(
      new Api.auth.ImportLoginToken({ token: result.token }),
    );
    return handleLoginToken(account, client, imported);
  }
  // Still waiting: a new token to show.
  authLog(account._id, "qr.token", {
    expiresInSec: Math.round(result.expires - Date.now() / 1000),
    dc: dcOf(client),
  });
  account.authStatus = "qr_pending";
  account.login.qrUrl = `tg://login?token=${Buffer.from(result.token).toString("base64url")}`;
  account.login.qrExpiresAt = new Date(result.expires * 1000);
  saveSession(account, client);
  await account.save();
  return { next: "qr" };
}

async function exportLoginToken(account, client) {
  const { apiId, apiHash } = tg.getCredentials(account);
  return orPassword(account, client, async () =>
    handleLoginToken(
      account,
      client,
      await client
        .invoke(new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }))
        .catch((err) => {
          if (err.errorMessage !== "SESSION_PASSWORD_NEEDED") {
            authLog(account._id, "qr.failed", { ...describeError(err), dc: dcOf(client) });
          }
          throw err;
        }),
    ),
  );
}

async function qrImage(account) {
  if (!account.login?.qrUrl) return null;
  return QRCode.toDataURL(account.login.qrUrl, { margin: 1, width: 280 });
}

async function startQrLogin(account) {
  account.loginMethod = "qr";
  qrScanned.delete(String(account._id));
  return withFreshConnection(account, (client) => {
    listenForQrScan(account, client);
    return exportLoginToken(account, client);
  });
}

// Called by the login dialog every couple of seconds. Telegram is only asked again
// when the code was scanned (UpdateLoginToken) or the token is about to expire.
async function pollQrLogin(account) {
  if (account.authStatus === "authorized") return { next: "done" };
  if (account.authStatus === "password_needed") return { next: "password" };
  // The dialog moved on (e.g. to a code) while a poll was in flight.
  if (account.authStatus !== "qr_pending") {
    return { next: STEP_BY_STATUS[account.authStatus] || "start" };
  }
  const client = await tg.getClient(account);
  listenForQrScan(account, client);
  const key = String(account._id);
  const expiresSoon =
    !account.login?.qrExpiresAt || account.login.qrExpiresAt.getTime() - Date.now() < 3000;
  if (!qrScanned.has(key) && !expiresSoon) return { next: "qr" };
  qrScanned.delete(key);
  return exportLoginToken(account, client);
}

// ---------- session import ----------

// Accepts a GramJS / Telethon string session ("1...") or a Pyrogram session string
// and returns a GramJS string session.
async function toGramJsSession(raw) {
  const value = String(raw || "").trim();
  if (!value) throw authError("Вставте рядок сесії");
  if (value.startsWith("1")) {
    try {
      const session = new StringSession(value);
      await session.load();
      if (session.authKey && session.dcId) return value;
    } catch {
      // not a GramJS/Telethon string, try Pyrogram below
    }
  }
  const bytes = Buffer.from(value, "base64url");
  let dcId;
  let key;
  if (bytes.length === 271) {
    // Pyrogram 2: dc_id B, api_id I, test_mode ?, auth_key 256s, user_id Q, is_bot ?
    dcId = bytes.readUInt8(0);
    key = bytes.subarray(6, 262);
  } else if (bytes.length === 263 || bytes.length === 267) {
    // Pyrogram 1: dc_id B, test_mode ?, auth_key 256s, user_id I|Q, is_bot ?
    dcId = bytes.readUInt8(0);
    key = bytes.subarray(2, 258);
  } else {
    throw authError("Не вдалося розпізнати рядок сесії (підтримуються GramJS, Telethon і Pyrogram)");
  }
  if (!DC_ADDRESSES[dcId]) throw authError(`Невідомий дата-центр у сесії: ${dcId}`);
  const authKey = new AuthKey();
  await authKey.setKey(Buffer.from(key));
  const session = new StringSession("");
  session.setDC(dcId, DC_ADDRESSES[dcId], 443);
  session.setAuthKey(authKey);
  return session.save();
}

async function importSession(account, { session }) {
  let converted;
  try {
    converted = await toGramJsSession(session);
  } catch (err) {
    authLog(account._id, "session.invalid", { error: err.message, length: String(session || "").trim().length });
    throw err;
  }
  authLog(account._id, "session.import", {
    format: String(session).trim().startsWith("1") ? "gramjs/telethon" : "pyrogram",
  });
  await tg.dropClient(account._id);
  clearLogin(account);
  account.loginMethod = "session";
  account.sessionEncrypted = encrypt(converted);
  try {
    const client = await tg.getClient(account);
    if (!(await client.checkAuthorization())) {
      authLog(account._id, "session.unauthorized", { error: "not authorized", dc: dcOf(client) });
      throw authError("Сесія недійсна або вже завершена в Telegram");
    }
    return await finish(account, client);
  } catch (err) {
    if (account.authStatus !== "authorized") {
      await tg.dropClient(account._id);
      account.sessionEncrypted = "";
      account.authStatus = "unknown";
      await account.save().catch(() => {});
    }
    throw err;
  }
}

// ---------- cancel ----------

async function cancelLogin(account) {
  if (account.authStatus === "authorized") return { next: "done" };
  await tg.dropClient(account._id);
  qrScanned.delete(String(account._id));
  account.sessionEncrypted = "";
  clearLogin(account);
  account.authStatus = "unknown";
  await account.save();
  authLog(account._id, "login.cancelled", {});
  return { next: "start" };
}

module.exports = {
  clearLogin,
  sendCode,
  resendCode,
  signIn,
  sendLoginEmail,
  verifyLoginEmail,
  checkPassword,
  requestPasswordRecovery,
  confirmPasswordRecovery,
  startQrLogin,
  pollQrLogin,
  qrImage,
  importSession,
  cancelLogin,
  normalizePhone,
  // exported for tests
  _toGramJsSession: toGramJsSession,
};
