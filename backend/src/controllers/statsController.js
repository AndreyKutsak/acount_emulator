const SocialAccount = require("../models/SocialAccount");
const Post = require("../models/Post");
const ThreadsComment = require("../models/ThreadsComment");
const VpnServer = require("../models/VpnServer");
const VpnSession = require("../models/VpnSession");
const scheduler = require("../services/scheduler");

// Aggregates the whole farm into one payload for the dashboard. Kept in its own
// controller so the frontend can render an overview with a single request instead
// of firing one request per collection.
exports.getStats = async (req, res, next) => {
  try {
    const [accounts, posts, comments, servers, activeSessions] =
      await Promise.all([
        SocialAccount.find().populate("vpnServer", "name host status"),
        Post.find().populate(
          "accounts.account",
          "platform username displayName",
        ),
        ThreadsComment.find(),
        VpnServer.find(),
        VpnSession.countDocuments({ status: "active" }),
      ]);

    // --- accounts ---
    const accountByPlatform = {};
    const auth = { authorized: 0, failed: 0, blocked: 0, unknown: 0 };
    for (const a of accounts) {
      accountByPlatform[a.platform] = (accountByPlatform[a.platform] || 0) + 1;
      auth[a.authStatus || "unknown"] =
        (auth[a.authStatus || "unknown"] || 0) + 1;
    }

    // --- posts ---
    const postSummaries = posts.map((p) => p.toSummary());
    const postByStatus = {
      draft: 0,
      active: 0,
      published_partial: 0,
      published_all: 0,
    };
    const metrics = { views: 0, likes: 0, comments: 0 };
    for (const p of postSummaries) {
      postByStatus[p.overallStatus] = (postByStatus[p.overallStatus] || 0) + 1;
      metrics.views += p.metrics.views || 0;
      metrics.likes += p.metrics.likes || 0;
      metrics.comments += p.metrics.comments || 0;
    }

    // --- comments ---
    const commentsByStatus = { new: 0, replied: 0, handled: 0 };
    for (const c of comments) {
      commentsByStatus[c.status] = (commentsByStatus[c.status] || 0) + 1;
    }

    // --- vpn ---
    const vpnByStatus = { online: 0, offline: 0, unknown: 0 };
    for (const s of servers) {
      vpnByStatus[s.status] = (vpnByStatus[s.status] || 0) + 1;
    }

    const recentPosts = postSummaries.slice(0, 5).map((p) => ({
      _id: p._id,
      text: p.text,
      overallStatus: p.overallStatus,
      metrics: p.metrics,
      accountsCount: p.accounts.length,
      createdAt: p.createdAt,
    }));

    res.json({
      accounts: {
        total: accounts.length,
        byPlatform: accountByPlatform,
        auth,
      },
      posts: {
        total: posts.length,
        byStatus: postByStatus,
        metrics,
        recent: recentPosts,
      },
      comments: {
        total: comments.length,
        byStatus: commentsByStatus,
      },
      vpn: {
        total: servers.length,
        byStatus: vpnByStatus,
        activeSessions,
      },
      scheduler: scheduler.getStatus(),
    });
  } catch (err) {
    next(err);
  }
};
