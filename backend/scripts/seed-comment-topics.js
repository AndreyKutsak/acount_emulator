// Loads comment topics and their ready-made comments (src/seeds/commentTopics.js).
//   * topics are matched by name: created or updated (keywords, flags, order);
//   * comments are added if the same text does not exist yet for that topic and
//     language; existing comments (and their usage counts) are left untouched.
//
//   node scripts/seed-comment-topics.js            apply
//   node scripts/seed-comment-topics.js --dry-run  only show what would change

require("dotenv").config();
const mongoose = require("mongoose");
const TelegramCommentTopic = require("../src/models/TelegramCommentTopic");
const TelegramCommentTemplate = require("../src/models/TelegramCommentTemplate");
const topics = require("../src/seeds/commentTopics");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/treds");
  let topicsCreated = 0;
  let topicsUpdated = 0;
  let templatesAdded = 0;
  for (const { templates, ...topic } of topics) {
    const existing = await TelegramCommentTopic.findOne({ name: topic.name });
    if (!dryRun) {
      if (existing) {
        existing.set({ universal: false, avoid: false, description: "", ...topic });
        await existing.save();
      } else {
        await TelegramCommentTopic.create(topic);
      }
    }
    if (existing) topicsUpdated += 1;
    else topicsCreated += 1;

    let added = 0;
    for (const [language, texts] of Object.entries(templates || {})) {
      for (const text of texts) {
        const exists = await TelegramCommentTemplate.exists({ language, category: topic.name, text });
        if (exists) continue;
        if (!dryRun) await TelegramCommentTemplate.create({ language, category: topic.name, text });
        added += 1;
      }
    }
    templatesAdded += added;
    console.log(`${existing ? "update" : "create"}: ${topic.name}${topic.avoid ? " (не коментувати)" : ""}${topic.universal ? " (універсальна)" : ""}, нових коментарів: ${added}`);
  }
  console.log(
    `${dryRun ? "[dry run] " : ""}topics created ${topicsCreated}, updated ${topicsUpdated}; comments added ${templatesAdded}`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
