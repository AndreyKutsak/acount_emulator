const mongoose = require('mongoose');
const SocialAccount = require('../models/SocialAccount');
const VpnSession = require('../models/VpnSession');
const Post = require('../models/Post');
const { decrypt } = require('../services/cryptoService');
const { captureAuthDebug } = require('../services/authDebugService');
const threadsMcpService = require('../services/threadsMcpService');
const mcpBrowserService = require('../services/mcpBrowserService');
const browserService = require('../services/browserService');
const loginStrategies = require('../services/loginStrategies');
const scrapeStrategies = require('../services/scrapeStrategies');
const publishStrategies = require('../services/publishStrategies');
const { downloadAllToTempFiles, cleanupTempFiles } = require('../services/tempDownload');
const { USER_AGENT_PRESETS } = require('../services/userAgentPresets');
const { scheduleRest, isResting } = require('../services/humanize');
const proxyManager = require('../services/proxyManager');
const tlsClient = require('../services/tlsClient');

function toSafeAccount(account) {
  const obj = account.toObject();
  delete obj.passwordEncrypted;
  delete obj.threadsSessionEncrypted;
  delete obj.proxyConfig;
  return obj;
}

async function recordAuthResult(account, loggedIn, err, debugInfo) {
  if (loggedIn) {
    account.authStatus = 'authorized';
    account.authError = '';
    account.authDebug = undefined;
  } else {
    // LOGIN_NOT_CONFIRMED means the form was filled and submitted without error, but the
    // platform never actually left the login page — typically a soft rate limit/automation
    // checkpoint after repeated automated logins, not a simple wrong-password failure.
    account.authStatus = err?.code === 'LOGIN_NOT_CONFIRMED' ? 'blocked' : 'failed';
    account.authError = err?.message || '';
    account.authDebug = debugInfo || undefined;
  }
  account.authCheckedAt = new Date();
  await account.save();
}

exports.listSessions = (req, res) => {
  res.json(browserService.listSessions());
};

exports.listUserAgentPresets = (req, res) => {
  res.json(USER_AGENT_PRESETS);
};

exports.health = (req, res) => {
  res.json({
    engine: process.env.BROWSER_ENGINE || 'playwright',
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    browser: 'ok',
    proxy: proxyManager.enabled()
      ? { enabled: true, endpoint: process.env.PROXY_ENDPOINT }
      : { enabled: false, note: 'no residential proxy — using direct/VPN egress' },
    tls: tlsClient.available()
      ? { enabled: true, impersonate: process.env.TLS_IMPERSONATE || 'chrome124' }
      : { enabled: false, note: 'impersonated-fetch not installed — using plain fetch' },
  });
};

