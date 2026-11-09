const mongoose = require("mongoose");
const { DEFAULT_TIMEZONE } = require("../services/zonedTime");

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const slotSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "sent", "skipped", "failed", "missed"],
      default: "pending",
    },
    note: { type: String, default: "" },
    log: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramCommentLog",
      default: null,
    },
  },
  { _id: false },
);

// "Comment in this chat from this account, using templates in this language, on
// this schedule." Executed by services/telegramAutoComment.js.
const telegramCommentTaskSchema = new mongoose.Schema(
  {
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TelegramAccount",
      required: true,
    },
    // Marked chat id (e.g. -1001234567890), as returned by the chat list.
    chatId: { type: String, required: true },
    chatTitle: { type: String, default: "" },
    chatType: { type: String, enum: ["channel", "supergroup"], required: true },
    // Templates are drawn from this language.
    language: { type: String, required: true, trim: true, lowercase: true },
    // Topics allowed in this chat (template category = topic name). Empty = all.
    topics: { type: [String], default: [] },
    // auto:  the post's topic is recognised by keywords and a comment of that
    //        topic is used (among `topics` if set);
    // fixed: comments are drawn from `topics` regardless of the post.
    topicMode: { type: String, enum: ["auto", "fixed"], default: "auto" },
    // auto mode: when no topic is recognised, use universal comments (otherwise
    // such posts are skipped).
    fallbackUniversal: { type: Boolean, default: true },
    // Legacy single category, read as topics: [category] when topics is empty.
    category: { type: String, default: "", trim: true },
    enabled: { type: Boolean, default: true },
    // slots:   every day N comments at random times inside the active window;
    // perPost: every new post gets a comment a random delay after publication.
    mode: { type: String, enum: ["slots", "perPost"], default: "slots" },
    schedule: {
      timezone: { type: String, default: DEFAULT_TIMEZONE },
      // 0 = Sunday ... 6 = Saturday.
      days: { type: [Number], default: () => [...ALL_DAYS] },
      activeFrom: { type: String, default: "09:00" },
      activeTo: { type: String, default: "21:00" },
      commentsPerDay: { type: Number, default: 5, min: 1, max: 200 },
      minIntervalMinutes: { type: Number, default: 30, min: 1, max: 1440 },
      // perPost only: how long after publication the comment goes out.
      delayMinMinutes: { type: Number, default: 5, min: 0, max: 1440 },
      delayMaxMinutes: { type: Number, default: 40, min: 0, max: 1440 },
    },
    targeting: {
      // Posts older than this are never commented.
      maxPostAgeHours: { type: Number, default: 24, min: 1, max: 24 * 30 },
      // Ignore posts published before the task was (re)enabled.
      onlyNewPosts: { type: Boolean, default: true },
      // Skip posts that are media only.
      skipWithoutText: { type: Boolean, default: false },
      // Comment only posts containing one of these words ("*" = any ending).
      keywords: { type: [String], default: [] },
    },
    // When the task was last enabled; the reference point for onlyNewPosts.
    startedAt: { type: Date, default: Date.now },
    // Today's generated schedule (slots mode). Rebuilt every local day.
    plan: {
      date: { type: String, default: "" },
      timezone: { type: String, default: "" },
      slots: { type: [slotSchema], default: [] },
    },
    // Last few templates used, so the same text does not repeat back to back.
    recentTemplates: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "TelegramCommentTemplate" }],
      default: [],
    },
    lastSentAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date, default: null },
    stats: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

telegramCommentTaskSchema.index({ account: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model("TelegramCommentTask", telegramCommentTaskSchema);
