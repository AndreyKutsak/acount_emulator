const mongoose = require("mongoose");

const telegramAccountSchema = new mongoose.Schema(
  {
    displayName: { type: String, default: "" },
    // Empty until known for QR / session logins; filled from the profile after login.
    phone: { type: String, default: "", trim: true },
    // How the account was (or is being) logged in.
    loginMethod: {
      type: String,
      enum: ["phone", "qr", "session"],
      default: "phone",
    },
    // Per-account API credentials from my.telegram.org. Empty = fall back to
    // TELEGRAM_API_ID / TELEGRAM_API_HASH from the environment.
    apiId: { type: Number, default: null },
    apiHashEncrypted: { type: String, default: "" },
    // Encrypted GramJS StringSession (the MTProto auth key). Whoever holds it is
    // logged in as the account, so it is never sent to the client (toSafeAccount).
    sessionEncrypted: { type: String, default: "" },
    // Hash returned by auth.sendCode — needed to submit the login code. Only valid
    // together with the session that requested it.
    phoneCodeHash: { type: String, default: "" },
    authStatus: {
      type: String,
      enum: [
        "unknown",
        "code_sent", // waiting for the login code
        "email_setup_needed", // Telegram requires a login email before sending a code
        "email_code_sent", // waiting for the code sent to that email
        "qr_pending", // waiting for the QR code to be scanned
        "password_needed", // two-step verification password required
        "password_recovery", // waiting for the password recovery code from email
        "authorized",
        "failed",
      ],
      default: "unknown",
    },
    authCheckedAt: { type: Date, default: null },
    authError: { type: String, default: "" },
    // Non-secret details of the login in progress, shown in the login dialog.
    login: {
      // Where the current code went: app, sms, call, email, fragment, ...
      codeType: { type: String, default: "" },
      // What "send again" would switch to, if anything.
      nextCodeType: { type: String, default: "" },
      codeLength: { type: Number, default: null },
      codeSentAt: { type: Date, default: null },
      // Seconds Telegram asks to wait before "send again".
      codeTimeout: { type: Number, default: null },
      emailPattern: { type: String, default: "" },
      fragmentUrl: { type: String, default: "" },
      passwordHint: { type: String, default: "" },
      hasRecovery: { type: Boolean, default: false },
      recoveryEmailPattern: { type: String, default: "" },
      qrUrl: { type: String, default: "" },
      qrExpiresAt: { type: Date, default: null },
    },
    // Snapshot of the account's own Telegram profile, refreshed on login and on demand.
    profile: {
      telegramId: { type: String, default: "" },
      username: { type: String, default: "" },
      firstName: { type: String, default: "" },
      lastName: { type: String, default: "" },
      phone: { type: String, default: "" },
      about: { type: String, default: "" },
      premium: { type: Boolean, default: false },
    },
    // Telegram answered FLOOD_WAIT: no automated sends from this account until then.
    floodWaitUntil: { type: Date, default: null },
    // Telegram answered PEER_FLOOD (the account is limited for spam): nothing is
    // sent until then. Check the account with @SpamBot.
    spamBlockedUntil: { type: Date, default: null },
    spamBlockReason: { type: String, default: "" },
    // Telegram answered FROZEN_*: the account is frozen, every action fails until
    // an appeal is accepted. Cleared by hand.
    frozenAt: { type: Date, default: null },
    // Activity quotas against Telegram's anti-spam, see services/telegramLimits.js.
    // Windows are rolling (last hour / last 24 hours / last 7 days). 0 = never.
    limits: {
      enabled: { type: Boolean, default: true },
      // Every message the app sends, private or in chats.
      messagesPerHour: { type: Number, default: 30, min: 0, max: 1000 },
      messagesPerDay: { type: Number, default: 150, min: 0, max: 10000 },
      // Private chats.
      dmChatsPerDay: { type: Number, default: 30, min: 0, max: 1000 },
      dmMessagesPerChatPerDay: { type: Number, default: 30, min: 0, max: 1000 },
      dmLinksPerDay: { type: Number, default: 3, min: 0, max: 1000 },
      // Groups, supergroups and channel comments.
      chatMessagesPerHour: { type: Number, default: 6, min: 0, max: 1000 },
      chatMessagesPerDay: { type: Number, default: 40, min: 0, max: 10000 },
      chatMessagesPerChatPerDay: { type: Number, default: 6, min: 0, max: 1000 },
      chatLinksPerDay: { type: Number, default: 2, min: 0, max: 1000 },
      // Joining channels and groups.
      joinsPerDay: { type: Number, default: 5, min: 0, max: 200 },
      joinsPerWeek: { type: Number, default: 20, min: 0, max: 1000 },
      joinGapMinutes: { type: Number, default: 30, min: 0, max: 1440 },
      // Telegram allows 500 channels/supergroups (1000 with Premium).
      maxChannels: { type: Number, default: 450, min: 0, max: 1000 },
      // A chat joined less than freshChatQuietHours ago gets no messages at all,
      // and for freshChatDays at most freshChatMessagesPerDay.
      freshChatQuietHours: { type: Number, default: 12, min: 0, max: 168 },
      freshChatDays: { type: Number, default: 3, min: 0, max: 30 },
      freshChatMessagesPerDay: { type: Number, default: 2, min: 0, max: 100 },
      // For the first warmupDays after the account was added here, every quota
      // is cut to warmupPercent.
      warmupDays: { type: Number, default: 7, min: 0, max: 60 },
      warmupPercent: { type: Number, default: 50, min: 1, max: 100 },
    },
    // Automatic answers to private messages, see services/telegramAutoReply.js.
    autoReply: {
      enabled: { type: Boolean, default: false },
      // Pause between a message arriving and the account reading it.
      readDelayMinSec: { type: Number, default: 10, min: 0, max: 3600 },
      readDelayMaxSec: { type: Number, default: 60, min: 0, max: 3600 },
      // Pause between reading and starting to type.
      thinkDelayMinSec: { type: Number, default: 2, min: 0, max: 600 },
      thinkDelayMaxSec: { type: Number, default: 8, min: 0, max: 600 },
      // "typing..." lasts length / speed seconds, clamped to [min, max].
      typingCharsPerSec: { type: Number, default: 6, min: 1, max: 50 },
      typingMinSec: { type: Number, default: 2, min: 0, max: 300 },
      typingMaxSec: { type: Number, default: 25, min: 0, max: 300 },
      // After answering someone, do not auto-answer them again for this long.
      cooldownMinutes: { type: Number, default: 2, min: 0, max: 1440 },
      maxRepliesPerUserPerDay: { type: Number, default: 20, min: 1, max: 1000 },
      replyToBots: { type: Boolean, default: false },
      // Answer only people who are not in the account's contacts.
      onlyNonContacts: { type: Boolean, default: false },
      // Mark as read even when no rule matched.
      markReadWithoutMatch: { type: Boolean, default: true },
      // On start-up, unread chats younger than this are picked up too (0 = off).
      catchUpHours: { type: Number, default: 12, min: 0, max: 168 },
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

// Unique only when set: accounts logging in by QR or session have no phone yet.
telegramAccountSchema.index(
  { phone: 1 },
  {
    unique: true,
    name: "phone_unique_when_set",
    partialFilterExpression: { phone: { $type: "string", $gt: "" } },
  },
);

module.exports = mongoose.model("TelegramAccount", telegramAccountSchema);
