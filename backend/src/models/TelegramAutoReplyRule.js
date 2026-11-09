const mongoose = require("mongoose");

// "If a private message contains these keywords, it is of this category: answer
// with one of these texts" (or, for spam and the like, do not answer at all).
// Matching lives in services/autoReplyMatcher.js.
const telegramAutoReplyRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // What the message is about ("Пошук роботи", "Спам", ...). Shown in the log
    // and the statistics; several rules may share one. Empty = the rule's name.
    category: { type: String, default: "", trim: true },
    // reply:  answer with one of `replies`;
    // ignore: only classify — read the chat, log it, send nothing.
    action: { type: String, enum: ["reply", "ignore"], default: "reply" },
    // The rule does not match when any of these is present ("не шукаю*"), so a
    // negated phrase is not taken for the topic. Whole words, "*" = any ending.
    excludeKeywords: { type: [String], default: [] },
    // Accounts the rule applies to; empty = every account with auto-replies on.
    accounts: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "TelegramAccount" }],
      default: [],
    },
    // contains: keyword appears as a whole word or phrase; "*" at the end of a
    //           word matches any ending ("цін*" -> ціна, ціни, ціну);
    // exact:    the whole message equals the keyword;
    // regex:    keyword is a regular expression.
    matchType: {
      type: String,
      enum: ["contains", "exact", "regex"],
      default: "contains",
    },
    // any: one keyword is enough; all: every keyword must be present.
    matchMode: { type: String, enum: ["any", "all"], default: "any" },
    keywords: { type: [String], default: [] },
    // Used only when no keyword rule matched. Keywords are ignored.
    isFallback: { type: Boolean, default: false },
    // One of these is sent, picked at random. Spintax "{a|b}" and the {name}
    // placeholder are supported; a line containing only "---" splits a reply into
    // several messages sent one after another. Not needed for action "ignore".
    replies: {
      type: [String],
      validate: [
        function hasReply(v) {
          return this.action === "ignore" || v.length > 0;
        },
        "At least one reply text is required",
      ],
    },
    // Higher wins when several rules match.
    priority: { type: Number, default: 0 },
    // Answer each person with this rule only once (e.g. a greeting).
    oncePerUser: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "TelegramAutoReplyRule",
  telegramAutoReplyRuleSchema,
);
