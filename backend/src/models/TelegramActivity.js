const mongoose = require("mongoose");

// One outgoing action of a Telegram account, made by this app: a message to a
// person, a message or comment in a group/channel, or joining a chat. The limits
// in services/telegramLimits.js count these rows. Old rows expire on their own.
const telegramActivitySchema = new mongoose.Schema(
  {
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramAccount",
      required: true,
    },
    // dm:   message in a private chat;
    // chat: message or comment in a group, supergroup or channel thread;
    // join: joined (or asked to join) a group or channel.
    kind: { type: String, enum: ["dm", "chat", "join"], required: true },
    // The person's id for dm, the chat's marked id (-100...) for chat and join.
    chatId: { type: String, required: true },
    // The message contained a link (http://, t.me/..., domain.tld).
    hasLink: { type: Boolean, default: false },
    // manual: sent from the UI; auto: auto-reply / auto-comment.
    source: { type: String, enum: ["manual", "auto"], default: "auto" },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

telegramActivitySchema.index({ account: 1, kind: 1, createdAt: -1 });
telegramActivitySchema.index({ account: 1, kind: 1, chatId: 1, createdAt: -1 });
// Weekly limits and "recently joined" need at most a few weeks of history.
telegramActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 35 * 24 * 3600 });

module.exports = mongoose.model("TelegramActivity", telegramActivitySchema);
