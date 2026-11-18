const express = require("express");
const PostWordRule = require("../models/PostWordRule");
const postWords = require("../services/postWords");
const rules = require("../services/threadsPostRules");

// Заборонені й ризикові слова для постів Threads: /api/post-words
const router = express.Router();

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === 11000) return res.status(409).json({ message: "Таке слово вже є в цій групі" });
    next(err);
  }
};

const describeGroups = () =>
  Object.entries(rules.WORD_GROUPS).map(([id, g]) => ({ id, label: g.label, severity: g.severity, message: g.message }));

router.get(
  "/",
  handle(async (req, res) => {
    const words = await PostWordRule.find().sort({ group: 1, phrase: 1 }).lean();
    res.json({ groups: describeGroups(), words });
  }),
);

// Додати одне чи кілька слів (через кому або з нового рядка).
router.post(
  "/",
  handle(async (req, res) => {
    const group = String(req.body?.group || "custom");
    if (!rules.WORD_GROUPS[group]) throw Object.assign(new Error("Невідома група"), { status: 400 });
    const phrases = String(req.body?.phrase || "")
      .split(/[\n,;]+/)
      .map((p) => p.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (!phrases.length) throw Object.assign(new Error("Введіть слово чи фразу"), { status: 400 });
    const bad = phrases.filter((p) => !rules.compilePhrase(p));
    if (bad.length) throw Object.assign(new Error(`Не вдалося розібрати: ${bad.join(", ")}`), { status: 400 });
    const added = [];
    for (const phrase of phrases) {
      const doc = await PostWordRule.findOneAndUpdate(
        { group, phrase },
        { $set: { enabled: true }, $setOnInsert: { group, phrase, builtin: false } },
        { upsert: true, new: true },
      );
      added.push(doc);
    }
    await postWords.reload();
    res.status(201).json(added);
  }),
);

router.patch(
  "/:id",
  handle(async (req, res) => {
    const doc = await PostWordRule.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Слово не знайдено" });
    if (req.body?.enabled !== undefined) doc.enabled = Boolean(req.body.enabled);
    await doc.save();
    await postWords.reload();
    res.json(doc);
  }),
);

// Увімкнути чи вимкнути всю групу.
router.patch(
  "/group/:group",
  handle(async (req, res) => {
    if (!rules.WORD_GROUPS[req.params.group]) return res.status(404).json({ message: "Невідома група" });
    await PostWordRule.updateMany({ group: req.params.group }, { $set: { enabled: Boolean(req.body?.enabled) } });
    await postWords.reload();
    res.json({ ok: true });
  }),
);

router.delete(
  "/:id",
  handle(async (req, res) => {
    const doc = await PostWordRule.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Слово не знайдено" });
    await postWords.reload();
    res.json({ message: "Видалено" });
  }),
);

router.post(
  "/restore-defaults",
  handle(async (req, res) => {
    await postWords.restoreDefaults();
    res.json({ ok: true });
  }),
);

// Перевірити текст: які слова знайдено (без збереження).
router.post(
  "/check",
  handle(async (req, res) => {
    res.json({ found: rules.findWords(String(req.body?.text || "")) });
  }),
);

module.exports = router;
