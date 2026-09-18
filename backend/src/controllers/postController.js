const Post = require('../models/Post');

async function populateAndSummarize(query) {
  const post = await query.populate('accounts.account', 'platform username displayName');
  return post.toSummary();
}

exports.getPosts = async (req, res, next) => {
  try {
    const posts = await Post.find().populate('accounts.account', 'platform username displayName').sort({
      createdAt: -1,
    });
    res.json(posts.map((p) => p.toSummary()));
  } catch (err) {
    next(err);
  }
};

exports.getPost = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id).populate(
      'accounts.account',
      'platform username displayName'
    );
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json(post.toSummary());
  } catch (err) {
    next(err);
  }
};

exports.createPost = async (req, res, next) => {
  try {
    const { text, images, scheduledAt, accountIds } = req.body;
    if (!Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({ message: 'accountIds must be a non-empty array' });
    }
    const post = await Post.create({
      text,
      images: images || [],
      scheduledAt: scheduledAt || null,
      accounts: accountIds.map((id) => ({ account: id })),
    });
    const summary = await populateAndSummarize(Post.findById(post._id));
    res.status(201).json(summary);
  } catch (err) {
    next(err);
  }
};

exports.updatePost = async (req, res, next) => {
  try {
    const { text, images, scheduledAt } = req.body;
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { text, images, scheduledAt },
      { new: true, runValidators: true }
    );
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const summary = await populateAndSummarize(Post.findById(post._id));
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

exports.deletePost = async (req, res, next) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ message: 'Post deleted' });
  } catch (err) {
    next(err);
  }
};

exports.updatePostAccount = async (req, res, next) => {
  try {
    const { status, publishedAt, views, likes, comments } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const entry = post.accounts.find((a) => a.account.toString() === req.params.accountId);
    if (!entry) return res.status(404).json({ message: 'Account not linked to this post' });

    if (status) entry.status = status;
    if (status === 'published' && !entry.publishedAt) entry.publishedAt = new Date();
    if (publishedAt) entry.publishedAt = publishedAt;
    if (views !== undefined) entry.views = views;
    if (likes !== undefined) entry.likes = likes;
    if (comments !== undefined) entry.comments = comments;

    await post.save();
    const summary = await populateAndSummarize(Post.findById(post._id));
    res.json(summary);
  } catch (err) {
    next(err);
  }
};