exports.checkAuth = async (req, res, next) => {
  try {
    const account = await SocialAccount.findById(req.params.accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    // Threads is driven through the Playwright MCP server (browser automation over
    // MCP tool calls) instead of threads-bot's direct private API — see
    // services/threadsMcpService.js / services/mcpBrowserService.js.
    if (account.platform === 'threads') {
      let loggedIn = false;
      let loginErr = null;
      try {
        const password = decrypt(account.passwordEncrypted);
        await threadsMcpService.checkAuth(account, password);
        loggedIn = true;
      } catch (err) {
        loginErr = err;
      }
      await recordAuthResult(account, loggedIn, loginErr, null);
      return res.json(toSafeAccount(account));
    }

    const tempSession = await browserService.createSession({
      accountId: account._id.toString(),
      label: 'auth-check',
      userAgent: req.body?.userAgent || account.userAgent || null,
      profileId: account.profileId || null,
    });

    let loggedIn = false;
    let loginErr = null;
    let debugInfo = null;
    try {
      const password = decrypt(account.passwordEncrypted);
      await loginStrategies.login(tempSession.page, {
        platform: account.platform,
        username: account.username,
        password,
        loginUrl: req.body?.loginUrl,
      });
      loggedIn = true;
    } catch (err) {
      loginErr = err;
      debugInfo = await captureAuthDebug(tempSession.page);
    } finally {
      await browserService.closeSession(tempSession.id);
    }

    await recordAuthResult(account, loggedIn, loginErr, debugInfo);
    res.json(toSafeAccount(account));
  } catch (err) {
    next(err);
  }
};

// A curated whitelist of one-off actions a human can trigger from the account's
// "Дії" modal — never arbitrary method names from the request body. Browser/DOM
// automation (unlike threads-bot's direct API) can't cheaply do like/follow/mute/
// block or read counters without a lot more selector work, so only posting is
// wired up here for now.
const THREADS_MANUAL_ACTIONS = {
  createPost: async (account, password, { text }) => {
    if (!text?.trim()) throw new Error('text is required');
    return threadsMcpService.createPost(account, password, text.trim());
  },
};

exports.listThreadsActions = (req, res) => {
  res.json(Object.keys(THREADS_MANUAL_ACTIONS));
};

// One-off manual actions for the account's "Дії" modal, triggered by a human on
// demand — not part of any scheduled automation loop.
exports.threadsManualAction = async (req, res) => {
  const { action, ...payload } = req.body || {};
  try {
    const account = await SocialAccount.findById(req.params.accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    if (account.platform !== 'threads') {
      return res.status(400).json({ message: 'Manual actions are only supported for threads accounts' });
    }
    const handler = THREADS_MANUAL_ACTIONS[action];
    if (!handler) {
      return res.status(400).json({ message: `Unknown action "${action}"` });
    }
    if (isResting(account)) {
      return res.status(409).json({
        message:
          `Account is resting to avoid looking automated — try again after ` +
          new Date(account.restUntil).toLocaleString(),
        restUntil: account.restUntil,
      });
    }

    const password = decrypt(account.passwordEncrypted);
    const result = await handler(account, password, payload);
    account.restUntil = scheduleRest();
    await account.save();

    res.json({ action, result });
  } catch (err) {
    res.status(502).json({ message: `Action failed: ${err.message}` });
  }
};

// Threads (like the rest of Meta) refuses to render inside anyone else's iframe, so
// the only way to hand the user the real, live Threads UI for this account is a real
// browser window: launches a visible browser via the Playwright MCP server,
// pre-authenticated with the account's own saved session. Close it later via
// DELETE /automation/sessions/:id (mcp:<id>).
exports.openManualBrowser = async (req, res) => {
  try {
    const account = await SocialAccount.findById(req.params.accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });
    if (account.platform !== 'threads') {
      return res.status(400).json({ message: 'Opening a live browser window is only wired up for threads accounts' });
    }
    if (isResting(account)) {
      return res.status(409).json({
        message:
          `Account is resting to avoid looking automated — try again after ` +
          new Date(account.restUntil).toLocaleString(),
        restUntil: account.restUntil,
      });
    }

    const password = decrypt(account.passwordEncrypted);
    const sessionId = await threadsMcpService.openManualBrowser(account, password);

    account.restUntil = scheduleRest();
    await account.save();

    res.json({ sessionId: `mcp:${sessionId}`, message: 'Відкрито реальне вікно Chrome, залогінене під цей акаунт.' });
  } catch (err) {
    res.status(502).json({ message: `Could not open browser: ${err.message}` });
  }
};

exports.startSession = async (req, res, next) => {
  try {
    const { accountId, label, loginUrl, skipLogin, userAgent } = req.body;
    if (!accountId) return res.status(400).json({ message: 'accountId is required' });

    const account = await SocialAccount.findById(accountId).populate('vpnServer');
    if (!account) return res.status(404).json({ message: 'Account not found' });

    let vpnSession = null;
    if (account.vpnServer) {
      // Bookkeeping only: the actual VPN tunnel (OpenVPN/WireGuard/IPSec) must already be
      // up at the OS level before this runs — Playwright just records which VPN the session
      // is assumed to be using, it does not establish the tunnel itself.
      vpnSession = await VpnSession.create({
        server: account.vpnServer._id,
        label: label || `automation:${account.username}`,
      });
    }

    const session = await browserService.createSession({
      accountId: account._id.toString(),
      vpnServerId: account.vpnServer ? account.vpnServer._id.toString() : null,
      vpnSessionId: vpnSession ? vpnSession._id.toString() : null,
      label: label || '',
      userAgent: userAgent || account.userAgent || null,
      profileId: account.profileId || null,
    });

    let loggedIn = false;
    let loginErr = null;
    if (!skipLogin) {
      let debugInfo = null;
      try {
        const password = decrypt(account.passwordEncrypted);
        await loginStrategies.login(session.page, {
          platform: account.platform,
          username: account.username,
          password,
          loginUrl,
        });
        loggedIn = true;
      } catch (err) {
        loginErr = err;
        debugInfo = await captureAuthDebug(session.page);
      }
      await recordAuthResult(account, loggedIn, loginErr, debugInfo);
    }

    res.status(201).json({
      sessionId: session.id,
      accountId: account._id,
      platform: account.platform,
      vpnSessionId: vpnSession ? vpnSession._id : null,
      loggedIn,
      loginError: loginErr?.message || null,
      authStatus: account.authStatus,
      userAgent: session.userAgent,
    });
  } catch (err) {
    next(err);
  }
};

exports.stopSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (sessionId.startsWith('mcp:')) {
      const closed = await mcpBrowserService.closeSession(sessionId.slice(4));
      if (!closed) return res.status(404).json({ message: 'Session not found' });
      return res.json({ message: 'Session closed' });
    }

    const session = browserService.getSession(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    if (session.vpnSessionId) {
      await VpnSession.findByIdAndUpdate(session.vpnSessionId, {
        status: 'closed',
        endedAt: new Date(),
      }).catch(() => {});
    }

    await browserService.closeSession(sessionId);
    res.json({ message: 'Session closed' });
  } catch (err) {
    next(err);
  }
};

