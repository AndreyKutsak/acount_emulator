const Post = require('../models/Post');
const postPlan = require('../services/postPlan');
const postMedia = require('../services/postMedia');

function rejectInvalid(res, validation) {
  return res.status(400).json({
    message: `Пост не пройшов перевірку правил Threads: ${validation.errors.map((e) => e.message).join(' ')}`,
    validation,
  });
}

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
    const validation = await postPlan.validatePost({ text, accountIds, scheduledAt });
    if (!validation.ok) return rejectInvalid(res, validation);
    const post = await Post.create({
      text,
      images: images || [],
      scheduledAt: scheduledAt || null,
      accounts: accountIds.map((id) => ({ account: id })),
    });
    const summary = await populateAndSummarize(Post.findById(post._id));
    res.status(201).json({ ...summary, validation });
  } catch (err) {
    next(err);
  }
};

exports.updatePost = async (req, res, next) => {
  try {
    const { text, images, scheduledAt } = req.body;
    const existing = await Post.findById(req.params.id, 'accounts.account');
    if (!existing) return res.status(404).json({ message: 'Post not found' });
    const validation = await postPlan.validatePost({
      text,
      accountIds: existing.accounts.map((a) => a.account),
      scheduledAt,
      postId: existing._id,
    });
    if (!validation.ok) return rejectInvalid(res, validation);
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { text, images, scheduledAt },
      { new: true, runValidators: true }
    );
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const summary = await populateAndSummarize(Post.findById(post._id));
    res.json({ ...summary, validation });
  } catch (err) {
    next(err);
  }
};

// Жива перевірка з форми: { text, accountIds?, scheduledAt?, postId? } -> результат правил.
exports.validatePost = async (req, res, next) => {
  try {
    const { text, accountIds, scheduledAt, postId } = req.body || {};
    res.json(
      await postPlan.validatePost({
        text,
        accountIds: Array.isArray(accountIds) ? accountIds : [],
        scheduledAt: scheduledAt || null,
        postId: postId || null,
      })
    );
  } catch (err) {
    next(err);
  }
};

// Денний план Threads-акаунтів: ?date=YYYY-MM-DD (за замовчуванням — сьогодні).
exports.getDailyPlan = async (req, res, next) => {
  try {
    res.json(await postPlan.dailyPlan(req.query.date));
  } catch (err) {
    next(err);
  }
};

// Шаблон вакансії для Threads (кнопка «Вставити шаблон» у формі).
exports.getJobTemplate = (req, res) => {
  const { TEMPLATE, REQUIRED } = require('../services/threadsJobTemplate');
  res.json({ text: TEMPLATE, required: REQUIRED });
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

// Фото до поста з браузера (сире тіло, ім'я в ?name=) -> { url } для Post.images.
exports.uploadImage = async (req, res, next) => {
  try {
    res.status(201).json(await postMedia.saveUpload(req));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
};
