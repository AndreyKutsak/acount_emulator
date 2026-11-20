const mongoose = require("mongoose");

// Правило автовідповіді на особисті повідомлення Threads: «якщо повідомлення
// містить ці слова, воно цієї категорії - відповісти одним із цих текстів» (або,
// для спаму, не відповідати). Окремий набір від правил Telegram, але ті самі поля
// й той самий збіг (services/autoReplyMatcher.js). Див. TelegramAutoReplyRule.
const threadsDmRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // dm - особисті повідомлення; comments - відповіді під нашими постами
    // (публічні, тож окремий набір правил і текстів).
    channel: { type: String, enum: ["dm", "comments"], default: "dm" },
    category: { type: String, default: "", trim: true },
    // reply: відповісти одним із `replies`; ignore: лише класифікувати.
    action: { type: String, enum: ["reply", "ignore"], default: "reply" },
    excludeKeywords: { type: [String], default: [] },
    // Акаунти Threads, до яких застосовується; порожньо = усі.
    accounts: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "SocialAccount" }],
      default: [],
    },
    matchType: {
      type: String,
      enum: ["contains", "exact", "regex"],
      default: "contains",
    },
    matchMode: { type: String, enum: ["any", "all"], default: "any" },
    keywords: { type: [String], default: [] },
    isFallback: { type: Boolean, default: false },
    // Один випадковий; spintax "{a|b}"; рядок "---" ділить на кілька повідомлень.
    replies: {
      type: [String],
      validate: [
        function hasReply(v) {
          return this.action === "ignore" || v.length > 0;
        },
        "At least one reply text is required",
      ],
    },
    priority: { type: Number, default: 0 },
    oncePerUser: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ThreadsDmRule", threadsDmRuleSchema);
