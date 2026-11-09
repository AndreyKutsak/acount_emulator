const TelegramAccount = require("../models/TelegramAccount");
const TelegramCommentTask = require("../models/TelegramCommentTask");
const TelegramCommentTemplate = require("../models/TelegramCommentTemplate");
const TelegramCommentLog = require("../models/TelegramCommentLog");
const TelegramCommentTopic = require("../models/TelegramCommentTopic");
const { classifyPost } = require("../services/commentTopics");
const telegramService = require("../services/telegramService");
const autoComment = require("../services/telegramAutoComment");
const spintax = require("../services/spintax");
const { isValidTimeZone, parseHHMM } = require("../services/zonedTime");
const { telegramAction } = require("./telegramController");

const LANGUAGE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const MAX_TEMPLATES_PER_REQUEST = 500;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Errors carrying an HTTP status (validation, task busy, ...) go back as is;
// anything else is a real server error.
function handle(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  };
}

function normalizeLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (!LANGUAGE_RE.test(language)) {
    throw badRequest("language must be a language code such as uk, en, pl");
  }
  return language;
}

function intInRange(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${name} must be an integer from ${min} to ${max}`);
  }
  return n;
}

// ---------- templates ----------

exports.listTemplates = handle(async (req, res) => {
  const filter = {};
  if (req.query.language) filter.language = normalizeLanguage(req.query.language);
  if (req.query.category !== undefined && req.query.category !== "") {
    filter.category = String(req.query.category).trim();
  }
  const templates = await TelegramCommentTemplate.find(filter).sort({
    language: 1,
    category: 1,
    createdAt: -1,
  });
  res.json(templates);
});

// Languages that have templates, with counts and categories — drives the language
// picker of the auto-comment form.
exports.templateLanguages = handle(async (req, res) => {
  const rows = await TelegramCommentTemplate.aggregate([
    {
      $group: {
        _id: "$language",
        total: { $sum: 1 },
        enabled: { $sum: { $cond: ["$enabled", 1, 0] } },
        categories: { $addToSet: "$category" },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  res.json(
    rows.map((row) => ({
      language: row._id,
      total: row.total,
      enabled: row.enabled,
      categories: row.categories.filter(Boolean).sort(),
    })),
  );
});

// Body: { language, category?, text } for one template, or { language, category?,
// texts: [...] } to add many at once.
exports.createTemplates = handle(async (req, res) => {
  const language = normalizeLanguage(req.body?.language);
  const category = String(req.body?.category || "").trim();
  const raw = Array.isArray(req.body?.texts) ? req.body.texts : [req.body?.text];
  const texts = [...new Set(raw.map((t) => String(t || "").trim()).filter(Boolean))];
  if (texts.length === 0) throw badRequest("text is required");
  if (texts.length > MAX_TEMPLATES_PER_REQUEST) {
    throw badRequest(`At most ${MAX_TEMPLATES_PER_REQUEST} templates per request`);
  }
  const created = await TelegramCommentTemplate.insertMany(
    texts.map((text) => ({ text, language, category })),
  );
  res.status(201).json(created);
});

exports.updateTemplate = handle(async (req, res) => {
  const template = await TelegramCommentTemplate.findById(req.params.templateId);
  if (!template) return res.status(404).json({ message: "Template not found" });
  const { text, language, category, enabled } = req.body || {};
  if (text !== undefined) {
    if (!String(text).trim()) throw badRequest("text cannot be empty");
    template.text = String(text).trim();
  }
  if (language !== undefined) template.language = normalizeLanguage(language);
  if (category !== undefined) template.category = String(category).trim();
  if (enabled !== undefined) template.enabled = Boolean(enabled);
  await template.save();
  res.json(template);
});

exports.deleteTemplate = handle(async (req, res) => {
  const template = await TelegramCommentTemplate.findByIdAndDelete(
    req.params.templateId,
  );
  if (!template) return res.status(404).json({ message: "Template not found" });
  res.json({ message: "Template deleted" });
});

function cleanList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split("\n");
  return [...new Set(list.map((v) => String(v).trim()).filter(Boolean))];
}

// ---------- topics ----------

// Topics with the number of enabled templates per language.
exports.listTopics = handle(async (req, res) => {
  const [topics, counts] = await Promise.all([
    TelegramCommentTopic.find().sort({ order: 1, name: 1 }).lean(),
    TelegramCommentTemplate.aggregate([
      { $match: { enabled: true } },
      { $group: { _id: { topic: "$category", language: "$language" }, count: { $sum: 1 } } },
    ]),
  ]);
  const byTopic = {};
  for (const row of counts) {
    byTopic[row._id.topic] = byTopic[row._id.topic] || {};
    byTopic[row._id.topic][row._id.language] = row.count;
  }
  res.json(topics.map((topic) => ({ ...topic, templateCounts: byTopic[topic.name] || {} })));
});

function applyTopic(topic, body = {}) {
  if (body.name !== undefined) topic.name = String(body.name).trim();
  if (body.description !== undefined) topic.description = String(body.description).trim();
  if (body.keywords !== undefined) topic.keywords = cleanList(body.keywords);
  if (body.universal !== undefined) topic.universal = Boolean(body.universal);
  if (body.avoid !== undefined) topic.avoid = Boolean(body.avoid);
  if (body.enabled !== undefined) topic.enabled = Boolean(body.enabled);
  if (body.order !== undefined) topic.order = Number(body.order) || 0;
  if (!topic.name) throw badRequest("name is required");
  if (topic.universal && topic.avoid) throw badRequest("A topic cannot be universal and avoided at once");
  if (!topic.universal && !topic.keywords.length) {
    throw badRequest("Add keywords, or mark the topic as universal");
  }
}

exports.createTopic = handle(async (req, res) => {
  const topic = new TelegramCommentTopic();
  applyTopic(topic, req.body);
  try {
    await topic.save();
  } catch (err) {
    if (err.code === 11000) throw badRequest("A topic with this name already exists");
    throw err;
  }
  res.status(201).json(topic);
});

// Renaming a topic carries its templates and the chats that use it along.
exports.updateTopic = handle(async (req, res) => {
  const topic = await TelegramCommentTopic.findById(req.params.topicId);
  if (!topic) return res.status(404).json({ message: "Topic not found" });
  const oldName = topic.name;
  applyTopic(topic, req.body);
  try {
    await topic.save();
  } catch (err) {
    if (err.code === 11000) throw badRequest("A topic with this name already exists");
    throw err;
  }
  if (topic.name !== oldName) {
    await TelegramCommentTemplate.updateMany({ category: oldName }, { $set: { category: topic.name } });
    await TelegramCommentTask.updateMany(
      { topics: oldName },
      { $set: { "topics.$[t]": topic.name } },
      { arrayFilters: [{ t: oldName }] },
    );
  }
  res.json(topic);
});

// ?withTemplates=true also deletes the topic's templates; otherwise a topic that
// still has templates is not deleted.
exports.deleteTopic = handle(async (req, res) => {
  const topic = await TelegramCommentTopic.findById(req.params.topicId);
  if (!topic) return res.status(404).json({ message: "Topic not found" });
  const templates = await TelegramCommentTemplate.countDocuments({ category: topic.name });
  if (templates && req.query.withTemplates !== "true") {
    return res.status(409).json({
      message: `The topic has ${templates} templates; delete them too or move them first`,
      templates,
    });
  }
  if (templates) await TelegramCommentTemplate.deleteMany({ category: topic.name });
  await TelegramCommentTask.updateMany({ topics: topic.name }, { $pull: { topics: topic.name } });
  await topic.deleteOne();
  res.json({ message: "Topic deleted", templatesDeleted: templates });
});

// Which topic a post text gets, and a sample comment for it in `language`.
exports.classifyText = handle(async (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) throw badRequest("text is required");
  const language = req.body?.language ? normalizeLanguage(req.body.language) : "uk";
  const topics = await TelegramCommentTopic.find({ enabled: true }).sort({ order: 1 }).lean();
  const match = classifyPost(text, topics);
  if (match?.avoid) {
    return res.json({ avoid: match.avoid.name, matchedKeywords: match.matchedKeywords, sample: null });
  }
  const topicName = match?.topic.name || topics.find((t) => t.universal)?.name || "";
  const pool = await TelegramCommentTemplate.find({ language, enabled: true, category: topicName })
    .select("text")
    .lean();
  const sample = pool.length ? spintax.render(pool[Math.floor(Math.random() * pool.length)].text) : null;
  res.json({
    topic: match?.topic.name || null,
    fallback: match ? null : topicName || null,
    matchedKeywords: match?.matchedKeywords || [],
    sample,
  });
});

exports.previewTemplate = handle(async (req, res) => {
  const text = String(req.body?.text || "");
  if (!text.trim()) throw badRequest("text is required");
  res.json({ samples: spintax.samples(text, 5) });
});

// ---------- tasks ----------

// Merges `body` over the task's current settings and validates the result as a
// whole (e.g. activeFrom < activeTo even when only one of them changes).
function scheduleSnapshot(task) {
  const { mode, schedule, language, category } = task.toObject();
  return JSON.stringify({ mode, schedule, language, category });
}

function applyTaskSettings(task, body = {}) {
  const before = scheduleSnapshot(task);
  const current = task.toObject();

  if (body.language !== undefined) task.language = normalizeLanguage(body.language);
  if (body.category !== undefined) task.category = String(body.category || "").trim();
  if (body.topics !== undefined) {
    task.topics = cleanList(body.topics);
    task.category = ""; // superseded by the topic list
  }
  if (body.topicMode !== undefined) {
    if (!["auto", "fixed"].includes(body.topicMode)) {
      throw badRequest('topicMode must be "auto" or "fixed"');
    }
    task.topicMode = body.topicMode;
  }
  if (body.fallbackUniversal !== undefined) {
    task.fallbackUniversal = Boolean(body.fallbackUniversal);
  }
  if (body.mode !== undefined) {
    if (!["slots", "perPost"].includes(body.mode)) {
      throw badRequest('mode must be "slots" or "perPost"');
    }
    task.mode = body.mode;
  }

  const s = { ...current.schedule, ...(body.schedule || {}) };
  if (!isValidTimeZone(s.timezone)) throw badRequest(`Unknown time zone "${s.timezone}"`);
  const days = [...new Set((s.days || []).map(Number))].sort();
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw badRequest("days must list at least one weekday (0 = Sunday ... 6 = Saturday)");
  }
  const from = parseHHMM(s.activeFrom);
  const to = parseHHMM(s.activeTo);
  if (from === null || to === null) throw badRequest("activeFrom/activeTo must look like 09:00");
  if (from >= to) throw badRequest("activeFrom must be earlier than activeTo");
  const delayMin = intInRange(s.delayMinMinutes, "delayMinMinutes", 0, 1440);
  const delayMax = intInRange(s.delayMaxMinutes, "delayMaxMinutes", 0, 1440);
  if (delayMin > delayMax) throw badRequest("delayMinMinutes cannot exceed delayMaxMinutes");
  task.schedule = {
    timezone: s.timezone,
    days,
    activeFrom: s.activeFrom,
    activeTo: s.activeTo,
    commentsPerDay: intInRange(s.commentsPerDay, "commentsPerDay", 1, 200),
    minIntervalMinutes: intInRange(s.minIntervalMinutes, "minIntervalMinutes", 1, 1440),
    delayMinMinutes: delayMin,
    delayMaxMinutes: delayMax,
  };

  const t = { ...current.targeting, ...(body.targeting || {}) };
  task.targeting = {
    maxPostAgeHours: intInRange(t.maxPostAgeHours, "maxPostAgeHours", 1, 24 * 30),
    onlyNewPosts: Boolean(t.onlyNewPosts),
    skipWithoutText: Boolean(t.skipWithoutText),
    keywords: cleanList(t.keywords),
  };
  if (task.topicMode === "fixed" && !autoComment.taskTopics(task).length) {
    throw badRequest('Choose at least one topic for topicMode "fixed"');
  }

  let enabledNow = false;
  if (body.enabled !== undefined) {
    const enabled = Boolean(body.enabled);
    enabledNow = enabled && !task.enabled;
    task.enabled = enabled;
    // "Only new posts" counts from the moment the task was switched back on.
    if (enabledNow) task.startedAt = new Date();
  }

  return before !== scheduleSnapshot(task) || enabledNow;
}

async function describeTask(task) {
  const now = new Date();
  const [sentToday, templatesAvailable] = await Promise.all([
    autoComment.sentToday(task, now),
    autoComment.countTemplates(task.language, autoComment.taskTopics(task)),
  ]);
  const next = (task.plan?.slots || []).find(
    (slot) => slot.status === "pending" && slot.at > now,
  );
  const obj = task.toObject();
  // The account is only needed as an id here.
  obj.account = String(task.account?._id ?? task.account);
  return {
    ...obj,
    sentToday,
    templatesAvailable,
    nextSlotAt: next ? next.at : null,
  };
}

exports.listTasks = handle(async (req, res) => {
  const tasks = await TelegramCommentTask.find({ account: req.params.id }).sort({
    createdAt: -1,
  });
  res.json(await Promise.all(tasks.map(describeTask)));
});

exports.createTask = telegramAction(
  "Creating the auto-comment task",
  async (account, req, res) => {
    const chatRef = String(req.body?.chatId || "").trim();
    if (!chatRef) throw badRequest("chatId is required");

    // Validate the chat against Telegram itself: it must have somewhere to comment.
    const chat = await telegramService.getChat(account, chatRef);
    if (chat.type === "group") {
      throw badRequest(
        "Basic groups have no comment threads; pick a channel with comments or a supergroup",
      );
    }
    if (chat.type === "channel" && !chat.linkedChat) {
      throw badRequest("Comments are turned off in this channel (no discussion group)");
    }

    const task = new TelegramCommentTask({
      account: account._id,
      chatId: chat.id,
      chatTitle: chat.title,
      chatType: chat.type,
      language: normalizeLanguage(req.body?.language),
      startedAt: new Date(),
    });
    applyTaskSettings(task, { ...req.body, enabled: undefined });
    task.enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : true;
    await autoComment.ensurePlan(task, new Date(), true);
    try {
      await task.save();
    } catch (err) {
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ message: "This account already has an auto-comment task for this chat" });
      }
      throw err;
    }
    res.status(201).json(await describeTask(task));
  },
);

exports.updateTask = handle(async (req, res) => {
  const task = await autoComment.updateTask(req.params.taskId, async (doc) =>
    applyTaskSettings(doc, req.body || {}),
  );
  res.json(await describeTask(task));
});

exports.deleteTask = handle(async (req, res) => {
  if (autoComment.isBusy(req.params.taskId)) {
    return res
      .status(409)
      .json({ message: "Завдання зараз виконується, спробуйте за кілька секунд" });
  }
  const task = await TelegramCommentTask.findByIdAndDelete(req.params.taskId);
  if (!task) return res.status(404).json({ message: "Task not found" });
  // Logs are kept: they still stop the account from commenting the same posts again.
  res.json({ message: "Task deleted" });
});

exports.runTask = handle(async (req, res) => {
  const { result, task } = await autoComment.runNow(req.params.taskId);
  res.json({
    status: result.status,
    reason: result.reason || "",
    log: result.log,
    task: await describeTask(task),
  });
});

exports.replanTask = handle(async (req, res) => {
  const task = await autoComment.replan(req.params.taskId);
  res.json(await describeTask(task));
});

exports.taskLogs = handle(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const logs = await TelegramCommentLog.find({ task: req.params.taskId })
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(logs);
});

exports.accountLogs = handle(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const logs = await TelegramCommentLog.find({ account: req.params.id })
    .sort({ createdAt: -1 })
    .limit(limit);
  res.json(logs);
});

exports.status = (req, res) => {
  res.json(autoComment.getStatus());
};

// Clears a FLOOD_WAIT pause recorded for the account (e.g. after waiting it out).
exports.clearFloodWait = handle(async (req, res) => {
  const account = await TelegramAccount.findByIdAndUpdate(
    req.params.id,
    { $set: { floodWaitUntil: null } },
    { new: true },
  );
  if (!account) return res.status(404).json({ message: "Account not found" });
  res.json({ floodWaitUntil: null });
});
