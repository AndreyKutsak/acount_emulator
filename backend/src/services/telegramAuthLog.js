// Login diagnostics for Telegram accounts: every step of a login, Telegram's exact
// answer and the data centre involved, written to the console and appended (JSON
// lines) to backend/logs/telegram-auth.log.
//
// Never logged: login codes, passwords, phone code hashes, sessions, api_hash.
// Phone numbers are masked.

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "telegram-auth.log");
const MAX_READ_BYTES = 512 * 1024;

function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length <= 6) return value;
  return `${value.slice(0, 5)}${"*".repeat(value.length - 7)}${value.slice(-2)}`;
}

function authLog(accountId, event, details = {}) {
  const entry = { at: new Date().toISOString(), account: String(accountId || ""), event, ...details };
  const level = details.error ? "warn" : "log";
  console[level](`[tg-auth] ${entry.account} ${event} ${JSON.stringify(details)}`);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
  } catch {
    // Diagnostics must never break a login.
  }
}

// Last `limit` entries for one account (newest last), from the tail of the file.
function readAuthLog(accountId, limit = 100) {
  let text;
  try {
    const { size } = fs.statSync(LOG_FILE);
    const start = Math.max(0, size - MAX_READ_BYTES);
    const fd = fs.openSync(LOG_FILE, "r");
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    text = buffer.toString("utf8");
  } catch {
    return [];
  }
  const id = String(accountId);
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && entry.account === id)
    .slice(-limit);
}

// Telegram's answer to sendCode / resendCode in loggable form.
function describeSentCode(sent) {
  if (!sent) return {};
  const type = sent.type || {};
  return {
    result: sent.className,
    codeType: type.className,
    codeLength: type.length,
    emailPattern: type.emailPattern,
    nextType: sent.nextType?.className || null,
    timeout: sent.timeout ?? null,
  };
}

// Telegram RPC error in loggable form.
function describeError(err) {
  return {
    error: err.errorMessage || err.message,
    code: err.code,
    seconds: err.seconds,
  };
}

module.exports = { authLog, readAuthLog, maskPhone, describeSentCode, describeError, LOG_FILE };
