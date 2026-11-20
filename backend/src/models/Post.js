const mongoose = require('mongoose');

const postAccountSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    status: {
      type: String,
      enum: ['pending', 'published', 'failed'],
      default: 'pending',
    },
    publishedAt: { type: Date, default: null },
    postUrl: { type: String, default: '' },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    metricsUpdatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    images: { type: [String], default: [] },
    // Перевіряти за шаблоном вакансії (threadsJobTemplate). false - пост не вакансія
    // («про життя», опитування): шаблон не вимагається; заборонені слова діють завжди.
    jobTemplate: { type: Boolean, default: true },
    scheduledAt: { type: Date, default: null },
    accounts: { type: [postAccountSchema], default: [] },
  },
  { timestamps: true }
);

postSchema.methods.toSummary = function toSummary() {
  const obj = this.toObject();
  const total = obj.accounts.length;
  const publishedCount = obj.accounts.filter((a) => a.status === 'published').length;

  let overallStatus = 'draft';
  if (total > 0) {
    if (publishedCount === 0) overallStatus = 'active';
    else if (publishedCount === total) overallStatus = 'published_all';
    else overallStatus = 'published_partial';
  }

  const metrics = obj.accounts.reduce(
    (acc, a) => {
      acc.views += a.views || 0;
      acc.likes += a.likes || 0;
      acc.comments += a.comments || 0;
      return acc;
    },
    { views: 0, likes: 0, comments: 0 }
  );

  // Позначка типу: short - короткий шаблон «набір», job - повний шаблон вакансії,
  // free - пост без шаблону («про життя»).
  const { checkShortTemplate } = require('../services/threadsJobTemplate');
  let templateKind = 'job';
  if (obj.jobTemplate === false) templateKind = 'free';
  else if (obj.text && !checkShortTemplate(obj.text).length) templateKind = 'short';

  return { ...obj, overallStatus, metrics, templateKind };
};

module.exports = mongoose.model('Post', postSchema);
