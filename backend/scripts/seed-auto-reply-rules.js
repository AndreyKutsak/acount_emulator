// Loads the ready-made auto-reply rules (src/seeds/autoReplyRules.uk.js) into the
// database. Rules are matched by name: existing ones are updated, new ones added,
// rules with other names are left alone. Usage-statistics are kept.
//
//   node scripts/seed-auto-reply-rules.js            add / update
//   node scripts/seed-auto-reply-rules.js --dry-run  only show what would change

require("dotenv").config();
const mongoose = require("mongoose");
const TelegramAutoReplyRule = require("../src/models/TelegramAutoReplyRule");
const matcher = require("../src/services/autoReplyMatcher");
const rules = require("../src/seeds/autoReplyRules.uk");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/treds");
  let created = 0;
  let updated = 0;
  for (const data of rules) {
    matcher.validateRule({ matchType: "contains", ...data });
    const existing = await TelegramAutoReplyRule.findOne({ name: data.name });
    console.log(`${existing ? "update" : "create"}: ${data.name} (${data.keywords.length} keywords, ${data.replies.length} replies)`);
    if (dryRun) continue;
    if (existing) {
      existing.set({
        matchType: "contains",
        matchMode: "any",
        oncePerUser: false,
        isFallback: false,
        action: "reply",
        category: "",
        excludeKeywords: [],
        ...data,
      });
      await existing.save();
      updated += 1;
    } else {
      await TelegramAutoReplyRule.create({ matchType: "contains", ...data });
      created += 1;
    }
  }
  console.log(dryRun ? "dry run, nothing written" : `created ${created}, updated ${updated}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
