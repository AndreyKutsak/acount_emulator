const SocialAccount = require("../models/SocialAccount");
const Post = require("../models/Post");
const ThreadsComment = require("../models/ThreadsComment");
const { decrypt } = require("./cryptoService");
const threadsMcpService = require("./threadsMcpService");
const browserService = require("./browserService");
const loginStrategies = require("./loginStrategies");
const publishStrategies = require("./publishStrategies");
const scrapeStrategies = require("./scrapeStrategies");
const { downloadAllToTempFiles, cleanupTempFiles } = require("./tempDownload");
const { captureAuthDebug } = require("./authDebugService");
const { isResting, scheduleRest, sleep, randomInt } = require("./humanize");

// Background "bot farm" loop. Everything the UI can trigger by hand (publish a
// scheduled post, refresh metrics, fetch Threads comments) is also run here on a
// timer, so the farm keeps working unattended:
//   * posts with scheduledAt in the past and still-pending accounts get published,
//   * published posts with a stored postUrl get their metrics re-scraped,
//   * threads accounts get their posts scanned for new comments.
// Every automated action schedules a rest window for the account (see humanize.js)
// so activity stays staggered instead of hammering platforms at a fixed cadence.

let intervalHandle = null;
let running = false;
let lastRunAt = null;
let lastSummary = null;

const ENABLED = process.env.SCHEDULER_ENABLED !== "false";
const INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS) || 60 * 1000;

// Kept in sync with automationController.recordAuthResult — records whether a login
// (or a publish that includes a login) succeeded, so the account table reflects the
// real state instead of "unknown" forever.
async function recordAuthResult(account, loggedIn, err, debugInfo) {
  if (loggedIn) {
    account.authStatus = "authorized";
    account.authError = "";
    account.authDebug = undefined;
  } else {
    account.authStatus =
      err?.code === "LOGIN_NOT_CONFIRMED" ? "blocked" : "failed";
    account.authError = err?.message || "";
    account.authDebug = debugInfo || undefined;
  }
  account.authCheckedAt = new Date();
  await account.save();
}

// Publishes one post to one account. Mirrors automationController.publishPostForAccount
// but without req/res, so it can be reused by the background loop.
async function publishToAccount(post, account, entry) {
  if (isResting(account)) {
    return {
      published: false,
      skipped: "resting",
      restUntil: account.restUntil,
    };
  }

  const postText = post.text;
  const urls = post.images || [];

  try {
    if (account.platform === "threads") {
      let tempPaths = [];
      try {
        const password = decrypt(account.passwordEncrypted);
        if (urls.length > 0) tempPaths = await downloadAllToTempFiles(urls);
        const result = await threadsMcpService.createPost(
          account,
          password,
          postText,
          tempPaths,
        );
        await recordAuthResult(account, true, null);

        entry.status = "published";
        entry.publishedAt = new Date();
        if (result?.postUrl) entry.postUrl = result.postUrl;
        await post.save();
        account.restUntil = scheduleRest();
        await account.save();
        return { published: true };
      } finally {
        cleanupTempFiles(tempPaths);
      }
    }

    const session = await browserService.createSession({
      accountId: account._id.toString(),
      label: "scheduled-publish",
      userAgent: account.userAgent || null,
    });

    let tempPaths = [];
    try {
      try {
        const password = decrypt(account.passwordEncrypted);
        await loginStrategies.login(session.page, {
          platform: account.platform,
          username: account.username,
          password,
        });
        await recordAuthResult(account, true, null);
      } catch (err) {
        const debugInfo = await captureAuthDebug(session.page);
        await recordAuthResult(account, false, err, debugInfo);
        throw new Error(`Login failed: ${err.message}`);
      }

      if (urls.length > 0) tempPaths = await downloadAllToTempFiles(urls);
      const result = await publishStrategies.publishPost(session.page, {
        platform: account.platform,
        text: postText,
        imagePaths: tempPaths,
        username: account.username,
      });

      entry.status = "published";
      entry.publishedAt = new Date();
      if (result?.postUrl) entry.postUrl = result.postUrl;
      await post.save();
      account.restUntil = scheduleRest();
      await account.save();
      return { published: true };
    } finally {
      cleanupTempFiles(tempPaths);
      await browserService.closeSession(session.id);
    }
  } catch (err) {
    entry.status = "failed";
    await post.save();
    await recordAuthResult(account, false, err).catch(() => {});
    // On failure still rest the account briefly so a broken selector doesn't turn
    // into a hammer loop on the next tick.
    account.restUntil = scheduleRest();
    await account.save().catch(() => {});
    return { published: false, error: err.message };
  }
}

