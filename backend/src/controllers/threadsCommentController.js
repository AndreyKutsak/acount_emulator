const mongoose = require('mongoose');
const SocialAccount = require('../models/SocialAccount');
const Post = require('../models/Post');
const ThreadsComment = require('../models/ThreadsComment');
const { decrypt } = require('../services/cryptoService');
const threadsMcpService = require('../services/threadsMcpService');
const { sleep, randomInt, scheduleRest, isResting } = require('../services/humanize');

async function markAccountActive(account) {
  account.restUntil = scheduleRest();
  await account.save();
}

exports.listComments = async (req, res, next) => {
  try {
    const { status, accountId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (accountId) filter.account = accountId;
    const comments = await ThreadsComment.find(filter)
      .populate('account', 'platform username displayName restUntil')
      .sort({ fetchedAt: -1 });
    res.json(comments);
  } catch (err) {
    next(err);
  }
};

// Fetches replies for every post of every threads account by driving a real browser
// through the Playwright MCP server (see services/threadsMcpService.js) and reading
// the reply DOM — the same approach the pre-threads-bot automation used.
exports.fetchComments = async (req, res) => {
  const { accountId } = req.body || {};
  try {
    const accountFilter = { platform: 'threads' };
    if (accountId) {
      if (!mongoose.isValidObjectId(accountId)) {
        return res.status(400).json({ message: 'accountId must be a valid id' });
      }
      accountFilter._id = accountId;
    }
    const accounts = await SocialAccount.find(accountFilter);
    if (accounts.length === 0) {
      return res.status(404).json({ message: 'No threads accounts found' });
    }

    const summary = [];
    for (const account of accounts) {
      if (isResting(account)) {
        summary.push({
          accountId: account._id,
          username: account.username,
          skipped: 'resting',
          restUntil: account.restUntil,
        });
        continue;
      }

      const posts = await Post.find({
        accounts: { $elemMatch: { account: account._id, postUrl: { $ne: '' } } },
      });
      if (posts.length === 0) {
        summary.push({ accountId: account._id, username: account.username, fetched: 0 });
        continue;
      }

      // Stagger accounts instead of hitting the API for all of them back to back.
      await sleep(randomInt(1500, 5000));

      let fetchedCount = 0;
      let errorMsg = null;
      try {
        const password = decrypt(account.passwordEncrypted);

        for (const post of posts) {
          const entry = post.accounts.find((a) => a.account.toString() === account._id.toString());
          if (!entry?.postUrl) continue;

          const replies = await threadsMcpService.fetchComments(account, password, entry.postUrl);
          for (const reply of replies) {
            const commentKey = threadsMcpService.makeCommentKey(reply.author, reply.text);
            await ThreadsComment.findOneAndUpdate(
              { account: account._id, postUrl: entry.postUrl, commentKey },
              {
                $setOnInsert: {
                  account: account._id,
                  post: post._id,
                  postUrl: entry.postUrl,
                  commentKey,
                  author: reply.author || '',
                  text: reply.text || '',
                  status: 'new',
                },
                $set: { fetchedAt: new Date() },
              },
              { upsert: true, new: true }
            );
            fetchedCount += 1;
          }
          await sleep(randomInt(800, 2500));
        }
        await markAccountActive(account);
      } catch (err) {
        errorMsg = err.message;
      }

      summary.push({
        accountId: account._id,
        username: account.username,
        fetched: fetchedCount,
        error: errorMsg,
      });
    }

    res.json({ accounts: summary });
  } catch (err) {
    res.status(502).json({ message: `Fetching comments failed: ${err.message}` });
  }
};

exports.replyToComment = async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ message: 'text is required' });
  }

  try {
    const comment = await ThreadsComment.findById(req.params.id).populate('account');
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    if (!comment.account || comment.account.platform !== 'threads') {
      return res.status(400).json({ message: 'Replying is only supported for threads accounts' });
    }

    const account = comment.account;
    if (isResting(account)) {
      return res.status(409).json({
        message:
          `Account is resting to avoid looking automated — try again after ` +
          new Date(account.restUntil).toLocaleString(),
        restUntil: account.restUntil,
      });
    }

    const password = decrypt(account.passwordEncrypted);
    await threadsMcpService.replyToComment(account, password, comment.postUrl, comment.text, text);

    comment.replyText = text;
    comment.repliedAt = new Date();
    comment.status = 'replied';
    await comment.save();
    await markAccountActive(account);

    const populated = await ThreadsComment.findById(comment._id).populate(
      'account',
      'platform username displayName restUntil'
    );
    res.json(populated);
  } catch (err) {
    res.status(502).json({ message: `Reply failed: ${err.message}` });
  }
};

exports.markStatus = async (req, res, next) => {
  try {
    const { status } = req.body || {};
    const allowed = ['new', 'replied', 'handled'];
    const nextStatus = allowed.includes(status) ? status : 'handled';
    const comment = await ThreadsComment.findByIdAndUpdate(
      req.params.id,
      { status: nextStatus },
      { new: true }
    ).populate('account', 'platform username displayName restUntil');
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    res.json(comment);
  } catch (err) {
    next(err);
  }
};

exports.deleteComment = async (req, res, next) => {
  try {
    const comment = await ThreadsComment.findByIdAndDelete(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    next(err);
  }
};
