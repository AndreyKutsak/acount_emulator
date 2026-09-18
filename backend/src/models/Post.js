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
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    images: { type: [String], default: [] },
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

  return { ...obj, overallStatus, metrics };
};

module.exports = mongoose.model('Post', postSchema);
