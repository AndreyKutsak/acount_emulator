const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const stealth = require('./stealth');
const profileManager = require('./profileManager');
const proxyManager = require('./proxyManager');
const { loadEngine } = require('./automation/browser');

const { chromium } = loadEngine();

// In-memory registry of live browser sessions. Each session owns its own
// browser instance so that different social accounts never share cookies,
// storage, or (when a VPN is attached at the OS level for that process) network path.
const sessions = new Map();

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const NAV_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS) || 30000;
const PROFILES_DIR = path.join(__dirname, '..', '..', process.env.PROFILES_DIR || 'profiles');

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
  profileId = null,
}) {
  const id = crypto.randomUUID();
  const profile = profileManager.getProfile(profileId);
  const ua = userAgent || profile.userAgent || DEFAULT_USER_AGENT;
  const proxy = proxyManager.buildProxy(accountId);
  const userDataDir = path.join(PROFILES_DIR, String(accountId || `session-${id}`));
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: headless ?? HEADLESS,
    ...(stealth.detectChromeChannel() ? { channel: 'chrome' } : {}),
    args: stealth.launchArgs(),
    ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
    userAgent: ua,
    viewport: profile.viewport,
    screen: profile.screen,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    colorScheme: 'light',
  });
  await context.addInitScript(stealth.initScript());
  await context.addInitScript(profileManager.profileInitScript(profileId));

  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  const session = {
    id,
    accountId,
    vpnServerId,
    vpnSessionId,
    label,
    userAgent: ua,
    profileId: profileId || profileManager.DEFAULT_PROFILE_ID,
    proxy: proxy ? { server: proxy.endpoint } : null,
    browser: context.browser(),
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
