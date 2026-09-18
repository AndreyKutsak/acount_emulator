const fs = require('fs');
const path = require('path');

// Shared anti-automation fingerprint layer.
//
// Stock Playwright Chromium reports `navigator.webdriver === true` and an empty
// `navigator.plugins` list — two of the easiest signals for a platform to flag an
// automated session. This module:
//   * patches the highest-signal fingerprints via an init script (stealthInit.js),
//   * configures a realistic viewport/screen/locale/timezone per session,
//   * prefers the real installed Google Chrome channel over the bundled Chromium,
//     both for the direct Playwright path and the Playwright MCP subprocess.
//
// No stealth layer is undetectable — this removes the obvious tells. It does NOT
// remove platform-level risk (checkpoints, phone verification, ToS enforcement),
// and over-aggressive patching can itself be a detection signal, so it stays
// conservative.

const INIT_SCRIPT_PATH = path.join(__dirname, 'stealthInit.js');

const LOCALE = process.env.STEALTH_LOCALE || 'uk-UA';
const TIMEZONE = process.env.STEALTH_TIMEZONE || 'Europe/Kyiv';

function initScript() {
  return fs.readFileSync(INIT_SCRIPT_PATH, 'utf8');
}

function launchArgs() {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
  ];
}

function uaLooksMobile(ua) {
  return /Android|iPhone|iPad|Mobile|IEMobile/i.test(ua || '');
}

// Context options for the direct Playwright path. Viewport/screen are derived from
// the account's pinned User-Agent so the emulation matches the browser it claims to be.
function contextOptions(userAgent) {
  const mobile = uaLooksMobile(userAgent);
  return {
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
    screen: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    deviceScaleFactor: mobile ? 3 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: LOCALE,
    timezoneId: TIMEZONE,
    colorScheme: 'light',
  };
}

const CHROME_CANDIDATES = [
  () => path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  () => path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  () => path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

// Returns 'chrome' when a real Chrome install is found, else null (caller falls
// back to Playwright's bundled Chromium).
function detectChromeChannel() {
  for (const candidate of CHROME_CANDIDATES) {
    const p = candidate();
    if (p && fs.existsSync(p)) return 'chrome';
  }
  return null;
}

// Viewport string for the Playwright MCP CLI's --viewport-size flag.
function mcpViewportSize(userAgent) {
  return uaLooksMobile(userAgent) ? '390,844' : '1366,768';
}

module.exports = {
  initScript,
  initScriptPath: INIT_SCRIPT_PATH,
  launchArgs,
  contextOptions,
  detectChromeChannel,
  mcpViewportSize,
  uaLooksMobile,
};
