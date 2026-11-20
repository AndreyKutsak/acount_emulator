// Редагований список заборонених і ризикових слів для постів Threads.
// Зберігається в PostWordRule; після кожної зміни набір перезавантажується в
// threadsPostRules (перевірка форми, збереження й публікація). Першого запуску
// база заповнюється стандартним набором.

const PostWordRule = require("../models/PostWordRule");
const rules = require("./threadsPostRules");

async function reload() {
  const list = await PostWordRule.find().lean();
  rules.setWordRules(list);
  return list;
}

// Додати стандартні слова, яких немає (видалені раніше повертаються).
async function restoreDefaults() {
  const ops = rules.defaultWordList().map(({ phrase, group }) => ({
    updateOne: {
      filter: { group, phrase },
      update: { $setOnInsert: { group, phrase, enabled: true, builtin: true } },
      upsert: true,
    },
  }));
  if (ops.length) await PostWordRule.bulkWrite(ops, { ordered: false });
  return reload();
}

async function init() {
  if (!(await PostWordRule.estimatedDocumentCount())) {
    await restoreDefaults();
  } else {
    await reload();
  }
}

module.exports = { init, reload, restoreDefaults };
