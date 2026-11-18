const mongoose = require("mongoose");

// Одне оброблене особисте повідомлення Threads (останнє непрочитане в чаті).
// Поля збігаються з TelegramAutoReplyLog, щоб журнал і статистика в панелі
// працювали однаково; peerId тут - username співрозмовника.
const threadsDmLogSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: "SocialAccount", required: true },
    peerId: { type: String, required: true },
    peerName: { type: String, default: "" },
    peerUsername: { type: String, default: "" },
    // dm - особисте повідомлення; comments - відповідь під нашим постом.
    channel: { type: String, enum: ["dm", "comments"], default: "dm" },
    // inbox - «Вхідні», requests - «Запити» (люди, на яких акаунт не підписаний),
    // comments - коментар (з «Дії → Розмови»).
    folder: { type: String, enum: ["inbox", "requests", "comments"], default: "inbox" },
    incomingText: { type: String, default: "" },
    // Для коментаря: текст, на який відповіли (наш пост чи наша відповідь).
    contextText: { type: String, default: "" },
    // username + текст: те саме повідомлення не обробляємо двічі.
    messageKey: { type: String, required: true },
    // 'folder|username|превʼю' рядка списку: такі рядки («2 нові повідомлення»)
    // телефон не відкриває повторно, щоб прочитати.
    rowSignature: { type: String, default: "" },
    receivedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "ThreadsDmRule", default: null },
    ruleName: { type: String, default: "" },
    category: { type: String, default: "" },
    categories: { type: [String], default: [] },
    matchedKeywords: { type: [String], default: [] },
    replyText: { type: String, default: "" },
    repliedAt: { type: Date, default: null },
    // replied:  відповідь надіслано;
    // ignored:  категорія без відповіді (спам);
    // no_match: жодне правило не підійшло - чат лишається непрочитаним для людини;
    // skipped:  свідомо не відповіли (ліміт, реакція замість тексту, ...);
    // failed:   не вдалося надіслати - наступний сеанс спробує знову.
    status: {
      type: String,
      enum: ["replied", "ignored", "no_match", "skipped", "failed"],
      required: true,
    },
    reason: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

threadsDmLogSchema.index({ account: 1, createdAt: -1 });
threadsDmLogSchema.index({ account: 1, messageKey: 1 });
threadsDmLogSchema.index({ account: 1, peerId: 1, status: 1, createdAt: -1 });
threadsDmLogSchema.index({ account: 1, category: 1, createdAt: -1 });

module.exports = mongoose.model("ThreadsDmLog", threadsDmLogSchema);