async function publishDuePosts() {
  const due = await Post.find({
    scheduledAt: { $ne: null, $lte: new Date() },
    accounts: { $elemMatch: { status: "pending" } },
  }).populate("accounts.account", "platform username displayName userAgent");

  const summary = [];
  for (const post of due) {
    for (const entry of post.accounts) {
      if (entry.status !== "pending") continue;
      const account = entry.account;
      if (!account) {
        summary.push({
          postId: post._id,
          username: "deleted-account",
          error: "Account not found",
        });
        continue;
      }
      const result = await publishToAccount(post, account, entry);
      summary.push({
        postId: post._id,
        accountId: account._id,
        username: account.username,
        platform: account.platform,
        published: result.published,
        skipped: result.skipped,
        error: result.error,
      });
      if (result.published) {
        await sleep(randomInt(800, 2500)); // stagger multiple accounts on one post
      }
    }
  }
  return summary;
}

// Re-scrapes metrics for published posts that have a stored URL. The account's rest
// window (set after every action) is the throttle — a post is only re-checked once
// its account has finished resting, which keeps the cadence human instead of fixed.
async function refreshPublishedMetrics() {
  const posts = await Post.find({
    accounts: { $elemMatch: { status: "published", postUrl: { $ne: "" } } },
  }).populate("accounts.account", "platform username displayName userAgent");

  const summary = [];
  for (const post of posts) {
    for (const entry of post.accounts) {
      if (entry.status !== "published" || !entry.postUrl) continue;
      const account = entry.account;
      if (!account) continue;
      if (isResting(account)) {
        summary.push({
          postId: post._id,
          username: account.username,
          skipped: "resting",
        });
        continue;
      }

      const session = await browserService.createSession({
        accountId: account._id.toString(),
        label: "scheduled-metrics",
        userAgent: account.userAgent || null,
      });
      try {
        try {
          const password = decrypt(account.passwordEncrypted);
          await loginStrategies.login(session.page, {
            platform: account.platform,
            username: account.username,
            password,
          });
          await recordAuthResult(account, true, null);
        } catch (err) {
          const debugInfo = await captureAuthDebug(session.page);
          await recordAuthResult(account, false, err, debugInfo);
          throw new Error(`Login failed: ${err.message}`);
        }

        await session.page.goto(entry.postUrl, {
          waitUntil: "domcontentloaded",
        });
        await session.page
          .waitForLoadState("networkidle", { timeout: 30000 })
          .catch(() => {});
        const metrics = await scrapeStrategies.extractMetrics(
          session.page,
          account.platform,
        );

        if (metrics.views !== undefined) entry.views = metrics.views;
        if (metrics.likes !== undefined) entry.likes = metrics.likes;
        if (metrics.comments !== undefined) entry.comments = metrics.comments;
        await post.save();
        summary.push({
          postId: post._id,
          username: account.username,
          refreshed: true,
        });
      } catch (err) {
        summary.push({
          postId: post._id,
          username: account.username,
          error: err.message,
        });
      } finally {
        await browserService.closeSession(session.id);
      }

      account.restUntil = scheduleRest();
      await account.save().catch(() => {});
      await sleep(randomInt(800, 2000));
    }
  }
  return summary;
}

