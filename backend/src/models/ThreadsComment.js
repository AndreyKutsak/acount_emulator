const mongoose = require('mongoose');

const threadsCommentSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'SocialAccount', required: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    postUrl: { type: String, required: true },
    // Threads exposes no stable comment id in the DOM, so comments are deduplicated
    // by a hash of (author + text) instead of a platform-issued id — see
    // threadsMcpService.makeCommentKey.
    commentKey: { type: String, required: true },
    author: { type: String, default: '' },
    text: { type: String, default: '' },
    replyText: { type: String, default: '' },
    repliedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['new', 'replied', 'handled'],
      default: 'new',
    },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

threadsCommentSchema.index({ account: 1, postUrl: 1, commentKey: 1 }, { unique: true });

module.exports = mongoose.model('ThreadsComment', threadsCommentSchema);
