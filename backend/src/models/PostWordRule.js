const mongoose = require("mongoose");

// Заборонене чи ризикове слово для постів Threads (services/threadsPostRules.js).
// group - група з WORD_GROUPS: від неї залежать пояснення й суворість (заборонено
// чи лише попередження). builtin - зі стандартного набору (можна видалити й
// повернути кнопкою «Відновити стандартні»).
const postWordRuleSchema = new mongoose.Schema(
  {
    phrase: { type: String, required: true, trim: true },
    group: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    builtin: { type: Boolean, default: false },
  },
  { timestamps: true },
);

postWordRuleSchema.index({ group: 1, phrase: 1 }, { unique: true });

module.exports = mongoose.model("PostWordRule", postWordRuleSchema);
