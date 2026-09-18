const crypto = require('crypto');
const { chromium } = require('playwright');
const stealth = require('./stealth');

// In-memory registry of live browser sessions. Each session owns its own
// browser instance so that different social accounts never share cookies,
// storage, or (when a VPN is attached at the OS level for that process) network path.
const sessions = new Map();

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const NAV_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS) || 30000;

// Playwright's own default UA otherwise reveals "HeadlessChrome" on some versions —
// use a realistic desktop Chrome string whenever an account has no user agent pinned.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

async function createSession({
  accountId,
  vpnServerId = null,
  vpnSessionId = null,
  label = '',
  userAgent = null,
  headless = null,
}) {
  const id = crypto.randomUUID();
  const ua = userAgent || DEFAULT_USER_AGENT;
  const channel = stealth.detectChromeChannel();
  const browser = await chromium.launch({
    headless: headless ?? HEADLESS,
    ...(channel ? { channel } : {}),
    args: stealth.launchArgs(),
  });
  const context = await browser.newContext({
    userAgent: ua,
    ...stealth.contextOptions(ua),
  });
  await context.addInitScript(stealth.initScript());
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  const session = {
    id,
    accountId,
    vpnServerId,
    vpnSessionId,
    label,
    userAgent: userAgent || DEFAULT_USER_AGENT,
    browser,
    context,
    page,
    createdAt: new Date(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function listSessions() {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    accountId: s.accountId,
    vpnServerId: s.vpnServerId,
    vpnSessionId: s.vpnSessionId,
    label: s.label,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
  }));
}

async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  await session.browser.close().catch(() => {});
  sessions.delete(id);
  return true;
}

async function closeAllSessions() {
  await Promise.all(Array.from(sessions.keys()).map((id) => closeSession(id)));
}

module.exports = {
  createSession,
  getSession,
  listSessions,
  closeSession,
  closeAllSessions,
};
