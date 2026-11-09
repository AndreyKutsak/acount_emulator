const mongoose = require("mongoose");

// A comment topic ("Робота і кар'єра", "Подорожі", ...). Comment templates belong to
// a topic through their `category` field (= topic name). Keywords recognise the
// topic in a post's text, so a post about travel gets a travel comment.
//
//   universal: comments that fit any post; used when a post's topic is unclear.
//   avoid:     posts matching this topic are never commented (tragedies etc.).
const telegramCommentTopicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "", trim: true },
    // Ukrainian and Russian spellings; "*" = any ending ("подорож*").
    keywords: { type: [String], default: [] },
    universal: { type: Boolean, default: false },
    avoid: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    // Display order; also breaks ties when two topics match equally well.
    order: { type: Number, default: 100 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("TelegramCommentTopic", telegramCommentTopicSchema);