// Fetches new comments for every published threads post. Reuses the MCP-driven
// scraper (threadsMcpService.fetchComments) and upserts into ThreadsComment keyed by
// (account, postUrl, author+text hash) so re-scans don't duplicate rows.
async function fetchThreadsComments() {
  const accounts = await SocialAccount.find({ platform: "threads" });
  const summary = [];
  for (const account of accounts) {
    if (isResting(account)) {
      summary.push({
        accountId: account._id,
        username: account.username,
        skipped: "resting",
      });
      continue;
    }

    const posts = await Post.find({
      accounts: { $elemMatch: { account: account._id, postUrl: { $ne: "" } } },
    });

    let fetched = 0;
    let error = null;
    try {
      const password = decrypt(account.passwordEncrypted);
      for (const post of posts) {
        const entry = post.accounts.find(
          (a) => a.account.toString() === account._id.toString(),
        );
        if (!entry?.postUrl) continue;

        const replies = await threadsMcpService.fetchComments(
          account,
          password,
          entry.postUrl,
        );
        for (const reply of replies) {
          const commentKey = threadsMcpService.makeCommentKey(
            reply.author,
            reply.text,
          );
          await ThreadsComment.findOneAndUpdate(
            { account: account._id, postUrl: entry.postUrl, commentKey },
            {
              $setOnInsert: {
                account: account._id,
                post: post._id,
                postUrl: entry.postUrl,
                commentKey,
                author: reply.author || "",
                text: reply.text || "",
                status: "new",
              },
              $set: { fetchedAt: new Date() },
            },
            { upsert: true, new: true },
          );
          fetched += 1;
        }
        await sleep(randomInt(800, 2500));
      }
    } catch (err) {
      error = err.message;
    }

    account.restUntil = scheduleRest();
    await account.save().catch(() => {});

    summary.push({
      accountId: account._id,
      username: account.username,
      fetched,
      error,
    });
  }
  return summary;
}

async function tick() {
  if (running) return lastSummary;
  running = true;
  try {
    lastSummary = {
      startedAt: new Date(),
      published: [],
      metrics: [],
      comments: [],
    };
    lastSummary.published = await publishDuePosts();
    lastSummary.metrics = await refreshPublishedMetrics();
    lastSummary.comments = await fetchThreadsComments();
    lastRunAt = new Date();
    logSummary();
    return lastSummary;
  } finally {
    running = false;
  }
}

function logSummary() {
  const { published, metrics, comments } = lastSummary || {};
  const publishedCount = (published || []).filter((p) => p.published).length;
  const refreshedCount = (metrics || []).filter((m) => m.refreshed).length;
  const commentsFetched = (comments || []).reduce(
    (acc, c) => acc + (c.fetched || 0),
    0,
  );
  console.log(
    `[scheduler] tick done: published=${publishedCount}, metrics=${refreshedCount}, comments=${commentsFetched}`,
  );
}

function startScheduledChecks(intervalMs = INTERVAL_MS) {
  if (!ENABLED) {
    console.log("[scheduler] disabled (SCHEDULER_ENABLED=false)");
    return null;
  }
  if (intervalHandle) return intervalHandle;

  // First tick shortly after boot, then on the interval. A rejected promise must
  // never kill the loop.
  setTimeout(
    () =>
      tick().catch((err) =>
        console.error("[scheduler] tick failed:", err.message),
      ),
    3000,
  );

  intervalHandle = setInterval(() => {
    tick().catch((err) =>
      console.error("[scheduler] tick failed:", err.message),
    );
  }, intervalMs);

  console.log(`[scheduler] running every ${intervalMs}ms`);
  return intervalHandle;
}

function stopScheduledChecks() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function getStatus() {
  return {
    enabled: ENABLED,
    running,
    intervalMs: INTERVAL_MS,
    lastRunAt,
    lastSummary,
  };
}

module.exports = {
  tick,
  startScheduledChecks,
  stopScheduledChecks,
  getStatus,
};