exports.navigate = async (req, res, next) => {
  try {
    const session = browserService.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const { url } = req.body;
    if (!url) return res.status(400).json({ message: 'url is required' });

    await session.page.goto(url, { waitUntil: 'domcontentloaded' });
    res.json({ message: 'Navigated', url });
  } catch (err) {
    next(err);
  }
};

exports.extract = async (req, res, next) => {
  try {
    const session = browserService.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const { selectors } = req.body;
    if (!selectors || typeof selectors !== 'object') {
      return res.status(400).json({ message: 'selectors object is required, e.g. { "title": "h1" }' });
    }

    const entries = await Promise.all(
      Object.entries(selectors).map(async ([key, selector]) => {
        const text = await session.page
          .locator(selector)
          .first()
          .innerText({ timeout: 5000 })
          .catch(() => null);
        return [key, text];
      })
    );

    res.json(Object.fromEntries(entries));
  } catch (err) {
    next(err);
  }
};

exports.scrapePost = async (req, res, next) => {
  try {
    const session = browserService.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const { postId, url, selectors } = req.body;
    if (!postId || !url) {
      return res.status(400).json({ message: 'postId and url are required' });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const entry = post.accounts.find((a) => a.account.toString() === session.accountId);
    if (!entry) return res.status(404).json({ message: 'Account not linked to this post' });

    const account = await SocialAccount.findById(session.accountId);

    await session.page.goto(url, { waitUntil: 'domcontentloaded' });
    const metrics = await scrapeStrategies.extractMetrics(session.page, account.platform, selectors);

    if (metrics.views !== undefined) entry.views = metrics.views;
    if (metrics.likes !== undefined) entry.likes = metrics.likes;
    if (metrics.comments !== undefined) entry.comments = metrics.comments;
    if (entry.status !== 'published') {
      entry.status = 'published';
      entry.publishedAt = entry.publishedAt || new Date();
    }

    await post.save();
    const populated = await Post.findById(post._id).populate(
      'accounts.account',
      'platform username displayName'
    );
    res.json(populated.toSummary());
  } catch (err) {
    next(err);
  }
};

exports.publishPostForAccount = async (req, res) => {
  const { postId, accountId, text, imageUrls, userAgent } = req.body;
  if (!postId || !accountId) {
    return res.status(400).json({ message: 'postId and accountId are required' });
  }
  if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(accountId)) {
    return res.status(400).json({ message: 'postId and accountId must be valid ids' });
  }

  try {
    const account = await SocialAccount.findById(accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const entry = post.accounts.find((a) => a.account.toString() === accountId);
    if (!entry) return res.status(404).json({ message: 'Account not linked to this post' });

    if (account.platform === 'threads') {
      let tempPaths = [];
      try {
        const password = decrypt(account.passwordEncrypted);
        const postText = text ?? post.text;
        const urls = imageUrls ?? post.images ?? [];
        if (urls.length > 0) {
          tempPaths = await downloadAllToTempFiles(urls);
        }

        const result = await threadsMcpService.createPost(account, password, postText, tempPaths);
        await recordAuthResult(account, true, null);

        entry.status = 'published';
        entry.publishedAt = new Date();
        if (result?.postUrl) entry.postUrl = result.postUrl;
        await post.save();
      } catch (err) {
        await recordAuthResult(account, false, err);
        return res.status(502).json({ message: `Publish failed: ${err.message}` });
      } finally {
        cleanupTempFiles(tempPaths);
      }

      const populatedThreads = await Post.findById(post._id).populate(
        'accounts.account',
        'platform username displayName'
      );
      return res.json(populatedThreads.toSummary());
    }

    const session = await browserService.createSession({
      accountId: account._id.toString(),
      label: 'publish-now',
      userAgent: userAgent || account.userAgent || null,
      profileId: account.profileId || null,
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

      const postText = text ?? post.text;
      const urls = imageUrls ?? post.images ?? [];
      if (urls.length > 0) {
        tempPaths = await downloadAllToTempFiles(urls);
      }

      const result = await publishStrategies.publishPost(session.page, {
        platform: account.platform,
        text: postText,
        imagePaths: tempPaths,
        username: account.username,
      });

      entry.status = 'published';
      entry.publishedAt = new Date();
      if (result?.postUrl) entry.postUrl = result.postUrl;
      await post.save();
    } finally {
      cleanupTempFiles(tempPaths);
      await browserService.closeSession(session.id);
    }

    const populated = await Post.findById(post._id).populate(
      'accounts.account',
      'platform username displayName'
    );
    res.json(populated.toSummary());
  } catch (err) {
    res.status(502).json({ message: `Publish failed: ${err.message}` });
  }
};

exports.refreshMetrics = async (req, res) => {
  const { postId, accountId, userAgent } = req.body;
  if (!postId || !accountId) {
    return res.status(400).json({ message: 'postId and accountId are required' });
  }
  if (!mongoose.isValidObjectId(postId) || !mongoose.isValidObjectId(accountId)) {
    return res.status(400).json({ message: 'postId and accountId must be valid ids' });
  }

  try {
    const account = await SocialAccount.findById(accountId);
    if (!account) return res.status(404).json({ message: 'Account not found' });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const entry = post.accounts.find((a) => a.account.toString() === accountId);
    if (!entry) return res.status(404).json({ message: 'Account not linked to this post' });
    if (!entry.postUrl) {
      return res.status(400).json({
        message:
          'This post has no stored URL yet — publish it via automation first (manually marking it published does not capture a URL to scrape).',
      });
    }

    // No special-casing needed for threads here: it never depended on threads-bot —
    // scrapeStrategies.js already has a threads DOM extractor, so the generic
    // Playwright-session path below (login + scrape) handles it like any other platform.
    const session = await browserService.createSession({
      accountId: account._id.toString(),
      label: 'refresh-metrics',
      userAgent: userAgent || account.userAgent || null,
      profileId: account.profileId || null,
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

      await session.page.goto(entry.postUrl, { waitUntil: 'domcontentloaded' });
      await session.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      const metrics = await scrapeStrategies.extractMetrics(session.page, account.platform);

      if (metrics.views !== undefined) entry.views = metrics.views;
      if (metrics.likes !== undefined) entry.likes = metrics.likes;
      if (metrics.comments !== undefined) entry.comments = metrics.comments;
      await post.save();
    } finally {
      await browserService.closeSession(session.id);
    }

    const populated = await Post.findById(post._id).populate(
      'accounts.account',
      'platform username displayName'
    );
    res.json(populated.toSummary());
  } catch (err) {
    res.status(502).json({ message: `Metrics refresh failed: ${err.message}` });
  }
};

exports.publishPost = async (req, res, next) => {
  try {
    const session = browserService.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const { postId, text, imageUrls } = req.body;
    if (!postId) return res.status(400).json({ message: 'postId is required' });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const entry = post.accounts.find((a) => a.account.toString() === session.accountId);
    if (!entry) return res.status(404).json({ message: 'Account not linked to this post' });

    const account = await SocialAccount.findById(session.accountId);
    const postText = text ?? post.text;
    const urls = imageUrls ?? post.images ?? [];

    let tempPaths = [];
    let resultPostUrl = null;
    try {
      if (urls.length > 0) {
        tempPaths = await downloadAllToTempFiles(urls);
      }

      const result = await publishStrategies.publishPost(session.page, {
        platform: account.platform,
        text: postText,
        imagePaths: tempPaths,
        username: account.username,
      });
      resultPostUrl = result?.postUrl;
    } finally {
      cleanupTempFiles(tempPaths);
    }

    entry.status = 'published';
    entry.publishedAt = new Date();
    if (resultPostUrl) entry.postUrl = resultPostUrl;
    await post.save();

    const populated = await Post.findById(post._id).populate(
      'accounts.account',
      'platform username displayName'
    );
    res.json(populated.toSummary());
  } catch (err) {
    // Publish failures are expected while selectors are being tuned against a live
    // platform UI — surface the exact step that failed instead of a generic 500.
    res.status(502).json({ message: `Publish failed: ${err.message}` });
  }
};
