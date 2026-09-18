const crypto = require('crypto');
const mcpBrowserService = require('./mcpBrowserService');
const { encrypt, decrypt } = require('./cryptoService');
const { sleep, randomInt } = require('./humanize');

// Threads exposes no stable comment id in the DOM, so re-scrapes are deduplicated
// by a hash of (author + text) instead of a platform-issued id.
function makeCommentKey(author, text) {
  return crypto.createHash('sha1').update(`${author}::${text}`).digest('hex');
}

// Same selectors the pre-threads-bot Playwright automation used for Threads
// (loginStrategies.js / publishStrategies.js) — issued here as MCP tool calls
// (browser_click/browser_type) instead of direct page.fill()/page.click().
const LOGIN_URL = 'https://www.threads.com/login';
const USERNAME_SELECTOR = 'input[placeholder="Username, phone or email"], input[name="username"]';
const PASSWORD_SELECTOR = 'input[type="password"]';
const SUBMIT_SELECTOR = 'input[type="submit"], button:has-text("Log in")';
const COMPOSE_TRIGGER_SELECTOR = 'text=/what.?s new\\??/i, [aria-label="New thread"]';
const EDITOR_SELECTOR = '[role="dialog"] [contenteditable="true"], [contenteditable="true"]';
const POST_BUTTON_SELECTOR = 'button:has-text("Post")';
const REPLY_ICON_SELECTOR = 'svg[aria-label="Reply"]';

function loadStoredSession(account) {
  if (!account.threadsSessionEncrypted) return null;
  try {
    return JSON.parse(decrypt(account.threadsSessionEncrypted));
  } catch {
    return null;
  }
}

async function persistSession(account, storageState) {
  account.threadsSessionEncrypted = encrypt(JSON.stringify(storageState));
  await account.save();
}

function throwNotConfirmed() {
  const err = new Error(
    'Still on the login page after submitting credentials — this usually means either the ' +
      'password is wrong, or (more likely after repeated automated attempts in a short time) ' +
      'the platform has quietly soft-blocked automated sessions for this account.'
  );
  err.code = 'LOGIN_NOT_CONFIRMED';
  throw err;
}

async function performLogin(session, username, password) {
  await mcpBrowserService.callTool(session, 'browser_navigate', { url: LOGIN_URL });
  await sleep(randomInt(500, 1200));
  await mcpBrowserService.callTool(session, 'browser_type', {
    element: 'username field',
    target: USERNAME_SELECTOR,
    text: username,
  });
  await sleep(randomInt(300, 900));
  await mcpBrowserService.callTool(session, 'browser_type', {
    element: 'password field',
    target: PASSWORD_SELECTOR,
    text: password,
  });
  await sleep(randomInt(300, 900));
  await mcpBrowserService.callTool(session, 'browser_click', {
    element: 'log in button',
    target: SUBMIT_SELECTOR,
  });
  await sleep(randomInt(1500, 3000));
  const waitText = await mcpBrowserService.callTool(session, 'browser_wait_for', { time: 2 });

  const url = mcpBrowserService.extractPageUrl(waitText);
  if ((url || '').toLowerCase().includes('login')) {
    throwNotConfirmed();
  }
}

// Restores a saved session if there is one and it still works; otherwise drives
// the real login form and persists the resulting session for next time.
async function ensureLoggedIn(session, account, password) {
  const stored = loadStoredSession(account);
  if (stored) {
    const navText = await mcpBrowserService.callTool(session, 'browser_navigate', {
      url: 'https://www.threads.com/',
    });
    const url = mcpBrowserService.extractPageUrl(navText);
    if (url && !url.toLowerCase().includes('login')) {
      return;
    }
  }

  await performLogin(session, account.username, password);
  const storageState = await mcpBrowserService.saveStorageState(session);
  await persistSession(account, storageState);
}

async function withSession(account, { headless = true } = {}, fn) {
  const session = await mcpBrowserService.startSession({
    accountId: account._id.toString(),
    headless,
    storageState: loadStoredSession(account),
    userAgent: account.userAgent || null,
  });
  try {
    return await fn(session);
  } finally {
    await mcpBrowserService.closeSession(session.id);
  }
}

async function checkAuth(account, password) {
  await withSession(account, { headless: true }, (session) => ensureLoggedIn(session, account, password));
}

