const mongoose = require("mongoose");

// One auto-comment attempt. Besides being the history shown in the UI, the "sent"
// rows are what stops an account from commenting the same post twice.
const telegramCommentLogSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramCommentTask",
      default: null,
    },
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramAccount",
      required: true,
    },
    chatId: { type: String, required: true },
    chatTitle: { type: String, default: "" },
    postId: { type: Number, default: null },
    postUrl: { type: String, default: "" },
    postText: { type: String, default: "" },
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramCommentTemplate",
      default: null,
    },
    text: { type: String, default: "" },
    // Topic of the comment and the post keywords that led to it.
    topic: { type: String, default: "" },
    matchedKeywords: { type: [String], default: [] },
    // Id of the sent comment message (in the discussion group for channel posts).
    commentId: { type: Number, default: null },
    status: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      required: true,
    },
    reason: { type: String, default: "" },
    trigger: { type: String, enum: ["schedule", "manual"], default: "schedule" },
  },
  { timestamps: true },
);

telegramCommentLogSchema.index({ account: 1, chatId: 1, postId: 1, status: 1 });
telegramCommentLogSchema.index({ task: 1, createdAt: -1 });

module.exports = mongoose.model("TelegramCommentLog", telegramCommentLogSchema);
