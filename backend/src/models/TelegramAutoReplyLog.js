const mongoose = require("mongoose");

// One handled batch of private messages from one person.
const telegramAutoReplyLogSchema = new mongoose.Schema(
  {
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramAccount",
      required: true,
    },
    peerId: { type: String, required: true },
    peerName: { type: String, default: "" },
    peerUsername: { type: String, default: "" },
    // The incoming messages of the batch, joined with new lines.
    incomingText: { type: String, default: "" },
    lastMessageId: { type: Number, default: null },
    receivedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    rule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramAutoReplyRule",
      default: null,
    },
    ruleName: { type: String, default: "" },
    // What the messages are about (the best matching rule's category), and every
    // category that matched, best first.
    category: { type: String, default: "" },
    categories: { type: [String], default: [] },
    matchedKeywords: { type: [String], default: [] },
    replyText: { type: String, default: "" },
    repliedAt: { type: Date, default: null },
    // replied:  answer sent;
    // ignored:  classified into a category that is not answered (spam, insults);
    // no_match: read, but no rule fits;
    // skipped:  deliberately not answered (bot, cooldown, daily limit, ...);
    // failed:   Telegram returned an error.
    status: {
      type: String,
      enum: ["replied", "ignored", "no_match", "skipped", "failed"],
      required: true,
    },
    reason: { type: String, default: "" },
  },
  { timestamps: true },
);

telegramAutoReplyLogSchema.index({ account: 1, createdAt: -1 });
telegramAutoReplyLogSchema.index({ account: 1, peerId: 1, status: 1, createdAt: -1 });
telegramAutoReplyLogSchema.index({ account: 1, category: 1, createdAt: -1 });

module.exports = mongoose.model("TelegramAutoReplyLog", telegramAutoReplyLogSchema);
