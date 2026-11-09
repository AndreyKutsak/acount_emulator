const mongoose = require("mongoose");

// A ready-made comment text. Auto-comment tasks pick templates by language (and
// optionally category). The text may contain spintax — "{Great|Nice} post" — which
// is expanded to a random variant on every use, see services/spintax.js.
const telegramCommentTemplateSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 4096 },
    // Language code such as "uk", "en", "pl".
    language: { type: String, required: true, trim: true, lowercase: true },
    // Free-form group inside a language ("compliment", "question", ...). Empty = none.
    category: { type: String, default: "", trim: true },
    enabled: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

telegramCommentTemplateSchema.index({ language: 1, category: 1 });

module.exports = mongoose.model(
  "TelegramCommentTemplate",
  telegramCommentTemplateSchema,
);
