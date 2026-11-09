const mongoose = require("mongoose");

// One login code that Telegram confirmed it sent, per phone number. Used to space
// out and cap code requests per NUMBER — deleting and re-adding the account must
// not reset the count. Rows expire on their own after the counting window.
const WINDOW_SECONDS = 3 * 3600;

const telegramCodeRequestSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  at: { type: Date, default: Date.now },
});

telegramCodeRequestSchema.index({ phone: 1, at: 1 });
telegramCodeRequestSchema.index({ at: 1 }, { expireAfterSeconds: WINDOW_SECONDS });

module.exports = mongoose.model("TelegramCodeRequest", telegramCodeRequestSchema);
module.exports.WINDOW_SECONDS = WINDOW_SECONDS;