async function createPost(account, password, text, imagePaths = []) {
  return withSession(account, { headless: true }, async (session) => {
    await ensureLoggedIn(session, account, password);

    await mcpBrowserService.callTool(session, 'browser_navigate', { url: 'https://www.threads.com/' });
    await sleep(randomInt(800, 2000));

    await mcpBrowserService.callTool(session, 'browser_click', {
      element: 'compose trigger ("What\'s new?" row or "New thread")',
      target: COMPOSE_TRIGGER_SELECTOR,
    });
    await sleep(randomInt(500, 1200));

    await mcpBrowserService.callTool(session, 'browser_click', {
      element: 'post text editor',
      target: EDITOR_SELECTOR,
    });
    await mcpBrowserService.callTool(session, 'browser_type', {
      element: 'post text editor',
      target: EDITOR_SELECTOR,
      text,
      slowly: true,
    });

    if (imagePaths.length > 0) {
      await mcpBrowserService.callTool(session, 'browser_file_upload', { paths: imagePaths });
      await sleep(randomInt(1000, 2000));
    }

    await sleep(randomInt(400, 1200));
    await mcpBrowserService.callTool(session, 'browser_click', {
      element: 'Post button',
      target: POST_BUTTON_SELECTOR,
    });
    await sleep(randomInt(1500, 3000));

    await mcpBrowserService
      .callTool(session, 'browser_take_screenshot', { filename: 'post-confirmation.png' })
      .catch(() => {});

    // Threads doesn't redirect to the new post's permalink after posting — recover
    // it by opening the author's own profile and taking the newest post listed.
    let postUrl = null;
    if (account.username) {
      await mcpBrowserService
        .callTool(session, 'browser_navigate', { url: `https://www.threads.com/@${account.username}` })
        .catch(() => {});
      await sleep(randomInt(800, 1500));
      const evalText = await mcpBrowserService
        .callTool(session, 'browser_evaluate', {
          function:
            '() => { const a = document.querySelector(\'a[href*="/post/"]\'); return a ? a.getAttribute("href") : null; }',
        })
        .catch(() => null);
      const href = evalText ? mcpBrowserService.extractEvalResult(evalText) : null;
      if (href) postUrl = href.startsWith('http') ? href : `https://www.threads.com${href}`;
    }

    return { postUrl };
  });
}

// Reads replies on a post via the same DOM shape the pre-threads-bot scraper used
// (each reply is an <article> after the root post) — run in-page through
// browser_evaluate so no accessibility-tree parsing is needed.
async function scrapeComments(session, postUrl) {
  await mcpBrowserService.callTool(session, 'browser_navigate', { url: postUrl });
  await sleep(randomInt(1000, 2500));

  const evalText = await mcpBrowserService.callTool(session, 'browser_evaluate', {
    function: `() => {
      const articles = Array.from(document.querySelectorAll('article'));
      return articles.slice(1).map((article) => {
        const authorLink = article.querySelector('a[href^="/@"]');
        const author = authorLink
          ? authorLink.getAttribute('href').replace(/^\\/@/, '').replace(/\\/$/, '')
          : '';
        const spans = Array.from(article.querySelectorAll('span[dir="auto"]'));
        const text = spans.map((s) => s.innerText).join(' ').trim();
        return { author, text };
      }).filter((c) => c.text);
    }`,
  });

  return mcpBrowserService.extractEvalResult(evalText) || [];
}

async function fetchComments(account, password, postUrl) {
  return withSession(account, { headless: true }, async (session) => {
    await ensureLoggedIn(session, account, password);
    return scrapeComments(session, postUrl);
  });
}

async function replyToComment(account, password, postUrl, commentText, replyText) {
  return withSession(account, { headless: true }, async (session) => {
    await ensureLoggedIn(session, account, password);
    await mcpBrowserService.callTool(session, 'browser_navigate', { url: postUrl });
    await sleep(randomInt(1000, 2000));

    // Find the article containing this comment's text, then click its own Reply icon
    // — expressed as a single evaluate that returns an index, since MCP's element
    // selectors can't target "the Nth article whose text includes X" directly.
    const findText = await mcpBrowserService.callTool(session, 'browser_evaluate', {
      function: `() => {
        const articles = Array.from(document.querySelectorAll('article'));
        const target = ${JSON.stringify(commentText.slice(0, 40))};
        for (let i = 1; i < articles.length; i++) {
          if (articles[i].innerText.includes(target)) return i;
        }
        return -1;
      }`,
    });
    const index = mcpBrowserService.extractEvalResult(findText);
    if (index === null || index === -1) {
      throw new Error(
        'Could not find the original comment on the page to reply to — the post layout may ' +
          'have changed, or the comment was deleted.'
      );
    }

    const replySelector = `article:nth-of-type(${index + 1}) ${REPLY_ICON_SELECTOR}`;
    await mcpBrowserService.callTool(session, 'browser_click', {
      element: 'reply icon on the comment',
      target: replySelector,
    });
    await sleep(randomInt(500, 1200));

    await mcpBrowserService.callTool(session, 'browser_click', {
      element: 'reply text editor',
      target: EDITOR_SELECTOR,
    });
    await mcpBrowserService.callTool(session, 'browser_type', {
      element: 'reply text editor',
      target: EDITOR_SELECTOR,
      text: replyText,
      slowly: true,
    });
    await sleep(randomInt(400, 1200));
    await mcpBrowserService.callTool(session, 'browser_click', {
      element: 'Post/Reply button',
      target: 'button:has-text("Post"), button:has-text("Reply")',
    });
    await sleep(randomInt(1000, 2500));
  });
}

// Opens a real, visible browser window pre-authenticated for this account — the
// only way to hand someone the actual live Threads UI, since Threads (like the
// rest of Meta) refuses to render inside anyone else's iframe.
async function openManualBrowser(account, password) {
  const session = await mcpBrowserService.startSession({
    accountId: account._id.toString(),
    headless: false,
    storageState: loadStoredSession(account),
    userAgent: account.userAgent || null,
  });
  await ensureLoggedIn(session, account, password);
  await mcpBrowserService.callTool(session, 'browser_navigate', { url: 'https://www.threads.com/' });
  // Deliberately not closed here — left open for the human to use, closed later
  // via mcpBrowserService.closeSession (see automationController's stopSession).
  return session.id;
}

module.exports = {
  checkAuth,
  createPost,
  fetchComments,
  replyToComment,
  openManualBrowser,
  makeCommentKey,
};
